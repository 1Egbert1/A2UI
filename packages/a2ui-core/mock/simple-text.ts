/**
 * 最小示例：一个 Text 组件。
 *
 * 用来验证「parser → hydrate → buildTree」这条链路能跑通的最小数据。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 */

export const simpleTextMessages: string[] = [
  `{"surfaceUpdate":{"surfaceId":"simple-text","components":[{"id":"root","component":{"Text":{"text":{"literalString":"Hello, A2UI!"},"usageHint":"h2"}}}]}}`, // #1 surfaceUpdate · root(Text)
  `{"beginRendering":{"surfaceId":"simple-text","root":"root"}}`, // #2 beginRendering · root=root
];
