/**
 * 入站请求的规范化。
 *
 * 接口同时接受三种请求体：
 * 1. **AG-UI 的 `RunAgentInput`**：`{ threadId, runId, messages: [{ role, content }], forwardedProps }`
 *    —— 这是「AG-UI 兼容」的字面要求，标准客户端会这么发；
 * 2. **简写**：`{ message: "..." }` —— curl 调试、脚本调用时不必手搓 messages 数组；
 * 3. **示例场景**：`{ scenario: "shopping-cart" }` —— 取内置 fixture 而不是现生成（见 `scenarios.ts`）。
 *
 * 三条来源最终都汇成同一份 `{ sessionId, surfaceId, message, scenario }`，
 * 于是下游（agent / 协议映射 / 缓存）完全不需要知道请求是哪种形状进来的。
 */
import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatMessageContentPart,
  ChatRequest,
  GenerateRequest,
  ImageInput,
  UserAction,
} from './types';

export interface NormalizedRequest {
  /** 对应 AG-UI 的 threadId。 */
  sessionId: string;
  surfaceId: string;
  /** 客户端指定的 runId（AG-UI 允许），缺省由服务端生成。 */
  runId?: string;
  /** 拼好的本轮输入文本。走场景时为空串。 */
  message: string;
  /** 示例场景 id；有值时本轮产出该场景的 fixture。 */
  scenario?: string;
  /** 多模态输入：本轮用户附上的图片。 */
  images?: ImageInput[];
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
/** 对话接口（`/api/a2ui/chat`）的 threadId。接口无状态，它只用于回显与日志区分。 */
export const createChatThreadId = (): string => shortId('chat');

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

/**
 * 读取并校验 `images`。
 *
 * 宽松处：缺省返回空数组，不强制带图。严格处：给了就必须是合法形态 —— 每项至少
 * `dataUrl` 或 `url` 之一，否则当场报 400，而不是让模型对着一个坏图片字段瞎编。
 */
const readImages = (value: unknown): ImageInput[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestError('images 必须是数组');
  }

  const images: ImageInput[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new BadRequestError('images 每项必须是对象');
    }
    const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : undefined;
    const url = typeof item.url === 'string' ? item.url : undefined;
    if (dataUrl === undefined && url === undefined) {
      throw new BadRequestError('images 每项至少需要 dataUrl 或 url 之一');
    }
    images.push({
      dataUrl,
      url,
      name: typeof item.name === 'string' ? item.name : undefined,
    });
  }
  return images;
};

/** 把一张图转成 OpenAI 内容分片。 */
const toImagePart = (image: ImageInput): { type: 'image_url'; image_url: { url: string } } => ({
  type: 'image_url',
  image_url: { url: image.dataUrl ?? (image.url as string) },
});

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * 服务端依赖没就绪（比如没配模型 Key）。
 *
 * 与 400 分开：请求本身是合法的，是「这台服务器现在打不了模型」——
 * 客户端据此提示配置，而不是去改请求体。映射到 503 见 `app.ts`。
 */
export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
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
 * 宽松处：`threadId` / `surfaceId` / `runId` 缺省都自动补；消息、动作、场景至少给一个。
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

  const scenario = isNonEmptyString(request.scenario) ? request.scenario.trim() : undefined;

  const images = readImages(request.images);
  if (message === '' && action === undefined && scenario === undefined && images.length === 0) {
    throw new BadRequestError('message / messages、action、scenario、images 至少提供一个');
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
    scenario,
    images,
  };
};

/** 规范化后的对话请求：只留一串送进模型的消息。 */
export interface NormalizedChat {
  messages: ChatMessage[];
}

/** 模型对话支持的角色。`tool` / `developer` 这类不在其列（见下）。 */
const CHAT_ROLES = new Set<ChatMessage['role']>(['system', 'user', 'assistant']);

/**
 * 规范化模型对话的请求体。
 *
 * 两条来源（完整 `messages` 与简写 `message`）汇成同一串消息，与 `/run` 的处理同构。
 *
 * 两个刻意的取舍：
 * - **`tool` / `developer` 角色静默跳过**，不塞成 `user`。塞过去等于把工具返回值当成用户说的话，
 *   模型会对着它当指令执行 —— 那是更坏的失败。
 * - **调用方自带 system 时不追加**：它显式表达了自己的意图，再加一条会把两条规则叠起来。
 */
export const normalizeChatRequest = (body: unknown, systemPrompt: string): NormalizedChat => {
  if (!isRecord(body)) {
    throw new BadRequestError('请求体必须是 JSON 对象');
  }

  const request = body as ChatRequest;
  const messages: ChatMessage[] = [];

  if (Array.isArray(request.messages)) {
    for (const item of request.messages) {
      if (!isRecord(item)) {
        continue;
      }
      const role = item.role as ChatMessage['role'];
      if (!CHAT_ROLES.has(role)) {
        continue;
      }
      const content = readMessageContent(item).trim();
      if (content !== '') {
        messages.push({ role, content });
      }
    }
  }

  if (isNonEmptyString(request.message)) {
    messages.push({ role: 'user', content: request.message.trim() });
  }

  const system = isNonEmptyString(request.system) ? request.system.trim() : systemPrompt;
  if (!messages.some((message) => message.role === 'system')) {
    messages.unshift({ role: 'system', content: system });
  }

  // 多模态：把图片合并进**最后一条 user 消息**，文本与图在同一轮里一起送进模型。
  const images = readImages(request.images);
  if (images.length > 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        // 先把 content 提到局部变量：`messages[index]` 是索引访问，TS 不做 typeof 收窄，
        // 直接对 `messages[index].content` 三元会让 `text` 落成 union 类型。
        const existing = messages[index].content;
        const text = typeof existing === 'string' ? existing : '';
        // 显式标注为分片数组：否则 `{ type: 'text' }` 会被宽成 `type: string` 而不匹配联合类型。
        const parts: ChatMessageContentPart[] = [
          { type: 'text', text },
          ...images.map(toImagePart),
        ];
        messages[index].content = parts;
        break;
      }
    }
  }

  // 只剩下那条补进去的 system 就说明本轮压根没有用户输入。
  if (messages.length <= 1) {
    throw new BadRequestError('message 与 messages 至少提供一个');
  }

  return { messages };
};
