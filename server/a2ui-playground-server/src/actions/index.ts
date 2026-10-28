/**
 * 动作路由：把客户端回传的 `userAction` 变成一组协议消息。
 *
 * ## 解决什么问题
 *
 * 协议里 `Button.action` 只有一条路：客户端把它物化成 `userAction` 交给宿主，宿主要么自己处理，
 * 要么发给服务端。渲染层（`a2ui-vue`）已经把这步做到了「派发 `a2ui-action` DOM 事件」为止 ——
 * 但**事件之后没人接**，于是点击服务端动作等于什么都没发生。
 *
 * 这个模块补的是服务端这半段：收到 `userAction` → 交给 handler → 拿回协议消息 → 计入会话缓存。
 * 客户端把消息 ingest 回 store，界面（和数据模型面板）就会跟着变。
 *
 * ## 边界
 *
 * - **不碰传输**：路由层负责 HTTP，这里只做「动作 → 消息」的纯变换。
 * - **不认识业务**：默认 handler 只做**回执**（把动作写进数据模型的 `__lastAction`），
 *   让任何点击都有可见结果。真正的业务处理由集成方 `register(name, handler)` 注册 ——
 *   只有业务方知道自己有哪些字段、要调哪个接口。
 * - 单个 handler 抛错不应该让整个请求 500：路由层捕获后照常回 200 + 一条回执，
 *   把错误写进 `error` 字段，避免前端因为一次动作失败就断掉整条链路。
 */
import type { A2UIMessage, UserAction } from '../types';

export interface ActionContext {
  sessionId: string;
  /** 动作所在 surface：取自 `userAction.surfaceId`，缺省用会话当前活跃 surface。 */
  surfaceId: string;
  /** 注入时钟，测试可固定。 */
  now: Date;
}

export type ActionHandler = (
  action: UserAction,
  context: ActionContext,
) => A2UIMessage[] | Promise<A2UIMessage[]>;

export interface ActionOutcome {
  messages: A2UIMessage[];
  /** 由谁处理的：注册的 `name`，或 `fallback`。日志与前端提示用。 */
  handledBy: string;
}

export interface ActionRouter {
  /** 注册/覆盖一个动作名的处理函数。 */
  register(name: string, handler: ActionHandler): void;
  /** 已注册的动作名（不含 fallback）。 */
  names(): string[];
  /** 是否已有该动作名的专门 handler。 */
  has(name: string): boolean;
  handle(action: UserAction, context: ActionContext): Promise<ActionOutcome>;
}

/**
 * 回执写入的保留路径。
 *
 * 用 `__` 前缀是为了不和业务字段撞车：它只是「这个动作发生过」的证据，
 * 界面想展示就绑 `__lastAction/name`，不想展示就完全无视。
 */
export const FALLBACK_ACTION_PATH = '__lastAction';

/** 默认 handler：把动作写进数据模型，保证**任何点击都有回执**。 */
export const writebackHandler: ActionHandler = (action, context) => [
  {
    dataModelUpdate: {
      surfaceId: context.surfaceId,
      path: FALLBACK_ACTION_PATH,
      contents: [
        { key: 'name', valueString: action.name },
        { key: 'sourceComponentId', valueString: action.sourceComponentId },
        { key: 'at', valueString: context.now.toISOString() },
      ],
    },
  },
];

/**
 * 校验并归一化客户端送来的 `userAction`。
 *
 * 只要求 `name`：`surfaceId` / `sourceComponentId` / `context` 缺了都能补（前者用会话活跃 surface，
 * 后两者给空值）。**宁可放行一条信息不全的动作，也不要因为少个字段就静默丢弃用户的点击。**
 */
export const parseUserAction = (value: unknown): UserAction | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') {
    return null;
  }

  const context =
    typeof raw.context === 'object' && raw.context !== null && !Array.isArray(raw.context)
      ? (raw.context as Record<string, unknown>)
      : {};

  return {
    name,
    surfaceId: typeof raw.surfaceId === 'string' ? raw.surfaceId : '',
    sourceComponentId: typeof raw.sourceComponentId === 'string' ? raw.sourceComponentId : '',
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
    context,
  };
};

export const createActionRouter = (
  handlers: Record<string, ActionHandler> = {},
): ActionRouter => {
  const registry = new Map<string, ActionHandler>(Object.entries(handlers));

  return {
    register(name, handler) {
      registry.set(name, handler);
    },
    names() {
      return [...registry.keys()];
    },
    has(name) {
      return registry.has(name);
    },
    async handle(action, context) {
      const handler = registry.get(action.name);
      const messages = await (handler ?? writebackHandler)(action, context);
      return {
        messages: Array.isArray(messages) ? messages : [],
        handledBy: handler ? action.name : 'fallback',
      };
    },
  };
};
