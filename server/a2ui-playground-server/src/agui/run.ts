/**
 * A2UI agent 的流 → AG-UI 事件序列。
 *
 * 这是本项目对 AG-UI 的**唯一映射点**，也是「A2UI 与 AG-UI 怎么配合」这句话的落点：
 * AG-UI 负责「agent 和前端之间怎么通信」，A2UI 负责「agent 生成什么界面」——
 * 于是 A2UI 的协议消息被当作领域载荷，走 AG-UI 的 CUSTOM 通道原样透传。
 *
 * 一轮 run 的事件序列（正常路径）：
 *   RUN_STARTED
 *   CUSTOM a2ui.surface        ← 会话/界面/provider 元信息，后续事件才有归属
 *   TEXT_MESSAGE_START         ← 惰性：真有文字增量时才发
 *   TEXT_MESSAGE_CONTENT × N   ← 模型原始文本增量（聊天面板可以实时显示）
 *   TEXT_MESSAGE_END
 *   CUSTOM a2ui.message × N    ← 每条完整的 A2UI 协议消息，客户端可直接解析渲染
 *   RUN_FINISHED               ← result 里带回 surfaceId 与消息条数
 *
 * 出错时把已收到的部分正常收尾（文本消息闭合、onFinish 落库），再以 RUN_ERROR 结束 ——
 * 流已经打开、HTTP 状态码改不了了，错误只能走在流里。
 */
import type { A2UIAgent } from '../agent';
import type { AgentProvider, AgentRequest, A2UIMessage } from '../types';
import {
  A2UI_CUSTOM_EVENT,
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
  yield event.custom(A2UI_CUSTOM_EVENT.surface, {
    threadId,
    surfaceId: request.surfaceId,
    provider: agent.provider,
  });

  try {
    for await (const chunk of agent.stream(request)) {
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
    provider: agent.provider,
    messageCount: messages.length,
    messages,
  };
  yield event.runFinished(threadId, runId, result);
}
