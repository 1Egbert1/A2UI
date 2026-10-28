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
import { createActionRouter, type ActionRouter } from './actions';
import { createModelChat, type ModelChat } from './chat';
import { loadConfig, type ServerConfig } from './config';
import { BadRequestError, ServiceUnavailableError } from './inbound';
import { registerRoutes } from './routes';
import { SessionStore } from './session';

export interface AppOptions {
  config?: ServerConfig;
  agent?: A2UIAgent;
  /** 纯模型对话（`/api/a2ui/chat`）。测试可注入替身，从而不必真打模型。 */
  chat?: ModelChat;
  sessions?: SessionStore;
  /** 动作路由。测试可注入已注册 handler 的实例，从而验证自定义业务动作。 */
  actions?: ActionRouter;
  /** 设为 false 关掉请求日志（测试里免得刷屏）。 */
  logger?: boolean;
}

export interface AppParts {
  app: Koa;
  config: ServerConfig;
  agent: A2UIAgent;
  chat: ModelChat;
  sessions: SessionStore;
  actions: ActionRouter;
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

    // 依赖没就绪（如没配模型 Key）：请求本身没问题，别报 400 让客户端去改请求体。
    if (error instanceof ServiceUnavailableError) {
      ctx.status = 503;
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
  // 对话客户端总是按配置构造（哪怕 A2UI 那条走 mock）：它的用途就是验证模型链接。
  // 没配 Key 时它照样能造出来，只是路由层会先挡下 503 —— 报错集中在请求时，启动不炸。
  const chat = options.chat ?? createModelChat(config.openai);
  // 默认一个 handler 都不注册：所有点击都走 fallback 回执（写 `__lastAction`），
  // 「点一下有反应」这件事不依赖业务方接入。业务动作由集成方 `register` 覆盖。
  const actions = options.actions ?? createActionRouter();

  const app = new Koa();
  const router = new Router();

  if (options.logger !== false) {
    app.use(requestLogger);
  }
  app.use(errorHandler);
  app.use(cors);
  app.use(bodyParser());
  registerRoutes(router, { config, agent, chat, sessions, actions });
  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(notFound);

  return { app, config, agent, chat, sessions, actions };
};
