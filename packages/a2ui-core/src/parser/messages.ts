import {
  addHydrateNode,
  addSurface,
  getDataModel,
  getHydrateNode,
  removeSurfaceCascade,
  setDataModel,
} from '../store';
import { recordError } from '../error';
import { splitComponent } from '../renderer';
import { ErrorType, type HydrateNode, type Surface } from '../store/types';
import type {
  BeginRenderingMessage,
  DataEntry,
  DataModelUpdateMessage,
  DeleteSurfaceMessage,
  SurfaceUpdateMessage,
} from './types';

/**
 * surfaceUpdate：为每个组件登记一个 hydrateNode。
 *
 * 这里**不做渲染**——`_vnode` 由 hydrate 阶段（整段 JSONL 处理完后）统一装配。
 * 原因见 `../hydrate`：path 绑定要等 dataModelUpdate，容器子节点存在前向引用。
 *
 * 登记阶段只做一件事：检查组件定义本身能否拆出类型。拆不出（协议要求组件对象恰好含
 * 一个键，值为该组件的属性）就记一条 PARSE_ERROR，节点仍然登记，便于在 store 里看到它。
 *
 * 另外，此时也不创建 Surface —— Surface.rootNode 是必填字段，只有 beginRendering
 * 才能确定根节点，所以 Surface 在 beginRendering 时才诞生。
 *
 * 新组件还在这里被打上 `hasMounted: false` 的「标记」：它提示渲染引擎「这个组件需要播一次
 * 入场动画」，动画结束后渲染引擎会回调 store 把标记清除（详见 store 的 markHydrateNodeMounted）。
 */
export const handleSurfaceUpdate = (message: SurfaceUpdateMessage): void => {
  for (const definition of message.components) {
    const { type } = splitComponent(definition.component);

    if (type === '') {
      recordError(
        ErrorType.PARSE_ERROR,
        `surface "${message.surfaceId}" 的组件 "${definition.id}" 定义不合法：` +
          `无法拆出组件类型（协议要求组件对象恰好含一个键，值为该组件的属性），` +
          `实际收到 ${JSON.stringify(definition.component)}`,
      );
    }

    // 同一 componentId 重复定义（协议允许，流式里少见）：原地更新协议与归属，
    // 保留 hasMounted —— 已经播过入场动画的节点，不该因为一次重复定义又淡入一遍。
    // 原地改还顺带保住了 `Surface.rootNode` 与 hydrateNodeMap 的对象同一性。
    const existing = getHydrateNode(definition.id);
    if (existing) {
      existing.ownerSurfaceId = message.surfaceId;
      existing.protocol = JSON.stringify(definition.component);
      addHydrateNode(existing);
      continue;
    }

    const node: HydrateNode = {
      componentId: definition.id,
      _vnode: null,
      ownerSurfaceId: message.surfaceId,
      protocol: JSON.stringify(definition.component),
      // 新组件：入场动画还没播过（渲染引擎播完会回调 markHydrateNodeMounted 置 true）。
      hasMounted: false,
    };
    addHydrateNode(node);
  }
};

/**
 * beginRendering：创建可渲染的 Surface，并把 rootNode 指向已登记的节点。
 * root 找不到对应组件时抛错，由上层统一记为 PARSE_ERROR。
 */
export const handleBeginRendering = (message: BeginRenderingMessage): void => {
  const rootNode = getHydrateNode(message.root);

  if (!rootNode) {
    throw new Error(
      `beginRendering 的 root "${message.root}" 在 surface "${message.surfaceId}" 中不存在`,
    );
  }

  const surface: Surface = {
    surfaceId: message.surfaceId,
    beginRender: true,
    rootNode,
  };
  addSurface(surface);
};

/**
 * dataModelUpdate：把 contents 解析为普通对象，按 path 合并进该 surface 的数据模型。
 * 每次更新都是浅合并（path 指向的那一层整体展开），不做深度 diff。
 */
export const handleDataModelUpdate = (message: DataModelUpdateMessage): void => {
  const patch = resolveContents(message.contents);
  const current = getDataModel(message.surfaceId) ?? {};
  setDataModel(message.surfaceId, applyPath(current, message.path ?? '', patch));
};

/** deleteSurface：级联清掉 surface 自身、其下所有 hydrateNode 与 dataModel。 */
export const handleDeleteSurface = (message: DeleteSurfaceMessage): void => {
  removeSurfaceCascade(message.surfaceId);
};

/** 把邻接表形式的 contents 还原成普通对象。 */
const resolveContents = (entries: DataEntry[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    result[entry.key] = resolveEntry(entry);
  }
  return result;
};

/** 依据 value* 字段判定单条数据项的值；valueMap 递归还原为嵌套对象。 */
const resolveEntry = (entry: DataEntry): unknown => {
  if (entry.valueMap !== undefined) {
    return resolveContents(entry.valueMap);
  }
  if (entry.valueString !== undefined) {
    return entry.valueString;
  }
  if (entry.valueNumber !== undefined) {
    return entry.valueNumber;
  }
  if (entry.valueBoolean !== undefined) {
    return entry.valueBoolean;
  }
  return null;
};

/**
 * 沿 path 逐层下钻后合并 patch。
 * path 兼容带或带前导斜杠两种写法（'user' 与 '/user' 等价）；空 path 表示合并到根。
 */
const applyPath = (
  target: Record<string, unknown>,
  path: string,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  const segments = path.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
    return { ...target, ...patch };
  }

  const [head, ...rest] = segments;
  const child = (target[head] as Record<string, unknown> | undefined) ?? {};
  return { ...target, [head]: applyPath(child, rest.join('/'), patch) };
};
