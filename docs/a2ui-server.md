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
├── inbound.ts        入站规范化：AG-UI RunAgentInput / 简写 / userAction → 统一输入
├── routes/index.ts   路由：只做装配与状态码，不含业务语义
├── agui/
│   ├── events.ts     AG-UI 事件类型 + SSE 编码 + 事件工厂
│   └── run.ts        **唯一映射点**：A2UI agent 流 → AG-UI 事件序列
├── agent/
│   ├── provider.ts   provider 契约：只负责吐文本
│   ├── index.ts      门面：选 provider + 抽取 + 流式行装配
│   ├── mock.ts       离线实现（当前默认）
│   ├── openai.ts     真实模型实现（打开开关即用）
│   ├── prompt.ts     system prompt（组件目录 + 输出硬约束 + 示例）
│   ├── messages.ts   拼对话消息（system / 历史 / 本轮）
│   ├── extract.ts    模型自由文本 → 协议消息（围栏、数组、坏行容错）
│   └── keys.ts       四种消息判别键
└── session/index.ts  会话历史 + surface 生成缓存（进程内存）
```

**分层的关键约定**：provider 只吐文本，抽取/校验/行装配全在门面里做一次。于是
「非流式」与「流式」**必然产出同一批消息**（有测试逐字节比对），换模型也不会改变抽取行为。

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
| `AGENT_PROVIDER` | `mock` | `mock`（离线假数据）\| `openai`（真实模型） |
| `OPENAI_API_KEY` | — | `AGENT_PROVIDER=openai` 时必填，**缺了会启动即报错** |
| `OPENAI_BASE_URL` | — | 兼容网关（Azure / 代理 / 中转） |
| `OPENAI_MODEL` | `gpt-4o-mini` | 模型 |
| `HISTORY_LIMIT` | `12` | 每会话保留轮数 |
| `SESSION_TTL_MS` | `1800000` | 会话空转回收时间，`0` = 不回收 |
| `MOCK_STREAM_DELAY_MS` | `0` | mock 吐字间隔，设正数可肉眼看到流式效果 |

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

### 3. `GET /api/a2ui/session/:threadId` —— 生成缓存回放

客户端刷新后可据此恢复界面，不必重新问模型：

```jsonc
{ "sessionId": "t1", "surfaceId": "surface-d061f0d2",
  "surfaces": [ { "surfaceId": "...", "messages": [ /* 该 surface 历史全部消息，可直接重放 */ ] } ],
  "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ] }
```

### 4. `GET /health`

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

覆盖：入站规范化（AG-UI / 简写 / action）、抽取容错（围栏 / 数组 / 坏行 / 行装配）、
会话与缓存（裁剪 / TTL / 快照）、agent 双路径一致性、AG-UI 事件序列（正常 / 抛错 / 空产出）、
以及端到端（真起一个临时端口打 SSE、多轮增量、`?stream=false` 的 JSON 分支与别名等价性、400/404/CORS 预检）。

## 九、已知边界与后续

- **尚未接真实模型**：当前默认 `mock`；`openai.ts` 已就位但未在真实 Key 下端到端验证。
- **未做中断/取消**：客户端断开时服务端会销毁流并落库已收到的部分，但没有显式的取消指令（AG-UI 的 interrupt / resume 未实现）。
- **无鉴权**：开发期接口，未加认证与限流。
- **playground 只接了非 SSE 那条**：`web/a2ui-playground` 多了「a2ui-server」面板，按钮走
  `POST /api/a2ui/run?stream=false`（地址可用 `VITE_A2UI_SERVER` 覆盖，缺省 `http://localhost:3000`），
  返回的 `messages` 字符串化后拼成 JSONL，走**与 mock 完全相同**的 `parseA2UI` 链路 ——
  所以渲染、数据模型、错误收集、组件树面板全部复用，没有为服务端另开分支。
  同一个 threadId 连点两次即多轮（第二次回增量）；「新会话」换 threadId，「回到 mock」切回本地数据。
  **SSE 流式尚未接**，那是下一步。
