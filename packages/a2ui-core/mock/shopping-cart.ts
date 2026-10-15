/**
 * 购物车列表演示协议（`List.children.template` + 数据列表 + 合计绑定）。
 *
 * 端到端验证「购物车」这种典型列表场景在当前 renderer 支持的标准组件协议下能否
 * 拼出来。用到的组件与属性都来自 `docs/a2ui-component-protocol.md` 的支持矩阵：
 *
 * - `Column` / `Row`：布局骨架，`distribution` / `alignment` 控制对齐；
 * - `List.children.template = { componentId: "item-card", dataBinding: "/cart/items" }`：
 *   按购物车条目列表动态渲染，`item-card` 是模板组件；
 * - `Card`：每个条目一张卡片；
 * - `Image`：商品缩略图，`url` 绑定 `/cart/items/item/image`，`usageHint` 控尺寸；
 * - `Text`：商品名 / 描述 / 单价 / 数量，`usageHint` 区分层级（h4 / caption / body）；
 * - `Divider`：合计与列表之间的分隔线；
 * - 合计行：`Text` 绑定 `/cart/total`，与列表同源于一份数据模型。
 *
 * 模板内部用**相对绑定**：path 里的 `item` 段是占位符，渲染第 k 个条目时替换成该
 * 条目的 key（`/cart/items/item/name` → `/cart/items/<key>/name`）。
 *
 * 注意：A2UI v0.8 的数据模型没有原生数组，购物车条目是 `valueMap` 还原成的**对象 map**，
 * key（c1 / c2 / c3）是条目标识。
 *
 * 每个元素是**一行 A2UI JSONL 消息**，数组顺序即发送顺序。
 */
export const shoppingCartMessages: string[] = [
  // #1 surfaceUpdate · root(Column) title(Text) list(List) divider(Divider) total-label(Text) total-value(Text)
  //                 + 模板：item-card(Card) item-content(Column) item-top(Row) item-image(Image)
  //                         item-main(Column) item-name(Text) item-desc(Text)
  //                         item-bottom(Row) item-price(Text) item-qty(Text)
  `{"surfaceUpdate":{"surfaceId":"shopping-cart","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","list","divider","total-row"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"购物车"},"usageHint":"h2"}}},{"id":"list","component":{"List":{"children":{"template":{"componentId":"item-card","dataBinding":"/cart/items"}}}}},{"id":"divider","component":{"Divider":{}}},{"id":"total-row","component":{"Row":{"children":{"explicitList":["total-label","total-value"]},"distribution":"spaceBetween","alignment":"center"}}},{"id":"total-label","component":{"Text":{"text":{"literalString":"合计"},"usageHint":"body"}}},{"id":"total-value","component":{"Text":{"text":{"path":"/cart/total"},"usageHint":"h3"}}},{"id":"item-card","component":{"Card":{"child":"item-content"}}},{"id":"item-content","component":{"Column":{"children":{"explicitList":["item-top","item-bottom"]}}}},{"id":"item-top","component":{"Row":{"children":{"explicitList":["item-image","item-main"]},"alignment":"center"}}},{"id":"item-image","component":{"Image":{"url":{"path":"/cart/items/item/image"},"fit":"cover","usageHint":"smallFeature"}}},{"id":"item-main","component":{"Column":{"children":{"explicitList":["item-name","item-desc"]}}}},{"id":"item-name","component":{"Text":{"text":{"path":"/cart/items/item/name"},"usageHint":"h4"}}},{"id":"item-desc","component":{"Text":{"text":{"path":"/cart/items/item/desc"},"usageHint":"caption"}}},{"id":"item-bottom","component":{"Row":{"children":{"explicitList":["item-price","item-qty"]},"distribution":"spaceBetween","alignment":"center"}}},{"id":"item-price","component":{"Text":{"text":{"path":"/cart/items/item/price"},"usageHint":"body"}}},{"id":"item-qty","component":{"Text":{"text":{"path":"/cart/items/item/qty"},"usageHint":"caption"}}}]}}`,
  // #2 dataModelUpdate · /cart/items 是 valueMap（对象 map），3 个条目；/cart/total 是合计
  `{"dataModelUpdate":{"surfaceId":"shopping-cart","contents":[{"key":"cart","valueMap":[{"key":"items","valueMap":[{"key":"c1","valueMap":[{"key":"name","valueString":"机械键盘"},{"key":"desc","valueString":"无线 · 87 键 · 红轴"},{"key":"image","valueString":"https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=240&h=180&fit=crop"},{"key":"price","valueString":"¥299.00"},{"key":"qty","valueString":"数量 1"}]},{"key":"c2","valueMap":[{"key":"name","valueString":"无线鼠标"},{"key":"desc","valueString":"2.4G · 人体工学"},{"key":"image","valueString":"https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=240&h=180&fit=crop"},{"key":"price","valueString":"¥129.00"},{"key":"qty","valueString":"数量 2"}]},{"key":"c3","valueMap":[{"key":"name","valueString":"USB-C 扩展坞"},{"key":"desc","valueString":"7 合 1 · 4K HDMI"},{"key":"image","valueString":"https://images.unsplash.com/photo-1625723044792-44de16ccb4e9?w=240&h=180&fit=crop"},{"key":"price","valueString":"¥199.00"},{"key":"qty","valueString":"数量 1"}]}]},{"key":"total","valueString":"¥627.00"}]}]}}`,
  // #3 beginRendering · root=root
  `{"beginRendering":{"surfaceId":"shopping-cart","root":"root"}}`,
];
