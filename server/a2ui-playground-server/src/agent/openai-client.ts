/**
 * OpenAI 兼容客户端的**唯一构造点**，外加「消息进 / 文本出」这个最小能力。
 *
 * 抽出来的原因是有两个消费方，而它们的差别只在「喂什么消息」：
 * - `agent/openai.ts` —— 喂 A2UI 协议提示词，产出协议 JSONL（要能被 `extract.ts` 解析）；
 * - `chat/index.ts`    —— 喂纯对话消息，产出普通文本（只为验证模型链接通不通）。
 *
 * 「建客户端 / 发请求 / 收流」这三件事两边一模一样。各写一份迟早会漂 —— 超时、重试、
 * 错误形状、`baseURL` 的处理都会各自演化，而其中一份往往没人维护。
 *
 * 兼容性全压在 `baseURL` 上：DeepSeek / Azure / 自建代理 / 各类中转都是 OpenAI 兼容接口，
 * 换网关只改环境变量，代码不动。
 *
 * ## 工具调用循环（tools）
 * 传了 `tools` 就走「模型要工具 → 执行 → 结果回灌 → 再问」的循环，直到模型产出最终文本。
 * 两个消费点都不需要知道循环的存在：`complete` 仍然返回最终文本，`stream` 仍然逐片
 * yield 最终文本（工具轮的思考过程照常透传，工具轮的空内容不影响装配）。
 */
import type { OpenAIConfig } from '../config';
import type { ChatMessage, ModelDelta, ToolExecutor } from '../types';
// 类型只在编译期存在：OpenAI SDK 的消息类型与我们的 `ChatMessage` 同构（role + content 分片），
// 但 SDK 把它定义成更严格的判别联合 —— 这里做一次类型层转换，运行期零开销。
import type OpenAI from 'openai';

type OpenAIModule = typeof import('openai');
type OpenAIClient = InstanceType<OpenAIModule['default']>;
type Conversation = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

export interface TextCompletionOptions {
  /** 缺省取配置里的 temperature。按调用点覆盖：协议生成要低，闲聊可以高。 */
  temperature?: number;
  /**
   * 工具执行器（通常是 MCP 客户端）。传了就走工具调用循环；不传就是普通补全。
   * A2UI 生成路径挂图标查询工具；纯对话路径不挂（它只验证模型链接）。
   */
  tools?: ToolExecutor;
  /** 单次请求内允许的最大工具轮数，防模型陷入「调用→再调用」死循环。 */
  maxToolRounds?: number;
}

/** 一次模型的「文本补全」能力，与 A2UI 协议无关。 */
export interface TextCompletionClient {
  readonly model: string;
  complete(messages: ChatMessage[], options?: TextCompletionOptions): Promise<string>;
  stream(messages: ChatMessage[], options?: TextCompletionOptions): AsyncGenerator<ModelDelta>;
}

/**
 * OpenAI 官方的 `delta` 类型里没有 `reasoning_content` —— 它是 DeepSeek 这类
 * 「思考模式」模型在 OpenAI 兼容协议上加的字段。只能自己声明。
 */
interface ReasoningDelta {
  content?: string | null;
  reasoning_content?: string | null;
}

/** 流式 `tool_calls` 增量的形状（SDK 类型藏得深，按协议字段自己声明）。 */
interface ToolCallDeltaShape {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** 累积成一个完整的工具调用（arguments 是分片拼过来的）。 */
interface StreamedToolCall {
  index: number;
  id: string;
  name: string;
  args: string;
}

const MAX_TOOL_ROUNDS = 4;

export const createTextCompletionClient = (config: OpenAIConfig): TextCompletionClient => {
  // 惰性 import：走 mock、或没配 Key 时这个 SDK 根本不会被加载，启动更快、也少一类启动期报错。
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

  const requestOf = (messages: Conversation, options: TextCompletionOptions) => ({
    model: config.model,
    temperature: options.temperature ?? config.temperature,
    messages,
  });

  const castMessages = (messages: ChatMessage[]): Conversation =>
    messages as unknown as Conversation;

  /** 我们的 `AgentToolDef` 包一层就是 OpenAI 的 tools 项。 */
  const toolsOf = (executor: ToolExecutor): OpenAI.Chat.Completions.ChatCompletionTool[] =>
    executor.definitions.map((def) => ({
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.inputSchema,
      },
    }));

  /** 工具参数解析失败时给空对象 —— 让模型看到错误结果，比让整轮请求崩掉好。 */
  const parseArgs = (raw: string): Record<string, unknown> => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  const toolCallDeltasOf = (delta: unknown): ToolCallDeltaShape[] => {
    const calls = (delta as { tool_calls?: ToolCallDeltaShape[] } | undefined)?.tool_calls;
    return Array.isArray(calls) ? calls : [];
  };

  /** 不带工具的普通流式（原路径，一行未改）。 */
  const streamOnce = async function* (
    messages: ChatMessage[],
    options: TextCompletionOptions,
  ): AsyncGenerator<ModelDelta> {
    const client = await getClient();
    const completion = await client.chat.completions.create({
      ...requestOf(castMessages(messages), options),
      stream: true,
    });

    for await (const chunk of completion) {
      // 思考内容与正式回复分成两个字段往外吐：调用方要能区分「模型在想」和「模型在答」。
      const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
      const content = delta?.content;
      const reasoning = delta?.reasoning_content;

      if (content || reasoning) {
        yield {
          ...(content ? { content } : {}),
          ...(reasoning ? { reasoning } : {}),
        };
      }
    }
  };

  return {
    model: config.model,

    async complete(messages, options = {}): Promise<string> {
      const executor = options.tools;
      const client = await getClient();

      if (executor === undefined) {
        const completion = await client.chat.completions.create({
          ...requestOf(castMessages(messages), options),
          stream: false,
        });
        return completion.choices[0]?.message?.content ?? '';
      }

      const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
      const conversation = castMessages(messages);

      for (let round = 0; round <= maxRounds; round += 1) {
        const completion = await client.chat.completions.create({
          ...requestOf(conversation, options),
          tools: toolsOf(executor),
          stream: false,
        });

        const message = completion.choices[0]?.message;
        const calls = message?.tool_calls ?? [];
        if (calls.length === 0) {
          return message?.content ?? '';
        }

        // assistant 消息（含 tool_calls）原样回灌，再逐条补 tool 结果 ——
        // 这是 OpenAI 工具协议的硬性要求：tool 消息必须紧跟在发起调用的 assistant 消息之后。
        conversation.push(message);
        for (const call of calls) {
          const result = await executor.execute(call.function.name, parseArgs(call.function.arguments));
          conversation.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }

      throw new Error(`工具调用连续 ${maxRounds} 轮仍未产出最终文本，已中止（防止死循环）`);
    },

    async *stream(messages, options = {}): AsyncGenerator<ModelDelta> {
      const executor = options.tools;
      if (executor === undefined) {
        yield* streamOnce(messages, options);
        return;
      }

      const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
      const conversation = castMessages(messages);

      for (let round = 0; round <= maxRounds; round += 1) {
        const client = await getClient();
        const completion = await client.chat.completions.create({
          ...requestOf(conversation, options),
          tools: toolsOf(executor),
          stream: true,
        });

        // 工具调用是分片流过来的：按 index 累积 id / name / arguments 再拼成完整调用。
        const pending = new Map<number, StreamedToolCall>();

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
          const content = delta?.content;
          const reasoning = delta?.reasoning_content;

          if (content || reasoning) {
            yield {
              ...(content ? { content } : {}),
              ...(reasoning ? { reasoning } : {}),
            };
          }

          for (const call of toolCallDeltasOf(delta)) {
            const index = call.index ?? 0;
            const slot = pending.get(index) ?? { index, id: '', name: '', args: '' };
            if (call.id !== undefined && call.id !== '') {
              slot.id = call.id;
            }
            if (call.function?.name) {
              slot.name += call.function.name;
            }
            if (call.function?.arguments) {
              slot.args += call.function.arguments;
            }
            pending.set(index, slot);
          }
        }

        if (pending.size === 0) {
          // 整轮都没有工具调用 —— 这就是最终文本（已边收边 yield 出去了）。
          return;
        }

        const calls = [...pending.values()].sort((a, b) => a.index - b.index);
        conversation.push({
          role: 'assistant',
          content: null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          })),
        });
        for (const call of calls) {
          const result = await executor.execute(call.name, parseArgs(call.args));
          conversation.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }

      throw new Error(`工具调用连续 ${maxRounds} 轮仍未产出最终文本，已中止（防止死循环）`);
    },
  };
};
