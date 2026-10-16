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
 */
import type { OpenAIConfig } from '../config';
import type { ChatMessage, ModelDelta } from '../types';
// 类型只在编译期存在：OpenAI SDK 的消息类型与我们的 `ChatMessage` 同构（role + content 分片），
// 但 SDK 把它定义成更严格的判别联合 —— 这里做一次类型层转换，运行期零开销。
import type OpenAI from 'openai';

type OpenAIModule = typeof import('openai');
type OpenAIClient = InstanceType<OpenAIModule['default']>;

export interface TextCompletionOptions {
  /** 缺省取配置里的 temperature。按调用点覆盖：协议生成要低，闲聊可以高。 */
  temperature?: number;
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

  const requestOf = (messages: ChatMessage[], options: TextCompletionOptions) => ({
    model: config.model,
    temperature: options.temperature ?? config.temperature,
    // 我们的 `ChatMessage` 与 SDK 的 `ChatCompletionMessageParam` 同构，但 SDK 把 role 定义成
    // 判别联合、content 定义成精确分片类型；直接透传会触发过严的类型报错。运行期形态一致，这里转换。
    messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
  });

  return {
    model: config.model,

    async complete(messages, options = {}): Promise<string> {
      const client = await getClient();
      const completion = await client.chat.completions.create({
        ...requestOf(messages, options),
        stream: false,
      });
      return completion.choices[0]?.message?.content ?? '';
    },

    async *stream(messages, options = {}): AsyncGenerator<ModelDelta> {
      const client = await getClient();
      const completion = await client.chat.completions.create({
        ...requestOf(messages, options),
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
    },
  };
};
