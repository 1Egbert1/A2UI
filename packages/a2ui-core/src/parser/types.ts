/**
 * A2UI 线协议消息类型（server → client）。
 *
 * 依据 specification/v0_8/json/server_to_client.json：
 * 一条消息 MUST 恰好携带以下四种之一：surfaceUpdate / beginRendering /
 * dataModelUpdate / deleteSurface。线格式为 JSONL，每行一条消息。
 */

/** surfaceUpdate 中单个组件定义。 */
export interface ComponentDefinition {
  /** 组件唯一 id，在 surface 内被 beginRendering.root 引用。 */
  id: string;
  /** 仅当直接父级为 Row/Column 时有意义，对应 CSS flex-grow。 */
  weight?: number;
  /** 包装对象，恰好一个键（组件类型名），值为该组件的属性。 */
  component: Record<string, unknown>;
}

export interface SurfaceUpdateMessage {
  surfaceId: string;
  components: ComponentDefinition[];
}

export interface BeginRenderingMessage {
  surfaceId: string;
  /** 根组件的 id，必须能在已有组件中找到。 */
  root: string;
  catalogId?: string;
  styles?: Record<string, unknown>;
}

/**
 * dataModelUpdate 的一条数据项。
 * 除 key 外，必须且只能提供 valueString / valueNumber / valueBoolean / valueMap 之一。
 */
export interface DataEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  /** 嵌套 map，以邻接表形式表达。 */
  valueMap?: DataEntry[];
}

export interface DataModelUpdateMessage {
  surfaceId: string;
  /** 数据模型内的可选路径（如 '/user/name'）；缺省或 '/' 表示整体合并。 */
  path?: string;
  contents: DataEntry[];
}

export interface DeleteSurfaceMessage {
  surfaceId: string;
}

export type A2UIMessage =
  | { surfaceUpdate: SurfaceUpdateMessage }
  | { beginRendering: BeginRenderingMessage }
  | { dataModelUpdate: DataModelUpdateMessage }
  | { deleteSurface: DeleteSurfaceMessage };

/** 消息类型判别键，顺序即分发顺序。 */
export const MESSAGE_KEYS = [
  'surfaceUpdate',
  'beginRendering',
  'dataModelUpdate',
  'deleteSurface',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];
