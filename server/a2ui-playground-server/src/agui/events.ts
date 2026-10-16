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
  /**
   * 有一行没能解析成协议消息。
   *
   * 单独发一帧，而不是混在 `RUN_FINISHED` 的 result 里：告警的价值在于**尽早**，客户端可以
   * 边收边提示「这轮有内容没解析成功」，而不是等整轮结束才补一句。
   */
  warning: 'a2ui.warning',
} as const;

/** 模型侧事件在 AG-UI 之上的 CUSTOM 事件名（A2UI 与对话两条流共用）。 */
export const MODEL_CUSTOM_EVENT = {
  /**
   * 这一轮用的是哪个模型。
   *
   * 单独发一帧而不是挂在 `RUN_STARTED` 上：AG-UI 的事件字段是规范定的，塞私有字段进去
   * 会让标准客户端收到未知字段。而「到底打的是哪个模型」恰恰是「仅测模型链接」时最想确认的
   * 那件事（`.env` 改错了模型名，只有在回复里才看得出来）。
   */
  info: 'model.info',
  /**
   * 思考过程的增量。
   *
   * 为什么单独走一帧而不是混进 `TEXT_MESSAGE_CONTENT`：那个事件的语义是「助手说的话」，
   * 而思考内容**不是回复**——混进去之后客户端既没法把「模型在想」和「模型在答」分开，
   * 生成界面那条路还会把这段散文当成模型输出。分开之后「中间状态」才是免费的：
   * 收到 reasoning 却还没收到 content，就说明模型在思考。
   */
  reasoning: 'model.reasoning',
} as const;

/**
 * 把一个事件编成 SSE 帧。
 *
 * 只写 `data:` 一行 —— 协议规定消费者必须忽略 `id:` / `event:` / `retry:`，
 * 那就不发；空行结尾是事件分隔符，不能省。
 *
 * 参数刻意收成 `unknown`：帧的**编码方式**与 AG-UI 无关，任何可 JSON 序列化的载荷都适用。
 * 场景字符流（`scenarios/:id/stream`）的事件集就不是 AG-UI 的，但传输层完全一样 ——
 * 与其在那边再写一遍这一行，不如让类型放开。
 */
export const encodeSse = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

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
