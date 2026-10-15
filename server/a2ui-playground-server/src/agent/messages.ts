/**
 * 把一次生成请求拼成送进模型的对话消息。
 *
 * 单独成模块是因为它被两个 provider 共用（mock 用不上，但 openai 用它），
 * 且它是「协议规则（system）」与「用户意图（user）」的分界线 —— 这条线很值得显式划出来。
 */
import type { AgentRequest, ChatMessage } from '../types';
import { buildRevisionHint, buildSystemPrompt } from './prompt';

export const buildChatMessages = (request: AgentRequest): ChatMessage[] => {
  // system 恒定：只含 surfaceId 与协议规则，不含任何随轮次变化的内容。
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(request.surfaceId) },
  ];

  // 历史原样回放 —— 模型的上下文里既有「它上一轮吐了什么」，也有「这轮的目标 surface」。
  for (const turn of request.history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  // 增量修改的约束**不放 system**：它只对后续轮次成立，
  // 混进 system 会让首轮也被「别重发组件」带偏。
  const instruction =
    request.history.length > 0
      ? `${buildRevisionHint(request.surfaceId)}\n\n用户：${request.message}`
      : request.message;
  messages.push({ role: 'user', content: instruction });

  return messages;
};
