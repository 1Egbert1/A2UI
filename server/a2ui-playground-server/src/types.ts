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
  content: string | Array<{ type: string; text?: string }>;
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
  content: string;
}

/** 流式路径上 agent 吐出的单个片段：要么是文字增量，要么是一条已抽好的协议消息。 */
export interface AgentStreamChunk {
  delta?: string;
  message?: A2UIMessage;
}
