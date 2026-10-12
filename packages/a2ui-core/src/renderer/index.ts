/**
 * 组件渲染注册表。
 *
 * core 只定义「渲染函数长什么样」，不关心具体框架：由渲染引擎（如 a2ui-vue）
 * 把「组件类型名 → 渲染函数」的映射在 init 时注入。这样 store 与 parser
 * 都不必依赖 Vue / React，符合 store.md 里「解除对 vue 依赖」的约束。
 */

/**
 * 渲染上下文：渲染函数除了组件属性，还需要「同 surface 的兄弟节点」与「本 surface 的数据模型」。
 *
 * 两个能力都做成**惰性函数**而不是直接给值，因为组件之间存在前向引用
 * （官方示例里 `Card.child` 指向的组件常常定义在 Card 之后），
 * 调用方可以在真正需要时再去取。
 */
export interface RenderContext {
  /** 正在渲染的组件 id。 */
  componentId: string;
  /** 该组件所属的 surface id。 */
  surfaceId: string;
  /**
   * 取同一 surface 下另一个组件的已渲染结果；跨 surface、未登记或尚未渲染时返回 `null`。
   *
   * 子节点的解析顺序因此不受 hydrate 遍历顺序影响 —— 渲染函数应把它包进「延迟求值」
   * 的容器里（a2ui-vue 的 `A2UINode` 就是这么做的），而不是在调用时立刻取值。
   */
  resolve: (componentId: string) => unknown;
  /** 读取本 surface 数据模型上某个 path（如 `/user/name`）的值；取不到时返回 `undefined`。 */
  read: (path: string) => unknown;
}

/** 单个组件的渲染函数：入参是该组件的属性对象与渲染上下文，返回本框架的渲染节点实例。 */
export type ComponentRenderer<TNode = unknown> = (
  props: Record<string, unknown>,
  context: RenderContext,
) => TNode;

/** 组件类型名 → 渲染函数。 */
export type RenderMap<TNode = unknown> = Record<string, ComponentRenderer<TNode>>;

/** 组件包装对象拆分结果，例如 `{ Text: {...} }` → `{ type: 'Text', props: {...} }`。 */
export interface ComponentPayload {
  type: string;
  /**
   * 组件属性。取不到时回退为空对象，避免把 undefined 交给渲染函数。
   * 索引签名带 unknown 是有意的：属性结构由各组件自己的协议定义约束，
   * core 不做也不知道字段级校验。
   */
  props: Record<string, unknown>;
}

let renderMap: RenderMap = {};

/** 注入渲染表；由 `init(renderMap)` 调用，也可单独调用以整体替换。 */
export const setRenderMap = (map: RenderMap): void => {
  renderMap = map;
};

export const getRenderMap = (): RenderMap => renderMap;

/** 取某个组件类型的渲染函数；该类型未注册时返回 undefined。 */
export const resolveRenderer = (componentType: string): ComponentRenderer | undefined =>
  renderMap[componentType];

/**
 * 拆开协议里的组件包装对象。
 *
 * 协议规定 wrapper 恰好含一个键（组件类型名），值即该组件的属性
 * （见 server_to_client.json 的 `component` 字段）。这里对畸形输入做兜底，
 * 返回空 type，让调用方按「未注册渲染器」处理，而不是抛错中断整行解析。
 */
export const splitComponent = (wrapped: unknown): ComponentPayload => {
  if (wrapped === null || typeof wrapped !== 'object') {
    return { type: '', props: {} };
  }

  const [entry] = Object.entries(wrapped as Record<string, unknown>);
  if (!entry) {
    return { type: '', props: {} };
  }

  const [type, props] = entry;
  return {
    type,
    props: props !== null && typeof props === 'object' ? (props as Record<string, unknown>) : {},
  };
};
