/**
 * 字符流模拟：把「一整段 JSON / JSONL 文本」当成模型逐字吐出的流来喂。
 *
 * 真实的 LLM 流式输出是**按字符（token）**来的，一条 A2UI 消息会被切得七零八落，
 * 且切片边界与 JSON 结构毫无关系。本模块提供两件东西：
 *
 * 1. `chunkText`：纯函数，把文本按固定长度切片（默认 50 字符）；
 * 2. `simulateTextStream`：定时器驱动，每隔 `intervalMs` 吐一片（默认 50ms / 50 字符），
 *    是「模拟完整 JSON stream 输出」的现成实现。
 *
 * 配套使用：把 `simulateTextStream` 的每一片 `onChunk` 喂给 `createA2UIBuffer().push()`，
 * 就得到「字符流 → 缓冲拼行 → 协议补全 → parser 解析 → 渲染」的完整链路。
 */

/**
 * 把文本按固定长度切片；最后一片可能短于 `size`。
 *
 * 切片是**纯字符切分**，不关心 JSON 结构——边界切在字符串中间、切在转义符中间都无所谓，
 * 因为补全交给 `createA2UIBuffer`（它做括号配对）而不是这里。
 */
export const chunkText = (text: string, size: number): string[] => {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunkText 的 size 必须是正整数，实际收到 ${size}`);
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }
  return chunks;
};

export interface TextStreamOptions {
  /** 每片字符数，默认 50。 */
  chunkSize?: number;
  /** 相邻两片的间隔（毫秒），默认 50。 */
  intervalMs?: number;
  /** 每吐出一片调一次。 */
  onChunk: (chunk: string) => void;
  /** 全部吐完后调一次；手动 `stop()` 不算结束，不会触发。 */
  onEnd?: () => void;
}

/**
 * 按 `chunkSize` / `intervalMs` 把 `text` 逐片吐出，模拟一个字符流。
 *
 * - **第一片同步立即吐出**（避免开头静默一拍），之后每 `intervalMs` 一片；
 * - 文本为空时立即走 `onEnd`；
 * - 返回一个 `stop()`：手动中止，清掉定时器且不再调用 `onChunk` / `onEnd`。
 *
 * 计时器用的是 `setInterval` / `clearInterval`，Node 与浏览器通用。
 */
export const simulateTextStream = (text: string, options: TextStreamOptions): (() => void) => {
  const { chunkSize = 50, intervalMs = 50, onChunk, onEnd } = options;
  const chunks = chunkText(text, chunkSize);

  let index = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  /** 吐下一片；返回「是否还有后续」。 */
  const emitNext = (): boolean => {
    if (index >= chunks.length) {
      return false;
    }
    onChunk(chunks[index]);
    index += 1;
    return index < chunks.length;
  };

  const finish = (): void => {
    stop();
    onEnd?.();
  };

  if (chunks.length === 0) {
    finish();
    return stop;
  }

  // 立即吐第一片；只有一片时同步收尾，不必起定时器。
  if (!emitNext()) {
    finish();
    return stop;
  }

  timer = setInterval(() => {
    if (stopped) {
      return;
    }
    if (!emitNext()) {
      finish();
    }
  }, intervalMs);

  return stop;
};
