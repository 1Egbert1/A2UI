/**
 * 协议层的「这一轮能不能显示」体检。
 *
 * 存在的理由：**渲染不出来时不一定有错误**。最典型的一种是模型只发了 `surfaceUpdate`
 * 却忘了 `beginRendering` —— 组件全都登记了，surface 却从未创建，预览一片空白，
 * `errorMap` 也是空的。文案级的 warning 抓不到它（JSON 完全合法），只有「看整轮的全貌」
 * 才能判断，所以放在 run 收尾处。
 *
 * **只在第一轮检查**：增量轮次本来就不该重发 `beginRendering`（surface 已经在了），
 * 无条件检查会把正常的增量修改全判成错误。
 */
import type { A2UIMessage } from '../types';

export interface ProtocolAuditContext {
  /** 本轮是不是新 surface 的第一轮（该 thread 的 `history` 为空）。 */
  isFirstTurn: boolean;
}

/** 一轮结束后能看出来的问题；没有问题时返回空数组。 */
export const protocolWarnings = (
  messages: A2UIMessage[],
  context: ProtocolAuditContext,
): string[] => {
  if (!context.isFirstTurn) {
    return [];
  }

  let components = 0;
  const componentIds = new Set<string>();
  let root: string | undefined;

  for (const message of messages) {
    if ('surfaceUpdate' in message) {
      components += message.surfaceUpdate.components.length;
      for (const item of message.surfaceUpdate.components) {
        componentIds.add(item.id);
      }
    } else if ('beginRendering' in message) {
      root = message.beginRendering.root;
    }
  }

  if (components === 0) {
    return [];
  }

  if (root === undefined) {
    return [
      `本轮收到 ${components} 个组件，但没有 beginRendering —— surface 不会被创建，界面不会显示。` +
        '（首轮必须发 beginRendering 指定 root）',
    ];
  }

  if (!componentIds.has(root)) {
    return [
      `beginRendering 指定的 root「${root}」不在本轮组件里 —— 根节点找不到，界面会空白。`,
    ];
  }

  return [];
};
