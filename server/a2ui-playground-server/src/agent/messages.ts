/**
 * 把一次生成请求拼成送进模型的对话消息。
 *
 * 单独成模块是因为它被两个 provider 共用（mock 用不上，但 openai 用它），
 * 且它是「协议规则（system）」与「用户意图（user）」的分界线 —— 这条线很值得显式划出来。
 */
import type { AgentRequest, ChatMessage } from '../types';
import { buildImageHint, buildRevisionHint, buildSystemPrompt } from './prompt';

/** 把一张输入图转成 OpenAI 内容分片。`dataUrl` 优先，否则用 `url`。 */
const toImagePart = (image: NonNullable<AgentRequest['images']>[number]) => ({
  type: 'image_url' as const,
  image_url: { url: image.dataUrl ?? (image.url as string) },
});

export const buildChatMessages = (request: AgentRequest): ChatMessage[] => {
  // system 恒定：只含 surfaceId 与协议规则，不含任何随轮次变化的内容。
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(request.surfaceId) },
  ];

  // 历史原样回放 —— 模型的上下文里既有「它上一轮吐了什么」，也有「这轮的目标 surface」。
  // 空的 user 轮跳过：示例场景跑完会落一条 `content: ''` 的用户轮（用户并没有「说」什么），
  // 回放出去等于给模型一句空指令，只会干扰它理解「现在要改什么」。
  for (const turn of request.history) {
    if (turn.role === 'user' && turn.content.trim() === '') {
      continue;
    }
    messages.push({ role: turn.role, content: turn.content });
  }

  // 增量修改的约束**不放 system**：它只对后续轮次成立，
  // 混进 system 会让首轮也被「别重发组件」带偏。
  const instruction =
    request.history.length > 0
      ? `${buildRevisionHint(request.surfaceId)}\n\n用户：${request.message}`
      : request.message;

  // 多模态：把图片与文本合成一个 content 分片数组放进 user 消息。
  // 纯文本时仍用 string —— 历史轮次一直是 string，保持最小差异、也避免无图时多一层包裹。
  if (request.images && request.images.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: buildImageHint(request.images.length) + instruction },
        ...request.images.map(toImagePart),
      ],
    });
  } else {
    messages.push({ role: 'user', content: instruction });
  }

  return messages;
};
