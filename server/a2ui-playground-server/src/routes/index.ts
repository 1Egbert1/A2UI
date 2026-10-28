/**
 * 路由层：把 HTTP 请求翻译成 agent 调用，再把结果翻译回响应。
 *
 * 这里**不放业务语义** —— 「什么叫合法的入站请求」在 `inbound.ts`，
 * 「怎么生成协议」在 `agent/`，「A2UI 怎么映射成 AG-UI 事件」在 `agui/`，
 * 「缓存什么」在 `session/`。路由只负责装配、状态码与传输层（SSE）细节。
 *
 * 生成只有**一个入口**，传输方式由 query 决定：
 * - `POST /api/a2ui/run`              —— 主接口，默认 SSE（AG-UI 事件流）；
 * - `POST /api/a2ui/run?stream=false` —— 同一接口收一次性 JSON（一次性返回全部协议消息）；
 * - `POST /api/a2ui/generate`         —— 上面那个的**固定别名**，省得脚本/测试记 query。
 *
 * 两条传输路径共享 `prepare()` 与 `commit()`，所以「入参怎么解析」「缓存什么」
 * 不因传输方式而分叉；分流只发生在最后一刻（`respondSse` / `respondJson`）。
 *
 * 另有两条只读接口给 Playground 取示例场景：`GET /api/a2ui/scenarios`（列表）与
 * `GET /api/a2ui/scenarios/:id`（原始 fixture）。场景的**生成**仍然走上面那个唯一入口，
 * 只是请求体里多一个 `scenario` 字段 —— 这样示例数据也走一遍完整链路。
 *
 * 再加一条 `GET /api/a2ui/scenarios/:id/stream`：把 fixture 的原始 JSON 文本按固定块长
 * **字符级**吐出去。它存在的理由与上面几条都不同 —— 服务端在这里只负责吐字节，
 * 「这段字符流是什么消息」交给客户端的 `createA2UIBuffer()`（括号配对 + 协议补全）去回答。
 *
 * 最后一条 `POST /api/a2ui/chat` 是**独立的另一条路**：只跟模型说话，不产出任何 A2UI 协议，
 * 用来排掉协议层与渲染层的变量、单独验证「baseURL + Key + 模型名」通不通。
 */
import { Readable } from 'node:stream';
import type Router from 'koa-router';
import type { A2UIAgent } from '../agent';
import { parseUserAction, type ActionRouter } from '../actions';
import { encodeSse, runA2UIStream, runChatStream } from '../agui';
import type { ModelChat } from '../chat';
import { hasModelKey, type ServerConfig } from '../config';
import {
  BadRequestError,
  ServiceUnavailableError,
  createChatThreadId,
  createRunId,
  normalizeChatRequest,
  normalizeGenerateRequest,
} from '../inbound';
import { buildScenarioStream } from '../scenario-stream';
import { DEFAULT_SCENARIO_ID, getScenario, getScenarioStreamPlan, listScenarios } from '../scenarios';
import type { SessionState, SessionStore } from '../session';
import type { AgentRequest, AgentResult, ScenarioOrder } from '../types';

export interface RouteDeps {
  config: ServerConfig;
  agent: A2UIAgent;
  /** 纯模型对话（`/api/a2ui/chat`），与 A2UI agent 无关。 */
  chat: ModelChat;
  sessions: SessionStore;
  /** 客户端动作路由（`POST /api/a2ui/action`）。 */
  actions: ActionRouter;
}

interface PreparedRun {
  session: SessionState;
  request: AgentRequest;
  runId: string;
}

/** `GET|POST /health` 的响应形状。 */
interface HealthBody {
  status: 'ok';
  provider: A2UIAgent['provider'];
  model: string;
  /** `POST /api/a2ui/chat` 会用的模型名。 */
  chatModel: string;
  /** 模型链接是否就绪（配了 Key）。false 时对话接口会 503，其余接口不受影响。 */
  modelReady: boolean;
  sessions: number;
}

/**
 * 模型对话接口的门槛：没配 Key 就打不了模型。
 *
 * 用 **503** 而不是 400：请求本身没问题，是这台服务器现在没有可用的模型凭据。
 * 而且必须**在开流之前**抛出去 —— 否则客户端收到的是一条 200 的空流，
 * 从状态码上看不出是配置问题。
 */
const requireModelKey = (deps: RouteDeps): void => {
  if (!hasModelKey(deps.config.openai)) {
    throw new ServiceUnavailableError(
      '未配置模型 Key：在 server/a2ui-playground-server/.env 里填上 OPENAI_API_KEY（或 DEEPSEEK_API_KEY）后重启服务端',
    );
  }
};

/** 把一次请求规整成「会话 + agent 请求 + runId」。两条传输路径共用。 */
const prepare = (deps: RouteDeps, body: unknown): PreparedRun => {
  const normalized = normalizeGenerateRequest(body);

  // 场景要跑在**自己的 surface** 上：fixture 里的消息自带 surfaceId，客户端拿到 AG-UI 的
  // `a2ui.surface` 事件后会按它去 treeMap 找树 —— 若这里沿用会话的活跃 surface，两边对不上
  // 就是一片白板。`SessionStore` 本来就把 surface 按 id 分桶存（`session.surfaces` 是 Map），
  // 所以「另起一个 surface」不会顶掉会话里已有的界面。
  const scenario = normalized.scenario === undefined ? undefined : getScenario(normalized.scenario);
  if (normalized.scenario !== undefined && scenario === undefined) {
    throw new BadRequestError(`未知的示例场景「${normalized.scenario}」`);
  }

  const session = deps.sessions.getOrCreate(
    normalized.sessionId,
    scenario?.surfaceId ?? normalized.surfaceId,
  );

  return {
    session,
    runId: normalized.runId ?? createRunId(),
    request: {
      message: normalized.message,
      // 已有会话以自己的活跃 surface 为准（见 SessionStore.getOrCreate 的注释）—— 但场景例外。
      surfaceId: scenario?.surfaceId ?? session.surfaceId,
      history: [...session.history],
      scenario: normalized.scenario,
      // 多模态输入：用户附上的图片，原样交给 agent（buildChatMessages 会转成 image_url 分片）。
      images: normalized.images,
    },
  };
};

/** 一轮生成结束后落库：历史轮次 + surface 缓存。流式/非流式都要跑，故抽出。 */
const commit = (
  deps: RouteDeps,
  session: SessionState,
  request: AgentRequest,
  result: Pick<AgentResult, 'messages' | 'raw'>,
): void => {
  deps.sessions.appendTurn(session, { role: 'user', content: request.message });

  if (result.messages.length === 0) {
    // 空产出不进历史：把一段「模型什么都没说」记进上下文，只会让后面越生成越差。
    return;
  }

  deps.sessions.appendTurn(session, { role: 'assistant', content: result.raw });
  // 场景不切活跃 surface：它不是「在编辑某个界面」，只是把一份素材渲染出来。
  deps.sessions.recordSurface(session, request.surfaceId, result.messages, {
    activate: request.scenario === undefined,
  });
};

/** query 里被当作「关掉流式」的取值。 */
const STREAM_OFF = new Set(['false', '0', 'no', 'off', 'json']);

/**
 * 本次请求是否用 SSE 传输。
 *
 * 为什么用 query 而不是 `Accept` 头做内容协商：入参在请求体里，
 * 浏览器就**只能发 POST**（`EventSource` 是 GET，用不上）；
 * 而 `fetch` 默认带 `Accept: *\/*`，靠它判断会一直落在「没表态」的模糊态，
 * 中间层还可能改写。query 是显式的、curl 能一比一复现、也能直接写进文档。
 *
 * 缺省为**流式** —— `run` 的语义就是「流式地跑一轮」，要一次性结果得显式声明。
 */
const wantsStream = (ctx: Router.RouterContext): boolean => {
  const raw = ctx.query.stream;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();

  if (value === undefined || value === '') {
    return true;
  }
  return !STREAM_OFF.has(value);
};

/**
 * 读 query 里的整数。
 *
 * 给了就必须合法 —— 与请求体的处理保持同一态度：与其猜一个值（`chunk=abc` 用默认 50），
 * 不如当场 400。调用方拿到的 `chunk` 会原样写进 `stream.started`，客户端据此画进度，
 * 猜出来的值只会让两边对不上。
 */
const readQueryInt = (
  raw: unknown,
  name: string,
  fallback: number,
  min: number,
): number => {
  const value = (Array.isArray(raw) ? raw[0] : raw) as string | undefined;
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== value.trim() || parsed < min) {
    throw new BadRequestError(`query ${name} 必须是不小于 ${min} 的整数（收到「${value}」）`);
  }
  return parsed;
};

/** query `order` → 推送顺序。只认两个字面量，别的一律 400。 */
const readOrder = (raw: unknown): ScenarioOrder => {
  const value = String((Array.isArray(raw) ? raw[0] : raw) ?? '')
    .trim()
    .toLowerCase();

  if (value === '' || value === 'stream') {
    return 'stream';
  }
  if (value === 'protocol') {
    return 'protocol';
  }
  throw new BadRequestError(`query order 只接受 protocol | stream（收到「${value}」）`);
};

/**
 * 打开一条 SSE 响应。
 *
 * `X-Accel-Buffering: no` 是给反向代理（nginx 等）看的：不加它，中间层会把「流式」
 * 攒成一整块再吐出去，到客户端就成了「一次性」。
 */
const openSse = (ctx: Router.RouterContext): void => {
  ctx.status = 200;
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');
};

/**
 * 把一串事件以 SSE 发出去。两条流（agent 运行 / 场景字符流）共用。
 *
 * 「客户端断开就销毁」不能省：否则 agent 会继续为「没人在听」的连接生成下去，
 * 场景字符流也会继续按 `delay` 一片片吐完。
 */
const pipeSse = async function <T>(ctx: Router.RouterContext, events: AsyncGenerator<T>): Promise<void> {
  openSse(ctx);

  const stream = Readable.from(toSse(events));
  ctx.req.on('close', () => stream.destroy());
  // 兜住流自身的错误，避免未处理的 'error' 事件把进程带崩（Koa 之后还会再处理一次）。
  stream.on('error', (error) => ctx.onerror(error));

  ctx.body = stream;
};

/** SSE 传输：AG-UI 事件流。 */
const respondSse = (ctx: Router.RouterContext, deps: RouteDeps, prepared: PreparedRun): void => {
  const { session, request, runId } = prepared;

  void pipeSse(
    ctx,
    runA2UIStream({
      agent: deps.agent,
      request,
      threadId: session.sessionId,
      runId,
      onFinish: (result) => commit(deps, session, request, result),
    }),
  );
};

/**
 * 一次性 JSON 传输：全部协议消息攒齐后一次返回。
 *
 * 只在**真的产出消息**时返回 200；一条都没抽出来通常意味着模型没按 JSONL 输出，
 * 返回 502 —— 这是上游的问题，不该让客户端以为「成功但界面是空的」。
 */
const respondJson = async (
  ctx: Router.RouterContext,
  deps: RouteDeps,
  prepared: PreparedRun,
): Promise<void> => {
  const { session, request } = prepared;
  const result = await deps.agent.generate(request);
  commit(deps, session, request, result);

  ctx.status = result.messages.length > 0 ? 200 : 502;
  ctx.body = {
    sessionId: session.sessionId,
    surfaceId: request.surfaceId,
    messages: result.messages,
    raw: result.raw,
    provider: result.provider,
    warnings: result.warnings,
  };
};

/** 事件对象 → SSE 帧。两条流共用（AG-UI 事件、场景字符流事件）。 */
async function* toSse<T>(events: AsyncGenerator<T>): AsyncGenerator<string> {
  for await (const event of events) {
    yield encodeSse(event);
  }
}

export const registerRoutes = (router: Router, deps: RouteDeps): void => {
  router.get('/health', (ctx) => {
    const body: HealthBody = {
      status: 'ok',
      provider: deps.agent.provider,
      model: deps.agent.provider === 'openai' ? deps.config.openai.model : 'mock',
      chatModel: deps.chat.model,
      modelReady: hasModelKey(deps.config.openai),
      sessions: deps.sessions.size,
    };
    ctx.body = body;
  });

  /**
   * 示例场景列表。playground 的下拉据此填充 —— 于是「有哪些示例」这件事只有服务端一处定义。
   */
  router.get('/api/a2ui/scenarios', (ctx) => {
    ctx.body = { scenarios: listScenarios(), defaultId: DEFAULT_SCENARIO_ID };
  });

  /**
   * 单个场景的**原始 fixture**（一行一条的协议消息）。
   *
   * 与 `/run?scenario=...` 的分工：那条路是「经 SSE 把消息发给客户端」，服务端的抽取、装配、
   * AG-UI 映射全都要跑一遍；这条只把素材取出来。Stream 面板需要素材本身 —— 它要在**不经过
   * 服务端**的前提下逐条/逐字符回放，那才是这个面板存在的意义。
   */
  router.get('/api/a2ui/scenarios/:id', (ctx) => {
    const scenario = getScenario(ctx.params.id);
    if (scenario === undefined) {
      ctx.status = 404;
      ctx.body = { error: `示例场景「${ctx.params.id}」不存在` };
      return;
    }

    ctx.body = {
      id: scenario.id,
      desc: scenario.desc,
      surfaceId: scenario.surfaceId,
      lines: scenario.lines,
    };
  });

  /**
   * 单个场景的**原始字符流**：把 fixture 的紧凑 JSONL 文本按固定块长吐出来。
   *
   * 与 `/run?scenario=` 的区别在「服务端负责到哪一步」：
   * - `/run` 逐条发**协议消息**（客户端拿到的已经是 A2UI 消息）；
   * - 这里只吐**未成形的文本切片**，客户端自己用 `createA2UIBuffer()` 把括号配对回去。
   *
   * 于是「切片落在 JSON 任意位置」这件事由真实网络分片来考 —— 这正是此前前端本地切片
   * 考不到的那部分。参数 `?order=` / `?chunk=` / `?delay=` 都允许覆盖，方便按需复现。
   */
  router.get('/api/a2ui/scenarios/:id/stream', async (ctx) => {
    // 读参数会抛 BadRequestError —— 必须在开流之前跑完，否则「参数非法」会以
    // 200 + event-stream 的形式漏出去（与 `/run` 的处理保持同一条规矩）。
    const order = readOrder(ctx.query.order);
    const plan = getScenarioStreamPlan(ctx.params.id, order);
    if (plan === undefined) {
      ctx.status = 404;
      ctx.body = { error: `示例场景「${ctx.params.id}」不存在` };
      return;
    }

    const chunkSize = readQueryInt(ctx.query.chunk, 'chunk', deps.config.scenarioChunkSize, 1);
    const delayMs = readQueryInt(ctx.query.delay, 'delay', deps.config.mockStreamDelayMs, 0);

    await pipeSse(
      ctx,
      buildScenarioStream({
        scenarioId: plan.id,
        surfaceId: plan.surfaceId,
        order: plan.order,
        text: plan.text,
        chunkSize,
        delayMs,
      }),
    );
  });

  /**
   * 核心接口：接收用户输入 → 调 agent → 按 query 选择传输方式。
   *
   * 入站请求体接受 AG-UI 的 `RunAgentInput`（threadId/runId/messages）或简写 `{ message }`。
   * 入参不合法时**在开流之前**返回 400（符合 AG-UI：run 尚未开始就不能给事件流）；
   * 开流之后的一切失败都只能以流里的 `RUN_ERROR` 表达 —— HTTP 状态码已经发出去了。
   */
  router.post('/api/a2ui/run', async (ctx) => {
    // prepare 会抛 BadRequestError —— 必须在设响应头之前跑完，
    // 否则「入参非法」就会以 200 + event-stream 的形式漏出去。
    const prepared = prepare(deps, ctx.request.body);

    if (wantsStream(ctx)) {
      respondSse(ctx, deps, prepared);
      return;
    }

    await respondJson(ctx, deps, prepared);
  });

  /** 等价于 `POST /api/a2ui/run?stream=false`。给脚本、回归测试、缓存预热用。 */
  router.post('/api/a2ui/generate', async (ctx) => {
    await respondJson(ctx, deps, prepare(deps, ctx.request.body));
  });

  /**
   * 客户端动作回传：把 `userAction` 交给动作路由，返回增量协议消息。
   *
   * 补的是「按钮点了没人接」那半段：渲染层派发 `a2ui-action` 之后，宿主原本只能自己处理；
   * 现在把动作 POST 过来，服务端按注册的 handler 产出一条（或几条）`dataModelUpdate` /
   * `surfaceUpdate`，客户端 `ingest` 回去 —— 数据模型面板、以及绑定该 path 的组件都会立刻变化。
   *
   * 刻意**不用 SSE**：动作回执通常只有一两条消息，一次性 JSON 更简单；需要推送的业务进度
   * 应该走 `/run` 那一侧，不要把这个接口做成流。
   */
  router.post('/api/a2ui/action', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    if (threadId === '') {
      throw new BadRequestError('缺少 threadId：动作必须归属到某个会话');
    }

    // 允许两种送法：`{ threadId, userAction }` 或把 userAction 字段平铺在顶层。
    const action = parseUserAction(body.userAction ?? body);
    if (!action) {
      throw new BadRequestError('userAction 缺少 name：无法确定要执行哪个动作');
    }

    const session = deps.sessions.get(threadId);
    if (!session) {
      ctx.status = 404;
      ctx.body = { error: `会话「${threadId}」不存在或已过期` };
      return;
    }

    const surfaceId = action.surfaceId || session.surfaceId;
    const startedAt = Date.now();

    try {
      const outcome = await deps.actions.handle(
        { ...action, surfaceId },
        { sessionId: threadId, surfaceId, now: new Date() },
      );

      if (outcome.messages.length > 0) {
        // activate: false —— 动作只改当前界面，不该改变「下一轮往哪个 surface 上改」。
        deps.sessions.recordSurface(session, surfaceId, outcome.messages, { activate: false });
      }

      ctx.body = {
        threadId,
        surfaceId,
        handledBy: outcome.handledBy,
        messageCount: outcome.messages.length,
        elapsedMs: Date.now() - startedAt,
        messages: outcome.messages,
      };
    } catch (error) {
      // 单个 handler 失败不该让整条交互断掉：回 200 + 空消息 + error，客户端可继续操作。
      ctx.body = {
        threadId,
        surfaceId,
        handledBy: 'error',
        messageCount: 0,
        elapsedMs: Date.now() - startedAt,
        messages: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /** 生成缓存回放：客户端刷新后据此恢复界面，不必重新问模型。 */
  router.get('/api/a2ui/session/:threadId', (ctx) => {
    const session = deps.sessions.get(ctx.params.threadId);
    if (!session) {
      ctx.status = 404;
      ctx.body = { error: `会话「${ctx.params.threadId}」不存在或已过期` };
      return;
    }
    ctx.body = deps.sessions.snapshot(session);
  });

  /**
   * 模型对话：**只跟模型说话，不产出任何 A2UI 协议**。
   *
   * 存在的意义是「排掉变量地验证模型链接」—— baseURL / Key / 模型名 三者只要有一个不对，
   * 协议那条路会以各种形态失败（抽不到消息、502、空产出），很难一眼看出是配置问题。
   * 这里直接返回模型原话，对了就是对了。
   *
   * 与 `/run` 一样是「单入口 + query 分流」：缺省 SSE（AG-UI 的文本消息事件），
   * `?stream=false` 一次性 JSON。**入参非法与未配 Key 都在开流之前返回**（400 / 503）。
   *
   * **无状态**：不写会话缓存、不动任何 surface —— 它是另一条独立的路，与 A2UI 那条互不影响。
   */
  router.post('/api/a2ui/chat', async (ctx) => {
    requireModelKey(deps);

    const normalized = normalizeChatRequest(ctx.request.body, deps.config.chatSystemPrompt);
    const body = ctx.request.body as { threadId?: unknown; runId?: unknown };
    const threadId = typeof body?.threadId === 'string' && body.threadId !== '' ? body.threadId : createChatThreadId();
    const runId = typeof body?.runId === 'string' && body.runId !== '' ? body.runId : createRunId();

    if (wantsStream(ctx)) {
      await pipeSse(
        ctx,
        runChatStream({
          source: deps.chat.stream(normalized.messages),
          threadId,
          runId,
          model: deps.chat.model,
        }),
      );
      return;
    }

    const startedAt = Date.now();
    const reply = await deps.chat.complete(normalized.messages);
    ctx.body = { reply, model: deps.chat.model, elapsedMs: Date.now() - startedAt };
  });
};
