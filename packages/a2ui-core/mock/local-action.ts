/**
 * 本地动作（client-side action）最小示例：**一个按钮更新一行文案**。
 *
 * 这是协议扩展 `action.type = "local"` 的最小完整用例（扩展说明见
 * `docs/a2ui-local-action-extension.md`）：点击按钮 → `resolveAction` 判定为本地分支 →
 * 把 `local` 里的 `updateDataModel` 操作**模拟成一次数据绑定写回**（`context.updateModel`）
 * → 写进 store 的数据模型 → 触发重渲染 → 绑了同一 path 的 Text 立刻显示新文案。
 *
 * 与 `data-binding.ts` 的区别值得对照着看：那边的新值来自**用户输入**（TextField / Slider 的值），
 * 这边的新值直接写在 `action.local` 里（`literalString`），是一次**点击触发的写回**。
 * 相同点是两者都走 `updateModel` 这同一条链路，都不经过服务端。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 */

export const localActionMessages: string[] = [
  // #1 surfaceUpdate · root(Column) + title(Text) + message(Text, 绑 /message) + refresh-button(Button)
  //    + refresh-label(Text，按钮文案)
  `{"surfaceUpdate":{"surfaceId":"local-action","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","message","refresh-button"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"本地动作（local action）"},"usageHint":"h2"}}},{"id":"message","component":{"Text":{"text":{"path":"/message"},"usageHint":"h3"}}},{"id":"refresh-button","component":{"Button":{"child":"refresh-label","primary":true,"action":{"name":"refreshMessage","type":"local","local":[{"type":"updateDataModel","path":"/message","value":{"literalString":"✅ 这行文案已由本地动作更新（没有经过服务端）"}}]}}}},{"id":"refresh-label","component":{"Text":{"text":{"literalString":"更新文案"}}}}]}}`,
  // #2 dataModelUpdate · 初始文案（点击前绑 /message 的 Text 显示这一句）
  `{"dataModelUpdate":{"surfaceId":"local-action","contents":[{"key":"message","valueString":"点击下方按钮，用本地动作更新这行文案"}]}}`,
  // #3 beginRendering · root=root
  `{"beginRendering":{"surfaceId":"local-action","root":"root"}}`,
];
