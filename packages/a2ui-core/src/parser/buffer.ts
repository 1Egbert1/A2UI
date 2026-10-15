/**
 * JSON 缓冲流（buffer stream）：从「任意切分的字符流」里还原出 A2UI 消息，
 * 再按协议**补全**成「一条消息一行」的 JSONL，交给 parser 解析。
 *
 * 与 `./stream`（`createJSONLStream`）的分工是**框定方式不同**，两者都要：
 *
 * - `createJSONLStream` 是**行框定**（line-framed）：它信任 `\n` 就是消息边界，按行切分。
 *   服务端规规矩矩「一条消息一行」时，它最简单也最快。
 * - 本模块是 **JSON 框定**（JSON-framed）：不依赖换行，而是在字符流里做**括号配对**，
 *   只要出现一个完整的 JSON 值（`{...}` 或 `[...]`）就立刻取出来。因此它能吃下：
 *   - 定长切片（如每片 50 字符）切在**任意位置**——切在字符串中间也不怕（含转义）；
 *   - 一条消息横跨很多片、一行里挤多条消息、甚至整段文本一个换行都没有；
 *   - 顶层直接是 JSON 数组（模型一次性给一批消息）——会把数组元素逐个当消息。
 *
 * ## 两层粒度：整值闭合 vs 子项闭合
 *
 * 模型（尤其是一次性输出一整批组件时）常常把 **N 个组件塞进同一条 `surfaceUpdate`**。
 * 如果只做「整值框定」，这条消息必须等**整个大括号闭合**才产出——中间那几十片全在干等，
 * 前端看到的还是「一次性全出现」。所以本模块在**两个粒度**上都做补全：
 *
 * 1. **子项粒度（增量，`extractPartialItems`）**：值**还没闭合**时，只要其中一个
 *    `components[i]` 自己闭合了，就立刻把它**补全成一条独立、完整、可解析**的 surfaceUpdate
 *    发出去 —— 这就是「边到边渲染」的关键，前端能看到组件一个个长出来。
 * 2. **整值粒度（兜底）**：值闭合时（`scanJSONValues`）走 `normalizeToJSONL`，把这条消息里
 *    **剩下**还没吐过的子项补齐（已经增量吐过的会被跳过，不重复）。
 *
 * 两条粒度必须产出**逐字节相同**的 JSONL（对同一个组件），实现上靠 `completeItem` 复用
 * `normalizeToJSONL` 来保证；`buffer.spec.ts` 里「紧凑进 / 逐条出，终态必须 deepEqual」是硬约束。
 *
 * ## 补全的机制：闭合序列
 *
 * 子项闭合时手上只有「值的前缀 + 这个子项」，要还原成合法消息，就补上把**尚未闭合的容器**
 * 逐个关掉的字符（`closeUnclosedContainers`）：
 *
 * ```jsonc
 * {"surfaceUpdate":{"surfaceId":"s","components":[ {…这里} ]]}}   ← 补的 ]}} 就是闭合序列
 * ```
 *
 * 于是「消息提取」= 在字符流里认出子项边界，「内容补全」= 用前缀 + 闭合序列拼回完整消息。
 *
 * 刷新时机：**每次 `push` 末尾刷新一次**（这一片真的产出了消息才刷）。
 * 也就是说「push 的粒度 = 刷新的粒度」——想更细就让调用方喂更小的片。
 */

import { ingestLine, refreshDerivedState } from './ingest';

/**
 * 已知的「批量消息」类型 → 载荷里可以逐个拆出的数组字段。
 *
 * 加新类型只需在这里登记一行：`normalizeToJSONL`（整值粒度）与 `extractPartialItems`
 * （子项粒度）共用同一张表，不会各拆各的。
 */
const SPLIT_ARRAY_FIELDS: Record<string, string> = {
  surfaceUpdate: 'components',
};

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
/** 标量值的终止字符：遇到它们就说明「这个数字/字面量读完了」。 */
const SCALAR_DELIMITERS = new Set([',', '}', ']', ' ', '\t', '\n', '\r']);

/** 一次扫描的结果：已完整的 JSON 值，以及还没闭合、留待下次的残留文本。 */
export interface ScanResult {
  /** 本次扫出的完整 JSON 值（原文，未被重新序列化）。 */
  values: string[];
  /** 未闭合的尾部（从当前值的起始括号开始），下次应当与新的分片拼起来再扫。 */
  rest: string;
}

/**
 * 从文本头部开始扫描**完整的顶层 JSON 值**。
 *
 * 用括号深度计数，并且**尊重字符串字面量**：`"` 内的 `{ } [ ]` 与转义引号 `\"` 都不参与计数。
 * 只有从深度 0 起、又回到 0 的 `{...}` / `[...]` 才算一个值——正是 A2UI 消息（对象）的形态。
 *
 * 值为**自终结**的：闭合括号一出现就完成，不需要 `\n` 之类的分隔符。所以返回的 `rest`
 * 只可能是一段**尚未闭合**的 JSON；已经完整的部分绝不会留在缓冲里。
 *
 * 顶层裸值（`42` / `"str"` / `true`）不识别——A2UI 的每条消息都是对象，不需要支持；
 * 值之间的空白、逗号等分隔符在深度 0 时被忽略。
 */
export const scanJSONValues = (text: string): ScanResult => {
  const values: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

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

    // 只在「值内部」才把引号当字符串开始；深度 0 处的引号是噪声，忽略。
    if (char === '"') {
      if (depth > 0) {
        inString = true;
      }
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      if (depth === 0) {
        // 没有对应开括号的闭括号：当作噪声跳过。
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(text.slice(start, i + 1));
        start = -1;
      }
    }
    // 其余字符（空白 / 逗号 / 冒号 / 在深度 0 处的任意噪声）一律忽略
  }

  return { values, rest: start >= 0 ? text.slice(start) : '' };
};

/** 跳过空白，返回下一个非空白字符的下标（越界时返回 `text.length`）。 */
const skipWhitespace = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && WHITESPACE.has(text[index] as string)) {
    index += 1;
  }
  return index;
};

/**
 * 读一个 JSON 字符串字面量（`from` 处必须是 `"`），返回其值与结束后的下标。
 *
 * `"` 还没出现（这一段字节还没到）时返回 `null` —— 调用方据此判断「这一块也还不能用」。
 * 解转义直接交给 `JSON.parse`，比自己再实现一遍 `\n` / `\uXXXX` 稳。
 */
const readString = (text: string, from: number): { value: string; end: number } | null => {
  if (text[from] !== '"') {
    return null;
  }

  let index = from + 1;
  let escaped = false;

  while (index < text.length) {
    const char = text[index] as string;

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return { value: JSON.parse(text.slice(from, index + 1)) as string, end: index + 1 };
    }

    index += 1;
  }

  return null;
};

/**
 * 从 `from` 起跳过一个完整的 JSON 值，返回其后的下标；**值尚未完整时返回 `-1`**。
 * 支持字符串、对象、数组，以及数字 / `true` / `false` / `null`。
 */
const skipValue = (text: string, from: number): number => {
  let index = skipWhitespace(text, from);
  const char = text[index];

  if (char === undefined) {
    return -1;
  }

  if (char === '"') {
    const literal = readString(text, index);
    return literal ? literal.end : -1;
  }

  if (char === '{' || char === '[') {
    let depth = 0;

    while (index < text.length) {
      const current = text[index] as string;

      if (current === '"') {
        const literal = readString(text, index);
        if (!literal) {
          return -1;
        }
        index = literal.end;
        continue;
      }

      if (current === '{' || current === '[') {
        depth += 1;
      } else if (current === '}' || current === ']') {
        depth -= 1;
        if (depth === 0) {
          return index + 1;
        }
      }

      index += 1;
    }

    return -1;
  }

  // 数字 / true / false / null：一路读到分隔符为止。
  let end = index;
  while (end < text.length && !SCALAR_DELIMITERS.has(text[end] as string)) {
    end += 1;
  }

  return end > index ? end : -1;
};

/**
 * 推导「把这段前缀闭合掉」需要补的字符序列（容器后进先出）。
 *
 * 例如 `{"surfaceUpdate":{"surfaceId":"s","components":[` → `]}}`。
 * 前缀里出现**未闭合的字符串**时返回 `null` —— 补全必须建立在结构可判定的前提上。
 */
const closeUnclosedContainers = (prefix: string): string | null => {
  const stack: string[] = [];
  let index = 0;

  while (index < prefix.length) {
    const char = prefix[index] as string;

    if (char === '"') {
      const literal = readString(prefix, index);
      if (!literal) {
        return null;
      }
      index = literal.end;
      continue;
    }

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      stack.pop();
    }

    index += 1;
  }

  return stack.reverse().join('');
};

/**
 * 把一个**完整 JSON 值**里属于「批量消息」的部分摊平成多条独立消息。
 * 不是批量消息（或结构不符）时返回 `null`，交给调用方走「原样成一行」。
 *
 * 摊平规则：`{ <messageKey>: { ...其余字段, <splitField>: [item] } }`，顺序保持。
 */
const splitBatchMessage = (item: unknown): string[] | null => {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const messageKey = Object.keys(record).find((key) => key in SPLIT_ARRAY_FIELDS);
  if (!messageKey) {
    return null;
  }

  const splitField = SPLIT_ARRAY_FIELDS[messageKey] as string;
  const payload = record[messageKey];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const items = (payload as Record<string, unknown>)[splitField];
  if (!Array.isArray(items)) {
    return null;
  }

  return items.map((entry) =>
    JSON.stringify({
      [messageKey]: { ...(payload as Record<string, unknown>), [splitField]: [entry] },
    }),
  );
};

/**
 * 把一个**完整的 JSON 值**补全成「一条消息一行」的 JSONL 字符串数组。
 *
 * - 顶层是数组时，逐个元素当消息（模型一次性给一批的场景）；
 * - 批量消息（见 `SPLIT_ARRAY_FIELDS`）：**每个子项一条独立消息**（`surfaceId` 等其余字段原样带上）；
 * - 其余消息：重新序列化成单行（去掉模型可能带上的缩进换行）；
 * - 顶层不是合法 JSON：原样返回，让 parser 去报错——缓冲层不吞错误。
 */
export const normalizeToJSONL = (value: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [value];
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const lines: string[] = [];

  for (const item of items) {
    const split = splitBatchMessage(item);
    if (split) {
      lines.push(...split);
      continue;
    }

    lines.push(JSON.stringify(item));
  }

  return lines;
};

/** 在未闭合文本里做子项级提取的结果。 */
export interface PartialItems {
  /** 本次扫到的**完整子项总数**（含被 `skip` 掉的前几条）。 */
  total: number;
  /** 已补全成 JSONL 的子项消息——只含第 `skip` 条之后的部分。 */
  messages: string[];
}

/** 把「前缀 + 单个子项 + 闭合序列」拼成的候选文本校验并规范化成一行 JSONL。 */
const completeItem = (candidate: string): string | null => {
  try {
    JSON.parse(candidate);
  } catch {
    // 结构可判定才补全，理论上不该走到这里；宁可少吐一条，也不吐一条垃圾给 parser。
    return null;
  }

  const [line] = normalizeToJSONL(candidate);
  return line ?? null;
};

/**
 * 从 `arrayOpen`（指向批量数组的 `[`）开始，逐个收集**已经闭合**的数组元素，
 * 每个元素都补全成「只含该元素」的一条完整消息。
 */
const collectPartialItems = (text: string, arrayOpen: number, skip: number): PartialItems => {
  const head = text.slice(0, arrayOpen + 1);
  const closers = closeUnclosedContainers(head);
  if (closers === null) {
    return { total: 0, messages: [] };
  }

  const result: PartialItems = { total: 0, messages: [] };
  let index = arrayOpen + 1;

  while (index < text.length) {
    index = skipWhitespace(text, index);

    if (text[index] === ']') {
      return result; // 数组已闭合：剩下的属于「整值粒度」，不在部分提取的职责里。
    }

    const end = skipValue(text, index);
    if (end < 0) {
      return result; // 当前元素还没吐完 → 下次再来。
    }

    result.total += 1;

    if (result.total > skip) {
      const line = completeItem(`${head}${text.slice(index, end)}${closers}`);
      if (line !== null) {
        result.messages.push(line);
      }
    }

    index = skipWhitespace(text, end);
    if (text[index] === ',') {
      index += 1;
      continue;
    }

    // 既不是逗号也不是数组结束：结构异常（或数组刚闭合），收手交给下一片。
    return result;
  }

  return result;
};

/**
 * 在**尚未闭合**的文本里，把「已经完整、能独立成消息」的批量子项抽出来并补全。
 *
 * 这是「消息提取 + JSONL 内容补全」的核心：**不等整个值闭合**，只要某个子项自己闭合了，
 * 就立刻用「前缀 + 该子项 + 闭合序列」拼出一条完整消息。
 *
 * 只处理规范的信封形态（顶层对象 → `{ <消息类型>: { ...字段, <数组>: [ ... ] } }`）：
 * - 顶层不是对象（如数组形态）、消息类型不可拆分、前面的字段还没吐完 → 返回空，交给整值粒度；
 * - 拆分数组必须是信封里**第一个键之后**的：数组排在最前时它后面可能还跟着必填字段
 *   （如 `surfaceId`），补出来的消息会缺字段，所以也交给整值粒度。A2UI 实际报文都满足这条。
 *
 * @param skip 已经吐过的子项条数（同一个未闭合值跨多次 push 时用来去重）
 */
export const extractPartialItems = (text: string, skip = 0): PartialItems => {
  const empty: PartialItems = { total: 0, messages: [] };

  let index = skipWhitespace(text, 0);
  if (text[index] !== '{') {
    return empty;
  }

  const topKey = readString(text, index + 1);
  if (!topKey) {
    return empty;
  }

  const splitField = SPLIT_ARRAY_FIELDS[topKey.value];
  if (!splitField) {
    return empty;
  }

  index = skipWhitespace(text, topKey.end);
  if (text[index] !== ':') {
    return empty;
  }
  index = skipWhitespace(text, index + 1);
  if (text[index] !== '{') {
    return empty; // 消息体必须是对象
  }

  // 在消息体里逐个键找「要拆分的数组」
  index += 1;
  let seenField = false;

  while (index < text.length) {
    index = skipWhitespace(text, index);

    if (text[index] === '}') {
      return empty; // 消息体已闭合：没有该数组，或已经走完
    }

    const key = readString(text, index);
    if (!key) {
      return empty;
    }

    index = skipWhitespace(text, key.end);
    if (text[index] !== ':') {
      return empty;
    }
    index = skipWhitespace(text, index + 1);

    if (key.value !== splitField) {
      const end = skipValue(text, index);
      if (end < 0) {
        return empty; // 数组之前的字段还没吐完 → 连数组在哪都还不知道
      }
      seenField = true;
      index = skipWhitespace(text, end);
      if (text[index] === ',') {
        index += 1;
      }
      continue;
    }

    // 数组必须是「第一个键之后」出现的：否则它后面可能还跟着必填字段（如 surfaceId），
    // 这时补出来的消息会缺字段。这种非规范报文交给整值粒度处理，不在这里猜。
    if (!seenField || text[index] !== '[') {
      return empty;
    }

    return collectPartialItems(text, index, skip);
  }

  return empty;
};

export interface A2UIBuffer {
  /**
   * 喂入一段文本。可以是一整段、一片、一个字，甚至空串。
   * @returns 本次**送给 parser 的消息条数**（已按协议补全并拆分，与 JSON 值个数不必相等）
   */
  push(chunk: string): number;
  /** 丢弃缓冲与计数。**不动 store**——要清 store 请另外调 `clearStore()`。 */
  reset(): void;
  /** 缓冲里还没闭合的残留文本（用于调试与断言）。 */
  readonly pending: string;
  /** 已扫出的完整 JSON 值个数（拆分前的「原始消息」数）。 */
  readonly valueCount: number;
  /** 已送给 parser 的 JSONL 消息条数（拆分后的「补全消息」数）。 */
  readonly messageCount: number;
  /** 已送出的 JSONL 行（拆分后的形态），供日志/断言。 */
  readonly emitted: readonly string[];
}

/**
 * 创建 A2UI 缓冲流。
 *
 * `push` 内部三件事：
 * ① 用 `scanJSONValues` 结算**已经闭合**的完整值（走 `normalizeToJSONL` 拆包，跳过已增量吐过的子项）；
 * ② 对**仍未闭合**的当前值做 `extractPartialItems`，把已完整的子项立刻补全发出去；
 * ③ 只要这一片真的产出了消息，就 `refreshDerivedState()`（hydrate + buildTree + 回调树渲染器）。
 */
export const createA2UIBuffer = (): A2UIBuffer => {
  let buffer = '';
  let valueCount = 0;
  let messageCount = 0;
  const emitted: string[] = [];
  /**
   * 当前**未闭合**的值里已经按子项增量吐出的条数。
   * 只服务于去重：这个值将来闭合时，整值路径只补吐「剩下的」那几条。
   */
  let drainedItems = 0;

  const emit = (line: string): void => {
    messageCount += 1;
    emitted.push(line);
    // 位置用「第 N 条消息」而不是行号——缓冲层没有物理行可数。
    ingestLine(line, `第 ${messageCount} 条消息`);
  };

  const push = (chunk: string): number => {
    buffer += chunk;

    // ① 整值粒度：结算已经闭合的完整值。
    const { values, rest } = scanJSONValues(buffer);
    let sent = 0;

    values.forEach((value, position) => {
      valueCount += 1;
      const lines = normalizeToJSONL(value);
      // 只有「上次遗留的那个未闭合值」才可能已经吐过子项，而它就是 values[0]。
      const drained = position === 0 ? drainedItems : 0;
      for (const line of lines.slice(drained)) {
        emit(line);
        sent += 1;
      }
    });

    // 上一个未闭合值已经结算完（或在下面重新计数），先归零。
    if (values.length > 0) {
      drainedItems = 0;
    }

    buffer = rest;

    // ② 子项粒度：对仍未闭合的当前值做增量提取，边到边吐。
    if (buffer === '') {
      drainedItems = 0;
    } else {
      const partial = extractPartialItems(buffer, drainedItems);
      drainedItems = partial.total;
      for (const line of partial.messages) {
        emit(line);
        sent += 1;
      }
    }

    if (sent > 0) {
      refreshDerivedState();
    }

    return sent;
  };

  const reset = (): void => {
    buffer = '';
    valueCount = 0;
    messageCount = 0;
    drainedItems = 0;
    emitted.length = 0;
  };

  return {
    push,
    reset,
    get pending() {
      return buffer;
    },
    get valueCount() {
      return valueCount;
    },
    get messageCount() {
      return messageCount;
    },
    get emitted() {
      return emitted;
    },
  };
};
