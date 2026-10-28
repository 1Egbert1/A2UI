/**
 * 场景字符流接口（`GET /api/a2ui/scenarios/:id/stream`）的测试。
 *
 * 这条流是给客户端的 `createA2UIBuffer()` 出题的：**切片落在 JSON 任意位置**，一行里挤着
 * 多个组件，`beginRendering` 也不在行首。所以这里断言的重点不是「事件发出来了」，而是
 * **拼回来的东西与 fixture 等价** —— 一旦切片边界或量词出错，缓冲层再怎么补也补不回来。
 */
import { after, before, describe, it } from 'mocha';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { getScenario } from '../src/scenarios';
import type { ScenarioStreamEvent } from '../src/types';
import { close, listen, makeConfig, readSseEvents } from './helpers';

const readEvents = (response: Response): Promise<ScenarioStreamEvent[]> =>
  readSseEvents<ScenarioStreamEvent>(response);

const chunksOf = (events: ScenarioStreamEvent[]): string[] =>
  events.filter((event) => event.type === 'stream.chunk').map((event) => event.text);

const startedOf = (events: ScenarioStreamEvent[]): Extract<ScenarioStreamEvent, { type: 'stream.started' }> => {
  const event = events.find(
    (item): item is Extract<ScenarioStreamEvent, { type: 'stream.started' }> =>
      item.type === 'stream.started',
  );
  assert.ok(event, '事件序列里必须有 stream.started');
  return event;
};

/** 把 JSONL 文本里所有组件 id 收集出来（用于「拼回来与 fixture 等价」的断言）。 */
const componentIds = (text: string): string[] => {
  const ids: string[] = [];
  for (const line of text.split('\n').filter((item) => item !== '')) {
    const message = JSON.parse(line) as { surfaceUpdate?: { components: Array<{ id: string }> } };
    for (const component of message.surfaceUpdate?.components ?? []) {
      ids.push(component.id);
    }
  }
  return ids.sort();
};

describe('scenario stream / 事件序列', () => {
  let server: Server;
  let base = '';

  before(() => {
    ({ server, base } = listen(makeConfig()));
  });

  after(() => close(server));

  it('started → chunk × N → done，且片数与 totalChunks 一致', async () => {
    const response = await fetch(`${base}/api/a2ui/scenarios/weather/stream`);
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    assert.equal(events[0]?.type, 'stream.started');
    assert.equal(events.at(-1)?.type, 'stream.done');

    const started = startedOf(events);
    const chunks = events.filter((event) => event.type === 'stream.chunk');
    assert.equal(chunks.length, started.totalChunks);
    // 序号必须连续且从 0 起 —— 客户端不靠序号拼装（它直接顺序喂 buffer），
    // 但序号是排查「哪一片出的问题」的唯一线索，跳过一格就断线了。
    assert.deepEqual(
      chunks.map((event) => (event as Extract<ScenarioStreamEvent, { type: 'stream.chunk' }>).index),
      Array.from({ length: started.totalChunks }, (_, index) => index),
    );
  });

  it('started 报的字符总数与分片实际内容一致', async () => {
    const events = await readEvents(await fetch(`${base}/api/a2ui/scenarios/weather/stream`));
    const started = startedOf(events);
    const text = chunksOf(events).join('');

    assert.equal(text.length, started.totalChars);
    assert.equal(started.chunkSize, 50);
  });

  it('分片拼回来与 fixture 等价（组件集合完全一致）', async () => {
    const events = await readEvents(await fetch(`${base}/api/a2ui/scenarios/weather/stream`));
    const text = chunksOf(events).join('');
    const lines = text.split('\n').filter((line) => line !== '');

    // 每一行都必须是能解析的 JSON —— 切片拼错（少一个字符、多一个字符）在这里就会炸。
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `这一行不是合法 JSON：${line.slice(0, 60)}…`);
    }

    // 紧凑形态把多条 surfaceUpdate 合并了，但**组件一个都不能少**。这是「拼回来的东西
    // 与 fixture 等价」最实在的一条：缓冲区补全之后必然要与原素材的组件集合重合。
    const fixture = getScenario('weather');
    assert.ok(fixture);
    assert.deepEqual(componentIds(text), componentIds(fixture.lines.join('\n')));
  });

  it('surfaceId 走 fixture 自带那个（不是拿 id 顶替）', async () => {
    const events = await readEvents(await fetch(`${base}/api/a2ui/scenarios/weather/stream`));

    assert.equal(startedOf(events).surfaceId, 'weather');
  });
});

describe('scenario stream / 顺序与参数', () => {
  let server: Server;
  let base = '';

  before(() => {
    ({ server, base } = listen(makeConfig()));
  });

  after(() => close(server));

  it('默认 order=stream：beginRendering 紧随 root（第 2 条），不是最后一条', async () => {
    const events = await readEvents(await fetch(`${base}/api/a2ui/scenarios/weather/stream`));
    const lines = chunksOf(events).join('').split('\n').filter((line) => line !== '');

    assert.equal(startedOf(events).order, 'stream');
    assert.ok(JSON.parse(lines[1] as string).beginRendering, '第 2 行应该是 beginRendering');
    assert.equal(JSON.parse(lines.at(-1) as string).beginRendering, undefined);
  });

  it('order=protocol：原样下发（不丢不移，fixture 本身就是流式友好顺序）', async () => {
    const events = await readEvents(
      await fetch(`${base}/api/a2ui/scenarios/weather/stream?order=protocol`),
    );
    const lines = chunksOf(events).join('').split('\n').filter((line) => line !== '');
    const fixture = getScenario('weather');
    assert.ok(fixture);

    assert.equal(startedOf(events).order, 'protocol');

    // 契约不是「beginRendering 一定在最后」，那是老 fixture 的偶然形态。真正的契约是：
    // **protocol = fixture 原样相对顺序**（只把多条 surfaceUpdate 合并成一条）。
    // weather 的 fixture 已经是流式友好顺序（beginRendering 在第 2 条），所以它仍在第 2 行。
    const fixtureBeginAt = fixture.lines.findIndex((line) => JSON.parse(line).beginRendering !== undefined);
    assert.ok(fixtureBeginAt >= 0, 'fixture 里应该有 beginRendering');
    assert.ok(
      JSON.parse(lines[fixtureBeginAt] as string).beginRendering,
      `紧凑后 beginRendering 应仍在第 ${fixtureBeginAt + 1} 行`,
    );

    // 无论哪种 order，组件集合都不能少 —— 这是「原样下发」最实在的一条。
    assert.deepEqual(componentIds(lines.join('\n')), componentIds(fixture.lines.join('\n')));
  });

  it('?chunk= 覆盖块长，且每片不超长', async () => {
    const events = await readEvents(
      await fetch(`${base}/api/a2ui/scenarios/weather/stream?chunk=17`),
    );
    const started = startedOf(events);

    assert.equal(started.chunkSize, 17);
    assert.equal(started.totalChunks, Math.ceil(started.totalChars / 17));
    for (const chunk of chunksOf(events)) {
      assert.ok(chunk.length <= 17, `分片超长：${chunk.length}`);
    }
  });

  it('缺省块长取自配置', async () => {
    const short = listen(makeConfig({ scenarioChunkSize: 7 }));
    try {
      const events = await readEvents(
        await fetch(`${short.base}/api/a2ui/scenarios/weather/stream`),
      );
      assert.equal(startedOf(events).chunkSize, 7);
    } finally {
      await close(short.server);
    }
  });

  it('?delay= 真的把节奏拖慢（事件之间等了一下）', async function () {
    // weather 这份 fixture 有 20 条消息、几十 KB，按 50 字符一片要几百片，
    // 2ms/片 就是秒级 —— mocha 默认 2s 会误判成挂掉，这里显式放宽。
    this.timeout(30_000);
    const delayMs = 2;
    const started = Date.now();
    const events = await readEvents(
      await fetch(`${base}/api/a2ui/scenarios/weather/stream?delay=${delayMs}`),
    );
    const elapsed = Date.now() - started;
    const total = startedOf(events).totalChunks;

    assert.equal(startedOf(events).delayMs, delayMs);
    // 第一片不等，所以理论下限是 (N-1) × delay；Node 的 setTimeout 不会提前触发。
    assert.ok(
      elapsed >= (total - 1) * delayMs,
      `总耗时 ${elapsed}ms 小于理论下限 ${(total - 1) * delayMs}ms，说明延迟没生效`,
    );
  });
});

describe('scenario stream / 错误分支', () => {
  let server: Server;
  let base = '';

  before(() => {
    ({ server, base } = listen(makeConfig()));
  });

  after(() => close(server));

  /** 这些请求都不该开流：状态码是 4xx，响应体是 JSON 而不是 event-stream。 */
  const expectRejected = async (path: string, status: number): Promise<void> => {
    const response = await fetch(`${base}${path}`);

    assert.equal(response.status, status, `${path} 期望 ${status}`);
    assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
    assert.equal(response.headers.get('content-type')?.includes('event-stream'), false);
  };

  it('未知场景 → 404', async () => {
    await expectRejected('/api/a2ui/scenarios/not-a-scenario/stream', 404);
  });

  it('order 只认两个字面量 → 其它一律 400', async () => {
    await expectRejected('/api/a2ui/scenarios/weather/stream?order=nope', 400);
  });

  it('chunk / delay 非法（0、负数、非数字）→ 400', async () => {
    await expectRejected('/api/a2ui/scenarios/weather/stream?chunk=0', 400);
    await expectRejected('/api/a2ui/scenarios/weather/stream?chunk=abc', 400);
    await expectRejected('/api/a2ui/scenarios/weather/stream?chunk=1.5', 400);
    await expectRejected('/api/a2ui/scenarios/weather/stream?delay=-1', 400);
  });

  it('delay=0 合法（表示不限速）', async () => {
    const response = await fetch(`${base}/api/a2ui/scenarios/weather/stream?delay=0`);

    assert.equal(response.status, 200);
    assert.equal(startedOf(await readEvents(response)).delayMs, 0);
  });
});
