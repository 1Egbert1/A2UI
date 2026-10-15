/**
 * 入站请求的规范化。
 *
 * 接口同时接受两种请求体：
 * 1. **AG-UI 的 `RunAgentInput`**：`{ threadId, runId, messages: [{ role, content }], forwardedProps }`
 *    —— 这是「AG-UI 兼容」的字面要求，标准客户端会这么发；
 * 2. **简写**：`{ message: "..." }` —— curl 调试、脚本调用时不必手搓 messages 数组。
 *
 * 两条来源最终都汇成同一份 `{ sessionId, surfaceId, message }`，
 * 于是下游（agent / 协议映射 / 缓存）完全不需要知道请求是哪种形状进来的。
 */
import { randomUUID } from 'node:crypto';
import type { GenerateRequest, UserAction } from './types';

export interface NormalizedRequest {
  /** 对应 AG-UI 的 threadId。 */
  sessionId: string;
  surfaceId: string;
  /** 客户端指定的 runId（AG-UI 允许），缺省由服务端生成。 */
  runId?: string;
  /** 拼好的本轮输入文本。 */
  message: string;
}

export interface NormalizeOptions {
  /** 请求里没带 threadId/sessionId 时用它；也没给就现生成一个。 */
  fallbackSessionId?: string;
  /** 请求与 session 都没给 surfaceId 时用它。 */
  fallbackSurfaceId?: string;
}

/** 可读前缀 + 短随机串，便于在日志里一眼区分。 */
const shortId = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

export const createSurfaceId = (): string => shortId('surface');
export const createSessionId = (): string => shortId('session');
export const createRunId = (): string => shortId('run');

/**
 * 把 `userAction` 展开成一段自然语言，拼在本轮输入的末尾。
 *
 * 为什么不把动作塞进 system prompt：prompt 描述的是「怎么生成协议」这类不变规则，
 * 而动作是**每轮都在变**的用户意图，混进去会让模型分不清主次。
 */
export const describeUserAction = (action: UserAction): string =>
  `用户点击了组件「${action.sourceComponentId}」触发的动作「${action.name}」，` +
  `动作上下文：${JSON.stringify(action.context ?? {})}。请据此更新界面。`;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * 取一条 AG-UI 消息的纯文本。
 *
 * AG-UI 的 `content` 既可以是字符串，也可以是内容分片数组
 * （`[{ type: 'text', text: '...' }]`，为多模态留的口子），两种都要认。
 */
const readMessageContent = (message: unknown): string => {
  if (!isRecord(message)) {
    return '';
  }

  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .filter((text) => text !== '')
      .join('\n');
  }

  return '';
};

/** 从 AG-UI 的 messages 数组里取最后一条 user 消息。 */
const readLatestUserMessage = (messages: unknown): string => {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === 'user') {
      const content = readMessageContent(message);
      if (content.trim() !== '') {
        return content.trim();
      }
    }
  }

  return '';
};

/** 校验 userAction 形状（`forwardedProps.action` 或顶层 `action` 都可能带）。 */
const readUserAction = (value: unknown): UserAction | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new BadRequestError('action 必须是 JSON 对象');
  }
  if (!isNonEmptyString(value.name)) {
    throw new BadRequestError('action.name 必填');
  }
  if (!isNonEmptyString(value.sourceComponentId)) {
    throw new BadRequestError('action.sourceComponentId 必填');
  }
  return value as unknown as UserAction;
};

/**
 * 校验并规范化请求体。
 *
 * 宽松处：`threadId` / `surfaceId` / `runId` 缺省都自动补；消息与动作至少给一个。
 * 严格处：给了就必须是合法类型 —— 与其让模型对着一坨坏输入瞎编，不如当场报 400。
 */
export const normalizeGenerateRequest = (
  body: unknown,
  options: NormalizeOptions = {},
): NormalizedRequest => {
  if (!isRecord(body)) {
    throw new BadRequestError('请求体必须是 JSON 对象');
  }

  const request = body as GenerateRequest;
  const threadedId = request.threadId ?? request.sessionId;

  const action = readUserAction(
    request.action ?? (isRecord(request.forwardedProps) ? request.forwardedProps.action : undefined),
  );

  const message = isNonEmptyString(request.message)
    ? request.message.trim()
    : readLatestUserMessage(request.messages);

  if (message === '' && action === undefined) {
    throw new BadRequestError('message / messages 与 action 至少提供一个');
  }

  const sessionId = isNonEmptyString(threadedId)
    ? threadedId.trim()
    : (options.fallbackSessionId ?? createSessionId());

  const surfaceId =
    (isNonEmptyString(request.surfaceId) ? request.surfaceId.trim() : undefined) ??
    (action && isNonEmptyString(action.surfaceId) ? action.surfaceId : undefined) ??
    options.fallbackSurfaceId ??
    createSurfaceId();

  return {
    sessionId,
    surfaceId,
    runId: isNonEmptyString(request.runId) ? request.runId.trim() : undefined,
    message: action ? [message, describeUserAction(action)].filter(Boolean).join('\n') : message,
  };
};
