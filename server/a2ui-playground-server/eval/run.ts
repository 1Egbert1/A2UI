/**
 * A2UI 评测集 runner。
 *
 * 读 `eval/a2ui-eval-set.json`，逐条打 `POST /api/a2ui/run`（SSE），用「实际下发的事件」判定，
 * 最后打印通过率、耗时、以及**每页被丢弃的样式键**。
 *
 * 为什么需要它：这 26 条断言原本只是文档 —— 没有执行者，改动 prompt 时就没有任何门禁。
 *
 * 用法（cwd 必须是 server/a2ui-playground-server，`pnpm --filter` 会自动满足）：
 *   pnpm --filter a2ui-playground-server run eval
 *   pnpm --filter a2ui-playground-server run eval -- --only T01,T22
 *
 * 判定只看服务端事件：`a2ui.message` / `a2ui.warning` / `a2ui.surface` /
 * `TEXT_MESSAGE_CONTENT` / `RUN_ERROR`。断言字段的含义见 `eval/README.md`。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 只为了拿白名单做「样式体检」。这里刻意直接引源码而不是复制一份：
// 白名单的唯一真相在渲染层，复制到别处迟早分叉。
// 该文件的唯一外部依赖是 `import type { CSSProperties } from 'vue'`（编译期擦除），
// 所以在 node 里 import 它不会把 Vue 拉进来。
import { auditStyles } from '../../../packages/a2ui-vue/src/internal/styles';

type Json = Record<string, any>;

interface EvalCase {
  id: string;
  name: string;
  category: string;
  userPrompt: string;
  assert?: Json;
  followUps?: Array<{ userPrompt: string; assert?: Json }>;
  attachments?: Json[];
  notes?: string;
}

interface Turn {
  messages: Json[];
  warnings: string[];
  raw: string;
  surfaceId: string;
  error: string;
  elapsedMs: number;
}

const BASE = process.env.EVAL_BASE ?? 'http://127.0.0.1:3000';
/** 单轮超时：复杂业务页 + 思考模式，实测有到 40s 的，留足余量。 */
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 240_000);

const args = process.argv.slice(2);
const onlyArg = args.find((item, index) => args[index - 1] === '--only');
const only = onlyArg === undefined ? undefined : new Set(onlyArg.split(',').map((s) => s.trim()));

const loadCases = (): EvalCase[] => {
  const file = path.resolve(process.cwd(), 'eval/a2ui-eval-set.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { tests: EvalCase[] };
  return parsed.tests;
};

/** SSE 帧 → 事件对象。只认 `data:` 行（与 playground 的客户端解析保持一致）。 */
const handleFrame = (frame: string, turn: Turn): void => {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (dataLine === undefined) {
    return;
  }
  let event: Json;
  try {
    event = JSON.parse(dataLine.slice('data:'.length).trim()) as Json;
  } catch {
    return;
  }

  if (event.type === 'CUSTOM') {
    if (event.name === 'a2ui.message') {
      turn.messages.push(event.value as Json);
    } else if (event.name === 'a2ui.warning') {
      turn.warnings.push(String((event.value as Json)?.message ?? ''));
    } else if (event.name === 'a2ui.surface') {
      turn.surfaceId = String((event.value as Json)?.surfaceId ?? '');
    }
    return;
  }
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    turn.raw += String(event.delta ?? '');
    return;
  }
  if (event.type === 'RUN_ERROR') {
    turn.error = String(event.message ?? 'RUN_ERROR');
  }
};

const runTurn = async (threadId: string, message: string): Promise<Turn> => {
  const turn: Turn = {
    messages: [],
    warnings: [],
    raw: '',
    surfaceId: '',
    error: '',
    elapsedMs: 0,
  };

  const startedAt = Date.now();
  const response = await fetch(`${BASE}/api/a2ui/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ threadId, message }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok || response.body === null) {
    turn.error = `HTTP ${response.status}`;
    turn.elapsedMs = Date.now() - startedAt;
    return turn;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      handleFrame(buffer.slice(0, index), turn);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim() !== '') {
    handleFrame(buffer, turn);
  }

  turn.elapsedMs = Date.now() - startedAt;
  return turn;
};

// ── 从消息里提取可判定的材料 ──

const componentsOf = (messages: Json[]): Array<{ id: string; type: string; props: Json }> =>
  messages.flatMap((message) =>
    (message.surfaceUpdate?.components ?? []).map((item: Json) => {
      const props = (item.component ?? {}) as Json;
      const type = Object.keys(props)[0] ?? '';
      return { id: String(item.id), type, props: (props[type] ?? {}) as Json };
    }),
  );

/** 递归收集某个 key 的所有值（`literalString` / `valueString` / `path` 共用）。 */
const collectValues = (value: unknown, key: string, into: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectValues(item, key, into);
    }
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, item] of Object.entries(value as Json)) {
      if (k === key && typeof item === 'string') {
        into.push(item);
      } else {
        collectValues(item, key, into);
      }
    }
  }
  return into;
};

/** 数据模型里的 key 路径（`/a/b`），用于 `paths` 断言的另一侧匹配。 */
const modelPaths = (messages: Json[]): string[] => {
  const paths: string[] = [];
  const walk = (entries: Json[], prefix: string): void => {
    for (const entry of entries) {
      const here = `${prefix}/${String(entry.key)}`;
      paths.push(here);
      if (Array.isArray(entry.valueMap)) {
        walk(entry.valueMap, here);
      }
    }
  };
  for (const message of messages) {
    if (Array.isArray(message.dataModelUpdate?.contents)) {
      walk(message.dataModelUpdate.contents, '');
    }
  }
  return paths;
};

const actionObjects = (messages: Json[]): Json[] => {
  const found: Json[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === 'object') {
      const object = value as Json;
      if (typeof object.name === 'string' && (object.type === 'local' || object.context !== undefined)) {
        found.push(object);
      }
      Object.values(object).forEach(walk);
    }
  };
  walk(messages);
  return found;
};

/** 这一页被丢弃的样式键 + 可疑行高（复用渲染端的体检，判据唯一）。 */
const styleStats = (messages: Json[]): { dropped: string[]; badLineHeight?: number } => {
  const dropped = new Set<string>();
  let badLineHeight: number | undefined;
  for (const component of componentsOf(messages)) {
    const audit = auditStyles(component.props.styles);
    audit.dropped.forEach((key) => dropped.add(key));
    if (audit.suspiciousLineHeight !== undefined) {
      badLineHeight = audit.suspiciousLineHeight;
    }
  }
  return { dropped: [...dropped], badLineHeight };
};

// ── 断言判定 ──

const judge = (
  assert: Json | undefined,
  turn: Turn,
  previousSurfaceId: string,
): string[] => {
  const failures: string[] = [];
  if (assert === undefined) {
    return failures;
  }

  if (turn.error !== '') {
    failures.push(`运行出错：${turn.error}`);
    return failures;
  }

  const kinds = turn.messages.map((message) => Object.keys(message)[0] ?? '');
  const components = componentsOf(turn.messages);

  for (const expected of assert.messageTypes ?? []) {
    if (!kinds.includes(expected)) {
      failures.push(`缺少消息类型 ${expected}`);
    }
  }
  for (const forbidden of assert.excludeMessageTypes ?? []) {
    if (kinds.includes(forbidden)) {
      failures.push(`不该出现 ${forbidden}`);
    }
  }
  if (assert.lastMessage !== undefined && kinds.at(-1) !== assert.lastMessage) {
    failures.push(`最后一条是 ${kinds.at(-1) ?? '(空)'}，期望 ${assert.lastMessage}`);
  }

  const types = new Set(components.map((component) => component.type));
  for (const expected of assert.components ?? []) {
    if (!types.has(expected)) {
      failures.push(`缺少组件 ${expected}`);
    }
  }

  const texts = [
    ...collectValues(turn.messages, 'literalString'),
    ...collectValues(turn.messages, 'valueString'),
  ].join('\n');
  for (const expected of assert.texts ?? []) {
    if (!texts.includes(expected)) {
      failures.push(`缺少文案「${expected}」`);
    }
  }

  if (Array.isArray(assert.paths) && assert.paths.length > 0) {
    const haystack = [...collectValues(turn.messages, 'path'), ...modelPaths(turn.messages)];
    for (const expected of assert.paths) {
      if (!haystack.some((item) => item.includes(expected))) {
        failures.push(`缺少路径 ${expected}`);
      }
    }
  }

  const actions = actionObjects(turn.messages);
  for (const expected of assert.actionNames ?? []) {
    if (!actions.some((action) => action.name === expected)) {
      failures.push(`缺少动作 ${expected}`);
    }
  }
  if (assert.localAction === true && !actions.some((action) => action.type === 'local')) {
    failures.push('缺少本地动作（type:"local"）');
  }

  if (assert.sameSurfaceId === true && turn.surfaceId !== previousSurfaceId) {
    failures.push(`surfaceId 变了：${previousSurfaceId} → ${turn.surfaceId}`);
  }

  for (const forbidden of assert.rawNotContains ?? []) {
    if (turn.raw.includes(forbidden)) {
      failures.push(`原始输出里出现了「${forbidden}」`);
    }
  }
  if (typeof assert.minRawChars === 'number' && turn.raw.length < assert.minRawChars) {
    failures.push(`原始输出只有 ${turn.raw.length} 字符（至少 ${assert.minRawChars}）`);
  }

  if (assert.noWarnings === true && turn.warnings.length > 0) {
    failures.push(`${turn.warnings.length} 条 warning：${turn.warnings[0]}`);
  }

  return failures;
};

// ── 主流程 ──

interface CaseResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  failures: string[];
  turns: Turn[];
  dropped: string[];
  badLineHeight?: number;
  elapsedMs: number;
  note?: string;
}

const runCase = async (testCase: EvalCase): Promise<CaseResult> => {
  if (testCase.attachments !== undefined && testCase.attachments.length > 0) {
    return {
      id: testCase.id,
      name: testCase.name,
      status: 'skip',
      failures: [],
      turns: [],
      dropped: [],
      elapsedMs: 0,
      note: '需要附图（runner 暂不提供图片）',
    };
  }

  const threadId = `eval-${testCase.id.toLowerCase()}-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  const turns: Turn[] = [];
  const failures: string[] = [];

  const first = await runTurn(threadId, testCase.userPrompt);
  turns.push(first);
  failures.push(...judge(testCase.assert, first, ''));

  let previousSurface = first.surfaceId;
  for (const followUp of testCase.followUps ?? []) {
    const turn = await runTurn(threadId, followUp.userPrompt);
    turns.push(turn);
    failures.push(...judge(followUp.assert, turn, previousSurface));
    previousSurface = turn.surfaceId;
  }

  // 样式统计只看**最后一条真正产出组件的轮次**（增量轮通常只带一两个组件，统计它会失真）。
  const substantive = [...turns].reverse().find((turn) => turn.messages.length > 0) ?? first;
  const style = styleStats(substantive.messages);

  return {
    id: testCase.id,
    name: testCase.name,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    turns,
    dropped: style.dropped,
    badLineHeight: style.badLineHeight,
    elapsedMs: Date.now() - startedAt,
  };
};

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const main = async (): Promise<void> => {
  const cases = loadCases().filter((item) => only === undefined || only.has(item.id));
  if (cases.length === 0) {
    console.error('没有匹配的用例');
    process.exit(1);
  }

  console.log(`评测 ${cases.length} 条 · 目标 ${BASE} · 单轮超时 ${formatSeconds(TIMEOUT_MS)}\n`);

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const result = await runCase(testCase);
    results.push(result);

    const messages = result.turns.reduce((sum, turn) => sum + turn.messages.length, 0);
    const components = result.turns.reduce(
      (sum, turn) => sum + componentsOf(turn.messages).length,
      0,
    );
    const mark = result.status === 'pass' ? '✅' : result.status === 'skip' ? '⏭' : '❌';
    // 一行一条：进度只在**完成时**打印。用 `\r` 回写会让重定向到文件时留下一堆半行。
    console.log(
      `${mark} ${result.id}  ${formatSeconds(result.elapsedMs).padStart(6)}  ` +
        `${String(messages).padStart(3)} 条消息 · ${String(components).padStart(3)} 组件 · ` +
        `${String(result.dropped.length).padStart(2)} 丢键   ${result.name}`,
    );

    if (result.status !== 'pass') {
      for (const failure of result.failures) {
        console.log(`      - ${failure}`);
      }
      if (result.note !== undefined) {
        console.log(`      - ${result.note}`);
      }
    }
  }

  const passed = results.filter((item) => item.status === 'pass').length;
  const failed = results.filter((item) => item.status === 'fail').length;
  const skipped = results.filter((item) => item.status === 'skip').length;
  const scored = results.filter((item) => item.status !== 'skip');

  const totalDropped = scored.reduce((sum, item) => sum + item.dropped.length, 0);
  const withDropped = scored.filter((item) => item.dropped.length > 0);
  const keyCount = new Map<string, number>();
  for (const item of withDropped) {
    for (const key of item.dropped) {
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
    }
  }
  const topKeys = [...keyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const badLineHeight = results.filter((item) => item.badLineHeight !== undefined);
  const elapsed = scored.reduce((sum, item) => sum + item.elapsedMs, 0);

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`通过 ${passed} / 失败 ${failed} / 跳过 ${skipped} · 总耗时 ${(elapsed / 60000).toFixed(1)} 分钟`);

  if (withDropped.length > 0) {
    console.log(
      `\n样式键被丢弃：${withDropped.length}/${scored.length} 页命中，合计 ${totalDropped} 个` +
        `（平均 ${(totalDropped / scored.length).toFixed(1)} 个/页）`,
    );
    console.log(`  最高频：${topKeys.map(([key, count]) => `${key}×${count}`).join('、')}`);
  } else {
    console.log('\n样式键被丢弃：无');
  }

  if (badLineHeight.length > 0) {
    console.log(
      `可疑行高：${badLineHeight.map((item) => `${item.id}(lineHeight:${item.badLineHeight})`).join('、')}`,
    );
  }

  const noBegin = results.filter(
    (item) => item.turns.some((turn) => turn.messages.length > 0) && item.failures.some((f) => f.includes('beginRendering')),
  );
  if (noBegin.length > 0) {
    console.log(`beginRendering 相关失败：${noBegin.map((item) => item.id).join('、')}`);
  }

  process.exit(failed === 0 ? 0 : 1);
};

void main();
