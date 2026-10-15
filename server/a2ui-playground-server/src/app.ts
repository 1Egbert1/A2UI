/**
 * Koa 应用装配。
 *
 * 区别于 `index.ts`：这里只**造**应用，不监听端口 —— 于是测试可以拿同一条装配路径
 * 起一个临时端口的服务来打，不用另写一套「测试专用」的中间件组合。
 *
 * 中间件顺序是有讲究的（外 → 内）：
 *   logger       最外层：只有它在 `next()` 之外，才能读到**最终**状态码；
 *   errorHandler 次外层：把下游抛出的异常统一转成 JSON 响应；
 *   cors / bodyParser / router / notFound
 */
import { Readable } from 'node:stream';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import { createA2UIAgent, type A2UIAgent } from './agent';
import { loadConfig, type ServerConfig } from './config';
import { BadRequestError } from './inbound';
import { registerRoutes } from './routes';
import { SessionStore } from './session';

export interface AppOptions {
  config?: ServerConfig;
  agent?: A2UIAgent;
  sessions?: SessionStore;
  /** 设为 false 关掉请求日志（测试里免得刷屏）。 */
  logger?: boolean;
}

export interface AppParts {
  app: Koa;
  config: ServerConfig;
  agent: A2UIAgent;
  sessions: SessionStore;
}

/**
 * 开发期 CORS：回显 Origin，不放开凭据。
 *
 * SSE 是「POST + text/event-stream」，属于需要预检的跨域请求，
 * 所以 OPTIONS 必须能就地返回 204，否则浏览器根本发不出那一次 POST。
 */
const cors = async (ctx: Koa.Context, next: Koa.Next): Promise<void> => {
  ctx.set('Access-Control-Allow-Origin', ctx.get('Origin') || '*');
  ctx.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  await next();
};

const errorHandler = async (ctx: Koa.Context, next: Koa.Next): Promise<void> => {
  try {
    await next();
  } catch (error) {
    // 响应头已经发出去了（比如 SSE 流中途出错），此时改不了状态码，
    // 只能交给 Koa 的 error 事件记日志。
    if (ctx.headerSent) {
      ctx.app.emit('error', error, ctx);
      return;
    }

    if (error instanceof BadRequestError) {
      ctx.status = 400;
      ctx.body = { error: error.message };
      return;
    }

    ctx.status = 500;
    ctx.body = { error: error instanceof Error ? error.message : '服务端内部错误' };
    ctx.app.emit('error', error, ctx);
  }
};

const requestLogger = async (ctx: Koa.Context, next: Koa.Next): Promise<void> => {
  const startedAt = Date.now();
  await next();
  // SSE 的耗时是「到响应头」的耗时：body 是流，pipe 完要等很久，
  // 把整段时间算进来会让日志看起来像卡死了。
  const suffix = ctx.body instanceof Readable ? ' (stream)' : '';
  console.log(`${ctx.method} ${ctx.path} → ${ctx.status} (${Date.now() - startedAt}ms)${suffix}`);
};

const notFound = (ctx: Koa.Context): void => {
  if (ctx.status === 404 && ctx.body == null) {
    ctx.body = { error: 'Not Found', path: ctx.path };
    // 必须显式再钉一次状态码：Koa 的 body setter 会把「未显式设置过状态码」的响应改成 200，
    // 不补这一行，未匹配的路由会以 200 + {"error":"Not Found"} 返回。
    ctx.status = 404;
  }
};

export const createApp = (options: AppOptions = {}): AppParts => {
  const config = options.config ?? loadConfig();
  const sessions =
    options.sessions ??
    new SessionStore({ historyLimit: config.historyLimit, ttlMs: config.sessionTtlMs });
  const agent = options.agent ?? createA2UIAgent(config);

  const app = new Koa();
  const router = new Router();

  if (options.logger !== false) {
    app.use(requestLogger);
  }
  app.use(errorHandler);
  app.use(cors);
  app.use(bodyParser());
  registerRoutes(router, { config, agent, sessions });
  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(notFound);

  return { app, config, agent, sessions };
};
