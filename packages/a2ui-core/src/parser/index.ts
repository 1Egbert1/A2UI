import { getA2UIStore, type A2UIStoreState } from '../store';
import { flushDerivedStateRefresh, ingestLine } from './ingest';

export * from './types';
export * from './stream';
export * from './buffer';
export * from './simulate';

/**
 * 刷新入口（两个，对应两种语义）：
 * - `requestDerivedStateRefresh` —— 合帧请求，流式推送与表单写回走它；
 * - `flushDerivedStateRefresh` —— 立即同步刷新并取消挂起项，`parseA2UI` 与「需要当场拿到
 *   最终 store」的宿主走它。
 *
 * `refreshDerivedState` 是它们底下的同步原语，一并导出便于宿主自己组装调度。
 */
export {
  flushDerivedStateRefresh,
  refreshDerivedState,
  requestDerivedStateRefresh,
} from './ingest';

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
 * 刷新走的是**同步**入口（`flushDerivedStateRefresh`）：本函数的契约就是「同步返回解析完的
 * 状态」，不能把刷新推到下一帧。反过来，它还会**取消**流式路径挂起的那次合帧刷新——内容
 * 已经在这里算过一遍了，没必要再跑一次。需要分片到达、边到边渲染时用 `createJSONLStream()`，
 * 那条路径走合帧（见 `./stream`）。
 *
 * 需要**流式**（分片到达、边到边渲染）时用 `createJSONLStream()`：它和本函数共用
 * `./ingest` 里的同一套分发与派生逻辑，两条路径的语义保证一致。
 *
 * 分片边界**不受换行约束**（定长切片、一条消息跨多片、顶层是数组）时改用
 * `createA2UIBuffer()`：它按 JSON 括号配对取完整值，并把批量消息补全成「一条子项一条消息」
 * ——`surfaceUpdate` 按组件拆，`dataModelUpdate` 递归拆到叶子数据条目（path 带上祖先 key）。
 * `./simulate` 里的 `simulateTextStream` 可把这个字符流跑起来。
 */
export const parseA2UI = (protocol: string): A2UIStoreState => {
  protocol.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') {
      return;
    }

    ingestLine(line, `第 ${index + 1} 行`);
  });

  flushDerivedStateRefresh();

  return getA2UIStore().getState();
};
