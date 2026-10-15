import { getA2UIStore, type A2UIStoreState } from '../store';
import { ingestLine, refreshDerivedState } from './ingest';

export * from './types';
export * from './stream';
export * from './buffer';
export * from './simulate';

/**
 * 解析 A2UI 的 JSONL 线协议（一次性：整段文本进，解析完的 store 快照出）。
 *
 * - 每行是一条独立消息，逐行 JSON.parse 后按类型分发；
 * - 空行（含文件尾部换行）直接跳过，不计为错误；
 * - 任何一行的失败都只记入 errorMap，不中断后续行的解析；
 * - 整段处理完后先**水合**（`hydrate`：把节点渲染成 `_vnode`），再组装组件树
 *   （`buildTree`）写入 store.treeMap；
 * - 返回解析结束时的 store 快照，便于调用方直接消费结果。
 *
 * 需要**流式**（分片到达、边到边渲染）时用 `createJSONLStream()`：它和本函数共用
 * `./ingest` 里的同一套分发与派生逻辑，两条路径的语义保证一致。
 *
 * 分片边界**不受换行约束**（定长切片、一条消息跨多片、顶层是数组）时改用
 * `createA2UIBuffer()`：它按 JSON 括号配对取完整值，并把多组件的 `surfaceUpdate`
 * 补全成「一个组件一条消息」。`./simulate` 里的 `simulateTextStream` 可把这个字符流跑起来。
 */
export const parseA2UI = (protocol: string): A2UIStoreState => {
  protocol.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') {
      return;
    }

    ingestLine(line, `第 ${index + 1} 行`);
  });

  refreshDerivedState();

  return getA2UIStore().getState();
};
