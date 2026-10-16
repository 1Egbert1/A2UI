/**
 * A2UI 生成 agent 的提示词组装器。
 *
 * prompt 的**正文**在 `prompt-template.ts`（单一来源，`{{surfaceId}}` 占位符），
 * 这里只做组装：把占位符替换成当轮真实的 surfaceId。改提示词内容请去改模板文件，
 * 改完记得同步 `docs/a2ui-agent-prompt.md`（它直接展示模板全文）。
 */
import { PROMPT_TEMPLATE } from './prompt-template';

/**
 * 本轮带图时，在 user 消息开头补的一句提示。
 *
 * 单独成函数是因为它随「带了 N 张图」变化，不能写进静态 system；只点一句，
 * 真正的版式对齐交给模型看图片。
 */
export const buildImageHint = (count: number): string =>
  `（本轮附上了 ${count} 张图片，可能是界面设计稿 / 截图 / 参考图。` +
  `请优先按图片中的版式与文案生成对应的 A2UI 协议，自然语言描述作补充。` +
  `仍须输出可解析的 JSONL，不要解释。）\n\n`;

/**
 * 拼完整的 system prompt：模板 + 占位符替换。
 *
 * `surfaceId` 写进 prompt 是刻意的：多轮对话里用户说「把标题改一下」，
 * 模型必须往**同一个 surface** 上更新，否则客户端会多出一块孤立的界面。
 */
export const buildSystemPrompt = (surfaceId: string): string =>
  PROMPT_TEMPLATE.replaceAll('{{surfaceId}}', surfaceId);

/**
 * 多轮对话里对模型的**增量修改**约束。
 * 不加这段的话，模型倾向于「整块重发」——协议上没错，但客户端会闪一下。
 */
export const buildRevisionHint = (surfaceId: string): string =>
  `这是对已有 surface「${surfaceId}」的修改。只输出**变化的部分**：` +
  `改文案/结构用 surfaceUpdate（可只带受影响的那几个组件，同 id 会原地更新），` +
  `改数据用 dataModelUpdate。除非用户要求重做整页，否则不要重发全部组件，` +
  `也不要再发 beginRendering（根节点没变）。`;
