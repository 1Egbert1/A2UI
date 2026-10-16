/**
 * 测试共用的装配与工具。
 *
 * 抽出来最实在的理由：`ServerConfig` 每加一个字段，所有自己拼配置的 spec 都会编译失败 ——
 * 新增 `scenarioChunkSize` 与 `chatSystemPrompt` 时各崩过一轮，每次都要改四个文件。
 * 现在配置只在 `makeConfig` 里造，加字段只改这一处。
 *
 * `listen()` 走的是**同一条** `createApp()` 装配路径（不是测试专用的中间件组合），
 * 所以它起出来的服务与 `pnpm dev` 起的行为一致。
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgUiEvent } from '../src/agui/events';
import { createApp, type AppOptions } from '../src/app';
import type { ServerConfig } from '../src/config';

export const makeConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 0,
  agentProvider: 'mock',
  openai: {
    apiKey: '',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    temperature: 0.2,
  },
  historyLimit: 12,
  sessionTtlMs: 0,
  mockStreamDelayMs: 0,
  scenarioChunkSize: 50,
  chatSystemPrompt: '你是一个乐于助人的中文助手。',
  ...overrides,
});

/** 起一个临时端口（0 = 由内核分配），测试完自己关掉。 */
export const listen = (
  config: ServerConfig,
  options: Omit<AppOptions, 'config'> = {},
): { server: Server; base: string } => {
  const { app } = createApp({ config, logger: false, ...options });
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

export const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

export const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * 把 SSE 响应体拆成事件数组（流会自然结束，直接读全文即可）。
 *
 * 泛型而不是写死 `AgUiEvent`：场景字符流的事件是另一套形状，但分帧规则完全一样。
 */
export const readSseEvents = async <T>(response: Response): Promise<T[]> => {
  const body = await response.text();
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as T);
};

/** 取出所有 `CUSTOM a2ui.message` 携带的协议消息。 */
export const a2uiMessages = (events: AgUiEvent[]): unknown[] =>
  events
    .filter(
      (event): event is Extract<AgUiEvent, { type: 'CUSTOM' }> =>
        event.type === 'CUSTOM' && event.name === 'a2ui.message',
    )
    .map((event) => event.value);

/** 取出 `CUSTOM a2ui.surface` 的载荷（会话/界面/provider 元信息）。 */
export const surfaceEvent = (events: AgUiEvent[]): Record<string, unknown> | undefined =>
  events.find(
    (event): event is Extract<AgUiEvent, { type: 'CUSTOM' }> =>
      event.type === 'CUSTOM' && event.name === 'a2ui.surface',
  )?.value as Record<string, unknown> | undefined;
