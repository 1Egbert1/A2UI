/**
 * Agent 实现（provider）的契约。
 *
 * 关键约定：**provider 只负责吐文本**。协议的抽取、校验、流式行装配都不在这里 ——
 * 那些是 agent 门面（`agent/index.ts`）的活。这样换模型时只需要实现「把请求变成文本」
 * 这一件事，抽帧逻辑仍然是同一份，两个 provider 的行为天然一致。
 */
import type { AgentProvider, AgentRequest, ModelDelta } from '../types';

export interface AgentImplementation {
  readonly name: AgentProvider;
  /** 一次性拿到完整输出（应当是一串 JSONL）。 */
  complete(request: AgentRequest): Promise<string>;
  /**
   * 流式吐字：逐片 yield 文本增量（可能是半行、甚至半个 token 片段）。
   *
   * 片里**可能只有思考内容**（`reasoning`）—— 照原样吐出去，怎么用由门面决定：
   * 抽取器只吃 `content`，思考内容单独作为「中间状态」上报。
   */
  stream(request: AgentRequest): AsyncGenerator<ModelDelta>;
}
