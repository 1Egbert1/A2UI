# A2UI 标准组件协议 —— 现有 Renderer 支持矩阵

> 依据：
> - 协议定义：[`specification/v0_8/json/standard_catalog_definition.json`](../specification/v0_8/json/standard_catalog_definition.json)
> - 渲染实现：`packages/a2ui-vue/src/renderMap.ts` + `renderers/{leaf,container,form}.ts`
> - 取值解析：`packages/a2ui-core/src/binding/index.ts`

本文档梳理当前 `a2ui-vue` 渲染引擎**实际支持**的标准组件及其属性，标注每个属性的支持状态、取值方式与渲染映射，并列出与标准目录的差异。

## 结论摘要

**标准目录的 18 个组件已全部实现，组件属性（除顶层 `styles` 主题）基本全覆盖。**

- 支持组件：18 / 18（leaf 6、container 6、form 6）
- 顶层 `styles`（`font` / `primaryColor`）主题：**未接入**，当前用内联样式
- 数据绑定写回（`updateModel`）：取值对象带 `path` 的组件属性支持
- `children.template` 动态列表渲染：Row / Column / List 三者均支持

---

## 一、全局约定

### 1.1 取值对象（bound value）

标准目录里几乎所有「值」都是同一种形状 —— 一个字面量键或一个 `path` 键二选一：

```jsonc
{ "literalString": "hello" }        // 字符串字面量
{ "literalNumber": 42 }             // 数字字面量
{ "literalBoolean": true }          // 布尔字面量
{ "literalArray": ["a", "b"] }      // 字符串数组字面量
{ "path": "/user/name" }            // 数据模型引用
```

core 的 `binding` 模块统一解析这套形状，渲染器按需调用：

| 读取函数 | 返回 | 宽松兼容 |
| --- | --- | --- |
| `readString` | string | path 指向数字/布尔时转字符串 |
| `readNumber` | number | path 指向数字字符串时转数字 |
| `readBoolean` | boolean | path 指向 `'true'` / `'false'` 时转布尔 |
| `readStringArray` | string[] | 非字符串元素转字符串 |

`path` 兼容 `'/user/name'` 与 `'user/name'` 两种写法；中间层为数组时按下标下钻（如 `/items/0/name`）。

### 1.2 数据绑定写回（updateModel）

表单控件的取值对象**仅当带 `path` 时才挂写回**：用户交互（输入、勾选、拖动）时通过 `RenderContext.updateModel(path, value)` 把新值写回 store，随后 core 重跑 hydrate + buildTree + renderTree，让绑定同一 path 的其它组件（如展示同值的 Text）联动刷新。

- 纯字面量（`literalString` 等）是静态值，**不写回**（没有目标 path）。
- 写回是 immutable：`writePath` 返回新对象，不改入参。

支持写回的组件：`CheckBox`、`TextField`、`DateTimeInput`、`MultipleChoice`、`Slider`。

### 1.3 children 的两种形态

Row / Column / List 的 `children` 字段支持两种取值（`container.ts` 的 `resolveChildNodes` 统一处理）：

| 形态 | 结构 | 行为 |
| --- | --- | --- |
| `explicitList` | `["comp-1", "comp-2"]` | 固定的 componentId 数组，逐个生成延迟解析占位 |
| `template` | `{ "componentId": "tpl", "dataBinding": "/items" }` | 按数据列表逐个渲染模板组件 |

`template` 的展开在 core 的 `hydrate` 完成：对集合里的每个 item，用「相对绑定」渲染一份模板组件 —— 模板子树内 `path` 中等于 `item` 的段会被替换为当前 item 的 key（官方示例 `/items/item/name` → `/items/<key>/name`）。兼容裸数组与对象 map 两种集合。

### 1.4 渲染增强层（与协议无关）

所有组件渲染时统一叠加两层包装（`renderMap.ts` 的 `enhance`）：

1. **唯一 id**：根元素挂 `id = surfaceId-componentId`；template 渲染出的 item 追加 `-itemKey`，保证「同一模板渲染 N 次」得到 N 个唯一 id。
2. **入场动画**：首次渲染（`hasMounted === false`）播一次 0.3s 淡入（WAAPI），结束后 `markMounted()` 置位（标记清除），重渲染不再重播。

---

## 二、支持矩阵总览

| 分组 | 组件 | 状态 | 备注 |
| --- | --- | --- | --- |
| leaf | Text | ✅ | usageHint 决定标签与字号 |
| leaf | Image | ✅ | usageHint 决定尺寸，fit 映射 object-fit |
| leaf | Icon | ✅ | 47 个图标名全映射（emoji 占位） |
| leaf | Video | ✅ | 原生 `<video controls>` |
| leaf | AudioPlayer | ✅ | 原生 `<audio controls>`，description 作标题 |
| leaf | Divider | ✅ | axis 决定方向 |
| container | Row | ✅ | 水平主轴，含 template |
| container | Column | ✅ | 垂直主轴，含 template |
| container | List | ✅ | 含 template（动态列表） |
| container | Card | ✅ | 单子组件卡片容器 |
| container | Tabs | ✅ | 有状态（当前选中页） |
| container | Modal | ✅ | 有状态（开/关） |
| form | Button | ✅ | action 走 DOM 事件出口（见差异） |
| form | CheckBox | ✅ | value 带 path 时写回 |
| form | TextField | ✅ | text 带 path 时写回 |
| form | DateTimeInput | ✅ | value 带 path 时写回 |
| form | MultipleChoice | ✅ | selections 带 path 时写回 |
| form | Slider | ✅ | value 带 path 时写回 |

---

## 三、组件协议明细

### 3.1 叶子组件（leaf）

#### Text

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `text` | 取值对象 | ✅ | `literalString` / `path` | 文本内容 |
| `usageHint` | `h1` `h2` `h3` `h4` `h5` `caption` `body` | — | — | 标签：`h1`~`h5`→`h1`~`h5`，`caption`→`small`，`body`→`p`，缺省→`span` |

#### Image

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `url` | 取值对象 | ✅ | `literalString` / `path` | `<img src>` |
| `fit` | `contain` `cover` `fill` `none` `scale-down` | — | — | CSS `object-fit`，缺省 `cover` |
| `usageHint` | `icon` `avatar` `smallFeature` `mediumFeature` `largeFeature` `header` | — | — | 预设尺寸（如 icon 24px、avatar 40px 圆形、header 满宽 200px），缺省 `maxWidth: 100%` |

#### Icon

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `name` | 取值对象 | ✅ | `literalString` / `path` | 47 个标准图标名 → emoji 字符表，未命中→`▢` |

> ⚠️ 占位实现：标准目录只规定图标名、不规定图形资源，本包用 emoji 字符表兜底。接入图标字体/SVG 图标集时只需替换 `ICON_GLYPHS` 表。

#### Video

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `url` | 取值对象 | ✅ | `literalString` / `path` | `<video controls preload="metadata">` |

#### AudioPlayer

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `url` | 取值对象 | ✅ | `literalString` / `path` | `<audio controls>` |
| `description` | 取值对象 | — | `literalString` / `path` | 播放器上方标题（无值则不显示） |

#### Divider

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `axis` | `horizontal` `vertical` | — | — | `horizontal`→`<hr>`，`vertical`→竖向 1px 分隔线，缺省 horizontal |

---

### 3.2 容器组件（container）

#### Row / Column

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `children` | `explicitList` / `template` | ✅ | — | 子节点列表（见 1.3） |
| `distribution` | Row：`center` `end` `spaceAround` `spaceBetween` `spaceEvenly` `start`<br>Column：`start` `center` `end` `spaceBetween` `spaceAround` `spaceEvenly` | — | — | CSS `justify-content`，缺省 `flex-start` |
| `alignment` | `start` `center` `end` `stretch` | — | — | CSS `align-items`，缺省 `stretch` |

Row 主轴水平（`flex-direction: row`），Column 主轴垂直（`flex-direction: column`）。

#### List

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `children` | `explicitList` / `template` | ✅ | — | 子节点列表（见 1.3） |
| `direction` | `vertical` `horizontal` | — | — | `horizontal`→row，其余→column |
| `alignment` | `start` `center` `end` `stretch` | — | — | CSS `align-items`，缺省 `stretch` |

#### Card

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `child` | string（componentId） | ✅ | — | 卡片容器内的单个子组件 |

#### Tabs

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `tabItems` | array | ✅ | — | 每项含 `title` + `child` |

`tabItems[]` 每项：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `title` | 取值对象 | ✅ | `literalString` / `path`，作标签文字 |
| `child` | string（componentId） | ✅ | 该标签页的面板内容组件 |

> 有状态组件：内部记住「当前选中页」，`tabItems` 变化时索引自动夹紧。

#### Modal

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `entryPointChild` | string（componentId） | ✅ | — | 点击后打开弹层的入口组件 |
| `contentChild` | string（componentId） | ✅ | — | 弹层内容组件 |

> 有状态组件：内部记住「是否打开」。点击入口打开，点遮罩关闭，点内容区不关闭（阻止冒泡）。

---

### 3.3 表单组件（form）

#### Button

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 |
| --- | --- | --- | --- | --- |
| `child` | string（componentId） | ✅ | — | 按钮文案组件（通常 Text） |
| `primary` | boolean | — | — | `true`→主按钮样式（蓝底白字），否则默认样式 |
| `action` | object | ✅ | — | 点击时派发的动作（见下） |

`action` 结构（标准目录）：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✅ | 动作名 |
| `context` | array | — | `{ key, value }` 列表，`value` 为取值对象（`path` / `literalString` / `literalNumber` / `literalBoolean`） |

> ⚠️ 差异：`action` 通过 DOM 自定义事件 `a2ui-action`（`bubbles: true`）抛给宿主，`event.detail` 为原样的 `{ name, context }`。core 尚无 client→server 回传通道，故**未解析 `context` 里 `value.path` 的实际值**，也**未走协议层的 `userAction` 消息**。宿主需自行监听该事件接入回传。

#### CheckBox

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 | 写回 |
| --- | --- | --- | --- | --- | --- |
| `label` | 取值对象 | ✅ | `literalString` / `path` | 勾选框旁文字 | — |
| `value` | 取值对象 | ✅ | `literalBoolean` / `path` | 勾选状态 | 带 `path` 时勾选写回 boolean |

#### TextField

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 | 写回 |
| --- | --- | --- | --- | --- | --- |
| `label` | 取值对象 | ✅ | `literalString` / `path` | 输入框标签 | — |
| `text` | 取值对象 | — | `literalString` / `path` | 输入值 | 带 `path` 时输入写回 string |
| `textFieldType` | `date` `longText` `number` `shortText` `obscured` | — | — | `longText`→`<textarea>`，其余→`<input type>`（`obscured`→password），缺省 `shortText` | — |
| `validationRegexp` | string | — | — | `<input pattern>` | — |

#### DateTimeInput

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 | 写回 |
| --- | --- | --- | --- | --- | --- |
| `value` | 取值对象 | ✅ | `literalString` / `path` | 选中值 | 带 `path` 时选择写回 string |
| `enableDate` | boolean | — | — | 允许选日期，缺省 `true` | — |
| `enableTime` | boolean | — | — | 允许选时间，缺省 `false` | — |

> `enableDate` + `enableTime` 组合出三种原生控件：`date` / `time` / `datetime-local`。

#### MultipleChoice

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 | 写回 |
| --- | --- | --- | --- | --- | --- |
| `selections` | 取值对象 | ✅ | `literalArray` / `path` | 已选项 | 带 `path` 时勾选写回 string[] |
| `options` | array | ✅ | — | 候选项（见下） | — |
| `maxAllowedSelections` | integer | — | — | 最大可选数（0 / 负数 = 不限） | — |
| `variant` | `checkbox` `chips` | — | — | `checkbox`→复选列表，`chips`→胶囊标签，缺省 checkbox | — |
| `filterable` | boolean | — | — | `true` 时显示筛选输入框 | — |

`options[]` 每项：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `label` | 取值对象 | ✅ | `literalString` / `path`，选项文字 |
| `value` | string | ✅ | 选中后关联的值 |

> 有状态组件：内部维护勾选状态与筛选关键词；`watch` 外部 `selections` 变化同步回本地，保证受控。

#### Slider

| 属性 | 类型 / 枚举 | 必需 | 取值 | 渲染映射 | 写回 |
| --- | --- | --- | --- | --- | --- |
| `value` | 取值对象 | ✅ | `literalNumber` / `path` | 当前值 | 带 `path` 时拖动写回 number |
| `minValue` | number | — | — | 最小值，缺省 `0` | — |
| `maxValue` | number | — | — | 最大值，缺省 `100` | — |

---

## 四、与标准目录的差异清单

| # | 差异 | 现状 | 影响 |
| --- | --- | --- | --- |
| 1 | 顶层 `styles`（`font` / `primaryColor`）主题 | 未接入，全内联样式 | 无法按 surface 换肤 |
| 2 | `Icon` 图形资源 | emoji 字符占位 | 观感非正式图标，需接图标集 |
| 3 | `Button.action` 回传 | DOM 自定义事件 `a2ui-action` 出口 | 未走协议 `userAction`，`context` 的 `path` 未解析 |
| 4 | `Text` 缺省 `usageHint` | 渲染为 `<span>`（非 `<body>` 的 `<p>`） | 视觉上等价，语义标签不同 |

## 五、可运行示例

- `packages/a2ui-core/mock/data-binding.ts` —— 最小完整数据绑定示例（TextField / CheckBox / Slider 写回 + Text 同 path 联动）
- `packages/a2ui-core/mock/list-template.ts` —— List `children.template` 动态渲染示例
- 端到端测试：`packages/a2ui-core/test/data-binding.spec.ts`、`template.spec.ts`；`packages/a2ui-vue/test/*`
