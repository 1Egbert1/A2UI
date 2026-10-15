/**
 * 流式（buffer stream）解析 JSONL 线协议。
 *
 * 与 `parseA2UI` 的区别只有「输入怎么到」：`parseA2UI` 一次性拿整段文本，本模块接受
 * **任意切分的片段**——网络分片、`readline` 逐行、甚至手工按字节切，都不影响结果。
 * 内部做三件事：
 *
 * 1. **缓冲拼接**：片段尾部不足一行的部分留在 buffer，等下一片补齐再处理；
 * 2. **逐行摄取**：凑齐一行就 trim → 空行跳过 → 交给 `ingestLine`（与 `parseA2UI` 同一条路径）；
 * 3. **每片请求刷新**：只要这一片真的解析出了消息，就 `requestDerivedStateRefresh()`（水合 +
 *    建树 + 回调树渲染器），使 store 尽快自洽、可渲染——这正是流式 UI 想要的「边到边渲染」。
 *
 * 关于「刷新」的时机：派生状态是**全量重算**，逐片同步重算在消息数很大时是 O(n²)。所以这里
 * 走的是**合帧**入口（`requestDerivedStateRefresh`）：同一帧内多次 push 只真正重算一次，
 * 具体的合并策略由 `../scheduler` 决定（浏览器合并到下一帧，Node / SSR 无 rAF 时同步执行）。
 * 单测环境没有 `requestAnimationFrame`，因此推完即可断言，行为与逐片同步一致。
 */

import { ingestLine, requestDerivedStateRefresh } from './ingest';

export interface JSONLStream {
  /**
   * 喂入一段文本。可以是一整段、一行、半行，甚至空串。
   * @returns 本次真正解析出的**消息条数**（空行不计）
   */
  push(chunk: string): number;
  /**
   * 结束流：把缓冲里最后一条**没有换行结尾**的消息也处理掉。
   * @returns 处理的消息条数（0 或 1）
   */
  end(): number;
  /** 丢弃缓冲与计数。**不动 store**——要清 store 请另外调 `clearStore()`。 */
  reset(): void;
  /** 缓冲里尚未成行的残留文本（用于调试与断言）。 */
  readonly pending: string;
  /** 已消费的**物理行数**（含空行），与文件行号一致，供错误定位。 */
  readonly lineCount: number;
  /** 已解析出的消息条数（空行不计）。 */
  readonly messageCount: number;
}

export const createJSONLStream = (): JSONLStream => {
  let buffer = '';
  let lineCount = 0;
  let messageCount = 0;

  /** 处理一个「以 \n 结尾」的完整行段；返回是否真的出了一条消息。 */
  const consumeSegment = (segment: string): boolean => {
    lineCount += 1;
    const line = segment.trim();
    if (line === '') {
      return false;
    }
    ingestLine(line, `第 ${lineCount} 行`);
    messageCount += 1;
    return true;
  };

  const push = (chunk: string): number => {
    buffer += chunk;

    const segments = buffer.split('\n');
    // 最后一段没有换行结尾，可能是半条消息，留在缓冲里等下一片。
    buffer = segments.pop() ?? '';

    let handled = 0;
    for (const segment of segments) {
      if (consumeSegment(segment)) {
        handled += 1;
      }
    }

    if (handled > 0) {
      requestDerivedStateRefresh();
    }

    return handled;
  };

  const end = (): number => {
    const rest = buffer;
    buffer = '';

    // 残留只有空白（典型情况：正文以换行结尾，push 时已把行全部消费）→ 无事可做，
    // 也不要计入行号，否则 lineCount 会比文件物理行数多 1。
    if (rest.trim() === '') {
      return 0;
    }

    consumeSegment(rest);
    requestDerivedStateRefresh();
    return 1;
  };

  const reset = (): void => {
    buffer = '';
    lineCount = 0;
    messageCount = 0;
  };

  return {
    push,
    end,
    reset,
    get pending() {
      return buffer;
    },
    get lineCount() {
      return lineCount;
    },
    get messageCount() {
      return messageCount;
    },
  };
};
