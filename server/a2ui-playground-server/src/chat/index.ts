/**
 * 最小模型对话：只做「消息进、文本出」，**不带任何 A2UI 协议约束**。
 *
 * 与 `agent/` 的分工值得说清楚，因为两者看着都是在「跟模型说话」：
 * - `agent/` 的 system prompt 全是协议规则（组件目录、JSONL 硬约束、增量修改的写法），
 *   它的产出必须能被 `extract.ts` 解析成协议消息；
 * - 这里什么都不约束 —— 存在的意义只有一个：用**最短的路径**回答
 *   「baseURL + Key + 模型名 到底通不通」，把协议层与渲染层的变量全部排掉。
 *
 * 所以它刻意**不接**会话缓存（那个缓存记的是「界面是怎么长出来的」，一次纯聊天既不是界面、
 * 也不该占 surface 桶位）：多轮要由调用方把历史一起发过来，接口本身是无状态的。
 */
import type { OpenAIConfig } from '../config';
import type { ChatMessage, ModelDelta } from '../types';
import { createTextCompletionClient } from '../agent/openai-client';

export interface ModelChat {
  readonly model: string;
  complete(messages: ChatMessage[]): Promise<string>;
  /** 流式产出：片里可能是正式回复，也可能只是思考内容（思考模式下先来一大段）。 */
  stream(messages: ChatMessage[]): AsyncGenerator<ModelDelta>;
}

/** 闲聊的温度比协议生成高一些：0.2 会让对话过分干巴。 */
const CHAT_TEMPERATURE = 0.7;

export const createModelChat = (config: OpenAIConfig): ModelChat => {
  const client = createTextCompletionClient(config);

  return {
    model: client.model,
    complete: (messages) => client.complete(messages, { temperature: CHAT_TEMPERATURE }),
    stream: (messages) => client.stream(messages, { temperature: CHAT_TEMPERATURE }),
  };
};
