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
  ModelDelta,
} from '../types';
import { createLineAssembler, extractLine, extractMessages } from './extract';
import { createMockAgent } from './mock';
import { createOpenAIAgent } from './openai';
import type { AgentImplementation } from './provider';

export { buildChatMessages } from './messages';
export { buildRevisionHint, buildSystemPrompt } from './prompt';
export type { AgentImplementation } from './provider';

export interface A2UIAgent {
  readonly provider: AgentProvider;
  /**
   * 本轮实际会用哪个 provider。
   *
   * 单独暴露而不是让调用方直接读 `provider`：场景请求会绕过当前配置走 fixture，
   * 于是那一轮产出的是 mock。`a2ui.surface` 这类**元信息事件**必须如实反映它 ——
   * 否则客户端拿到的 provider 是假的（曾经就是这样：配了 openai 时，明明跑的是内置素材，
   * 事件却报 openai）。
   */
  providerFor(request: AgentRequest): AgentProvider;
  /** 一次性生成（非流式接口用）。 */
  generate(request: AgentRequest): Promise<AgentResult>;
  /** 流式生成：先逐片给 `delta`，每凑满一行就多给一条 `message`。 */
  stream(request: AgentRequest): AsyncGenerator<AgentStreamChunk>;
}

/**
 * 把一段模型文本流包成「文字增量 / 思考增量 / 完整消息」的流。
 *
 * 装配（半行 → 整行）只在这里做一次，两个 provider 都受益。
 *
 * **思考内容绝不进装配器**：它是一大段散文，塞进去既抽不出协议消息，还会把「查看原始输出」
 * 折叠区污染成读不懂的东西。它单独作为 `reasoning` 片透传，客户端只拿它显示「模型正在思考」。
 *
 * 导出是为了能被直接测：「思考片不进装配器」这条规矩，只有在装配器这一层才验得准。
 */
export const assembleStream = async function* (
  source: AsyncGenerator<ModelDelta>,
): AsyncGenerator<AgentStreamChunk> {
  const assembler = createLineAssembler();

  const emit = function* (lines: string[]): Generator<AgentStreamChunk> {
    for (const line of lines) {
      const { messages, warnings } = extractLine(line);

      // 坏行**不中断这一轮**，但要如实上报。静默丢掉是更坏的选择：模型把括号写错时，
      // 整棵组件树会消失而客户端毫不知情 —— 界面上只看到一片空白。
      for (const warning of warnings) {
        yield { warning };
      }
      for (const message of messages) {
        yield { message };
      }
    }
  };

  for await (const chunk of source) {
    if (chunk.reasoning) {
      yield { reasoning: chunk.reasoning };
    }

    if (chunk.content) {
      yield { delta: chunk.content };
      yield* emit(assembler.push(chunk.content));
    }
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

  /**
   * 场景专用的 provider。
   *
   * 示例场景是**内置 fixture**，不是模型产出 —— 所以不论当前配的是哪个 provider，场景请求
   * 一律走它。否则在 `AGENT_PROVIDER=openai` 下点一个示例，模型会收到一条空输入然后自由
   * 发挥，出来的东西和 fixture 毫无关系。
   */
  const fixtures = createMockAgent({ delayMs: config.mockStreamDelayMs });

  /** 本轮用哪个实现：带场景走 fixture，否则走配置的 provider。 */
  const pick = (request: AgentRequest): AgentImplementation =>
    request.scenario === undefined ? implementation : fixtures;

  return {
    provider: implementation.name,

    providerFor: (request: AgentRequest): AgentProvider => pick(request).name,

    async generate(request: AgentRequest): Promise<AgentResult> {
      const chosen = pick(request);
      const raw = await chosen.complete(request);
      const { messages, warnings } = extractMessages(raw);
      // provider 报的是**实际用了哪个**：场景请求在 openai 配置下也会如实回 'mock'。
      return { messages, raw, provider: chosen.name, warnings };
    },

    stream(request: AgentRequest): AsyncGenerator<AgentStreamChunk> {
      return assembleStream(pick(request).stream(request));
    },
  };
};

export type { A2UIMessage };
