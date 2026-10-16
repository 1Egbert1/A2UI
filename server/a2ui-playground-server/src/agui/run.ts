/**
 * 两条流 → AG-UI 事件序列。
 *
 * 这是本项目对 AG-UI 的**唯一映射点**，也是「A2UI 与 AG-UI 怎么配合」这句话的落点：
 * AG-UI 负责「agent 和前端之间怎么通信」，A2UI 负责「agent 生成什么界面」——
 * 于是 A2UI 的协议消息被当作领域载荷，走 AG-UI 的 CUSTOM 通道原样透传。
 *
 * 两条映射：
 * - `runA2UIStream` —— A2UI agent：文本增量 + 协议消息（`CUSTOM a2ui.message`）；
 * - `runChatStream` —— 纯模型对话（`/api/a2ui/chat`）：只有文本增量，**没有任何协议消息**。
 *
 * 一轮 run 的事件序列（正常路径）：
 *   RUN_STARTED
 *   CUSTOM a2ui.surface        ← 会话/界面/provider 元信息，后续事件才有归属
 *   CUSTOM model.reasoning × N ← 思考过程的增量（仅思考模式的模型；客户端据此显示「模型正在思考」）
 *   TEXT_MESSAGE_START         ← 惰性：真有文字增量时才发
 *   TEXT_MESSAGE_CONTENT × N   ← 模型原始文本增量（聊天面板可以实时显示）
 *   TEXT_MESSAGE_END
 *   CUSTOM a2ui.message × N    ← 每条完整的 A2UI 协议消息，客户端可直接解析渲染
 *   CUSTOM a2ui.warning × N    ← 没能解析成协议消息的行（不中断这一轮，但必须让客户端知道）
 *   RUN_FINISHED               ← result 里带回 surfaceId 与消息条数
 *
 * 出错时把已收到的部分正常收尾（文本消息闭合、onFinish 落库），再以 RUN_ERROR 结束 ——
 * 流已经打开、HTTP 状态码改不了了，错误只能走在流里。
 */
import type { A2UIAgent } from '../agent';
import type { AgentProvider, AgentRequest, A2UIMessage, ModelDelta } from '../types';
import {
  A2UI_CUSTOM_EVENT,
  MODEL_CUSTOM_EVENT,
  createEventFactory,
  type AgUiEvent,
} from './events';

export interface A2UIRunOptions {
  agent: A2UIAgent;
  request: AgentRequest;
  /** 对应 AG-UI 的 threadId，本项目就是 sessionId。 */
  threadId: string;
  runId: string;
  /** 注入时钟，便于测试断言 timestamp。 */
  now?: () => number;
  /**
   * 流结束（含出错）时回调，携带本轮抽到的消息与原始文本 ——
   * 路由层拿它落库（历史轮次 + surface 缓存），从而不必把会话状态耦合进协议映射。
   */
  onFinish?: (result: { messages: A2UIMessage[]; raw: string }) => void;
}

/** 供 RUN_FINISHED 的 result 使用：不带原始文本，避免把整段模型输出塞进终帧。 */
interface RunSummary {
  surfaceId: string;
  provider: AgentProvider;
  messageCount: number;
  messages: A2UIMessage[];
}

export async function* runA2UIStream(options: A2UIRunOptions): AsyncGenerator<AgUiEvent> {
  const { agent, request, threadId, runId, onFinish } = options;
  const event = createEventFactory(options.now);

  const messages: A2UIMessage[] = [];
  let raw = '';
  let textMessageId: string | undefined;
  let settled = false;

  /**
   * 落库一次且仅一次。
   *
   * 放在 `finally` 里触发是为了**客户端中途断开**这种情况：调用方 destroy 掉流时，
   * 生成器会被 `return()` 提前收尾，正常路径后面的代码根本不执行 ——
   * 那时候已经抽到的消息不该丢（用户已经看到了一部分界面）。
   */
  const settle = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    onFinish?.({ messages, raw });
  };

  yield event.runStarted(threadId, runId);
  // 报「本轮实际会用哪个 provider」而不是配置项：场景请求走内置 fixture，那条路与
  // AGENT_PROVIDER 无关，如实上报才能让客户端的状态条说真话。
  const provider = agent.providerFor(request);
  yield event.custom(A2UI_CUSTOM_EVENT.surface, {
    threadId,
    surfaceId: request.surfaceId,
    provider,
  });

  try {
    for await (const chunk of agent.stream(request)) {
      if (chunk.reasoning) {
        // 思考过程**只上报、不入账**：`raw` 必须保持「模型产出的协议文本」这一含义，
        // 否则「查看原始输出」会变成一大段散文，排查协议问题时反而看不清。
        yield event.custom(MODEL_CUSTOM_EVENT.reasoning, { delta: chunk.reasoning });
      }

      if (chunk.warning) {
        yield event.custom(A2UI_CUSTOM_EVENT.warning, { message: chunk.warning });
      }

      if (chunk.delta) {
        // 惰性开文本消息：任一轮若一个字都没吐（比如直接报错），
        // 就不会留下一个「开始了却没有任何内容」的空文本消息。
        if (textMessageId === undefined) {
          textMessageId = `msg-${runId}`;
          yield event.textMessageStart(textMessageId);
        }
        raw += chunk.delta;
        yield event.textMessageContent(textMessageId, chunk.delta);
      }

      if (chunk.message) {
        messages.push(chunk.message);
        yield event.custom(A2UI_CUSTOM_EVENT.message, chunk.message);
      }
    }
  } catch (error) {
    if (textMessageId !== undefined) {
      yield event.textMessageEnd(textMessageId);
    }
    settle();
    yield event.runError(error instanceof Error ? error.message : String(error), 'AGENT_ERROR');
    return;
  } finally {
    settle();
  }

  if (textMessageId !== undefined) {
    yield event.textMessageEnd(textMessageId);
  }

  if (messages.length === 0) {
    // 流是通的、模型也回话了，但一条合法协议消息都没抽出来 ——
    // 客户端拿不到任何界面，这必须当成失败，不能悄悄以 RUN_FINISHED 收场。
    yield event.runError(
      raw.trim() === ''
        ? 'agent 没有产出任何输出'
        : 'agent 输出里没有可解析的 A2UI 协议消息（原文见请求日志）',
      'EMPTY_OUTPUT',
    );
    return;
  }

  const result: RunSummary = {
    surfaceId: request.surfaceId,
    provider,
    messageCount: messages.length,
    messages,
  };
  yield event.runFinished(threadId, runId, result);
}

export interface ChatRunOptions {
  /** 模型的产出流（`ModelChat.stream()`）：片里可能是正式回复，也可能只是思考内容。 */
  source: AsyncGenerator<ModelDelta>;
  /** 对应 AG-UI 的 threadId。对话接口是无状态的，这个值只用来回显。 */
  threadId: string;
  runId: string;
  /** 本轮实际调用的模型名。 */
  model: string;
  /** 注入时钟，便于测试断言 timestamp。 */
  now?: () => number;
}

/**
 * 纯模型对话 → AG-UI 事件序列。
 *
 * 与 `runA2UIStream` 的差别只有一处、但很关键：**这里没有 `CUSTOM a2ui.message`**。
 * 一轮对话不产出任何界面，客户端也只把文本增量叠进气泡 —— 若还是照发协议消息，
 * 就说明「仅测模型对话」这条路偷偷把 A2UI 那一层也拉进来了，那正是要排除的变量。
 *
 * 思考模式下的序列会长这样（**这就是「中间状态」的来源**）：
 *   RUN_STARTED → CUSTOM model.info → CUSTOM model.reasoning × N → TEXT_MESSAGE_START
 *   → TEXT_MESSAGE_CONTENT × N → TEXT_MESSAGE_END → RUN_FINISHED
 * 只收到 `reasoning` 而还没收到 `content` 的那段时间，就是模型在思考 —— 客户端据此显示
 * 「模型正在思考」而不是干等一句「正在回复…」。
 *
 * 文本消息同样**惰性开始**：模型要是一个字都没吐（模型名写错时，网关常回 200 + 空 choices），
 * 不该留下一个「开始了却没内容」的空消息。注意**只有思考、没有正文也算空产出** ——
 * 思考不是回复。
 */
export async function* runChatStream(options: ChatRunOptions): AsyncGenerator<AgUiEvent> {
  const { source, threadId, runId, model } = options;
  const event = createEventFactory(options.now);

  let text = '';
  let textMessageId: string | undefined;

  yield event.runStarted(threadId, runId);
  // 先报模型名：这是「模型链接」这条路的元信息，出错时也知道打的是谁。
  yield event.custom(MODEL_CUSTOM_EVENT.info, { model });

  try {
    for await (const chunk of source) {
      if (chunk.reasoning) {
        yield event.custom(MODEL_CUSTOM_EVENT.reasoning, { delta: chunk.reasoning });
      }

      if (chunk.content) {
        if (textMessageId === undefined) {
          textMessageId = `msg-${runId}`;
          yield event.textMessageStart(textMessageId);
        }
        text += chunk.content;
        yield event.textMessageContent(textMessageId, chunk.content);
      }
    }
  } catch (error) {
    // 已经吐了一部分的照样收尾，客户端手里的半截回复不该被丢掉。
    if (textMessageId !== undefined) {
      yield event.textMessageEnd(textMessageId);
    }
    yield event.runError(error instanceof Error ? error.message : String(error), 'MODEL_ERROR');
    return;
  }

  if (textMessageId !== undefined) {
    yield event.textMessageEnd(textMessageId);
  }

  if (text.trim() === '') {
    // HTTP 200、流也正常收了尾，但一个字都没有 —— 这必须当成失败：
    // 静默以 RUN_FINISHED 收场，用户只会看到一个空气泡，查不出所以然。
    yield event.runError('模型没有返回任何内容（检查模型名是否正确、账户余额是否充足）', 'EMPTY_OUTPUT');
    return;
  }

  yield event.runFinished(threadId, runId, { model, chars: text.length });
}
