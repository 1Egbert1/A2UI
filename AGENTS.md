# AGENTS.md

> 给在这个仓库里工作的 AI agent（以及刚接手的人）。
> **只写「不写下来就会踩」的约束**。架构、设计动机、演进史看 `README.md` 与 `docs/`，这里不重复。

## 1. 背景（30 秒）

A2UI：模型输出 **JSONL 协议** → `a2ui-core` 解析并维护状态 → `a2ui-vue` 用组件渲染函数画出来。
五个工作区：`packages/a2ui-core`（协议引擎，零框架依赖）、`packages/a2ui-vue`（18 个渲染器）、
`packages/a2ui-ui-components`、`server/a2ui-playground-server`（Koa，产出协议）、`web/a2ui-playground`（Vite + Vue3）。

**协议锁在 v0.8.2**（上游已 closed）。这一点最容易出错，见 §6。

Node ≥ 22，pnpm 12.10.1。

## 2. 命令（按「你改了哪层」选，不是每次都全跑）

| 改了什么 | 必跑 |
| --- | --- |
| 任何代码 | `pnpm test` |
| `packages/a2ui-core/**` | `pnpm --filter a2ui-core run test` + `pnpm --filter a2ui-core run test:types` |
| `packages/a2ui-vue/**` | `pnpm --filter a2ui-vue run test`（脚本内部会先 build core）+ `run test:types` |
| `server/**` | `pnpm --filter a2ui-playground-server run test` + `run test:types` |
| `web/**` | `pnpm --filter a2ui-playground run build`（含 `vue-tsc`） |
| 只动解析器 | `pnpm --filter a2ui-core run test:parser`（独立 mocharc） |

起服务：`pnpm --filter a2ui-playground-server dev`（3000，默认 `AGENT_PROVIDER=mock` 离线可跑）、
`pnpm --filter a2ui-playground dev`（playground）。

## 3. 单点真相（改之前先看这一处，别复制粘贴）

| 事实 | 唯一来源 |
| --- | --- |
| system prompt 全文 | `server/a2ui-playground-server/src/agent/prompt-template.ts` 的 `PROMPT_TEMPLATE`（唯一占位符 `{{surfaceId}}`） |
| 上面那份 prompt 的文档镜像 | `docs/a2ui-agent-prompt.md` **§2**（两者必须逐字一致） |
| 组件类型名 → 渲染函数 | `packages/a2ui-vue/src/renderMap.ts`（18 个；没登记的组件会进 `errorMap` 的 `RENDERER_NOT_FOUND`） |
| 组件级样式白名单 | `packages/a2ui-vue/src/internal/styles.ts` 的 `STYLE_RULES`（42 条，白名单外静默忽略） |
| 示例场景数据 | `packages/a2ui-core/mock/**`（TS 模块导出 `string[]`；服务端读的是**构建产物**） |
| 协议定义（只读） | `specification/v0_8/**`——上游规范快照，不要改它去迁就实现 |

## 4. 改动联动清单

| 改了 A | 必须同步 B |
| --- | --- |
| `packages/a2ui-core/mock/**` | `pnpm --filter a2ui-core run build` —— 服务端 `scenarios.ts` 直接 `import .../dist/mock`，不重建就是旧数据 |
| `prompt-template.ts` | `docs/a2ui-agent-prompt.md` §2 的模板全文 |
| prompt 里的示例 JSON | 自己 `JSON.parse` 校验一遍。**踩过**：示例多写一个 `}`，模型复刻时会照抄坏模式 |
| 新增 / 删减组件 | `renderMap.ts` + prompt 的组件清单与示例 + `eval` 的 `componentCoverage` |
| 改协议解析行为 | core 测试 + vue 测试（它是消费方）+ `eval` 里对应断言 |
| 改 playground 布局 | 两处 `@media (max-width: 900px)`（`App.vue` 内）+ 真机截图验证 |
| 改 `deploy/**/*.sh` | 保持 **LF**（`.gitattributes` 已锁 `*.sh eol=lf`） |

## 5. 已知的「假通过」

这几件事「命令绿了但结果是错的」，只能靠另外的检查兜住：

1. **`pnpm build` 过 ≠ 布局对**。flex 子项的 `min-height:0`、`.playground`/`.panel` 的 `box-sizing`、
   900px 断点写两处——这些错一个，`vue-tsc` 照样通过，真机上却是撑破或塌陷。
2. **类型测试不在 `pnpm test` 里**。`test:types` 是独立的 `tsc -p tsconfig.test.json`，漏跑等于没验类型。
3. **改了 mock 没重建 core**：单测可能仍全绿，但服务端跑的是旧 fixture。
4. **调度器在无 `requestAnimationFrame` 的环境下同步执行**（Node / 单测）。所以「推完立刻断言」是成立的，
   但别在测试里假设异步——也别因为测试同步通过就认为浏览器里也同步。

## 6. 不要做

- **不要按 v0.9 的写法改协议**。本仓库是 v0.8.2：组件写成 `{"Row": {...}}`（组件名是对象唯一键），
  不是 `{"component": "Row", ...}`；`children` 是 `{"explicitList": [...]}` 或 `{"template": ...}`。
  上游 v0.9 改了形状，但这里没迁。
- **`pnpm install --force`**：`nodeLinker: hoisted`，强装会打乱链接。
- **提交 `.env`**：只提交 `.env.example`。模型 Key 走环境变量。
- **手改 `dist/` 或 `node_modules/`**：`dist` 是构建产物，改了下次 build 就没了。
- **把长清单塞进 prompt**：图标走 MCP 按需查询（`src/agent/tools/`），不要退回到「把几百个图标名贴进 system prompt」。

## 7. 验收（提 PR / 交付前）

1. 按 §2 跑对应命令，全绿；
2. 若是可见改动，起 playground 真看一眼（不要只看 build 输出）；
3. 若是生成侧改动（prompt / 抽取 / 模型），至少跑 `eval` 里的 T01（基础）、T11（业务）、
   T22（多轮）、T24（对抗）四条，跑法见 `server/a2ui-playground-server/eval/README.md`；
4. 改了部署，按 `deploy/README.md` 的端口所有权检查：**80/443 只归 gateway**，web 只绑 `127.0.0.1:8080`。

## 8. 目录导航

```
packages/a2ui-core        协议引擎：parser / store / hydrate / treebuilder / tree-render / scheduler / binding / action
packages/a2ui-vue         渲染器：renderMap + internal（node / styles / icons / entrance）
packages/a2ui-ui-components
server/a2ui-playground-server  Koa：routes / agent（prompt、抽取、图标 MCP）/ eval
web/a2ui-playground       Playground：对话、预览、Stream 模拟
docs/                     服务端、组件协议、样式扩展、本地动作、agent prompt
deploy/                   docker compose（gateway / web / server）+ 脚本
specification/v0_8/       上游协议快照（只读）
```

## 9. 一处已知技术债

`packages/a2ui-vue/src/index.ts` 导出的 `createA2UIRenderer` 是抛异常的占位实现，仓库内无人调用。
要新增公共 API 时先确认它是该删还是该实现，别照着它的形状扩展。
