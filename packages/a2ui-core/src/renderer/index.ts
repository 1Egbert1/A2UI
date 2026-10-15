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
   * 模板 item 作用域标识。
   *
   * 静态组件为 `undefined`；通过 `template` 动态渲染出来的组件，是当前 item 的 key
   * （如 `p1`）。渲染引擎据此给每个 item 的组件根生成**唯一 id**（`surfaceId-componentId-itemKey`），
   * 避免「同一个模板组件被渲染 N 次」得到 N 个相同 id。
   */
  itemKey?: string;
  /**
   * 取同一 surface 下另一个组件的已渲染结果；跨 surface、未登记或尚未渲染时返回 `null`。
   *
   * 子节点的解析顺序因此不受 hydrate 遍历顺序影响 —— 渲染函数应把它包进「延迟求值」
   * 的容器里（a2ui-vue 的 `A2UINode` 就是这么做的），而不是在调用时立刻取值。
   */
  resolve: (componentId: string) => unknown;
  /** 读取本 surface 数据模型上某个 path（如 `/user/name`）的值；取不到时返回 `undefined`。 */
  read: (path: string) => unknown;
  /**
   * 该组件是否**已经播过入场动画**（即 store 里这个 HydrateNode 的 `hasMounted`）。
   *
   * 渲染引擎据此决定要不要给这个组件挂入场动画：
   * - `false` —— 这是它第一次被渲染，应播一次；
   * - `true` —— 已经播过（或宿主不需要动画），保持静止，重渲染不要重播。
   */
  hasMounted: boolean;
  /**
   * 入场动画播放完毕时调用：把 store 里该节点的 `hasMounted` 置为 `true`（「标记清除」的清除）。
   *
   * core 只提供这个落点，**动画怎么播由渲染引擎自己决定**（CSS 过渡 / Web Animations API /
   * 原生动画都行）；渲染引擎不需要知道 store 长什么样，只要在合适的时刻调它一次。
   * 幂等：重复调用无副作用（详见 store 的 markHydrateNodeMounted）。
   */
  markMounted: () => void;
  /**
   * 把本 surface 数据模型上某个 path（如 `/email`）写为 `value`，并触发一次派生状态刷新。
   *
   * 这是「客户端本地写回数据模型」的落点：表单控件在用户交互时（输入、勾选、拖动）
   * 通过它把新值写回 store，随后 core 会重跑 hydrate + buildTree + renderTree，
   * 让绑定了同一 path 的其它组件（如一个展示同值的 Text）跟着更新。
   *
   * 渲染引擎只跟这个函数打交道，不需要知道 store 的结构，也不必自己触发重渲染——
   * 刷新时机由 core 决定（与 `renderTree` 的「渲染时机归 SDK」一脉相承）。
   */
  updateModel: (path: string, value: unknown) => void;
  /**
   * 按数据列表动态渲染模板组件的子项（`children.template` 的落点）。
   *
   * - `componentId`：作为模板的组件，数据列表里每个 item 渲染它一次；
   * - `dataBinding`：指向数据模型里集合（对象 map 或数组）的 path，如 `/items`。
   *
   * 对集合里的每个 item，用「相对绑定」渲染一份模板组件：模板（及其子树）内部 `path`
   * 里等于 `item` 的段会被替换成当前 item 的 key（官方示例 `/items/item/name` →
   * `/items/<key>/name`）。
   *
   * 返回**带 key 的条目列表**而不是裸节点数组，是为了让渲染引擎能把集合里的 key 当作子节点的
   * 稳定身份（框架的 `key` / `trackBy`）。列表是数据驱动的：中间插入或删除一项时，位置会整体
   * 平移，若按「第 n 个」去复用节点，内容就会错位到别的 item 上。带上 key，框架才能把节点
   * 跟着它的 item 一起移动。
   *
   * 为什么放在 core 而不是渲染引擎：展开需要「读组件协议 + 递归调用渲染函数」，
   * 这些只有 core 的 hydrate 才够得着；渲染引擎（如 renderList）拿到这个方法后，
   * 只负责把返回的一组节点摆进布局。
   */
  renderTemplate: (componentId: string, dataBinding: string) => TemplateItem[];
}

/** `renderTemplate` 展开出的一个 item：集合里的键 + 用它渲染出来的节点。 */
export interface TemplateItem {
  /** 数据集合里的键（对象 map 的键，或裸数组的下标字符串），形如 `c1`。 */
  key: string;
  /** 用模板组件渲染这个 item 得到的节点；渲染不出东西时为 `null`。 */
  node: unknown;
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
