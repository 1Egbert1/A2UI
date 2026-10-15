/**
 * Agent 门面：服务端「生成 A2UI 协议」这件事在这里收口。
 *
 * 分层：
 *   prompt / messages → 造输入（纯函数）
 *   provider（mock / openai） → 只吐文本
 *   extract           → 文本 → 协议消息（含坏行容错）
 *   index（本文件）    → 选 provider、把文本流装配成「增量 + 完整消息」的事件流
 *
 * 两个 provider 共用这一层的抽取与装配，保证流式/非流式的语义**必然一致**：
 * 非流式是「整段进 extractMessages」，流式是「逐行进 extractLine」，
 * 而 extractLine 正是 extractMessages 逐行时调用的那个函数。
 */
import type { ServerConfig } from '../config';
import type {
  AgentProvider,
  AgentRequest,
  AgentResult,
  AgentStreamChunk,
  A2UIMessage,
} from '../types';
import { createLineAssembler, extractLine, extractMessages } from './extract';
import { createMockAgent } from './mock';
import { createOpenAIAgent } from './openai';
import type { AgentImplementation } from './provider';

export { buildChatMessages } from './messages';
export { buildRevisionHint, buildSystemPrompt, COMPONENT_CATALOG } from './prompt';
export type { AgentImplementation } from './provider';

export interface A2UIAgent {
  readonly provider: AgentProvider;
  /** 一次性生成（非流式接口用）。 */
  generate(request: AgentRequest): Promise<AgentResult>;
  /** 流式生成：先逐片给 `delta`，每凑满一行就多给一条 `message`。 */
  stream(request: AgentRequest): AsyncGenerator<AgentStreamChunk>;
}

/**
 * 把一段文本流包成「文字增量 + 完整消息」的流。
 *
 * 装配（半行 → 整行）只在这里做一次，两个 provider 都受益。
 */
const assembleStream = async function* (
  source: AsyncGenerator<string>,
): AsyncGenerator<AgentStreamChunk> {
  const assembler = createLineAssembler();

  const emit = function* (lines: string[]): Generator<AgentStreamChunk> {
    for (const line of lines) {
      for (const message of extractLine(line).messages) {
        // 流式路径不为坏行报错：deltas 已经把原文喂给调用方了，调试面板看得到。
        yield { message };
      }
    }
  };

  for await (const chunk of source) {
    yield { delta: chunk };
    yield* emit(assembler.push(chunk));
  }

  yield* emit(assembler.flush());
};

export const createA2UIAgent = (config: ServerConfig): A2UIAgent => {
  if (config.agentProvider === 'openai' && config.openai.apiKey === '') {
    // 显式配了 openai 却没有 Key：宁可启动就炸，也不要运行期才发现每一轮都 502。
    throw new Error('AGENT_PROVIDER=openai 需要同时配置 OPENAI_API_KEY');
  }

  const implementation: AgentImplementation =
    config.agentProvider === 'openai'
      ? createOpenAIAgent(config.openai)
      : createMockAgent({ delayMs: config.mockStreamDelayMs });

  return {
    provider: implementation.name,

    async generate(request: AgentRequest): Promise<AgentResult> {
      const raw = await implementation.complete(request);
      const { messages, warnings } = extractMessages(raw);
      return { messages, raw, provider: implementation.name, warnings };
    },

    stream(request: AgentRequest): AsyncGenerator<AgentStreamChunk> {
      return assembleStream(implementation.stream(request));
    },
  };
};

export type { A2UIMessage };
