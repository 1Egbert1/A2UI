/**
 * 一个 Column 挂三个 Text，专门验证 treebuilder 的父子组装。
 *
 * 子组件定义在父组件**之后**（前向引用），树里 root 应有 3 个 children 且顺序与 `explicitList` 一致。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 */

export const columnTextsMessages: string[] = [
  `{"surfaceUpdate":{"surfaceId":"column-texts","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","body","caption"]},"distribution":"start","alignment":"stretch"}}},{"id":"title","component":{"Text":{"text":{"literalString":"A2UI 组件树"},"usageHint":"h2"}}},{"id":"body","component":{"Text":{"text":{"literalString":"Column 容器下挂了三个 Text 子组件，父子关系由 children.explicitList 声明。"},"usageHint":"body"}}},{"id":"caption","component":{"Text":{"text":{"literalString":"treebuilder 按 componentId 反查 hydrateNode，递归展开子树。"},"usageHint":"caption"}}}]}}`, // #1 surfaceUpdate · root(Column) title(Text) body(Text) caption(Text)
  `{"beginRendering":{"surfaceId":"column-texts","root":"root"}}`, // #2 beginRendering · root=root
];
