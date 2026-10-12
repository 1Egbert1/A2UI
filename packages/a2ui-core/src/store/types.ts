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
