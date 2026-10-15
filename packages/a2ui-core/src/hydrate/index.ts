/**
 * 水合（hydrate）：把已登记的 hydrateNode 组装成可渲染节点，写回 `_vnode`。
 *
 * 为什么渲染不在 `surfaceUpdate` 里做，而要等到整段 JSONL 处理完：
 *
 * 1. **数据绑定**。官方示例的消息顺序是 `surfaceUpdate` → `dataModelUpdate` →
 *    `beginRendering`，而 `path` 绑定是普遍用法（Text/Image/Text… 几乎都写 `{ path }`）。
 *    在 surfaceUpdate 时渲染，数据模型还是空的，所有 path 都取不到值。
 * 2. **前向引用**。容器类组件的子节点是 componentId 引用，官方示例里
 *    `Card.child` 指向的组件常常定义在 Card 之后；同一消息内先渲染就会漏掉。
 *
 * 两个理由都指向「先把整段协议收全，再统一装配」——这也正是 `HydrateNode` 这个名字的含义。
 */

import { readPath } from '../binding';
import { recordError } from '../error';
import { resolveRenderer, splitComponent, type RenderContext, type TemplateItem } from '../renderer';
import { getA2UIStore, markHydrateNodeMounted, updateDataModelPath } from '../store';
import { ErrorType, type HydrateNode } from '../store/types';

/** 模板相对绑定的占位段：渲染某个 item 时，path 里等于它的段会被替换成当前 item 的 key。 */
const ITEM_TOKEN = 'item';

/** 把 path 里所有等于 `item` 的段替换成当前迭代项的 key（模板相对绑定）。 */
const replaceItemToken = (path: string, itemKey: string): string =>
  path
    .split('/')
    .map((segment) => (segment === ITEM_TOKEN ? itemKey : segment))
    .join('/');

/**
 * 读 `dataBinding` 指向的集合，规整成 `{ key, value }` 列表。
 *
 * 协议的数据模型没有原生数组（`DataEntry` 只有 valueString/valueNumber/valueBoolean/valueMap），
 * 所以「列表」通常是 valueMap 还原成的**对象 map**；这里同时兼容裸数组（服务端直塞），
 * 数组元素按下标作为 key。
 */
const readCollection = (
  dataModel: Record<string, unknown>,
  dataBinding: string,
): Array<{ key: string; value: unknown }> => {
  const source = readPath(dataModel, dataBinding);

  if (Array.isArray(source)) {
    return source.map((value, index) => ({ key: String(index), value }));
  }

  if (source !== null && typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  }

  return [];
};

/**
 * 渲染单个节点，接受外部传入的 context（而不是自己 `createContext`）。
 *
 * 抽出来是为了支持「模板展开」：静态组件树用 `createContext(node)`，而模板 item 需要
 * 一个「把 path 里的 item 段替换成当前 key」的 context，两者共用同一套渲染逻辑。
 */
const renderNode = (node: HydrateNode, context: RenderContext): RenderOutcome => {
  let component: unknown;
  try {
    component = JSON.parse(node.protocol);
  } catch (error) {
    return { kind: 'failed', reason: `protocol 不是合法 JSON：${(error as Error).message}` };
  }

  const { type, props } = splitComponent(component);

  // 拆不出类型的畸形定义在登记阶段已经记过一次 PARSE_ERROR，这里不再重复报。
  if (type === '') {
    return { kind: 'skipped' };
  }

  const renderer = resolveRenderer(type);
  if (!renderer) {
    recordError(
      ErrorType.RENDERER_NOT_FOUND,
      `surface "${node.ownerSurfaceId}" 的组件 "${node.componentId}" 类型为 "${type}"，` +
        `但 renderMap 中没有登记该类型的渲染函数，该组件不会被渲染。` +
        `请在渲染引擎的 renderMap 中补充 "${type}"。`,
    );
    return { kind: 'skipped' };
  }

  try {
    return { kind: 'rendered', vnode: renderer(props, context) };
  } catch (error) {
    return { kind: 'failed', reason: (error as Error).message };
  }
};

/**
 * 在「模板 item 上下文」里递归渲染某个组件。
 *
 * 与静态 hydrate 的差别只有两点：`read` / `updateModel` 会把 path 里的 `item` 段替换成
 * 当前 item 的 key；`resolve` 递归调回自己（而不是读 store 里那个「非 item 上下文」的
 * `_vnode`），让模板组件整棵子树都落在同一个 item 上。
 *
 * 模板 item 是数据驱动的重复单元，不是「新到的组件」，所以 `hasMounted` 恒为 `true`、
 * `markMounted` 是 no-op —— 不给每个 item 单独播入场动画。
 */
const renderScopedNode = (componentId: string, surfaceId: string, itemKey: string): unknown => {
  const node = getA2UIStore().getState().hydrateNodeMap[componentId];
  if (!node || node.ownerSurfaceId !== surfaceId) {
    return null;
  }

  let component: unknown;
  try {
    component = JSON.parse(node.protocol);
  } catch {
    return null;
  }

  const { type } = splitComponent(component);
  if (type === '' || !resolveRenderer(type)) {
    return null;
  }

  const context: RenderContext = {
    componentId,
    surfaceId,
    itemKey,
    hasMounted: true,
    markMounted: () => {},
    updateModel: (path, value) =>
      updateDataModelPath(surfaceId, replaceItemToken(path, itemKey), value),
    resolve: (childId) => renderScopedNode(childId, surfaceId, itemKey),
    read: (path) =>
      readPath(getA2UIStore().getState().dataModelMap[surfaceId] ?? {}, replaceItemToken(path, itemKey)),
    renderTemplate: (childId, dataBinding) => renderTemplateItems(surfaceId, childId, dataBinding),
  };

  const outcome = renderNode(node, context);
  return outcome.kind === 'rendered' ? outcome.vnode : null;
};

/**
 * 遍历 `dataBinding` 指向的集合，对每个 item 用模板组件渲染一次。
 *
 * 这是 `RenderContext.renderTemplate` 的实现本体，也是「动态列表渲染」的核心：
 * 集合里几个 item，就返回几个条目。
 *
 * 返回的是**带 key 的条目**而不是裸节点数组：集合的键就是这一项在渲染侧的稳定身份，
 * 渲染引擎可以拿它当子节点的 `key`。列表是数据驱动的，中间插入/删除会让位置整体平移，
 * 没有稳定 key 时框架只能按位置复用节点，内容会错位到别的 item 上。
 */
const renderTemplateItems = (
  surfaceId: string,
  componentId: string,
  dataBinding: string,
): TemplateItem[] => {
  const dataModel = getA2UIStore().getState().dataModelMap[surfaceId] ?? {};
  return readCollection(dataModel, dataBinding).map((item) => ({
    key: item.key,
    node: renderScopedNode(componentId, surfaceId, item.key),
  }));
};

/**
 * 构造某个节点的渲染上下文。
 *
 * - `resolve` 从 store 实时读取，且**限制在同一 surface 内**——跨 surface 引用一律视为无；
 * - `read` 同样实时读取，所以后到的 `dataModelUpdate` 也能被延迟求值的渲染器看到；
 * - `hasMounted` / `markMounted` 是入场动画的「读标记 / 清标记」两端：读的是当前节点的
 *   `hasMounted`，清除则回写到 store（`markHydrateNodeMounted`）。渲染引擎只跟上下文打交道，
 *   不必知道 store 的结构。
 */
const createContext = (node: HydrateNode): RenderContext => ({
  componentId: node.componentId,
  surfaceId: node.ownerSurfaceId,
  hasMounted: node.hasMounted,
  markMounted: () => markHydrateNodeMounted(node.componentId),
  updateModel: (path: string, value: unknown) => updateDataModelPath(node.ownerSurfaceId, path, value),
  resolve: (componentId: string) => {
    const target = getA2UIStore().getState().hydrateNodeMap[componentId];
    if (!target || target.ownerSurfaceId !== node.ownerSurfaceId) {
      return null;
    }
    return target._vnode ?? null;
  },
  read: (path: string) => readPath(getA2UIStore().getState().dataModelMap[node.ownerSurfaceId] ?? {}, path),
  renderTemplate: (componentId: string, dataBinding: string) =>
    renderTemplateItems(node.ownerSurfaceId, componentId, dataBinding),
});

type RenderOutcome =
  | { kind: 'rendered'; vnode: unknown }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: string };

/**
 * 渲染 store 中当前所有节点。
 *
 * 每次调用都是**全量重渲染**：`_vnode` 是协议 + 数据模型的派生结果，全量重算比增量维护
 * 简单，也不会留下脏节点。单个节点失败只写 `errorMap`，不影响其它节点。
 *
 * 实现上有一处刻意的取舍：写回 `_vnode` 用的是**原地修改 + 一次性替换 map 引用**，
 * 而不是 `updateHydrateNode`（那样会生成新节点对象）。因为 `Surface.rootNode` 与
 * `treeMap[*].root.vnode` 都持有同一个节点对象的引用，换掉对象会让这两处悄悄失联。
 */
export const hydrate = (): void => {
  const store = getA2UIStore();
  const hydrateNodeMap = store.getState().hydrateNodeMap;

  for (const node of Object.values(hydrateNodeMap)) {
    const outcome = renderNode(node, createContext(node));

    if (outcome.kind === 'rendered') {
      node._vnode = outcome.vnode;
      continue;
    }

    node._vnode = null;

    if (outcome.kind === 'failed') {
      recordError(
        ErrorType.PARSE_ERROR,
        `surface "${node.ownerSurfaceId}" 的组件 "${node.componentId}" 渲染失败：${outcome.reason}`,
      );
    }
  }

  // 节点对象是原地改的，但 map 引用必须换新，订阅者才会收到通知。
  store.setState({ hydrateNodeMap: { ...hydrateNodeMap } });
};
