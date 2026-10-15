export interface A2uiStore {
  surfaceMap: Record<string, Surface>;
  hydrateNodeMap: Record<string, HydrateNode>;
}

export interface Surface {
  surfaceId: string;
  beginRender: boolean;
  rootNode: HydrateNode;
}

export interface HydrateNode {
  componentId: string;
  _vnode: unknown;
  ownerSurfaceId: string;
  protocol: string;
  /**
   * 入场动画是否**已播放完毕**（「标记清除」里的标记位）。
   *
   * - 新登记的组件为 `false`：渲染引擎据此给这个组件加入场动画；
   * - 动画结束时由渲染引擎回调 `markHydrateNodeMounted(componentId)` 置为 `true`，
   *   之后该节点不再播动画，只有重渲染不该重播的语义。
   *
   * 放在 store 而不是渲染引擎内部，是为了让「该不该播动画」这件事**框架无关**：
   * core 只维护状态与转换时机，具体怎么播（CSS / Web Animations / 原生动画）由渲染引擎决定。
   * `clearStore` 会整表清空，因此清场后重新登记的组件天然从 `false` 重新开始。
   */
  hasMounted: boolean;
}

export enum ErrorType {
  /** 协议层面的错误：非法 JSON、未知消息类型、root 指向不存在的组件、渲染器抛错等。 */
  PARSE_ERROR = 'PARSE_ERROR',
  /** 组件类型在 renderMap 中没有登记渲染函数，该组件无法被渲染。 */
  RENDERER_NOT_FOUND = 'RENDERER_NOT_FOUND',
  /** 协议里合法、但当前实现还没支持的特性（如 children.template），需要显式暴露而不是静默忽略。 */
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
}

export interface A2UIError {
  type: ErrorType;
  content: string;
}
