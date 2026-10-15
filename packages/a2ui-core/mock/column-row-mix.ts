/**
 * 多层 Column / Row 混排（最深 5 层）。
 *
 * Row 横排三张 Card，Card 内再套 Column，底部 Row 里再嵌 Column + Row，用来压深层嵌套的组装与渲染。
 * 已拆成「每条消息只定义一个组件」，最适合喂给流式解析逐条推送。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 *
 * 下面导出的四种形态（协议顺序 / 流式友好 × 逐条 / 紧凑）由 `./stream` 里的通用函数派生，
 * 不再手工维护——其它 mock 也能用同一套函数随时派生，供 Stream 面板跟随下拉实时切换。
 */

import { compactSurfaceUpdates, toStreamFriendly, toStreamFriendlyCompact } from './stream';

export { compactSurfaceUpdates } from './stream';

export const columnRowMixMessages: string[] = [
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","subtitle","divider-top","overview-row","divider-bottom","footer-row"]},"distribution":"start","alignment":"stretch"}}}]}}`, // #01 surfaceUpdate · root(Column)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"title","component":{"Text":{"text":{"literalString":"Column / Row 混排"},"usageHint":"h2"}}}]}}`, // #02 surfaceUpdate · title(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"subtitle","component":{"Text":{"text":{"literalString":"Row 横向排布三张 Card，每张 Card 内再套 Column 纵向堆叠文案。"},"usageHint":"caption"}}}]}}`, // #03 surfaceUpdate · subtitle(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"divider-top","component":{"Divider":{}}}]}}`, // #04 surfaceUpdate · divider-top(Divider)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"overview-row","component":{"Row":{"children":{"explicitList":["stat-revenue","stat-orders","stat-growth"]},"distribution":"spaceBetween","alignment":"center"}}}]}}`, // #05 surfaceUpdate · overview-row(Row)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"stat-revenue","component":{"Card":{"child":"card-revenue"}}}]}}`, // #06 surfaceUpdate · stat-revenue(Card)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"stat-orders","component":{"Card":{"child":"card-orders"}}}]}}`, // #07 surfaceUpdate · stat-orders(Card)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"stat-growth","component":{"Card":{"child":"card-growth"}}}]}}`, // #08 surfaceUpdate · stat-growth(Card)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"card-revenue","component":{"Column":{"children":{"explicitList":["label-revenue","value-revenue"]}}}}]}}`, // #09 surfaceUpdate · card-revenue(Column)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"label-revenue","component":{"Text":{"text":{"literalString":"本月收入"},"usageHint":"caption"}}}]}}`, // #10 surfaceUpdate · label-revenue(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"value-revenue","component":{"Text":{"text":{"path":"/revenue"},"usageHint":"h3"}}}]}}`, // #11 surfaceUpdate · value-revenue(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"card-orders","component":{"Column":{"children":{"explicitList":["label-orders","value-orders"]}}}}]}}`, // #12 surfaceUpdate · card-orders(Column)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"label-orders","component":{"Text":{"text":{"literalString":"订单数"},"usageHint":"caption"}}}]}}`, // #13 surfaceUpdate · label-orders(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"value-orders","component":{"Text":{"text":{"path":"/orders"},"usageHint":"h3"}}}]}}`, // #14 surfaceUpdate · value-orders(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"card-growth","component":{"Column":{"children":{"explicitList":["label-growth","value-growth"]}}}}]}}`, // #15 surfaceUpdate · card-growth(Column)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"label-growth","component":{"Text":{"text":{"literalString":"同比增长"},"usageHint":"caption"}}}]}}`, // #16 surfaceUpdate · label-growth(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"value-growth","component":{"Text":{"text":{"path":"/growth"},"usageHint":"h3"}}}]}}`, // #17 surfaceUpdate · value-growth(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"divider-bottom","component":{"Divider":{}}}]}}`, // #18 surfaceUpdate · divider-bottom(Divider)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"footer-row","component":{"Row":{"children":{"explicitList":["legend","detail-btn"]},"distribution":"spaceBetween","alignment":"center"}}}]}}`, // #19 surfaceUpdate · footer-row(Row)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"legend","component":{"Column":{"children":{"explicitList":["legend-title","legend-items"]}}}}]}}`, // #20 surfaceUpdate · legend(Column)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"legend-title","component":{"Text":{"text":{"literalString":"图例"},"usageHint":"body"}}}]}}`, // #21 surfaceUpdate · legend-title(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"legend-items","component":{"Row":{"children":{"explicitList":["legend-income","legend-expense"]}}}}]}}`, // #22 surfaceUpdate · legend-items(Row)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"legend-income","component":{"Text":{"text":{"literalString":"● 收入"},"usageHint":"caption"}}}]}}`, // #23 surfaceUpdate · legend-income(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"legend-expense","component":{"Text":{"text":{"literalString":"● 支出"},"usageHint":"caption"}}}]}}`, // #24 surfaceUpdate · legend-expense(Text)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"detail-btn","component":{"Button":{"child":"detail-btn-label","action":{"name":"viewDetail","context":[]}}}}]}}`, // #25 surfaceUpdate · detail-btn(Button)
  `{"surfaceUpdate":{"surfaceId":"column-row-mix","components":[{"id":"detail-btn-label","component":{"Text":{"text":{"literalString":"查看明细"}}}}]}}`, // #26 surfaceUpdate · detail-btn-label(Text)
  `{"dataModelUpdate":{"surfaceId":"column-row-mix","contents":[{"key":"revenue","valueString":"$128,400"},{"key":"orders","valueString":"1,284"},{"key":"growth","valueString":"+18.6%"}]}}`, // #27 dataModelUpdate · revenue, orders, growth
  `{"beginRendering":{"surfaceId":"column-row-mix","root":"root"}}`, // #28 beginRendering · root=root
];


/**
 * 同一批消息的**流式友好顺序**：把 `beginRendering` 从末尾提到 root 组件之后。
 *
 * 为什么值得单独留一份：协议顺序（surfaceUpdate… → dataModelUpdate → beginRendering）下，
 * surface 要等最后一条 `beginRendering` 才诞生（`Surface.rootNode` 必须先知道根是谁），
 * 所以前 27 条推完组件都登记齐了、树却还是空的、页面一片空白。
 *
 * 把 `beginRendering` 提前到 root 之后，root 一到 surface 就成立，后续子组件每到达一条
 * 就挂上一批，预览区能真的「边到边长大」。两条消息内容一模一样，只是顺序不同。
 */
export const columnRowMixStreamMessages: string[] = toStreamFriendly(columnRowMixMessages);

/** 紧凑版（协议顺序）：26 条组件 surfaceUpdate 压成 1 条。 */
export const columnRowMixCompactMessages: string[] = compactSurfaceUpdates(columnRowMixMessages);

/**
 * 紧凑版（流式友好）：**保住 beginRendering 紧随 root**。root 单独一条 → beginRendering →
 * 其余 25 个组件压成一条。字符流喂进去时：root 到 → root 登记；beginRendering 到 → surface
 * 成立、树有 1 个节点；随后那条大 surfaceUpdate 边吐边被 buffer 逐个抽出，组件逐个登记。
 */
export const columnRowMixCompactStreamMessages: string[] = toStreamFriendlyCompact(
  columnRowMixMessages,
);
