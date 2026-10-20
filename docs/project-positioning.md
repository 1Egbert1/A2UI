# A2UI 项目定位分析：对标 A2UI Composer

> 比较对象先对齐：上一版我对比的是 Google 的**协议仓库**；你要对比的是 **A2UI Composer**（`a2ui-composer.ag-ui.com/workbench`，CopilotKit 驱动）。两边都跑 A2UI 协议，但**不是同一物种**——一个是「做 A2UI 的工具」，一个是「用 A2UI 做出来的应用」。
>
> 结论先行：**它解决「怎么写出一段合法的 A2UI」，我们解决「怎么让这段 A2UI 在真实产品里跑起来」。** 真正的硬伤只有一个：**两边的 JSON 方言不通**。

---

## 一、Composer 是什么

从它的导航就能看出定位：

| 模块 | 作用 |
| --- | --- |
| **Create** | 输入一句话 → 生成 A2UI（`Powered by CopilotKit`） |
| **Workbench** | `Chat · edit · preview · debug`，右侧常驻「Current data model」面板 |
| **Gallery** | 成品案例集 |
| **Basic Catalog / Custom Catalog** | 组件目录浏览（属性、默认值、预览） |
| **Icons** | 图标浏览 |
| **Theater** | JSONL Playback：`Pretty / Wire` 双视图 + React renderer 回放 |

一句话：**它是 A2UI 的浏览器 IDE**。产物是「一段 JSON / 一个可粘贴进 agent prompt 的目录说明」，交付边界到此为止。

## 二、我们是什么

**一个可部署的 A2UI 运行时**：Koa 服务端接真实模型 → 分块流式产出 JSONL → Vue 渲染器边收边画 → Playground 调试 → 容器 + 网关上线。

产物是「一个能对外服务的站点」，不是一段 JSON。

---

## 三、形态差异（先看这张表，后面的优劣都从这里长出来）

| 维度 | A2UI Composer | 本项目 |
| --- | --- | --- |
| 交付形态 | 浏览器工具，免安装 | 全栈应用，自带 Docker + Caddy 网关 |
| 谁跑模型 | CopilotKit 的通道（模型与 Key 不在你手里） | 你自己配：DeepSeek 直连 / 任意 OpenAI 兼容网关 / 离线 mock |
| 产出物 | A2UI JSON、可粘贴的 prompt 片段 | 一个跑起来的站点 + SSE 流 + 会话 |
| 目标用户 | 做 A2UI 的开发者（写协议、调组件、做 demo） | 终端用户（对话出界面）+ 开发团队（要上线） |
| 渲染器 | React（Theater 里的 renderer 可选） | Vue3（18 组件） |
| 协议方言 | 当前主线（`component` 为字符串 + 属性平铺） | **v0.8.2**（`component` 为单键对象包裹） |
| 数据来源 | 工具内编辑 / 生成 | 真实模型 + 场景注册表 + 多轮会话 |

**最关键的一条**：两边 JSON 不兼容。Composer 的 Basic Catalog 里 `Row` 长这样：

```json
{ "id": "row-1", "component": "Row", "align": "center", "justify": "spaceBetween", "children": ["child-1", "child-2"] }
```

我们的 v0.8.2 是：

```json
{ "id": "row-1", "component": { "Row": { "align": "center", "justify": "spaceBetween", "children": { "explicitList": ["child-1", "child-2"] } } } }
```

组件名从「对象的唯一键」变成了「字符串字段」，props 从嵌套变成平铺，`children` 也换了形状。**Composer 导出的东西，我们的解析器直接吃会全部判非法。**

---

## 四、我们的六个亮点（以及 Composer 的对应物）

| 亮点 | 我们做了什么 | Composer 那边 |
| --- | --- | --- |
| **流式是运行时主链路** | 分块 prompt（root 先到 + 提前 `beginRendering` + 前向引用）→ 括号配对解析（组件闭合即渲染）→ 合帧调度。生成、解析、渲染三层配合 | Theater 把 JSONL 当**回放对象**（调试用）；我们的流式是**生产路径** |
| **模型输出容错** | `recoverJson`：结构化候选 + 唯一判据（括号栈补齐 / 删多余闭合符 / 闭合符互换 / 插符 / 迭代修补），且必须过 `validateMessage` | 工具场景下人可以手动改，不需要这层；线上跑就绕不过 |
| **组件级样式 42 属性白名单** | 颜色/间距/圆角/阴影可调，白名单外静默忽略，收口在一处 | Basic Catalog 只描述结构属性（`align`/`justify`），不管视觉 |
| **图标按需查询（MCP）** | 模型生成前调 `searchIcons/getIcon`，中文别名（「购物车」→ `ShoppingCart`），清单不进 prompt | 有 **Icons 浏览页**（人查），模型不会自己查 |
| **真实业务闭环** | 场景注册表 + 会话缓存 + 多轮增量 + 预览点选回填 `@id` | Workbench 有 chat 与 data model 面板，偏「单次编辑」 |
| **可回归的质量** | 26 条带机检断言的评测集（10 基础/10 业务/5 进阶/1 对抗，18 组件 / 19 类特性） | 工具不需要评测集；产品线必须有 |

---

## 五、真正的优势（四条）

1. **能上线，且能私有化。** Composer 是别人的 SaaS，模型通道也在别人手里；我们这个可以装在自己服务器上、接自己的模型和 Key。对国内团队这不是加分项，是硬门槛。
2. **模型链路自主。** DeepSeek 直连、provider 可换、可离线 mock 跑通全链路。Composer 用不了你的模型，也没法在无网环境跑。
3. **Vue 生态。** 官方与 Composer 的渲染侧都是 React；国内前端主流是 Vue，这块是空白位。
4. **质量工程是可迁移资产。** 分块规约 + 抽取容错 + 评测集，和协议版本解耦——协议升级它们还在，Composer 这类工具则天然没有。

## 六、硬伤（不粉饰）

1. **JSON 方言不通（最要命）。** 我们锁 v0.8.2，Composer 已按新方言产出。既不能直接渲染它的输出，也不能把我们的产物丢进它的 Workbench 调试。**这等于被排除在它建立的协作链路之外。**
2. **没有 Catalog 概念。** Composer 有 Basic / Custom Catalog 浏览与定义；我们的组件集写死在 prompt 里，换设计系统要改提示词。
3. **没有「数据模型可视化编辑」。** Workbench 右侧能直接改 `current data model` 看绑定效果；我们只能靠点击交互间接写回，调试靠看 raw。
4. **回放能力不对等。** 我们只有「服务端场景逐条/字符流」，不能粘任意 JSONL 回放；Theater 是通用的。
5. **没有 Gallery / 图标浏览页。** 缺少「先看效果再动手」的入口，新人和外部评估者上手成本更高。
6. **单端 + 单 surface。** 只有 Vue、只有一块 surface；弹窗叠层这类产品形态表达不了。

---

## 七、可发掘的方向

### P0 — 一周内，性价比最高

1. **写一个 v0.8 ↔ 新版方言的双向转换器。** 这是把「硬伤 1」直接变成「兼容层」：解析器前面加一层 adapter，`component: "Row"` + 平铺 props ⇄ `component: {"Row": {...}}`。做完之后，Composer 生成的东西我们能直接渲染，我们产出的东西也能丢进它的 Workbench 验证。**这一步的信息量比迁移整个版本大得多，成本却小一个量级。**
2. **评测集接 CI。** 26 条断言现成，只差门禁。改 prompt 必跑。
3. **导出 `catalog.json`，prompt 由它生成。** 对标 Composer 的 Custom Catalog，同时解决「换组件库要改 prompt」。

### P1 — 一个月，补齐工具形态的短板

4. **数据模型编辑器。** 一个 JSON 树面板：改值 → 实时联动预览。这是 Workbench 最好用的部分，补上之后调试体验立刻对等。
5. **通用 JSONL 回放。** 支持粘贴任意 JSONL（不绑定服务端场景），带单步/倍速。对标 Theater。
6. **多 surface**（Modal / 侧栏各自一块），先把最痛的产品形态解决。

### P2 — 三到六个月，做差异化

7. **行业 catalog 包**：把 26 条里的 10 个业务场景（订单/点餐/酒店/工单/课表…）沉淀成目录 + 默认 prompt + 用例。**这是 Composer 不会做的事，也是最难复制的东西。**
8. **迁 v0.9.1 / v1.0**：`createSurface`、`surfaceProperties`、客户端函数。有了 P0 的转换器，迁移可以分步走。
9. **多端**：Web Component 封装，或补 React / 小程序，把「Vue 专用」变成「多端可选」。
10. **可私有化的 A2UI 工作台**：把 Playground 做成能装进内网的工具（含 catalog 管理、模型切换、评测面板），这是 Composer 覆盖不到的市场。

---

## 八、如果只做三件事

1. **方言转换器**（一周）—— 立刻和 Composer 生态互通，把最大短板变成兼容能力
2. **评测接 CI**（一天）—— 现有资产立刻产生约束力
3. **catalog 化**（一周）—— 解开「换设计系统」的死结，也是升级 v0.9 的前置

这三件都不动协议主版本，但能让项目从「一个自己的实现」变成「能跟生态对话的实现」。**协议版本可以晚点追，互通能力不能等。**
