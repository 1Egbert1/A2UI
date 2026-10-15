/**
 * OpenAI 实现（后续接真模型时启用，当前默认不启用 —— 见 `agent/index.ts` 的 provider 选择）。
 *
 * 职责边界很窄：把对话消息发出去，把文本收回来（一次性或流式）。
 * 提示词怎么拼在 `messages.ts`/`prompt.ts`，输出怎么解析在 `extract.ts`，
 * 换模型或换网关（`baseURL` 兼容 Azure / 自建代理 / 各类中转）只动这一个文件。
 */
import type { OpenAIConfig } from '../config';
import type { AgentRequest, ChatMessage } from '../types';
import { buildChatMessages } from './messages';
import type { AgentImplementation } from './provider';

type OpenAIModule = typeof import('openai');
type OpenAIClient = InstanceType<OpenAIModule['default']>;

export const createOpenAIAgent = (config: OpenAIConfig): AgentImplementation => {
  // 惰性 import：provider 不是 openai 时这个 SDK 根本不会被加载，启动更快、也少一类启动期报错。
  let clientPromise: Promise<OpenAIClient> | undefined;

  const getClient = async (): Promise<OpenAIClient> => {
    clientPromise ??= import('openai').then(
      ({ default: OpenAI }) =>
        new OpenAI({
          apiKey: config.apiKey,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        }),
    );
    return clientPromise;
  };

  const requestOf = (messages: ChatMessage[]) => ({
    model: config.model,
    temperature: config.temperature,
    messages,
  });

  return {
    name: 'openai',

    async complete(request: AgentRequest): Promise<string> {
      const client = await getClient();
      const completion = await client.chat.completions.create({
        ...requestOf(buildChatMessages(request)),
        stream: false,
      });
      return completion.choices[0]?.message?.content ?? '';
    },

    async *stream(request: AgentRequest): AsyncGenerator<string> {
      const client = await getClient();
      const completion = await client.chat.completions.create({
        ...requestOf(buildChatMessages(request)),
        stream: true,
      });

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
    },
  };
};
