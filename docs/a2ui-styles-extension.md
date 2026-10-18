# A2UI 协议扩展：组件级 `styles`

> 依据：
> - 原生协议：[`specification/v0_8/json/server_to_client.json`](../specification/v0_8/json/server_to_client.json)
>   （`styles` 只定义在 `beginRendering` 上）、[`standard_catalog_definition.json`](../specification/v0_8/json/standard_catalog_definition.json)
>   （顶层 `styles` 只有 `font` / `primaryColor`）
> - 实现：`packages/a2ui-vue/src/internal/styles.ts`（`stylesOf`）、`packages/a2ui-vue/src/internal/node.ts`（`withRootId`）
> - 测试：`packages/a2ui-vue/test/components.spec.ts` 的「组件级 styles 扩展」段

## 一、为什么需要扩展

A2UI v0.8 的 `styles` **只在 surface 级**：`beginRendering.styles` 里只有 `font` 与 `primaryColor`
两个字段，作用范围是整个 surface。组件层没有任何样式入口。

但真实对话里最常见的微调恰恰是**逐组件**的：

- 「把 @title 改成红色、字号加大」；
- 「这张卡片加点内边距、圆角调大」；
- 「价格用加粗的深色」。

没有组件级入口时，这些诉求只能靠换 `usageHint` 或重做组件树，表达力远远不够。本扩展补上这一层：
**每个组件都可以带一个可选的 `styles` 对象，作为该组件根元素的内联样式。**

## 二、扩展字段

`styles` 写在**组件自身的属性对象里**（与 `text` / `usageHint` 同级），不是组件条目上：

```jsonc
{ "id": "title", "component": { "Text": {
    "text": { "literalString": "城市漫步指南" },
    "usageHint": "h2",
    "styles": { "color": "#ef4444", "fontSize": 22, "fontWeight": 600 }   // ★ 扩展
} } }
```

为什么不放在组件条目层（`{"id", "component", "styles"}`，与原生 `weight` 并列）：渲染器契约
`ComponentRenderer(props, context)` 拿到的是**组件属性对象**，`styles` 放这里，18 个渲染器
一行不用改就能支持；放条目层则需要改 core 的 hydration 与渲染上下文，收益为零。

## 三、取值规则

| 规则 | 说明 |
| --- | --- |
| 键名 | camelCase 为主，kebab-case（`font-size`）与 snake_case（`font_size`）都会归一 |
| 数字 | **长度类**属性自动补 `px`（`fontSize: 18` → `18px`）；**数值类**（opacity / fontWeight / lineHeight / flexGrow…）保持数字；**枚举/颜色类**给数字直接忽略 |
| 字符串 | 原样使用；空字符串忽略 |
| 白名单外的键 | **静默忽略**（不报错、不写 errorMap） |

### 可用属性（白名单）

`STYLE_RULES`（`internal/styles.ts`）是唯一事实源，当前覆盖：

| 分类 | 属性 |
| --- | --- |
| 颜色 | `color`、`backgroundColor`、`background`、`borderColor` |
| 字体 | `fontSize`、`fontWeight`、`fontStyle`、`fontFamily`、`lineHeight`、`letterSpacing` |
| 文本 | `textAlign`、`textDecoration`、`textTransform`、`whiteSpace` |
| 间距 | `padding`(+Top/Right/Bottom/Left)、`margin`(+四边)、`gap` |
| 尺寸 | `width`、`height`、`minWidth`、`maxWidth`、`minHeight`、`maxHeight` |
| 边框 | `border`、`borderWidth`、`borderStyle`、`borderRadius` |
| 其他 | `opacity`、`boxShadow`、`objectFit`、`flexGrow`、`flexShrink`、`alignSelf`、`justifySelf` |

**刻意不收录**：`position` / `display` / `zIndex` / `transform` 等会破坏预览布局的属性。
白名单让「支持什么」可枚举、可测试、可写进提示词，也不会随模型发挥把界面搅乱。

## 四、语义

### 4.1 合并顺序：默认样式在前，`styles` 覆盖同名项

组件自身由 `usageHint` 等推导出的样式**保留**，只有同名属性被覆盖：

```
Text(usageHint=h2) 默认 { fontSize: 1.5rem, lineHeight: 1.3, ... }
      + styles { fontSize: 22 }        → { fontSize: 22px, lineHeight: 1.3, ... }
```

### 4.2 落在哪个元素上

与 `id` 完全一致（同一处实现）：

- 渲染器返回**元素** vnode → 合进该元素；
- 返回**组件** vnode（Tabs / Modal / MultipleChoice 等有状态组件）→ 作为透传属性落到其唯一根元素；
- 返回 `null`（属性不完整渲染不出东西）→ 不生效。

### 4.3 模板实例

`List` 的模板组件（`children.template`）渲染出的每个实例都会各自拿到同一份 `styles`
（与 `id` 的 itemKey 后缀同一个包裹层），无需特殊处理。

## 五、示例

```jsonc
// 红字加粗标题
{ "id": "title", "component": { "Text": {
    "text": { "literalString": "限时特惠" }, "usageHint": "h2",
    "styles": { "color": "#ef4444", "fontWeight": 700 } } } }

// 卡片留白与圆角
{ "id": "card", "component": { "Card": {
    "child": "body",
    "styles": { "padding": 16, "borderRadius": 16, "boxShadow": "0 4px 12px rgba(0,0,0,0.08)" } } } }

// 图标颜色与大小
{ "id": "icon", "component": { "Icon": {
    "name": { "literalString": "ShoppingCart" },
    "styles": { "color": "#2563eb", "fontSize": 28 } } } }
```

## 六、兼容性

- **对服务端无影响**：`styles` 只出现在 `server → client` 的组件定义里，入站消息格式未变。
- **对严格校验器有影响**：标准目录里各组件的属性是 `additionalProperties: false`，新增的
  `styles` 会被「按标准 schema 严格校验」的工具判为非法。本项目不跑这层校验；对外兼容时可给
  扩展单独出一份 catalog，或把 `styles` 挪到 `x-styles` 命名空间下。
- **对不认识该扩展的实现无影响**：它们会把它当未知属性，按 `additionalProperties: false`
  校验则报错、不校验则忽略 —— 两种降级都不会破坏原有渲染。

## 七、实现落点

| 环节 | 位置 |
| --- | --- |
| `styles` → Vue style 对象（白名单、归一化、数字→px） | `packages/a2ui-vue/src/internal/styles.ts` 的 `stylesOf` |
| 合入组件根元素（与 `id` 同一处） | `packages/a2ui-vue/src/internal/node.ts` 的 `withRootId` |
| 提示词里的可用属性清单 | `server/a2ui-playground-server/src/agent/prompt-template.ts`「通用属性」段 |
| 测试 | `packages/a2ui-vue/test/components.spec.ts`「组件级 styles 扩展」 |

**为什么切在这里**：`withRootId` 是每个渲染器都必经的唯一包裹层（`renderMap` 里 18 个组件全部
`enhance`），把样式覆盖放在这里，新增组件自动获得能力，也不会有人漏写。
