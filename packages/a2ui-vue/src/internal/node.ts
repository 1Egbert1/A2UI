import { cloneVNode, defineComponent, h, isVNode, type PropType, type VNode, type VNodeChild } from 'vue';
import type { ComponentRenderer } from 'a2ui-core';
import { stylesOf } from './styles';

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
 * 给渲染结果的**根元素**补上组件 id，并合入组件级 `styles` 扩展。
 *
 * 为什么要包一层而不是在每个渲染器里手写：id / styles 都不属于任何组件的协议属性
 * （`standard_catalog_definition.json` 里没有组件声明它们），逐组件写 18 遍既重复又
 * 容易漏；`ComponentRenderer` 是统一契约，在这里收口最稳。
 *
 * 关于 `styles`：官方 v0.8 只在 surface 级定义 styles，组件级是本项目的受控扩展
 * （白名单见 `internal/styles.ts` 的 `STYLE_RULES`，说明见
 * `docs/a2ui-styles-extension.md`）。`cloneVNode` 内部走 `mergeProps`，对 `style`
 * 是**合并**而非替换 —— 组件自身由 usageHint 等推导出的默认样式仍然保留，
 * 只有同名属性被覆盖。
 *
 * 为什么带 surfaceId 前缀：componentId 只在**单个 surface 内**唯一，多个 surface
 * 各自都有 `root` 是常态，裸 componentId 当 id 必撞。
 *
 * 为什么再叠加 itemKey 后缀（模板场景）：`children.template` 会把同一个模板组件渲染
 * N 次（每个 item 一次），这些实例的 componentId 完全相同，仅靠 `surfaceId-componentId`
 * 会得到 N 个相同 id。此时 core 会在 `context.itemKey` 上给出当前 item 的 key，
 * 拼上它后每个 item 的组件根 id 才唯一（`surfaceId-componentId-itemKey`）。
 *
 * 关于「全局唯一」：本 store 的 hydrateNodeMap 是按 componentId 索引的**扁平表**
 * （见 a2ui-core/src/store），因此 componentId 在整个 store 内已隐含唯一；
 * 再叠加 surfaceId 前缀后，`surfaceId-componentId` 对不同 (surface, component) 组合
 * 两两不同；模板 item 再叠加 itemKey，同一 (surface, component) 的多个 item 也各自不同。
 *
 * 唯一残留边界：**同一组件被 DAG 展开多次**（同一 surface 内 componentId 被两个父节点
 * 同时引用）。treebuilder 会把它展开成两份 TreeNode，但它们指向**同一个 `_vnode` 实例**，
 * 渲染进同一文档时会得到两个相同 id。这是「从 vnode 直接渲染」这条路径的固有上限 ——
 * 要彻底消除得让子节点 id 带上「从根到它的路径」（需要改 `childOf` 的契约），本轮没做。
 *
 * 落在哪个元素上：
 * - 渲染器返回**元素 vnode**（大多数组件）时，`cloneVNode` 直接把 `id` / `style` 合进该元素；
 * - 返回**组件 vnode**（Tabs / Modal / MultipleChoice 这类有状态组件）时，二者作为
 *   透传属性落到该组件唯一的根元素上（Vue 的单根属性透传）；
 * - 返回 `null`（渲染不出东西）时保持 `null` —— 没有根元素，也就没有 id / 样式可挂。
 */
export const withRootId = (renderer: ComponentRenderer<VueNode>): ComponentRenderer<VueNode> =>
  (props, context) => {
    const node = renderer(props, context);
    if (!isVNode(node)) {
      return node;
    }
    const id = context.itemKey
      ? `${context.surfaceId}-${context.componentId}-${context.itemKey}`
      : `${context.surfaceId}-${context.componentId}`;
    // 没写 styles（或全是白名单外的键）时保持原样，不多挂一个空 style。
    const styles = stylesOf(props.styles);
    return styles === undefined ? cloneVNode(node, { id }) : cloneVNode(node, { id, style: styles });
  };

/**
 * 给节点挂上渲染框架的 `key` —— 集合项的**稳定身份**。
 *
 * 数据驱动的列表（`children.template`）在中间插入或删除一项时，后面所有项的位置都会平移。
 * 没有 key 时 Vue 只能按「第 n 个」复用 DOM，于是把 c1 的内容 patch 到 c2 的位置上，表现为
 * **内容错位**（不是闪烁，是串）。带上集合的 key，Vue 会把节点跟着它的 item 一起移动。
 *
 * 与 `withRootId` 用同一套机制（`cloneVNode` 合并属性）：`key` 是 Vue 的 diff 元信息，
 * 不会渲染成 DOM 属性。非 vnode（字符串 / 数字 / null）原样返回 —— 它们没有身份，
 * 也不需要被追踪。
 */
export const withKey = (value: VNodeChild, key: string): VNodeChild => {
  if (!isVNode(value)) {
    return value;
  }
  return cloneVNode(value, { key });
};
