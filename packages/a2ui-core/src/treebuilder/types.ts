/**
 * 组件树的数据结构。
 *
 * 单独成文件是为了打断类型循环：store 需要引用 ComponentTree 作为 state 的一员，
 * 而 treebuilder 的组装逻辑又需要引用 store/types 里的 Surface。把纯类型放在这个
 * 不依赖任何模块的叶子里，两边都可以安全地 import type。
 */

/** 组件树节点：由 HydrateNode 投影而来，只保留渲染一棵树所需的信息。 */
export interface TreeNode {
  componentId: string;
  /**
   * 父节点的 componentId；根节点为 `null`。
   *
   * 父子关系在结构上已经由 `children` 的嵌套表达，这里额外记一份是因为
   * 「往上走」的需求（面包屑、自底向上收集、定位某个组件属于哪条分支）
   * 靠嵌套数组要整棵树线性扫描才能做到。
   *
   * 注意：同一个组件被多个父节点引用时，会生成多份 TreeNode（树是展开的视图，
   * 不是原始的 DAG），每份的 `parentId` 各自指向引用它的那个父节点。
   */
  parentId: string | null;
  /** 该组件渲染出的节点实例；具体类型由渲染引擎决定（core 保持框架无关）。 */
  vnode: unknown;
  /** 子节点；由组件定义的 `children.explicitList` 还原而来。 */
  children: TreeNode[];
}

/** 一个 surface 对应一棵组件树；root 即 surface.rootNode 的投影。 */
export interface ComponentTree {
  surfaceId: string;
  root: TreeNode;
}

/** surfaceId → 组件树。 */
export type TreeMap = Record<string, ComponentTree>;
