import { cloneVNode, defineComponent, h, isVNode, type PropType, type VNode, type VNodeChild } from 'vue';
import type { ComponentRenderer } from 'a2ui-core';

/** 渲染结果类型：允许为空 —— 属性不完整或数据缺失时，确实渲染不出东西。 */
export type VueNode = VNode | null;

/**
 * 把 core 侧解析出来的「任意节点值」归一化成 Vue 能渲染的东西。
 *
 * 子节点的 `_vnode` 类型是开放的（core 不知道框架），所以这里只接纳 Vue 认得的形态：
 * VNode / 字符串 / 数字 / null。都不是就退化成 null，而不是把非法值塞给 Vue。
 */
export const normalizeNode = (value: unknown): VNodeChild => {
  if (isVNode(value)) {
    // 必须 clone：store 里存的是同一个实例，多处渲染同一实例会触发 Vue 的复用警告。
    return cloneVNode(value);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return null;
};

/**
 * 子节点占位组件。
 *
 * hydrate 是**单趟遍历**：容器渲染时，定义在它后面的兄弟组件可能还没渲染出 `_vnode`，
 * 所以容器不能直接持有子节点，只能持有一个 `resolve` 函数。真正取值的时刻由本组件
 * 决定 —— 到那时 hydrate 早已跑完，`resolve` 必定能拿到结果。
 *
 * 组件内部需要延迟渲染某一块（Tabs 的非当前页、Modal 的弹层）时也复用它。
 */
export const A2UINode = defineComponent({
  name: 'A2UINode',
  props: {
    resolve: { type: Function as PropType<() => unknown>, required: true },
  },
  setup(props) {
    return () => normalizeNode(props.resolve());
  },
});

/** 按 componentId 生成一个延迟解析的子节点。 */
export const childOf = (resolve: (componentId: string) => unknown, componentId: string) =>
  h(A2UINode, { resolve: () => resolve(componentId) });

/** 用一个自定义取值函数生成一个延迟解析的子节点。 */
export const nodeOf = (resolve: () => unknown) => h(A2UINode, { resolve });

/**
 * 给渲染结果的**根元素**补上组件 id，格式 `${surfaceId}-${componentId}`。
 *
 * 为什么要包一层而不是在每个渲染器里手写：id 不属于任何组件的协议属性
 * （standard_catalog_definition.json 里没有组件声明 `id`），逐组件写 18 遍既重复又
 * 容易漏；`ComponentRenderer` 是统一契约，在这里收口最稳。
 *
 * 为什么带 surfaceId 前缀：componentId 只在**单个 surface 内**唯一，多个 surface
 * 各自都有 `root` 是常态，裸 componentId 当 id 必撞。
 *
 * 关于「全局唯一」：本 store 的 hydrateNodeMap 是按 componentId 索引的**扁平表**
 * （见 a2ui-core/src/store），因此 componentId 在整个 store 内已隐含唯一；
 * 再叠加 surfaceId 前缀后，`surfaceId-componentId` 对不同 (surface, component) 组合
 * 两两不同。
 *
 * 唯一残留边界：**同一组件被 DAG 展开多次**（同一 surface 内 componentId 被两个父节点
 * 同时引用）。treebuilder 会把它展开成两份 TreeNode，但它们指向**同一个 `_vnode` 实例**，
 * 渲染进同一文档时会得到两个相同 id。这是「从 vnode 直接渲染」这条路径的固有上限 ——
 * 要彻底消除得让子节点 id 带上「从根到它的路径」（需要改 `childOf` 的契约），本轮没做。
 *
 * 落在哪个元素上：
 * - 渲染器返回**元素 vnode**（大多数组件）时，`cloneVNode` 直接把 `id` 合进该元素；
 * - 返回**组件 vnode**（Tabs / Modal / MultipleChoice 这类有状态组件）时，`id` 会作为
 *   透传属性落到该组件唯一的根元素上（Vue 的单根属性透传）；
 * - 返回 `null`（渲染不出东西）时保持 `null` —— 没有根元素，也就没有 id 可挂。
 */
export const withRootId = (renderer: ComponentRenderer<VueNode>): ComponentRenderer<VueNode> =>
  (props, context) => {
    const node = renderer(props, context);
    return isVNode(node) ? cloneVNode(node, { id: `${context.surfaceId}-${context.componentId}` }) : node;
  };
