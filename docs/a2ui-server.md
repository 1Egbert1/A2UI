# a2ui-server

> 位置：`server/a2ui-playground-server`
> 职责：**接收用户输入 → 调 agent → 产出 A2UI 协议**。传输默认走 SSE + AG-UI 事件流，加 `?stream=false` 则收一次性 JSON（同一个入口）。

## 一、一句话说清两个协议的分工

- **A2UI** 管「agent 生成什么界面」——一组 JSONL 协议消息（`surfaceUpdate` / `dataModelUpdate` / `beginRendering` / `deleteSurface`）。
- **AG-UI** 管「agent 和前端之间怎么通信」——SSE 承载的事件流（`RUN_STARTED` / `TEXT_MESSAGE_CONTENT` / `CUSTOM` / `RUN_FINISHED` …）。

两者不冲突：A2UI 消息被当作**领域载荷**，原样放进 AG-UI 的 `CUSTOM` 事件里传给前端。

## 二、目录与分层

```
src/
├── index.ts          进程入口：读 .env → 装配 → 监听
├── app.ts            Koa 装配（logger / errorHandler / cors / bodyParser / router）
├── config.ts         环境变量 → ServerConfig（含一个 20 行的 .env 解析器，不引 dotenv）
├── types.ts          对外契约（请求/响应）与 agent 契约；协议消息类型复用 a2ui-core
├── inbound.ts        入站规范化：AG-UI RunAgentInput / 简写 / scenario → 统一输入
├── scenarios.ts      示例场景注册表：从 core 构建产物（dist/mock）加载 fixture，
│                     并推导/校验每个场景的 surfaceId；按顺序派生出字符流要吐的文本
├── scenario-stream.ts 场景字符流：把 fixture 的原始 JSON 文本按固定块长吐成 SSE 事件
├── routes/index.ts   路由：只做装配与状态码，不含业务语义
├── agui/
│   ├── events.ts     AG-UI 事件类型 + SSE 编码 + 事件工厂
│   └── run.ts        **唯一映射点**：两条流 → AG-UI 事件序列
│                     （runA2UIStream：文本 + 协议消息；runChatStream：只有文本）
├── chat/index.ts     最小模型对话：消息进 / 文本出，**不带任何 A2UI 协议约束**
├── agent/
│   ├── provider.ts   provider 契约：只负责吐文本
│   ├── index.ts      门面：选 provider + 抽取 + 流式行装配
│   ├── mock.ts       离线实现（当前默认）
│   ├── openai-client.ts OpenAI 兼容客户端的唯一构造点（A2UI agent 与对话共用）
│   ├── openai.ts     真实模型实现（打开开关即用）
│   ├── prompt.ts     system prompt（组件目录 + 输出硬约束 + 示例）
│   ├── messages.ts   拼对话消息（system / 历史 / 本轮）
│   ├── extract.ts    模型自由文本 → 协议消息（围栏、数组、坏行容错）
│   └── keys.ts       四种消息判别键
└── session/index.ts  会话历史 + surface 生成缓存（进程内存）
```

**分层的关键约定**：provider 只吐文本，抽取/校验/行装配全在门面里做一次。于是
「非流式」与「流式」**必然产出同一批消息**（有测试逐字节比对），换模型也不会改变抽取行为。

第二层的约定同样重要：**建客户端 / 发请求 / 收流只有一份**（`agent/openai-client.ts`）。
A2UI agent 与纯对话的差别只在「喂什么消息」，各写一份的话超时、重试、错误形状都会各自漂。

## 三、跑起来

```bash
pnpm install
pnpm --filter a2ui-playground-server dev     # http://localhost:3000
```

前置：`a2ui-core` 需要先构建（`pnpm -r build` 会按依赖顺序先构建 core）——
服务端从 core 取**类型**（`import type`），`tsconfig.json` 的 `paths` 直接指向 core 的声明产物。

配置见 `.env.example`（复制成 `.env` 即可，`.env` 已被 gitignore）：

| 变量 | 缺省 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 端口 |
| `AGENT_PROVIDER` | `mock` | `mock`（离线假数据）\| `openai`（真实模型）。**只测对话不用改它** |
| `OPENAI_BASE_URL` | —（模板里给了 DeepSeek） | OpenAI 兼容网关：Azure / 中转 / 自建代理 / DeepSeek |
| `OPENAI_MODEL` | `gpt-4o-mini`（模板里是 `deepseek-flash`） | 模型名 |
| `OPENAI_API_KEY` | — | 模型 Key。`AGENT_PROVIDER=openai` 时必填（缺了启动即报错）；对话接口缺了返回 503 |
| `DEEPSEEK_API_KEY` | — | `OPENAI_API_KEY` 的别名（用 DeepSeek 时更顺眼）；两者都在时前者优先 |
| `OPENAI_TEMPERATURE` | `0.2` | 协议生成的温度（对话固定用 0.7） |
| `CHAT_SYSTEM_PROMPT` | 内置一句话 | `POST /api/a2ui/chat` 的默认 system prompt |
| `HISTORY_LIMIT` | `12` | 每会话保留轮数 |
| `SESSION_TTL_MS` | `1800000` | 会话空转回收时间，`0` = 不回收 |
| `MOCK_STREAM_DELAY_MS` | `0` | 模拟吐字间隔，设正数可肉眼看到流式效果；同时是场景字符流的默认节奏 |
| `SCENARIO_CHUNK_SIZE` | `50` | 场景字符流的默认块长（字符数），可按请求用 `?chunk=` 覆盖 |
| `AGENT_ICON_TOOLS` | 开 | A2UI 生成路径是否挂**图标 MCP 工具**（模型按需查询 Element Plus 图标名）。`0`/`false`/`off` 关掉；详见 `docs/a2ui-agent-prompt.md` §4 |

### 接 DeepSeek（`.env` 里默认就是它）

`base_url` 与模型名取自官方文档 <https://api-docs.deepseek.com>：

```dotenv
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash     # DeepSeek-V4.1-Flash；旧的 deepseek-v4-flash 已下线
OPENAI_API_KEY=sk-...           # 填自己的 Key
```

`deepseek-v4-pro` 也还能用，但 2026-09-14 起请求会被路由到 V4.1 Flash 并按 Flash 计费。
换其它网关（Azure / 中转 / 自建代理）只改 `OPENAI_BASE_URL` 与 `OPENAI_MODEL`，代码不动。

## 四、接口

### 1. `POST /api/a2ui/run` —— 主接口（默认 SSE，可用 query 切一次性 JSON）

**生成只有一个入口，传输方式由 query 决定**，路径不变：

| query | 传输 | 用途 |
| --- | --- | --- |
| 不带 / `stream=true` | `text/event-stream`（AG-UI 事件流） | 前端：边生成边渲染 |
| `stream=false`（也认 `0` / `no` / `off` / `json`） | `application/json`（一次返回全部消息） | 脚本、回归测试、缓存预热 |

缺省是**流式** —— `run` 的语义就是「流式地跑一轮」，要一次性结果得显式声明。

为什么用 query 而不用 `Accept` 头做内容协商：入参在请求体里，浏览器就**只能发 POST**
（`EventSource` 是 GET，用不上）；而 `fetch` 默认带 `Accept: */*`，靠它判断会永远落在
「没表态」的模糊态，中间层还可能改写。query 是显式的、curl 能一比一复现、也能直接写进文档。

```bash
# 流式（默认）
curl -N -X POST http://localhost:3000/api/a2ui/run \
  -H 'Content-Type: application/json' -d '{"message":"做一个购物车"}'

# 一次性 JSON
curl -X POST 'http://localhost:3000/api/a2ui/run?stream=false' \
  -H 'Content-Type: application/json' -d '{"message":"做一个购物车"}'
```

两种传输共用入参解析与落库，所以**会话/多轮增量在 JSON 模式下同样生效**。

请求体两种写法都收：

```jsonc
// AG-UI 的 RunAgentInput（标准客户端会这么发）
{ "threadId": "t1", "runId": "run-1",
  "messages": [{ "id": "m1", "role": "user", "content": "做一个购物车" }] }

// 简写（curl / 脚本调试）
{ "message": "做一个购物车" }
```

**多模态**：用户附上的图片（设计稿 / 截图 / 参考图）放在顶层的 `images` 数组里，
模型会据此**复刻出对应的 A2UI 界面**。每张图至少给 `dataUrl`（base64）或 `url` 之一：

```jsonc
{ "message": "照这张图做一个商品详情页",
  "images": [{ "dataUrl": "data:image/png;base64,iVBORw0KGgo...", "name": "design.png" }] }
```

- `images` 与 `message` 一起送进模型；图片在前端读成 base64 `dataUrl` 随请求发出，服务端不落地存储。
- 仅附图、不给文字也合法（「复刻这张图」）；其余校验规则不变（`images` 每项至少要有 `dataUrl` / `url` 之一）。
- 提示词与服务端处理细节见 [`a2ui-agent-prompt.md`](./a2ui-agent-prompt.md)。

也可以带 A2UI 的客户端动作（按钮点击）：

```jsonc
{ "threadId": "t1",
  "forwardedProps": { "action": { "name": "login", "surfaceId": "sf-1",
                                  "sourceComponentId": "submit", "context": { "username": "ada" } } } }
```

响应是 `text/event-stream`，每帧一个 JSON 事件：

```bash
curl -N -X POST http://localhost:3000/api/a2ui/run \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"t1","message":"做一个购物车"}'
```

```
data: {"type":"RUN_STARTED","threadId":"t1","runId":"run-797bcc66","timestamp":...}
data: {"type":"CUSTOM","name":"a2ui.surface","value":{"threadId":"t1","surfaceId":"surface-d061f0d2","provider":"mock"},"timestamp":...}
data: {"type":"TEXT_MESSAGE_START","messageId":"msg-run-797bcc66","role":"assistant","timestamp":...}
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"msg-run-797bcc66","delta":"{\"surfaceUpdate\":...","timestamp":...}
data: {"type":"CUSTOM","name":"a2ui.message","value":{"surfaceUpdate":{...}},"timestamp":...}
data: {"type":"TEXT_MESSAGE_END","messageId":"msg-run-797bcc66","timestamp":...}
data: {"type":"RUN_FINISHED","threadId":"t1","runId":"run-797bcc66","result":{"surfaceId":"...","provider":"mock","messageCount":3,"messages":[...]},"timestamp":...}
```

**入参不合法会在开流之前返回 400**（AG-UI 规定：run 尚未开始就不能给事件流）；
**开流之后的失败只能走在流里**（`RUN_ERROR`）—— HTTP 状态码已经发出去了。

### 2. `POST /api/a2ui/generate` —— `?stream=false` 的固定别名（一次性 JSON）

等价于 `POST /api/a2ui/run?stream=false`，保留纯粹是为了让脚本和回归测试不必记住 query。

两条传输路径共用 `prepare()` / `commit()`，分流只发生在最后一步（`respondSse` / `respondJson`），
所以「入参怎么解析」「缓存什么」不会因传输方式而分叉。响应体与上面的 JSON 模式逐字段一致。

```jsonc
{ "sessionId": "session-1a2b", "surfaceId": "surface-d061f0d2",
  "messages": [ /* 按序的 A2UI 协议消息 */ ],
  "raw": "模型原始输出", "provider": "mock", "warnings": [] }
```

产出为空时返回 **502**（上游没按 JSONL 输出）——不该让客户端以为「成功但界面是空的」。

### 2b. `POST /api/a2ui/chat` —— 模型对话（**不产出 A2UI**）

一条独立的路：只跟模型说话，把原话流回来。存在的意义是**排掉变量地验证模型链接** ——
baseURL / Key / 模型名只要有一个不对，生成界面那条路会以各种形态失败（抽不到消息、502、空产出），
很难一眼看出是配置问题；这里直接给模型原话，对了就是对了。

```bash
# 流式（默认，AG-UI 的文本消息事件）
curl -N -X POST http://localhost:3000/api/a2ui/chat \
  -H 'Content-Type: application/json' -d '{"message":"用一句话介绍你自己"}'

# 一次性 JSON
curl -X POST 'http://localhost:3000/api/a2ui/chat?stream=false' \
  -H 'Content-Type: application/json' -d '{"message":"你好"}'
# → { "reply": "...", "model": "deepseek-flash", "elapsedMs": 812 }
```

请求体三种写法，与 `/run` 同构：

| 字段 | 说明 |
| --- | --- |
| `message` | 简写：就一轮单句（curl 调试用） |
| `messages` | 完整对话（AG-UI 形状），**多轮要自己带全** —— 接口是无状态的 |
| `system` | 覆盖服务端默认的 `CHAT_SYSTEM_PROMPT` |
| `images` | 多模态输入：附上的图片（设计稿 / 截图 / 参考图），与 `message` 一起送进模型做「看图说话」 |

事件序列刻意**只有文本**：

```
RUN_STARTED
CUSTOM model.info          ← 这一轮用的模型名（`.env` 改错了模型名只在这里看得出来）
TEXT_MESSAGE_START         ← 惰性，真的吐字了才发
TEXT_MESSAGE_CONTENT × N
TEXT_MESSAGE_END
RUN_FINISHED               ← result: { model, chars }
```

**没有 `CUSTOM a2ui.message`** —— 一轮对话不产出任何界面。这不是省事，是这条路的定义：
若它也发协议消息，就说明「仅测模型对话」偷偷把 A2UI 那一层也拉了进来。

三条刻意的规则：

1. **Key 检查排在入参检查之前**，未配 Key 返回 **503**（不是 400）—— 请求本身没问题，
   是这台机器现在打不了模型。报 400 会把人引去改请求体，那是白费功夫。
2. **`tool` / `developer` 角色静默跳过**，不塞成 `user`。塞过去等于把工具返回值当成用户说的话，
   模型会当指令执行 —— 那是更坏的失败。
3. **不写会话缓存、不碰任何 surface**：它是与 A2UI 平行的另一条路（`/health` 里的
   `sessions` 不会因对话增长）。

空产出（网关回 200 + 空 `choices`，通常是模型名写错）→ 流内 `RUN_ERROR`（`EMPTY_OUTPUT`）；
上游调用失败 → `RUN_ERROR`（`MODEL_ERROR`），已吐出的半截回复照常闭合。

### 3. 示例场景（三条只读接口）

Playground 的示例下拉据此填充，**示例数据因此也走真实接口**，而不是在浏览器里 import 本地 fixture。

```jsonc
// GET /api/a2ui/scenarios
{ "scenarios": [ { "id": "shopping-cart", "desc": "购物车列表：List 模板 + 图片 + 合计绑定",
                   "surfaceId": "shopping-cart", "messageCount": 3 } ],
  "defaultId": "column-row-mix" }

// GET /api/a2ui/scenarios/shopping-cart —— 原始素材（Stream 面板的逐条模式用）
{ "id": "shopping-cart", "desc": "...", "surfaceId": "shopping-cart",
  "lines": [ "{\"surfaceUpdate\":{...}}", "..." ] }
```

未知场景返回 **404**。

跑一个场景则用主接口，请求体里带 `scenario` 即可（此时 `message` 可省）：

```bash
curl -N -X POST http://localhost:3000/api/a2ui/run \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"t1","scenario":"shopping-cart"}'
```

三条刻意的规则：

1. **场景永远走 fixture，与 `AGENT_PROVIDER` 无关。** 它是内置素材、不是模型产出；
   若落到真实模型，模型会收到一条空输入然后自由发挥，出来的东西和 fixture 毫无关系。
   `a2ui.surface` 事件里的 `provider` 会**如实回 `mock`**（`agent.providerFor(request)`）。
2. **跑在 fixture 自带的 `surfaceId` 上**，而不是场景 id —— `product-card` 用的就是
   `gallery-product-card`。客户端按这个 id 去 `treeMap` 找树，对不上就是一片白板。
   注册表在加载时就会校验「一份 fixture 只面向一个 surface」，不一致直接启动失败。
3. **不夺走会话的活跃 surface**（`recordSurface(..., { activate: false })`）。
   场景不是「在编辑某个界面」，只是把素材渲染出来；若也切换活跃 surface，
   同一个 thread 里随后发一句话就会被画到示例界面上。

### 3b. `GET /api/a2ui/scenarios/:id/stream` —— 场景**原始字符流**（SSE）

与上面几条的差别是「服务端负责到哪一步」：`/run?scenario=` 发的是**已解析好的协议消息**，
这条只吐**尚未成形的文本切片**，客户端自己用 `createA2UIBuffer()` 把括号配对回去。

| query | 缺省 | 说明 |
|---|---|---|
| `order` | `stream` | `protocol`（fixture 原样，`beginRendering` 在最后）\| `stream`（`beginRendering` 紧随 root） |
| `chunk` | `SCENARIO_CHUNK_SIZE`（50） | 每片字符数，需 ≥ 1 |
| `delay` | `MOCK_STREAM_DELAY_MS` | 片与片之间的间隔毫秒，`0` = 不限速（第一片不等待） |

```bash
curl -N 'http://localhost:3000/api/a2ui/scenarios/column-row-mix/stream?chunk=50&delay=60'
```

```jsonc
data: {"type":"stream.started","scenarioId":"column-row-mix","surfaceId":"column-row-mix",
       "order":"stream","chunkSize":50,"delayMs":60,"totalChars":2997,"totalChunks":60}
data: {"type":"stream.chunk","index":0,"text":"{\"surfaceUpdate\":{\"surfaceId\":\"column-ro"}
   ...
data: {"type":"stream.done","chunks":60,"chars":2997}
```

**事件集刻意不复用 AG-UI 类型**：这条流不是「跑一轮 agent」，硬套 `RUN_STARTED` 就得为它编一个
并不存在的对话轮次，用 `TEXT_MESSAGE_CONTENT.delta` 又是在说「模型正在吐字」。传输层完全一致
（`text/event-stream` + `data: {...}`），所以客户端复用同一个切帧函数，只是事件形状自己定。

吐的是**紧凑形态**（多条 `surfaceUpdate` 压成一条）：字符流面板要压的就是「括号配对 + 协议补全」——
紧凑形态进去、补全形态出来；若吐规整的「一行一条消息」，按换行切就够了，缓冲层那段逻辑根本不会被执行到。
顺序用的是 core 的 `deriveStreamOrders()`，与客户端逐条模式**同一份实现**，两边不会各算各的。

参数非法（`chunk=0` / `chunk=abc` / `chunk=1.5` / `delay=-1` / `order=nope`）→ **400**，
场景不存在 → **404**；都在**开流之前**返回 JSON，不会退化成 `200 + event-stream`。

### 4. `GET /api/a2ui/session/:threadId` —— 生成缓存回放

客户端刷新后可据此恢复界面，不必重新问模型：

```jsonc
{ "sessionId": "t1", "surfaceId": "surface-d061f0d2",
  "surfaces": [ { "surfaceId": "...", "messages": [ /* 该 surface 历史全部消息，可直接重放 */ ] } ],
  "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ] }
```

### 5. `GET /health`

```jsonc
{ "status": "ok", "provider": "mock", "model": "mock", "sessions": 0 }
```

## 五、A2UI → AG-UI 的事件映射

| A2UI 侧 | AG-UI 事件 | 说明 |
| --- | --- | --- |
| 一轮开始 | `RUN_STARTED` | `threadId` = 会话 id，`runId` 客户端可指定 |
| 会话/界面元信息 | `CUSTOM` · `a2ui.surface` | `{ threadId, surfaceId, provider }`，后续事件据此归属 |
| 模型原始文本增量 | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` × N → `TEXT_MESSAGE_END` | 聊天面板可实时显示；**惰性开始**，一个字都没有时不发 |
| 一条完整 A2UI 协议消息 | `CUSTOM` · `a2ui.message` | value 即协议消息对象，客户端可直接喂给 a2ui-core 解析 |
| 正常结束 | `RUN_FINISHED` | `result` 带 `surfaceId` / `provider` / `messageCount` / `messages` |
| 出错 | `RUN_ERROR` | `code`：`AGENT_ERROR`（agent 抛错）\| `EMPTY_OUTPUT`（抽不出协议消息） |

### 为什么 A2UI 消息不走 `STATE_SNAPSHOT` / `STATE_DELTA`

那两个事件面向「一份可打 JSON Patch 的共享状态对象」，而 A2UI 是一串**有先后顺序、语义各自独立**的协议消息。硬塞进 JSON Patch 是有损转换，客户端还得反解回来。AG-UI 的 `CUSTOM` 就是为这类「领域自有载荷」留的口子，原样传递最忠实。

### 前端消费示例

```ts
const response = await fetch('http://localhost:3000/api/a2ui/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ threadId, message }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  // SSE 以空行分帧
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';
  for (const frame of frames) {
    const line = frame.trim();
    if (!line.startsWith('data: ')) continue;       // 忽略注释/其它字段
    const event = JSON.parse(line.slice(6));

    if (event.type === 'CUSTOM' && event.name === 'a2ui.message') {
      // 逐条喂给 a2ui-core：createA2UIBuffer / createJSONLStream 直接吃 JSONL
      feedA2UI(event.value);
    }
    if (event.type === 'TEXT_MESSAGE_CONTENT') showToken(event.delta);
    if (event.type === 'RUN_ERROR') reportError(event.message);
  }
}
```

## 六、多轮与缓存

- 同一 `threadId` 的下一轮会带上历史，模型据此做**增量修改**：只回变化的那几个组件（同 id 原地更新），不再重发 `beginRendering`。
- 会话的活跃 surface 由服务端记住：客户端传的 `surfaceId` 只在**新建会话**时生效，不会把正在编辑的界面顶掉。
- `surfaces` 里按 surface 累积历次消息，本身就是一段可重放的 JSONL 序列。
- 缓存在**进程内存**里（`session/index.ts` 只有几个方法，换成 Redis/DB 只动这一个文件）；`SESSION_TTL_MS` 控制空转回收。

## 七、切换到真实模型

```bash
AGENT_PROVIDER=openai OPENAI_API_KEY=sk-xxx pnpm --filter a2ui-playground-server dev
```

切换后**接口与事件流完全不变**，变的只是「谁来产出那段 JSONL 文本」。提示词见 `agent/prompt.ts`：
它按仓库里渲染器**真正支持**的组件矩阵写（18 个组件 / 属性 / 枚举），而不是官方目录的全量文档 ——
提示词里出现渲染器没实现的属性，模型就会照着编，最后变成「协议合法但界面上什么都不显示」。

`agent/extract.ts` 对模型输出的三类常见偏差做了兜底：套 markdown 围栏、输出成 JSON 数组、混进半截 JSON（坏行只记 `warnings`，不阻断整批）。

## 八、测试

```bash
pnpm --filter a2ui-playground-server test        # mocha + tsx
pnpm --filter a2ui-playground-server test:types  # 含测试文件的类型检查
```

覆盖：入站规范化（AG-UI / 简写 / action / scenario 三选一 · 对话的 message/messages/system）、
抽取容错（围栏 / 数组 / 坏行 / 行装配）、会话与缓存（裁剪 / TTL / 快照 / 场景不切活跃 surface）、
agent 双路径一致性、AG-UI 事件序列（正常 / 抛错 / 空产出）、示例场景（注册表不变量 / 列表 / fixture / 404 /
场景经 SSE 产出的消息与 fixture **逐条一致** / `openai` 配置下仍走 fixture 且 `provider` 如实回 `mock`）、
场景字符流（事件序列与序号连续 / `started` 报的总长与分片实际长度一致 / 分片拼回来**组件集合与 fixture 一致** /
`order` 决定 `beginRendering` 落点 / `chunk`·`delay` 生效且缺省取配置 / 400·404 分支）、
模型对话（角色过滤与 system 覆盖 / 事件序列**不含任何 `a2ui.message`** / 空产出与中途抛错 /
未配 Key 503 且不开流 / 注入假 chat 后两条传输的形状 / 对话不写会话缓存）、
以及端到端（真起一个临时端口打 SSE、多轮增量、`?stream=false` 的 JSON 分支与别名等价性、400/404/CORS 预检）。

测试的装配统一走 `test/helpers.ts` 的 `makeConfig` / `listen` —— 之前每个 spec 各自拼配置，
`ServerConfig` 每加一个字段就要改四个文件（崩过两轮）。

**真模型不打进单测**：要 Key、要网络、要花钱，还会因模型措辞变化而抖动。所以对话接口分两层测 ——
纯函数层（入参规范化、事件序列，用假的文本流摆布顺序）与接口层（503 / 400 / 注入假 chat 的两条传输）。

当前：**115 passing**。

## 九、已知边界与后续

- **真实模型已实测通过（DeepSeek `deepseek-flash`）**，但 `.env` 里的 `AGENT_PROVIDER` **默认仍是 `mock`** ——
  想让 A2UI 生成也走真实模型，把它改成 `openai` 再重启。实测结论：
  - `POST /api/a2ui/chat`：逐 token 流式（16 片）、首字 ~2.7s、整轮 ~2.8s；
    `?stream=false` 约 1.0s；多轮（自带 `messages`）与 `system` 覆盖都正常。
  - `POST /api/a2ui/run`（`AGENT_PROVIDER=openai`）：一轮 5.7s 产出 **3 条协议消息 / 11 个组件**
    （Column→Card→Column→Image/Text/Text/Button，外加底部 Row + Icon），
    `path` 绑定与嵌套 `valueMap` 都对，`warnings: []`（抽取器一行没丢）；
    在 playground 里**真的渲染出来了**（预览 12 个节点 + 数据模型面板显示 `product.*`）。
  - 两点观察：① `deepseek-flash` **默认开思考模式**，首字前那 2~3 秒就是它，
    要更快可加 `thinking: { type: 'disabled' }`（本服务未透出这个参数）；
    ② 模型会**编造示例图片地址**（`https://images.example.com/...`），图裂是数据问题、不是渲染问题。
- **对话接口不记历史**（无状态）：多轮由调用方带全 `messages`。真要做服务端多轮，应当另开一份
  只存对话的缓存，而不是复用 `session`（那份缓存记的是「界面怎么长出来的」）。
- **未做中断/取消**：客户端断开时服务端会销毁流并落库已收到的部分，但没有显式的取消指令（AG-UI 的 interrupt / resume 未实现）。
- **无鉴权**：开发期接口，未加认证与限流。
- **playground 已接 SSE，示例数据也走接口**：`web/a2ui-playground` 是「左预览 + 右聊天」双栏，
  顶部下拉的 8 个示例场景由 `GET /api/a2ui/scenarios` 提供，选中即 `POST /api/a2ui/run { scenario }`
  走 SSE 流式回来；聊天栏的发送键同理（走 `{ message }`）。两条都喂进**同一套** `createJSONLStream`
  链路，没有为服务端另开渲染分支。地址可用 `VITE_A2UI_SERVER` 覆盖（缺省 `http://localhost:3000`）。
  - 场景用**独立 thread**（`sc-xxxx`），不占用对话会话；
  - 左侧「Stream 模拟」页签的两条模式**都从服务端取数**：
    - *逐条（JSONL）*是**客户端步进**（要能一条条推、随时停下看 store），素材来自
      `GET /api/a2ui/scenarios/:id`；
    - *字符流*是**服务端推送**，走 `GET /api/a2ui/scenarios/:id/stream` —— 客户端不再
      `chunkText()` 自己切、也不再自己跑定时器，切片与节奏都归服务端。
  - 聊天栏标题右侧的 **「对话 / 界面」开关** = 仅测模型对话：打开后发送键改打
    `POST /api/a2ui/chat`，气泡里显示模型原话，**不清 store、不动预览、不喂 JSONL 流**
    （实测预览区节点数前后一致），多轮由前端自带历史。未配 Key 时气泡里会显示服务端
    503 的原话（它写明了该改哪个文件）。
- **场景注册表依赖 core 的构建产物**：`scenarios.ts` 从 `packages/a2ui-core/dist/mock` 加载
  （core 的 `build` 脚本因此多了一步 `tsc -p tsconfig.mock.json`，把 `mock/` 单独编成 CommonJS）。
  改 mock 后要重新构建 core，否则服务端拿到的是旧 fixture。
