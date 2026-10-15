/**
 * 组件树渲染器：把「整棵组件树」交给宿主挂载到页面上。
 *
 * 与 `../renderer` 的分工是**层级不同**，两者都要：
 * - `renderer`（组件级）：**单个组件** → 渲染节点（`componentId` → `_vnode`），由 hydrate 逐个调用；
 * - 本模块（树级）：**整棵组件树** → 挂载到页面，由 core 在合适的时机统一调用。
 *
 * 为什么把「时机」收进 core：宿主只该回答「渲染成什么」，不该自己去猜「什么时候该重画」。
 * 在此之前 playground 只能用一个 `watch(treeMap)` 盯着建树结果 —— 那个 watch 其实是把
 * SDK 的调度职责泄漏到了宿主里。收进来之后，换 React / 原生 DOM 只需替换这一个回调，
 * 调度逻辑一行都不用重写。
 *
 * 触发点只有两处，都代表「组件树刚刚发生了变化」：
 * 1. `refreshDerivedState()` —— 每次 `buildTree` 之后（一次性解析在整段末尾，
 *    流式解析在每次 `push` 末尾）；
 * 2. `clearStore()` —— 树被清空，通知渲染器把页面上的旧树撤掉。
 */

import type { TreeMap } from '../treebuilder/types';

/**
 * 组件树渲染函数。
 *
 * 收到的参数是**刚构建出来的完整 treeMap**（`surfaceId → ComponentTree`）：
 * 想渲染哪一棵、渲染到哪个容器，由宿主自己决定。传空对象表示「当前没有任何组件树」，
 * 宿主应据此清空页面（例如 `clearStore()` 之后）。
 */
export type TreeRenderer = (treeMap: TreeMap) => void;

let treeRenderer: TreeRenderer | null = null;

/** 注入树渲染器；由 `init(renderMap, treeRenderer)` 调用，也可单独调用以整体替换。传 null 解除注册。 */
export const setTreeRenderer = (renderer?: TreeRenderer | null): void => {
  treeRenderer = renderer ?? null;
};

export const getTreeRenderer = (): TreeRenderer | null => treeRenderer;

/**
 * 通知渲染器「组件树已更新」。
 *
 * **仅供 core 内部调用**（`refreshDerivedState` 与 `clearStore`）。宿主不要自己调 ——
 * 一旦宿主开始主动调它，调用时机又回到了宿主手里，正是本模块要消除的东西。
 * 未注册渲染器时是空操作。
 */
export const renderTree = (treeMap: TreeMap): void => {
  treeRenderer?.(treeMap);
};
