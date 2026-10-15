/**
 * 官方示例 `catalogs/basic/examples/05_product-card.json` 的 JSONL 版。
 *
 * 用 Card / Column / Row / Image / Text / Button，属性值全部通过 `dataModelUpdate` 的 path 绑定。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 */

export const productCardMessages: string[] = [
  `{"surfaceUpdate":{"surfaceId":"gallery-product-card","components":[{"id":"root","component":{"Card":{"child":"main-column"}}},{"id":"main-column","component":{"Column":{"children":{"explicitList":["image","details"]}}}},{"id":"image","component":{"Image":{"url":{"path":"/imageUrl"},"fit":"cover"}}},{"id":"details","component":{"Column":{"children":{"explicitList":["name","rating-row","price-row","actions"]}}}},{"id":"name","component":{"Text":{"text":{"path":"/name"},"usageHint":"h3"}}},{"id":"rating-row","component":{"Row":{"children":{"explicitList":["stars","reviews"]},"alignment":"center"}}},{"id":"stars","component":{"Text":{"text":{"path":"/stars"},"usageHint":"body"}}},{"id":"reviews","component":{"Text":{"text":{"path":"/reviews"},"usageHint":"caption"}}},{"id":"price-row","component":{"Row":{"children":{"explicitList":["price","original-price"]},"alignment":"start"}}},{"id":"price","component":{"Text":{"text":{"path":"/price"},"usageHint":"h2"}}},{"id":"original-price","component":{"Text":{"text":{"path":"/originalPrice"},"usageHint":"caption"}}},{"id":"actions","component":{"Row":{"children":{"explicitList":["add-cart-btn"]}}}},{"id":"add-cart-btn-text","component":{"Text":{"text":{"literalString":"Add to Cart"}}}},{"id":"add-cart-btn","component":{"Button":{"child":"add-cart-btn-text","action":{"name":"addToCart","context":[]}}}}]}}`, // #1 surfaceUpdate · root(Card) main-column(Column) image(Image) details(Column) name(Text) rating-row(Row) stars(Text) reviews(Text) price-row(Row) price(Text) original-price(Text) actions(Row) add-cart-btn-text(Text) add-cart-btn(Button)
  `{"dataModelUpdate":{"surfaceId":"gallery-product-card","contents":[{"key":"imageUrl","valueString":"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=200&fit=crop"},{"key":"name","valueString":"Wireless Headphones Pro"},{"key":"stars","valueString":"★★★★★"},{"key":"reviews","valueString":"(2,847 reviews)"},{"key":"price","valueString":"$199.99"},{"key":"originalPrice","valueString":"$249.99"}]}}`, // #2 dataModelUpdate · imageUrl, name, stars, reviews, price, originalPrice
  `{"beginRendering":{"surfaceId":"gallery-product-card","root":"root"}}`, // #3 beginRendering · root=root
];
