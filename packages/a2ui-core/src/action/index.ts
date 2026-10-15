/**
 * 客户端动作（client → server）的协议解析。
 *
 * 协议原文见 `specification/v0_8/json/client_to_server.json`：组件（目前只有 `Button`）的
 * `action` 在用户交互时被「物化」成一条 `userAction` 消息，由客户端发给服务端；服务端再回
 * `surfaceUpdate` / `dataModelUpdate` 把 UI 改掉。
 *
 * ## 为什么需要扩展
 *
 * 标准协议里**只有「上报服务端」这一条路**：没有服务端就没有状态变化。但有一类交互根本不需要
 * 往返服务端 —— 展开/收起、切页签、按一次换一句文案这类**纯本地状态更新**。为此本模块在
 * `action` 上增加两个可选字段（见 `docs/a2ui-local-action-extension.md`）：
 *
 * ```jsonc
 * "action": {
 *   "name": "refreshMessage",           // 原协议字段，必填
 *   "context": [ ... ],                 // 原协议字段，可选
 *   "type": "local",                    // ★ 扩展：动作类型，缺省 "server"
 *   "local": [                          // ★ 扩展：type="local" 时要执行的本地操作
 *     { "type": "updateDataModel", "path": "/message", "value": { "literalString": "新文案" } }
 *   ]
 * }
 * ```
 *
 * `type` 是唯一的分流开关：只有**显式** `"local"` 才走本地，其余（含缺省、含写错的值）一律按
 * 「上报服务端」处理 —— 宁可多发一条消息，也不要在用户拼错字段时**静默执行本地写操作**。
 *
 * ## 职责边界
 *
 * 本模块只做**协议语义**：解析、取值对象求值、组装消息。**不执行**本地操作（那要改 store，
 * 由渲染引擎拿着 `RenderContext.updateModel` 去做），也**不发**网络请求（那是宿主的事）。
 * 这样 core 保持框架/宿主无关，换 React 渲染器时这段逻辑一行不用改。
 */

import { readBoundValue } from '../binding';

/** `client_to_server.json` 里的 `userAction` 消息（含外层信封，可直接序列化发给服务端）。 */
export interface UserActionMessage {
  userAction: {
    /** 动作名，取自组件的 `action.name`。 */
    name: string;
    /** 事件来源的 surface id。 */
    surfaceId: string;
    /** 触发事件的组件 id。 */
    sourceComponentId: string;
    /** ISO 8601 时间戳。 */
    timestamp: string;
    /** `action.context` 里所有取值对象**求值后**的键值对。 */
    context: Record<string, unknown>;
  };
}

/** 本地操作：把数据模型上某个 path 写为某个值。 */
export interface UpdateDataModelOperation {
  type: 'updateDataModel';
  /** 数据模型路径，如 `/message`。 */
  path: string;
  /** 已经求值好的新值（不再是取值对象）。 */
  value: unknown;
}

/**
 * 本地操作联合类型。
 *
 * 目前只有 `updateDataModel` 一种；把「类型」放在每个操作上（而不是用一个 `updates` 数组），
 * 是为了以后加 `toggleDataModel` / `pushDataModel` 之类的操作时不必改结构。
 */
export type LocalOperation = UpdateDataModelOperation;

/**
 * 动作解析结果。
 *
 * 用可辨识联合而不是「两个可空字段」，是为了让调用方 `switch (resolved.kind)` 之后
 * TypeScript 能直接收窄 —— 本地分支一定有 `operations`，服务端分支一定有 `message`。
 */
export type ResolvedAction =
  | {
      kind: 'local';
      name: string;
      /** 要依次执行的本地操作（顺序即执行顺序）；可能为空数组（表示「本地什么都不做」）。 */
      operations: LocalOperation[];
    }
  | {
      kind: 'server';
      name: string;
      /** 可直接发给服务端的完整消息。 */
      message: UserActionMessage;
    };

/** 解析动作时的环境：由渲染引擎在渲染该组件时提供。 */
export interface ActionEnvironment {
  surfaceId: string;
  /** 触发动作的组件 id（写进 `sourceComponentId`）。 */
  componentId: string;
  /** 读数据模型，用于给 `context[].value.path` 与本地操作的 `value.path` 求值。 */
  read: (path: string) => unknown;
  /**
   * 时间戳来源。默认 `new Date()`；测试注入固定时钟，避免断言踩到真实时间。
   */
  now?: () => Date;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * 解析一个组件的 `action`。
 *
 * 返回 `null` 表示「这不是一个可执行的动作」—— 不是对象、或缺 `name`（标准目录里 `name` 必填）。
 * 渲染引擎遇到 `null` 直接什么都不做，不要造一个空动作出来。
 */
export const resolveAction = (action: unknown, env: ActionEnvironment): ResolvedAction | null => {
  const record = asRecord(action);
  if (!record) {
    return null;
  }

  const name = record.name;
  if (typeof name !== 'string' || name === '') {
    return null;
  }

  if (record.type === 'local') {
    return { kind: 'local', name, operations: resolveLocalOperations(record.local, env.read) };
  }

  return { kind: 'server', name, message: buildUserAction(name, record.context, env) };
};

/**
 * 把 `action.context` 的邻接表形态还原成普通对象，并求值每个 `value`。
 *
 * 标准目录里 `context` 是 `[{ key, value }]`（数组），而 `client_to_server.json` 要求发出的
 * `context` 是对象 —— 这一步就是两者之间的转换。为了不把非标准写法炸掉，对象形态原样透传。
 */
const resolveActionContext = (
  context: unknown,
  read: (path: string) => unknown,
): Record<string, unknown> => {
  if (Array.isArray(context)) {
    const result: Record<string, unknown> = {};
    for (const entry of context) {
      const item = asRecord(entry);
      if (!item || typeof item.key !== 'string') {
        continue;
      }
      result[item.key] = readBoundValue(item.value, read);
    }
    return result;
  }

  const record = asRecord(context);
  return record ? { ...record } : {};
};

/** 组装符合 `client_to_server.json` 的 `userAction` 消息。 */
const buildUserAction = (
  name: string,
  context: unknown,
  env: ActionEnvironment,
): UserActionMessage => ({
  userAction: {
    name,
    surfaceId: env.surfaceId,
    sourceComponentId: env.componentId,
    timestamp: (env.now?.() ?? new Date()).toISOString(),
    context: resolveActionContext(context, env.read),
  },
});

/**
 * 把 `action.local` 解析成可执行的操作列表。
 *
 * 容错策略：**逐项跳过不合法的操作**，而不是整体失败 —— 一个动作里几个操作互不依赖，
 * 写坏一个不该把其余几个也拖下水；未知的 `type` 同理跳过（那是给未来扩展留的位置，
 * 老实现遇到新操作类型时的正确行为就是忽略它）。
 */
const resolveLocalOperations = (
  local: unknown,
  read: (path: string) => unknown,
): LocalOperation[] => {
  if (!Array.isArray(local)) {
    return [];
  }

  const operations: LocalOperation[] = [];
  for (const entry of local) {
    const record = asRecord(entry);
    if (!record || record.type !== 'updateDataModel') {
      continue;
    }
    // path 是写入目标，空 path（整体替换整个数据模型）在这里没有意义，一并跳过。
    if (typeof record.path !== 'string' || record.path === '') {
      continue;
    }
    operations.push({
      type: 'updateDataModel',
      path: record.path,
      value: readBoundValue(record.value, read),
    });
  }

  return operations;
};
