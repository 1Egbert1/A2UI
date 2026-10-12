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
import { resolveRenderer, splitComponent, type RenderContext } from '../renderer';
import { getA2UIStore } from '../store';
import { ErrorType, type HydrateNode } from '../store/types';

/**
 * 构造某个节点的渲染上下文。
 *
 * - `resolve` 从 store 实时读取，且**限制在同一 surface 内**——跨 surface 引用一律视为无；
 * - `read` 同样实时读取，所以后到的 `dataModelUpdate` 也能被延迟求值的渲染器看到。
 */
const createContext = (node: HydrateNode): RenderContext => ({
  componentId: node.componentId,
  surfaceId: node.ownerSurfaceId,
  resolve: (componentId: string) => {
    const target = getA2UIStore().getState().hydrateNodeMap[componentId];
    if (!target || target.ownerSurfaceId !== node.ownerSurfaceId) {
      return null;
    }
    return target._vnode ?? null;
  },
  read: (path: string) => readPath(getA2UIStore().getState().dataModelMap[node.ownerSurfaceId] ?? {}, path),
});

type RenderOutcome =
  | { kind: 'rendered'; vnode: unknown }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: string };

/** 渲染单个节点，把三种结局分开表达，避免用异常做控制流。 */
const renderNode = (node: HydrateNode): RenderOutcome => {
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
    return { kind: 'rendered', vnode: renderer(props, createContext(node)) };
  } catch (error) {
    return { kind: 'failed', reason: (error as Error).message };
  }
};

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
    const outcome = renderNode(node);

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
