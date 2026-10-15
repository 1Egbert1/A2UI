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
 */
import { Readable } from 'node:stream';
import type Router from 'koa-router';
import type { A2UIAgent } from '../agent';
import { encodeSse, runA2UIStream, type AgUiEvent } from '../agui';
import type { ServerConfig } from '../config';
import { createRunId, normalizeGenerateRequest } from '../inbound';
import type { SessionState, SessionStore } from '../session';
import type { AgentRequest, AgentResult } from '../types';

export interface RouteDeps {
  config: ServerConfig;
  agent: A2UIAgent;
  sessions: SessionStore;
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
  sessions: number;
}

/** 把一次请求规整成「会话 + agent 请求 + runId」。两条传输路径共用。 */
const prepare = (deps: RouteDeps, body: unknown): PreparedRun => {
  const normalized = normalizeGenerateRequest(body);
  const session = deps.sessions.getOrCreate(normalized.sessionId, normalized.surfaceId);

  return {
    session,
    runId: normalized.runId ?? createRunId(),
    request: {
      message: normalized.message,
      // 已有会话以自己的活跃 surface 为准（见 SessionStore.getOrCreate 的注释）。
      surfaceId: session.surfaceId,
      history: [...session.history],
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
  deps.sessions.recordSurface(session, request.surfaceId, result.messages);
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

/** SSE 传输：AG-UI 事件流。 */
const respondSse = (
  ctx: Router.RouterContext,
  deps: RouteDeps,
  prepared: PreparedRun,
): void => {
  const { session, request, runId } = prepared;

  ctx.status = 200;
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  // 让反向代理（nginx 等）不要缓冲，否则「流式」会被攒成一整块再吐出去。
  ctx.set('X-Accel-Buffering', 'no');

  const stream = Readable.from(
    toSse(
      runA2UIStream({
        agent: deps.agent,
        request,
        threadId: session.sessionId,
        runId,
        onFinish: (result) => commit(deps, session, request, result),
      }),
    ),
  );

  // 客户端断开时主动销毁：否则 agent 会继续为「没人在听」的连接生成下去。
  ctx.req.on('close', () => stream.destroy());
  // 兜住流自身的错误，避免未处理的 'error' 事件把进程带崩（Koa 之后还会再处理一次）。
  stream.on('error', (error) => ctx.onerror(error));

  ctx.body = stream;
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

/** AG-UI 事件 → SSE 帧。 */
const toSse = async function* (events: AsyncGenerator<AgUiEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    yield encodeSse(event);
  }
};

export const registerRoutes = (router: Router, deps: RouteDeps): void => {
  router.get('/health', (ctx) => {
    const body: HealthBody = {
      status: 'ok',
      provider: deps.agent.provider,
      model: deps.agent.provider === 'openai' ? deps.config.openai.model : 'mock',
      sessions: deps.sessions.size,
    };
    ctx.body = body;
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
};
