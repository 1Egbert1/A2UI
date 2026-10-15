/**
 * List 动态渲染演示协议（`children.template` + 数据列表）。
 *
 * 用来端到端验证「List 按数据模型里的列表动态渲染」：
 *
 * - `List.children.template = { componentId: "item-card", dataBinding: "/items" }`：
 *   `item-card` 是模板组件，`/items` 指向数据模型里的集合；
 * - 集合里的每个 item 都渲染一次 `item-card`（这里 3 个 item → 3 张卡片）；
 * - 模板内部用**相对绑定**：path 里的 `item` 段是占位符，渲染某个 item 时替换成该
 *   item 的 key。`/items/item/name` → 渲染第 k 个 item 时 → `/items/<key>/name`。
 *
 * 注意：A2UI v0.8 的数据模型没有原生数组（`DataEntry` 只有 valueString/valueNumber/
 * valueBoolean/valueMap），所以「列表」是 `valueMap` 还原成的**对象 map**，key 是 item 标识。
 *
 * 每个元素是**一行 A2UI JSONL 消息**，数组顺序即发送顺序。
 */
export const listTemplateMessages: string[] = [
  // #1 surfaceUpdate · root(Column) title(Text) list(List) item-card(Card) item-content(Column) item-name(Text) item-desc(Text)
  `{"surfaceUpdate":{"surfaceId":"list-template","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","list"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"Product List"},"usageHint":"h2"}}},{"id":"list","component":{"List":{"children":{"template":{"componentId":"item-card","dataBinding":"/items"}}}}},{"id":"item-card","component":{"Card":{"child":"item-content"}}},{"id":"item-content","component":{"Column":{"children":{"explicitList":["item-name","item-desc"]}}}},{"id":"item-name","component":{"Text":{"text":{"path":"/items/item/name"},"usageHint":"h4"}}},{"id":"item-desc","component":{"Text":{"text":{"path":"/items/item/desc"}}}}]}}`,
  // #2 dataModelUpdate · /items 是 valueMap（对象 map），3 个 item
  `{"dataModelUpdate":{"surfaceId":"list-template","contents":[{"key":"items","valueMap":[{"key":"p1","valueMap":[{"key":"name","valueString":"Product A"},{"key":"desc","valueString":"The first product"}]},{"key":"p2","valueMap":[{"key":"name","valueString":"Product B"},{"key":"desc","valueString":"The second product"}]},{"key":"p3","valueMap":[{"key":"name","valueString":"Product C"},{"key":"desc","valueString":"The third product"}]}]}]}}`,
  // #3 beginRendering · root=root
  `{"beginRendering":{"surfaceId":"list-template","root":"root"}}`,
];
