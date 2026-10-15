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

/**
 * 抽取一行文本里的消息。一行里若是一个数组，按元素逐个校验（展开为多条）。
 */
export const extractLine = (line: string): { messages: A2UIMessage[]; warnings: string[] } => {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { messages: [], warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { messages: [], warnings: [`JSON 解析失败 — ${reason}`] };
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const messages: A2UIMessage[] = [];
  const warnings: string[] = [];

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
