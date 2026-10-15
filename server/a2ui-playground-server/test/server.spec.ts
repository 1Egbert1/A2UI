import { after, before, describe, it } from 'mocha';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import type { AgUiEvent } from '../src/agui/events';
import type { ServerConfig } from '../src/config';

const config: ServerConfig = {
  port: 0,
  agentProvider: 'mock',
  openai: { apiKey: '', baseURL: undefined, model: 'gpt-4o-mini', temperature: 0.2 },
  historyLimit: 12,
  sessionTtlMs: 0,
  mockStreamDelayMs: 0,
};

let server: Server;
let base = '';

const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** 把 SSE 响应体拆成事件数组（流会自然结束，直接读全文即可）。 */
const readSse = async (response: Response): Promise<AgUiEvent[]> => {
  const body = await response.text();
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as AgUiEvent);
};

const a2uiMessages = (events: AgUiEvent[]) =>
  events
    .filter(
      (event): event is Extract<AgUiEvent, { type: 'CUSTOM' }> =>
        event.type === 'CUSTOM' && event.name === 'a2ui.message',
    )
    .map((event) => event.value);

describe('server / 端到端（mock agent）', () => {
  before(() => {
    const { app } = createApp({ config, logger: false });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  it('GET /health 报出当前 provider', async () => {
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as { status: string; provider: string };

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.provider, 'mock');
  });

  it('POST /api/a2ui/run 走 SSE，事件序列符合 AG-UI', async () => {
    const response = await post('/api/a2ui/run', { message: '做一个购物车' });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const events = await readSse(response);
    const types = events.map((event) => event.type);

    assert.equal(types[0], 'RUN_STARTED');
    assert.equal(types.at(-1), 'RUN_FINISHED');
    assert.ok(types.includes('TEXT_MESSAGE_CONTENT'));
    assert.equal(a2uiMessages(events).length, 3);
  });

  it('接受 AG-UI 的 RunAgentInput（threadId/runId 原样回显）', async () => {
    const response = await post('/api/a2ui/run', {
      threadId: 'thr-agui',
      runId: 'run-agui',
      messages: [{ id: 'm1', role: 'user', content: '来一个搜索表单' }],
    });

    const events = await readSse(response);
    const started = events[0] as Extract<AgUiEvent, { type: 'RUN_STARTED' }>;
    const finished = events.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;

    assert.equal(started.threadId, 'thr-agui');
    assert.equal(started.runId, 'run-agui');
    assert.equal(finished.runId, 'run-agui');
  });

  it('同一 threadId 的下一轮走增量：只回一条 surfaceUpdate，不再 beginRendering', async () => {
    const first = await readSse(
      await post('/api/a2ui/run', { threadId: 'thr-multi', message: '第一轮' }),
    );
    const second = await readSse(
      await post('/api/a2ui/run', { threadId: 'thr-multi', message: '把标题改一下' }),
    );

    assert.equal(a2uiMessages(first).length, 3);
    const secondMessages = a2uiMessages(second) as Array<Record<string, unknown>>;
    assert.equal(secondMessages.length, 1);
    assert.ok('surfaceUpdate' in secondMessages[0]);
    assert.ok(!secondMessages.some((message) => 'beginRendering' in message));
  });

  it('会话缓存累积两轮共 4 条消息，且 surface 不变', async () => {
    const response = await fetch(`${base}/api/a2ui/session/thr-multi`);
    const snapshot = (await response.json()) as {
      sessionId: string;
      surfaceId: string;
      surfaces: Array<{ surfaceId: string; messages: unknown[] }>;
      history: Array<{ role: string }>;
    };

    assert.equal(response.status, 200);
    assert.equal(snapshot.sessionId, 'thr-multi');
    assert.equal(snapshot.surfaces.length, 1);
    assert.equal(snapshot.surfaces[0].messages.length, 4);
    // 两轮对话 → user/assistant 各两条。
    assert.deepEqual(
      snapshot.history.map((turn) => turn.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
  });

  it('POST /api/a2ui/generate 返回一次性 JSON', async () => {
    const response = await post('/api/a2ui/generate', { message: '来一个登录表单' });
    const body = (await response.json()) as {
      sessionId: string;
      surfaceId: string;
      messages: Array<Record<string, unknown>>;
      provider: string;
      warnings: string[];
    };

    assert.equal(response.status, 200);
    assert.equal(body.provider, 'mock');
    assert.equal(body.messages.length, 3);
    assert.deepEqual(body.warnings, []);
    assert.match(body.sessionId, /^session-/);
  });

  it('POST /api/a2ui/run?stream=false 走一次性 JSON（同一接口的另一种传输）', async () => {
    const response = await post('/api/a2ui/run?stream=false', { message: '做一个购物车' });
    const body = (await response.json()) as {
      messages: Array<Record<string, unknown>>;
      provider: string;
    };

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(body.provider, 'mock');
    assert.equal(body.messages.length, 3);
  });

  it('?stream 的关闭取值宽松（0/no/off），开启值仍走 SSE', async () => {
    const off = await post('/api/a2ui/run?stream=0', { message: '来一个表格' });
    assert.match(off.headers.get('content-type') ?? '', /application\/json/);

    const on = await post('/api/a2ui/run?stream=true', { message: '来一个表格' });
    assert.match(on.headers.get('content-type') ?? '', /text\/event-stream/);
    // 必须读完：SSE 响应体不消费的话，连接会一直挂着，after() 里的 server.close 就等不到。
    await on.text();
  });

  it('?stream=false 与 /api/a2ui/generate 是同一件事（响应形状一致）', async () => {
    const viaQuery = await post('/api/a2ui/run?stream=false', { message: '做一个表单' });
    const viaAlias = await post('/api/a2ui/generate', { message: '做一个表单' });

    const a = (await viaQuery.json()) as Record<string, unknown>;
    const b = (await viaAlias.json()) as Record<string, unknown>;

    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  });

  it('?stream=false 下入参非法同样是 400，且不会退回流', async () => {
    const response = await post('/api/a2ui/run?stream=false', {});

    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  });

  it('入参非法在开流之前就返回 400（符合 AG-UI：run 未开始不能给事件流）', async () => {
    const response = await post('/api/a2ui/run', {});
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.match(body.error, /至少提供一个/);
  });

  it('未知会话返回 404', async () => {
    const response = await fetch(`${base}/api/a2ui/session/does-not-exist`);
    assert.equal(response.status, 404);
  });

  it('未知路由返回 JSON 404', async () => {
    const response = await fetch(`${base}/nope`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not Found', path: '/nope' });
  });

  it('CORS 预检就地返回 204（跨域 SSE 必须先过这一关）', async () => {
    const response = await fetch(`${base}/api/a2ui/run`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});
