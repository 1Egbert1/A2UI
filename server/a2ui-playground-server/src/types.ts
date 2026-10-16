/**
 * a2ui-server 的对外数据契约（HTTP 请求/响应）与内部 agent 契约。
 *
 * 协议消息类型直接复用 `a2ui-core` 的声明（`import type` 只在编译期存在，
 * 运行时零耦合）—— 服务端生成的、客户端解析的必须是同一套类型，不能各写一份。
 */
import type { A2UIMessage } from 'a2ui-core';

export type { A2UIMessage };

/** 当前可选的 agent 实现。`mock` 是默认值（先把接口跑通，接真模型是后续一步）。 */
export type AgentProvider = 'mock' | 'openai';

/**
 * 一张输入图片（多模态）。
 *
 * 走 base64 `dataUrl` 最省事：客户端本地读文件即得，服务端无需落地存储，
 * 也直接对应 OpenAI `image_url.url` 的 `data:image/...;base64,...` 形态。
 * 有现成可公开访问的图也可以用 `url`。两者至少给一个。
 */
export interface ImageInput {
  /** base64 data URL，形如 `data:image/png;base64,....` */
  dataUrl?: string;
  /** 可公开访问的图片地址。 */
  url?: string;
  /** 可选的文件名，仅用于日志与调试。 */
  name?: string;
}

/**
 * 送进模型的一条消息的内容分片（OpenAI Chat Completions 的多模态形态）。
 *
 * 整条消息要么纯文本（`string`），要么这一组分片数组 —— 不能同时存在。
 * `image_url` 的 `url` 可以是 `https://...` 也可以是 `data:image/...;base64,...`。
 */
export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * 客户端上报的动作，对齐 `specification/v0_8/json/client_to_server.json` 的 `userAction`。
 * 由渲染层的 `a2ui-action` 事件原样带来（见 core 的 `action` 模块）。
 */
export interface UserAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  /** ISO 8601。缺省由服务端补当前时间。 */
  timestamp?: string;
  context: Record<string, unknown>;
}

/**
 * AG-UI `RunAgentInput.messages` 里的一条消息（只声明服务端用得到的字段）。
 * `content` 允许是字符串或内容分片数组（AG-UI 为多模态留的口子）。
 */
export interface AgUiInputMessage {
  id?: string;
  role: 'developer' | 'system' | 'assistant' | 'user' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/**
 * 生成接口的请求体。
 *
 * 前四个字段是 **AG-UI `RunAgentInput`** 的形状（标准客户端会这么发）；
 * `message` / `action` / `surfaceId` 是本项目的简写，方便 curl 与脚本调试。
 * 两种形状都接受，规范化在 `inbound.ts`。
 */
export interface GenerateRequest {
  threadId?: string;
  runId?: string;
  messages?: AgUiInputMessage[];
  forwardedProps?: Record<string, unknown>;
  /** 简写：直接用一句话描述想要的界面。 */
  message?: string;
  /** 旧名兼容，等价于 `threadId`。 */
  sessionId?: string;
  surfaceId?: string;
  /** 客户端动作（按钮点击等），也可放在 `forwardedProps.action`。 */
  action?: UserAction;
  /**
   * 多模态输入：用户附上的图片（设计稿 / 截图 / 参考图）。
   *
   * 给了就让模型**据此复刻出对应的 A2UI 界面**——自然语言描述与图片一起送进模型，
   * 模型优先对齐图片里的版式与内容。至少给 `dataUrl` 或 `url` 之一。
   */
  images?: ImageInput[];
  /**
   * 示例场景 id（见 `scenarios.ts`）。
   *
   * 给了它就**忽略 `message`**：本轮产出该场景的 fixture 而不是现生成的界面。
   * 存在的意义是让示例数据也走一遍完整链路，而不是在浏览器里本地 import 后直接渲染。
   */
  scenario?: string;
}

/** `GET /api/a2ui/scenarios` 列表里的一项。 */
export interface ScenarioSummary {
  id: string;
  /** 一句话说明，下拉里展示。 */
  desc: string;
  /** fixture 自带的 surfaceId，客户端渲染时按它取树。 */
  surfaceId: string;
  /** 该场景有多少条协议消息。 */
  messageCount: number;
}

/**
 * 场景字符流的推送顺序，与 core 的 `deriveStreamOrders()` 一一对应：
 * - `protocol`：fixture 原样顺序，`beginRendering` 在最后；
 * - `stream`：把 `beginRendering` 提到 root 之后（流式友好）。
 */
export type ScenarioOrder = 'protocol' | 'stream';

/**
 * `GET /api/a2ui/scenarios/:id/stream` 的事件（SSE，一行一个 JSON）。
 *
 * **刻意不复用 AG-UI 事件类型**：这条流不是「跑一轮 agent」，而是把一份素材按固定块长吐出去。
 * 硬套只能二选一，两条路都别扭：
 * - 用 `RUN_STARTED` / `RUN_FINISHED` 就得为它编一个并不存在的对话轮次；
 * - 用 `TEXT_MESSAGE_CONTENT` 的 `delta` 则是在说「模型正在吐字」，而这里吐的是 fixture 的切片。
 *
 * 所以给它一套自己的极小事件集：`started`（元信息，客户端据此画进度条）→ `chunk` × N → `done`。
 * 传输层（`text/event-stream` + `data: {...}`）与 AG-UI 完全一致，客户端复用同一个切帧函数。
 */
export type ScenarioStreamEvent =
  | {
      type: 'stream.started';
      scenarioId: string;
      /** fixture 自带的 surfaceId —— 客户端拿它去 treeMap 取树。 */
      surfaceId: string;
      order: ScenarioOrder;
      /** 每片多少字符（客户端不再自己切片，边界由服务端定义，故必须告知）。 */
      chunkSize: number;
      /** 每片之间的间隔毫秒数（0 表示不限速）。面板标签据此显示，不写死。 */
      delayMs: number;
      totalChars: number;
      totalChunks: number;
    }
  | { type: 'stream.chunk'; index: number; text: string }
  | { type: 'stream.done'; chunks: number; chars: number };

/**
 * `POST /api/a2ui/chat` 的请求体 —— 最基础的模型对话，**不生成任何 A2UI 协议**。
 *
 * **无状态**：多轮要由调用方把历史一起发过来（`messages`）。刻意不挂会话缓存（见 `chat/index.ts`）。
 */
export interface ChatRequest {
  /** 简写：就一轮单句（curl 调试用）。与 `messages` 二选一，也可以只补一句到最后。 */
  message?: string;
  /** 完整对话（AG-UI 形状的 `messages`）。多轮时由调用方带全。 */
  messages?: AgUiInputMessage[];
  /** 覆盖服务端默认的 system prompt（`CHAT_SYSTEM_PROMPT`）。 */
  system?: string;
  /**
   * 多模态输入：附上的图片。与 `/run` 同义，本轮作为「看图说话」的素材送进模型。
   * 至少给 `dataUrl` 或 `url` 之一。
   */
  images?: ImageInput[];
}

export interface ChatResponse {
  reply: string;
  /** 本轮实际用的模型名，便于确认 `.env` 里的 `OPENAI_MODEL` 真的生效了。 */
  model: string;
  elapsedMs: number;
}

export interface GenerateResponse {
  sessionId: string;
  surfaceId: string;
  /** agent 产出的 A2UI 协议消息，数组顺序即发送顺序（JSONL 语义）。 */
  messages: A2UIMessage[];
  /** 抽取前的模型原始文本，供协议调试面板排查「模型到底吐了什么」。 */
  raw: string;
  /** 本轮由哪个 agent 产出。 */
  provider: AgentProvider;
  /** 抽取阶段丢弃的行及原因（容错记录，不阻断请求）。 */
  warnings: string[];
}

/** 单轮对话记录，落进会话缓存用于多轮续接。 */
export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 交给 agent 的一次生成请求。 */
export interface AgentRequest {
  /** 本轮输入（已把 `action` 展开成人话）。 */
  message: string;
  /** 目标 surface id，system prompt 会要求模型原样使用。 */
  surfaceId: string;
  /** 之前轮次（不含本轮），最新在后。 */
  history: AgentTurn[];
  /** 有值时按场景取 fixture，不再看 `message` / `history`。 */
  scenario?: string;
  /** 多模态输入：本轮用户附上的图片（设计稿 / 截图 / 参考图）。 */
  images?: ImageInput[];
}

/** agent 一次生成的产出。 */
export interface AgentResult {
  messages: A2UIMessage[];
  raw: string;
  provider: AgentProvider;
  warnings: string[];
}

/** 送进模型的一条对话消息（OpenAI Chat Completions 的形状）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** 纯文本，或多模态分片数组（文本 + 图片）。 */
  content: string | ChatMessageContentPart[];
}

/**
 * 模型流里的一片。
 *
 * 分成两个字段而不是一个字符串：**思考内容不是回复内容**。思考模式下，模型会先吐一大段
 * `reasoning_content`，再吐正式答复 —— 两者混在一个通道里，生成界面那条路会把思考过程
 * 喂给协议抽取器（抽不出东西、还把「查看原始输出」污染成一大段散文）。
 *
 * 这也正是「模型回复中的中间状态」的数据来源：有 `reasoning` 没 `content` = 正在思考。
 */
export interface ModelDelta {
  /** 正式回复的增量。 */
  content?: string;
  /** 思考过程的增量（`reasoning_content`）。只有开了思考模式的模型才吐。 */
  reasoning?: string;
}

/** 流式路径上 agent 吐出的单个片段：文字增量、思考增量、坏行告警，或一条已抽好的协议消息。 */
export interface AgentStreamChunk {
  /** 模型原始文本增量（**不含思考内容**）。 */
  delta?: string;
  /** 思考过程增量，只用于展示中间状态，**绝不进抽取器**。 */
  reasoning?: string;
  /**
   * 这一行没能解析成协议消息（JSON 坏了 / 字段不合格）。
   *
   * 必须单独报出来：流式路径**刻意不为坏行中断**（一次坏行不该毁掉整轮），但静默丢掉是另一种
   * 伤害 —— 真出过这事：模型把 `surfaceUpdate` 的括号多写了一个，整棵组件树被丢掉，
   * 客户端却显示「已生成界面 · 2 条协议消息」，预览一片空白，看起来像渲染坏了。
   */
  warning?: string;
  message?: A2UIMessage;
}
