/**
 * 从模型输出里抽取 A2UI 协议消息。
 *
 * 模型（尤其非前沿模型）几乎不可能 100% 遵守「只输出 JSONL」——
 * 常见偏差有三类，这里逐类兜：
 * 1. 套了 ```json 围栏、或前面加一句「好的，这是你要的界面」→ `stripCodeFences` + 逐行挑；
 * 2. 输出成 JSON 数组（一次性解析时）→ 数组自动展开；
 * 3. 混进半截 JSON / 注释 / 空对象 → 单行失败只记 warning，不阻断整批。
 *
 * 设计原则：**抽取永不抛错**。坏行进 `warnings`，调用方照常拿到能用的部分；
 * 真出问题（一条消息都没抽出来）由上层决定怎么回。
 */
import { MESSAGE_KEYS, type A2UIMessage, type MessageKey } from './keys';

export { MESSAGE_KEYS };
export type { MessageKey };

export interface ExtractResult {
  messages: A2UIMessage[];
  /** 被丢弃的内容及原因，形如 `第 3 行: JSON 解析失败 — Unexpected token }`。 */
  warnings: string[];
}

type LineCheck = { ok: true; message: A2UIMessage } | { ok: false; reason: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * 校验单个对象是不是一条合法消息。
 *
 * 严格程度对标协议 schema 的 `additionalProperties: false`：**恰好一个顶层键**，
 * 且必须是四种消息之一；再按各自 required 字段做一层浅校验。只做浅层是因为
 * 深层组件属性由渲染器容错（未知属性被忽略），在服务端做全量 schema 校验收益很低。
 */
export const validateMessage = (value: unknown): LineCheck => {
  if (!isPlainObject(value)) {
    return { ok: false, reason: '不是 JSON 对象' };
  }

  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return {
      ok: false,
      reason: `顶层必须恰好一个键（收到 ${keys.length} 个：${keys.join(', ') || '无'}）`,
    };
  }

  const key = keys[0] as MessageKey;
  if (!MESSAGE_KEYS.includes(key)) {
    return { ok: false, reason: `未知消息类型「${keys[0]}」` };
  }

  const payload = value[key];
  if (!isPlainObject(payload)) {
    return { ok: false, reason: `${key} 的值必须是对象` };
  }

  if (!isNonEmptyString(payload.surfaceId)) {
    return { ok: false, reason: `${key}.surfaceId 必填` };
  }

  if (key === 'surfaceUpdate' && !Array.isArray(payload.components)) {
    return { ok: false, reason: 'surfaceUpdate.components 必须是数组' };
  }

  if (key === 'dataModelUpdate' && !Array.isArray(payload.contents)) {
    return { ok: false, reason: 'dataModelUpdate.contents 必须是数组' };
  }

  if (key === 'beginRendering' && !isNonEmptyString(payload.root)) {
    return { ok: false, reason: 'beginRendering.root 必填' };
  }

  return { ok: true, message: value as A2UIMessage };
};

/**
 * 剥掉 markdown 代码围栏。
 *
 * 只处理「成对围栏」这一种形态：找到第一行 ``` 与最后一行 ``` 并取中间内容。
 * 不追求覆盖所有 markdown 变体 —— 抽不出来时后面的兜底路径会接手。
 */
export const stripCodeFences = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().startsWith('```'));
  if (first === -1) {
    return text;
  }

  let last = -1;
  for (let index = lines.length - 1; index > first; index -= 1) {
    if (lines[index].trim().startsWith('```')) {
      last = index;
      break;
    }
  }

  return last === -1 ? text : lines.slice(first + 1, last).join('\n');
};

const tryParse = (text: string): { value: unknown } | null => {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
};

/**
 * 字符串感知的括号扫描：跳过字符串字面量（含转义），返回未闭合的栈与**首个错配位置**。
 *
 * `mismatchAt === -1 && stack.length > 0` 意味着「只是结尾没写完」——缺的闭合符序列是唯一解。
 */
const scanBrackets = (
  text: string,
): { stack: string[]; mismatchAt: number; openString: boolean } => {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) {
        return { stack, mismatchAt: index, openString: false };
      }
    }
  }

  // `openString` 为真说明字符串字面量没闭合 —— 报文被截断，任何"补括号"都是徒劳。
  return { stack, mismatchAt: -1, openString: inString };
};

/** 栈 → 需要补齐的闭合符序列（栈顶先补）。 */
const closersOf = (stack: string[]): string =>
  stack
    .slice()
    .reverse()
    .map((char) => (char === '{' ? '}' : ']'))
    .join('');

/**
 * 修复成果的**唯一判据**：能 parse，且至少一条消息通过结构校验。
 *
 * 这是整条容错链的安全阀 —— 候选再合理，只要修出来不是一条合法协议消息就不采纳。
 */
const acceptRecovered = (text: string): { value: unknown } | null => {
  const parsed = tryParse(text);
  if (parsed === null) {
    return null;
  }
  const candidates = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  return candidates.some((candidate) => validateMessage(candidate).ok) ? parsed : null;
};

/**
 * 连写错**两处**时的迭代修补。
 *
 * 真实输出里出现过这种形态：数组收尾处本该 `]` 却写了 `}`，末尾还多一个 `}` ——
 * 单点编辑（删 / 换 / 插）全都无法让它变成合法 JSON，但**结构信息仍在**。
 *
 * 做法：每轮用括号栈找首个错配，枚举几种单字符编辑（`}`↔`]` 互换、删除、插 `}`、插 `]`），
 * 选「能让错配位置推进最远（或直接平衡）」的那个，最多 4 轮。贪心、有界、可验证。
 * 字符串未闭合（报文截断）时直接放弃 —— 那种情况补括号只会造出错误的界面。
 */
const repairByStack = (text: string): { value: unknown; rounds: number } | null => {
  let current = text;

  for (let round = 1; round <= 4; round += 1) {
    const { stack, mismatchAt, openString } = scanBrackets(current);
    if (openString) {
      return null;
    }

    if (mismatchAt === -1) {
      if (stack.length === 0) {
        const parsed = acceptRecovered(current);
        return parsed === null ? null : { value: parsed.value, rounds: round - 1 };
      }
      // 结尾还缺闭合：按栈补齐后继续下一轮（可能还有前面的错）。
      current += closersOf(stack);
      continue;
    }

    const char = current[mismatchAt]!;
    const candidates: string[] = [];
    if (char === '}') {
      candidates.push(current.slice(0, mismatchAt) + ']' + current.slice(mismatchAt + 1));
    }
    if (char === ']') {
      candidates.push(current.slice(0, mismatchAt) + '}' + current.slice(mismatchAt + 1));
    }
    candidates.push(current.slice(0, mismatchAt) + current.slice(mismatchAt + 1));
    candidates.push(current.slice(0, mismatchAt) + '}' + current.slice(mismatchAt));
    candidates.push(current.slice(0, mismatchAt) + ']' + current.slice(mismatchAt));

    let best: string | null = null;
    let bestScore = -1;
    for (const candidate of candidates) {
      const probe = scanBrackets(candidate);
      const score = probe.mismatchAt === -1 ? Number.MAX_SAFE_INTEGER : probe.mismatchAt;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    // 修不动就别硬来（避免在错误方向上原地打转）。
    if (best === null || bestScore <= mismatchAt) {
      return null;
    }
    current = best;
  }

  return null;
};

/**
 * JSON.parse 失败时尝试**可验证**的修复。
 *
 * 历史做法是逐条匹配 V8 的报错文案（多一个 `}` / 少一个 `]` …），但实测模型的括号错误形态
 * 远比文案丰富：内层 styles 与组件对象**同时**少闭合、结尾整组缺失、少两层……每加一种就得
 * 再补一个分支，且 V8 对「对象少闭合」在不同位置还会报不同的错（`Expected double-quoted
 * property name` vs `Expected ',' or '}' after property value`）。
 *
 * 因此改成**结构化候选 + 唯一判据**，按「最小改动优先」依次尝试：
 *
 * 1. **结尾按栈补齐**：无错配但栈非空 → 缺的闭合符序列是唯一解，直接补（治「少 N 层」）。
 * 2. **删掉报错位置的多余闭合符**（`Expected ',' or ']' after array element` 的典型形态）。
 * 3. **在报错位置前插入 1~3 个闭合符**（治内层少闭合导致的错配，报错点会停在下一个 token 上）。
 * 4. **删掉报错位置的多余逗号 / 关闭符**。
 *
 * 每个候选都必须过 `acceptRecovered`（能 parse + 至少一条合法消息），修错就拦下。
 * 跨段的**重构式**修复仍不在此列 —— 风险过高，宁可记 warning 让人来看。
 */
const recoverJson = (text: string, error: string): { value: unknown; note: string } | null => {
  // ① 结尾缺闭合：唯一解，不必搜索。
  const { stack, mismatchAt } = scanBrackets(text);
  if (mismatchAt === -1 && stack.length > 0) {
    const closers = closersOf(stack);
    const closed = acceptRecovered(text + closers);
    if (closed !== null) {
      // 常见形态用具体措辞（对接原有提示文案），其余给通用描述。
      const note =
        closers === ']'
          ? '数组少了一个闭合 `]`，已补上'
          : closers === ']}'
            ? '结尾少了一组闭合 `]}`，已补上'
            : `结尾缺少 ${closers.length} 个闭合符（\`${closers}\`），已补上`;
      return { value: closed.value, note };
    }
  }

  const match = /position (\d+)/.exec(error);
  if (match === null) {
    return null;
  }
  // 报错位置可能是 EOF（`position` 等于长度），结尾缺闭合时正是这种形态。
  const pos = Math.min(Number(match[1]), text.length);

  // ② 多余的闭合符：删掉报错位置连续 1~2 个。
  if (text[pos] === '}' || text[pos] === ']') {
    for (const count of [1, 2]) {
      const removed = acceptRecovered(text.slice(0, pos) + text.slice(pos + count));
      if (removed !== null) {
        return {
          value: removed.value,
          note:
            count === 1
              ? `数组元素后多了一个 \`${text[pos]}\`，已删除`
              : `数组元素后多了 ${count} 个 \`${text[pos]}\`，已删除`,
        };
      }
    }
  }

  // ②b 闭合符写错：本该是 `]` 的地方写成 `}`（或反之）。
  //
  // 这是模型的另一类高频错误 —— 数组元素收尾时习惯性多敲一个 `}`，把 `]` 顶掉了，
  // 于是 `tabItems:[...]` / `components:[...]` 在这里就"错配"。此时删和插都修不好，
  // 只有把这个字符**换掉**才对。
  const swapped = text[pos] === '}' ? ']' : text[pos] === ']' ? '}' : null;
  if (swapped !== null) {
    const fixed = acceptRecovered(text.slice(0, pos) + swapped + text.slice(pos + 1));
    if (fixed !== null) {
      return {
        value: fixed.value,
        note: `闭合符写错了（\`${text[pos]}\` 应为 \`${swapped}\`），已更正`,
      };
    }
  }

  // ③ 局部缺闭合：在报错位置前补 1~3 个闭合符，或补一个漏掉的逗号。
  //
  // 插入点有两个：报错位置本身，以及「报错位置前一个字符是逗号」时逗号**之前** ——
  // 内层对象少闭合时，解析器会一路读到下一个元素的 `{` 才报错，真正缺的 `}` 在逗号前。
  const inserts = [
    '}',
    ']',
    ']}',
    '}]',
    '}}',
    ']}}',
    '}]}',
    '}}]',
    ']]',
    ']]}',
    ']}]',
    '}}}]',
    // 逗号放最后：它是「漏逗号」的修法，不该抢在闭合符之前命中。
    ',',
    '},',
    '},}',
  ];
  // 常见形态给具体措辞（人看 warning 是为了知道模型错在哪），多闭合符才用通用描述。
  const describeInsert = (insert: string): string => {
    if (insert === '}') {
      return '对象少了一个闭合 `}`，已补上';
    }
    if (insert === ']') {
      return '数组少了一个闭合 `]`，已补上';
    }
    if (insert === ']}') {
      return '结尾少了一组闭合 `]}`，已补上';
    }
    if (insert === ',') {
      return '对象/数组元素之间漏了一个 `,`，已补上';
    }
    return `括号不匹配，已在报文里补上 \`${insert}\``;
  };
  const anchors = text[pos - 1] === ',' ? [pos - 1, pos] : [pos];
  for (const anchor of anchors) {
    for (const insert of inserts) {
      const patched = acceptRecovered(text.slice(0, anchor) + insert + text.slice(anchor));
      if (patched !== null) {
        return { value: patched.value, note: describeInsert(insert) };
      }
    }
  }

  // ④ 多余的逗号：删掉再试。
  if (text[pos] === ',') {
    const removed = acceptRecovered(text.slice(0, pos) + text.slice(pos + 1));
    if (removed !== null) {
      return { value: removed.value, note: '多余的 `,`，已删除' };
    }
  }

  // ⑤ 单点都不成立时，走「按栈迭代修补」——处理**连写错两处**的报文（真实输出里并不少见）。
  const repaired = repairByStack(text);
  if (repaired !== null) {
    return {
      value: repaired.value,
      note: `多处括号错位，已按括号结构修补 ${repaired.rounds} 处`,
    };
  }

  return null;
};

/**
 * 抽取一行文本里的消息。一行里若是一个数组，按元素逐个校验（展开为多条）。
 */
export const extractLine = (line: string): { messages: A2UIMessage[]; warnings: string[] } => {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { messages: [], warnings: [] };
  }

  let parsed: unknown;
  let recoveryNote = '';
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fixed = recoverJson(trimmed, reason);
    if (fixed === null) {
      return { messages: [], warnings: [`JSON 解析失败 — ${reason}`] };
    }
    parsed = fixed.value;
    recoveryNote = fixed.note;
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const messages: A2UIMessage[] = [];
  const warnings: string[] = [];
  if (recoveryNote !== '') {
    // 修好了就别当「坏行」丢：消息照常采纳，但留一句提示让调用方知道模型这里翻过车。
    warnings.push(recoveryNote);
  }

  for (const candidate of candidates) {
    const check = validateMessage(candidate);
    if (check.ok) {
      messages.push(check.message);
    } else {
      warnings.push(check.reason);
    }
  }

  return { messages, warnings };
};

/**
 * 从整段文本抽取消息。
 *
 * 主路径是逐行；一行都没成功时再试「整段当一个 JSON 解析」（兜「漂亮打印的多行 JSON」）。
 */
export const extractMessages = (text: string): ExtractResult => {
  const body = stripCodeFences(text);
  const messages: A2UIMessage[] = [];
  const warnings: string[] = [];

  body.split(/\r?\n/).forEach((line, index) => {
    const result = extractLine(line);
    messages.push(...result.messages);
    for (const warning of result.warnings) {
      warnings.push(`第 ${index + 1} 行: ${warning}`);
    }
  });

  if (messages.length > 0) {
    return { messages, warnings };
  }

  const whole = body.trim();
  if (whole === '') {
    return { messages, warnings };
  }

  try {
    const parsed: unknown = JSON.parse(whole);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const check = validateMessage(candidate);
      if (check.ok) {
        messages.push(check.message);
      } else {
        warnings.push(check.reason);
      }
    }
  } catch {
    // 逐行与整段都失败：保留逐行的 warnings，它们比「整段解析失败」更有定位价值。
  }

  return { messages, warnings };
};

/**
 * 行装配器：把任意切分的文本碎片还原成完整行。
 *
 * 流式路径的关键件 —— 模型吐字是按 token 切的，一行 JSON 会被切成好几个 chunk，
 * 必须攒到换行符才算一行，否则每片都会 JSON 解析失败。
 */
export const createLineAssembler = () => {
  let pending = '';

  return {
    /** 吃一个文本碎片，返回其中已完成的行。 */
    push(chunk: string): string[] {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      // 最后一段没有换行收尾，是半行，留到下次。
      pending = lines.pop() ?? '';
      return lines;
    },
    /** 流结束时取出残留（模型最后一行常常没有换行）。 */
    flush(): string[] {
      const tail = pending;
      pending = '';
      return tail === '' ? [] : [tail];
    },
  };
};
