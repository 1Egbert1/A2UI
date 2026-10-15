/**
 * 单行摄取（ingest）：把「一条已经完整的 JSONL 行」变成对 store 的写入。
 *
 * 抽出来是为了让 `parseA2UI`（一次性解析整段文本）与 `createJSONLStream`（流式逐片解析）
 * 走**完全同一套**分发与派生逻辑——否则两条路径迟早会漂移出不一致的语义。
 */

import { recordError } from '../error';
import { hydrate } from '../hydrate';
import { getA2UIStore, setTrees } from '../store';
import { ErrorType } from '../store/types';
import { renderTree } from '../tree-render';
import { buildTree } from '../treebuilder';
import {
  handleBeginRendering,
  handleDataModelUpdate,
  handleDeleteSurface,
  handleSurfaceUpdate,
} from './messages';
import {
  MESSAGE_KEYS,
  type BeginRenderingMessage,
  type DataModelUpdateMessage,
  type DeleteSurfaceMessage,
  type MessageKey,
  type SurfaceUpdateMessage,
} from './types';

/** 错误 id 与写入由 error 模块统一负责，这里只表达「记一条解析错误」。 */
export const recordParseError = (content: string): void => {
  recordError(ErrorType.PARSE_ERROR, content);
};

/** 按消息类型分发到对应 handler；结构非法或类型未知时只记错，不抛。 */
export const dispatch = (message: unknown): void => {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    recordParseError(`消息必须是 JSON 对象，实际收到：${JSON.stringify(message)}`);
    return;
  }

  const record = message as Record<string, unknown>;
  const key = MESSAGE_KEYS.find((candidate) => candidate in record);

  if (!key) {
    const keys = Object.keys(record);
    recordParseError(
      keys.length === 0
        ? '空对象不是合法的 A2UI 消息'
        : `未知消息类型：${keys.join(', ')}`,
    );
    return;
  }

  try {
    applyMessage(key, record);
  } catch (error) {
    recordParseError(`${key} 处理失败：${(error as Error).message}`);
  }
};

const applyMessage = (key: MessageKey, record: Record<string, unknown>): void => {
  switch (key) {
    case 'surfaceUpdate':
      handleSurfaceUpdate(record.surfaceUpdate as SurfaceUpdateMessage);
      return;
    case 'beginRendering':
      handleBeginRendering(record.beginRendering as BeginRenderingMessage);
      return;
    case 'dataModelUpdate':
      handleDataModelUpdate(record.dataModelUpdate as DataModelUpdateMessage);
      return;
    case 'deleteSurface':
      handleDeleteSurface(record.deleteSurface as DeleteSurfaceMessage);
      return;
  }
};

/**
 * 处理一条**已完整**（不含换行结尾）的行。
 *
 * @param line 已 trim 过的行内容；空行必须由调用方提前过滤，这里不重复判断
 * @param position 错误文案里的位置描述，如 `第 3 行`；流式场景下由调用方维护行号
 */
export const ingestLine = (line: string, position: string): void => {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch (error) {
    recordParseError(`${position}不是合法 JSON：${(error as Error).message}`);
    return;
  }

  dispatch(message);
};

/**
 * 刷新派生状态：先**水合**（把节点渲染成 `_vnode`），再组装组件树写入 `treeMap`，
 * 最后把树交给已注册的**树渲染器**。
 *
 * 两件事都不适合逐行做——surfaceUpdate 只登记节点，根节点要等 beginRendering 才确定，
 * 数据模型要等 dataModelUpdate 才齐，容器子节点还可能是前向引用。因此它们是「一批输入
 * 处理完之后」的动作：一次性解析在整段末尾调一次，流式解析在每次 `push` 末尾调一次，
 * 保证任何时刻 store 都自洽可渲染。
 *
 * `renderTree(trees)` 就是「渲染时机」的落点：宿主在 `init` 时交出「怎么渲染」，
 * 由这里决定「什么时候渲染」——每次建树之后都算组件树变了一次。
 */
export const refreshDerivedState = (): void => {
  hydrate();
  // 建树要同时看 surfaceMap（从哪里开始）和 hydrateNodeMap（子节点引用反查）。
  const { surfaceMap, hydrateNodeMap } = getA2UIStore().getState();
  const trees = buildTree(surfaceMap, hydrateNodeMap);
  setTrees(trees);
  renderTree(trees);
};
