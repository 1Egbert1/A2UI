import { recordError } from '../error';
import { hydrate } from '../hydrate';
import { getA2UIStore, setTrees, type A2UIStoreState } from '../store';
import { ErrorType } from '../store/types';
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

export * from './types';

/** 错误 id 与写入由 error 模块统一负责，这里只表达「记一条解析错误」。 */
const recordParseError = (content: string): void => {
  recordError(ErrorType.PARSE_ERROR, content);
};

const dispatch = (message: unknown): void => {
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
 * 解析 A2UI 的 JSONL 线协议，边解析边写入全局 store。
 *
 * - 每行是一条独立消息，逐行 JSON.parse 后按类型分发；
 * - 空行（含文件尾部换行）直接跳过，不计为错误；
 * - 任何一行的失败都只记入 errorMap，不中断后续行的解析；
 * - 整段处理完后先**水合**（`hydrate`：把节点渲染成 `_vnode`），再组装组件树
 *   （`buildTree`）写入 store.treeMap；
 * - 返回解析结束时的 store 快照，便于调用方直接消费结果。
 */
export const parseA2UI = (protocol: string): A2UIStoreState => {
  protocol.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      recordParseError(`第 ${index + 1} 行不是合法 JSON：${(error as Error).message}`);
      return;
    }

    dispatch(message);
  });

  // 触发时机：一整段 JSONL 处理完之后，先水合再建树。
  // 两件事都不能逐行做——surfaceUpdate 只登记节点，根节点要等 beginRendering 才确定，
  // 数据模型要等 dataModelUpdate 才齐，容器子节点还可能是前向引用。
  hydrate();
  // 建树要同时看 surfaceMap（从哪里开始）和 hydrateNodeMap（子节点引用反查）。
  const { surfaceMap, hydrateNodeMap } = getA2UIStore().getState();
  setTrees(buildTree(surfaceMap, hydrateNodeMap));

  return getA2UIStore().getState();
};
