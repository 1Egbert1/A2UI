/**
 * AG-UI 事件类型与 SSE 编码。
 *
 * 依据 AG-UI 协议（https://docs.ag-ui.com）：
 * - 事件名用**大写蛇形**（`RUN_STARTED`），字段名用**小驼峰**（`threadId`）；
 * - 传输固定为 `text/event-stream`，**每个事件的 data 载荷恰好是一个 JSON 对象**
 *   （不能多个、不能是片段），事件之间空行分隔，行尾必须是 LF；
 * - 所有事件共有的可选字段：`timestamp`（Unix 毫秒）、`rawEvent`、`metadata`。
 *
 * 这里只声明本项目用到的子集 —— 协议本身允许消费者忽略不认识的字段，
 * 反过来生产者也只需要产出用得到的那些。
 */

/** 所有事件共有的可选字段。 */
export interface AgUiBaseEvent {
  type: string;
  /** Unix 毫秒。 */
  timestamp?: number;
  rawEvent?: unknown;
  metadata?: Record<string, unknown>;
}

/** 一次运行开始。`threadId` 与 `runId` 必填。 */
export interface RunStartedEvent extends AgUiBaseEvent {
  type: 'RUN_STARTED';
  threadId: string;
  runId: string;
}

/** 一次运行正常结束。`result` 是可选的完成载荷。 */
export interface RunFinishedEvent extends AgUiBaseEvent {
  type: 'RUN_FINISHED';
  threadId: string;
  runId: string;
  result?: unknown;
}

/** 运行中出错。`message` 必填。 */
export interface RunErrorEvent extends AgUiBaseEvent {
  type: 'RUN_ERROR';
  message: string;
  code?: string;
}

/** 一段助手文本消息开始。 */
export interface TextMessageStartEvent extends AgUiBaseEvent {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
  role: 'assistant';
}

/** 文本增量。协议要求 `delta` **非空**。 */
export interface TextMessageContentEvent extends AgUiBaseEvent {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends AgUiBaseEvent {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
}

/** 协议预留的开放通道：本项目的 A2UI 协议消息走它，不经任何有损转换。 */
export interface CustomEvent extends AgUiBaseEvent {
  type: 'CUSTOM';
  name: string;
  value: unknown;
}

export type AgUiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | CustomEvent;

/**
 * 本项目在 AG-UI 之上的 CUSTOM 事件名。
 *
 * 为什么 A2UI 消息不用 `STATE_SNAPSHOT` / `STATE_DELTA`：那两个事件面向「一份可打补丁的
 * 共享状态对象」，而 A2UI 是一串**有先后顺序、语义各自独立**的协议消息（surfaceUpdate /
 * dataModelUpdate / beginRendering）。硬塞进 JSON Patch 是有损转换，客户端还得反解回来。
 * CUSTOM 就是协议为这类「领域自有载荷」留的口子，原样传递最忠实。
 */
export const A2UI_CUSTOM_EVENT = {
  /** 首帧元信息：这一轮跑在哪个会话/界面上、由哪个 provider 产出。 */
  surface: 'a2ui.surface',
  /** 一条完整的 A2UI 协议消息（客户端可直接喂给 a2ui-core 的解析器）。 */
  message: 'a2ui.message',
} as const;

/**
 * 把一个事件编成 SSE 帧。
 *
 * 只写 `data:` 一行 —— 协议规定消费者必须忽略 `id:` / `event:` / `retry:`，
 * 那就不发；空行结尾是事件分隔符，不能省。
 */
export const encodeSse = (event: AgUiEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/** SSE 注释行，用作心跳（协议允许生产者任意频率发送）。 */
export const SSE_COMMENT = ': keep-alive\n\n';

/**
 * 事件工厂：统一补 `timestamp`。
 *
 * 抽成工厂是为了测试能注入时钟 —— 否则断言里全是「时间差不多」这种松校验。
 */
export const createEventFactory = (now: () => number = Date.now) => {
  const stamp = <T extends AgUiEvent>(event: Omit<T, 'timestamp'>): T =>
    ({ ...event, timestamp: now() }) as T;

  return {
    runStarted: (threadId: string, runId: string): RunStartedEvent =>
      stamp({ type: 'RUN_STARTED', threadId, runId }),

    runFinished: (threadId: string, runId: string, result?: unknown): RunFinishedEvent =>
      stamp(
        result === undefined
          ? { type: 'RUN_FINISHED', threadId, runId }
          : { type: 'RUN_FINISHED', threadId, runId, result },
      ),

    runError: (message: string, code?: string): RunErrorEvent =>
      stamp(code === undefined ? { type: 'RUN_ERROR', message } : { type: 'RUN_ERROR', message, code }),

    textMessageStart: (messageId: string): TextMessageStartEvent =>
      stamp({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' }),

    textMessageContent: (messageId: string, delta: string): TextMessageContentEvent =>
      stamp({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta }),

    textMessageEnd: (messageId: string): TextMessageEndEvent =>
      stamp({ type: 'TEXT_MESSAGE_END', messageId }),

    custom: (name: string, value: unknown): CustomEvent => stamp({ type: 'CUSTOM', name, value }),
  };
};

export type EventFactory = ReturnType<typeof createEventFactory>;
