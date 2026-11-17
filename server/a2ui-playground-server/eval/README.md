# A2UI Agent 评测集

对 **A2UI agent**（自然语言/图片 → A2UI v0.8 JSONL 协议 → 端上渲染）做端到端评测的数据集与判定标准。
每条用例 = 一个 `userPrompt` + 一组可机检断言。数据在 [`a2ui-eval-set.json`](./a2ui-eval-set.json)。

> 与 `specification/v0_8/eval/`（官方 genkit 脚手架，评「模型是否遵守标准 schema」）不同：
> 本评测集评的是**我们这套实现**——我们的 system prompt、我们的协议抽取器、`a2ui-core` 解析、
> `a2ui-vue` 渲染器。断言因此按「渲染器真实支持的组件矩阵」设计，不按官方全量目录。

## 一、怎么跑

**一键跑全量（推荐）**：

```bash
# 先把服务起起来（真实模型或 mock 都行，runner 只认 HTTP）
pnpm --filter a2ui-playground-server dev

# 另一个终端：跑全部 26 条
pnpm --filter a2ui-playground-server run eval

# 只跑某几条（调试 runner 本身时用）
pnpm --filter a2ui-playground-server run eval -- --only T01,T22

# 每条跑 2 次，把「抖动」和「稳定失败」分开（耗时翻倍）
pnpm --filter a2ui-playground-server run eval -- --repeat 2
```

输出每条的「耗时 / 消息条数 / 组件数 / 被丢弃的样式键」，末尾给通过率与丢键统计。
**抖动**（有通过有失败）单独计数，不影响退出码；**失败**（每次都挂）才返回 1，可直接接 CI。
环境变量：`EVAL_BASE`（默认 `http://127.0.0.1:3000`）、`EVAL_TIMEOUT_MS`（单轮超时，默认 240s）。

runner 在 [`run.ts`](./run.ts)：它按下面的规则打接口、收事件、逐字段判定。
需要附图的用例（T23）目前**跳过**并标 `⏭` —— runner 还没有提供图片的入口。

**手工跑单条**（排查某一条时更直观）：被测接口是 `POST /api/a2ui/run`（默认 3000 端口）。

```bash
# 单条（流式 SSE，收集 data: 帧）
curl -sN -X POST http://127.0.0.1:3000/api/a2ui/run \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"eval-T01","message":"显示一个欢迎卡片：一行大标题「欢迎使用 A2UI」…"}'
```

| 用例类型 | 跑法 |
| --- | --- |
| 普通（T01–T21、T24–T26） | 每条一个**新 threadId**，发 `userPrompt`，收集本轮事件后判定 |
| 多轮（T22） | 同一 threadId 先发首轮、再发 `followUps[0].userPrompt`，对第二轮判定 |
| 多模态（T23） | 请求体加 `images:[{ "dataUrl": "data:image/png;base64,…" }]`（`attachments` 字段说明附图要求） |

判定只看服务端实际下发的事件：`a2ui.message`（协议消息）、`a2ui.warning`（坏行/自动修复）、
`TEXT_MESSAGE_CONTENT`（模型原始输出拼接）、`a2ui.surface`（surfaceId）。

## 二、用例字段

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定编号 T01–T26 |
| `name` | 用例名称 |
| `category` | `basic`（基础单元）/ `business`（复杂业务场景）/ `advanced`（进阶）/ `adversarial`（对抗） |
| `tags` | 需要考察的组件名与协议特性（组件名与协议一致，特性用 kebab-case） |
| `userPrompt` | 送给 agent 的提示词（首轮） |
| `assert` | 首轮断言 |
| `followUps[]` | 多轮后续：各带 `userPrompt` 与 `assert` |
| `attachments[]` | 多模态用例的附图说明 |
| `notes` | 考察点与常见失败模式 |

### 断言字段（`assert`）

| 字段 | 判定 |
| --- | --- |
| `messageTypes` | 本轮必须出现的消息类型（顶层键，子集匹配） |
| `excludeMessageTypes` | 不得出现的消息类型 |
| `lastMessage` | 最后一条消息的类型 |
| `components` | 必须出现的组件名（任一路 surfaceUpdate 中命中） |
| `texts` | 必须出现的文案（`literalString` 或数据模型 `valueString` 中子串命中） |
| `paths` | 必须出现的数据路径（组件 `path` 值或数据模型 key 路径，子串命中） |
| `actionNames` | 必须出现的动作名 |
| `localAction` | `true` = 至少一个 action 带 `type:"local"` |
| `sameSurfaceId` | `true` = 本轮 surfaceId 与上一轮一致（增量轮） |
| `rawNotContains` | 模型原始输出不得包含的串（如 ` ``` ` ） |
| `minRawChars` | 模型原始输出最小长度 |
| `noDropped` | `true` = 不允许**真丢行**（解析失败 / 字段不合格 / 结构性失败）。`recoverJson` 修好的（`recovered`）**不算** |
| `strictWarnings` | `true` = 连「已自动修复」也不允许（只要出现过 `a2ui.warning` 就失败）。对抗类用例用 |

> 为什么分两级：warning 现在带 `kind`。
> `recovered` = 模型写错了但修好了（页面正常，实测约 10% 的复杂页会偶发多写一个 `}`）；
> `dropped` = 这块内容真没了。功能用例卡后者，纪律用例（T24）才卡前者 ——
> 否则每一条复杂用例都会随机翻红，评测集就没法当门禁用了。

## 三、覆盖矩阵

**26 条 = basic 10 + business 10 + advanced 5 + adversarial 1**

| 段 | 编号 | 内容 |
| --- | --- | --- |
| 基础 | T01–T10 | 单组件/少组件：文本层级、工具栏、分割线、图卡、音视频、登录表单、反馈表单、滑块、日期选择 |
| **复杂业务场景** | **T11–T20** | 电商订单确认、餐厅点餐、酒店预订、任务看板、音乐播放器、健身日报、课程表、客服工单、智能家居、招聘筛选 |
| 进阶 | T21–T23、T25–T26 | deleteSurface、多轮增量修改、多模态复刻、本地动作单元、大数据量压力 |
| 对抗 | T24 | 输出格式纪律（用户要求围栏+解释，仍须纯 JSONL） |

- **18 个组件全覆盖**：Text / Image / Icon / Video / AudioPlayer / Divider / Row / Column / List / Card /
  Tabs / Modal / Button / CheckBox / TextField / DateTimeInput / MultipleChoice / Slider
- **协议特性覆盖**：消息顺序与 `beginRendering` 收尾、单顶层键、surfaceId 一致性、四种取值对象、
  `valueMap` 对象 map（无数组）、List + template 与 `item` 占位路径、服务端动作 `context` 回传、
  本地动作单/多操作、`deleteSurface`、多轮增量、多模态、空状态、长输出压力。

## 四、设计边界（用例为何这样写）

这些是当前协议/渲染器的真实边界，用例表述已避开「协议表达不了」的需求：

1. **本地动作只有 `updateDataModel` 写固定值**（无取反/累加，见 `docs/a2ui-local-action-extension.md` §八）。
   所以「切换/加减」一律写成两个按钮各写一个固定值（T15、T25），场景模式写成一次多操作批量置值（T19）。
2. **协议没有条件渲染**，空状态用静态 Text 表达（T17 周三、T20 无匹配）。
3. **`Text` 的 `text` 只认 `literalString` / `path`**（`readString` 不收 `literalNumber` 直插）。
   显示数字/布尔必须走 `path`（T09、T16、T19 均按此设计）。
4. **数据模型没有数组**，列表一律对象 map + `item` 占位路径（T11–T20、T26）。
5. **`literalArray` 暂无渲染器消费者**，故不设可见性断言。
6. **分块流式规约**（prompt 规则 4/5）：组件多的界面按区块拆成多条 `surfaceUpdate`，
   root 在第一条且随后立刻 `beginRendering`，后续块实时补充；root 的 `explicitList` 可**前向引用**
   尚未到达的区块 id（客户端先跳过，到达后自动进树）。因此 `beginRendering` **不再是最后一条**——
   除 T21（deleteSurface 收尾）外不再对 `lastMessage` 作断言，只验消息类型的存在性。
   模型不拆块时退化为单条大消息，协议仍合法，只是观感回到批量。

## 五、后续

- runner 已实现（[`run.ts`](./run.ts)，`pnpm --filter a2ui-playground-server run eval`）；接下来是**接 CI 门禁**与**补图片入口**（T23 现在跳过）。
- 新增用例请保持：`tags` 只写渲染器真实支持的组件/属性；`texts`/`paths` 断言与 `userPrompt` 明确要求一致；
  改 `summary` 时同步 `byCategory` 与覆盖率声明。
