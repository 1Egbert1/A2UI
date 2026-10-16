/**
 * A2UI 的 OpenAI 实现：把对话消息发出去，把**协议文本**收回来。
 *
 * 职责边界很窄 —— 提示词怎么拼在 `messages.ts`/`prompt.ts`，输出怎么解析在 `extract.ts`，
 * 「建客户端 / 发请求 / 收流」在 `openai-client.ts`。本文件只剩「A2UI 该喂什么消息」这一件事。
 *
 * 温度刻意压低（配置里的 `OPENAI_TEMPERATURE`，缺省 0.2）：产出是 JSONL，格式正确比文采重要。
 */
import type { OpenAIConfig } from '../config';
import type { AgentRequest, ModelDelta } from '../types';
import { buildChatMessages } from './messages';
import { createTextCompletionClient } from './openai-client';
import type { AgentImplementation } from './provider';

export const createOpenAIAgent = (config: OpenAIConfig): AgentImplementation => {
  const client = createTextCompletionClient(config);

  return {
    name: 'openai',

    async complete(request: AgentRequest): Promise<string> {
      return client.complete(buildChatMessages(request));
    },

    stream(request: AgentRequest): AsyncGenerator<ModelDelta> {
      return client.stream(buildChatMessages(request));
    },
  };
};
