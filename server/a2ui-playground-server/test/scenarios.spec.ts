import { after, before, describe, it } from 'mocha';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AgUiEvent } from '../src/agui/events';
import { DEFAULT_SCENARIO_ID, SCENARIOS, getScenario, listScenarios } from '../src/scenarios';
import {
  a2uiMessages,
  close,
  listen,
  makeConfig,
  post,
  readSseEvents as readEvents,
  surfaceEvent,
} from './helpers';

const readSse = (response: Response): Promise<AgUiEvent[]> => readEvents<AgUiEvent>(response);

describe('scenarios / 注册表（纯数据）', () => {
  it('surfaceId 从 fixture 里读出来，而不是拿场景 id 顶替', () => {
    // 规则比某个具体场景重要：surfaceId 必须来自 fixture 首条 surfaceUpdate，不能拿 id 顶。
    // 曾经有过「直接用 id」的写法，那样 fixture 自带别的 surfaceId 时，客户端会去 treeMap
    // 找一个不存在的 key，渲染成空白。现在只剩一个场景（两者恰好同名），所以按不变量逐条校验。
    for (const scenario of SCENARIOS) {
      const first = scenario.messages[0] as unknown as { surfaceUpdate?: { surfaceId?: string } };
      assert.equal(
        scenario.surfaceId,
        first.surfaceUpdate?.surfaceId,
        `${scenario.id} 的 surfaceId 应来自 fixture 首条消息`,
      );
    }
    assert.equal(getScenario('weather')?.surfaceId, 'weather');
  });

  it('每个场景的 messages 与 lines 一一对应', () => {
    for (const scenario of SCENARIOS) {
      assert.ok(scenario.lines.length > 0, `${scenario.id} 应该至少有一条消息`);
      assert.equal(scenario.messages.length, scenario.lines.length);
      assert.equal(scenario.lines[0], JSON.stringify(scenario.messages[0]));
    }
  });

  it('列表只暴露客户端要的字段，且默认场景在列表里', () => {
    const list = listScenarios();

    assert.equal(list.length, SCENARIOS.length);
    assert.deepEqual(Object.keys(list[0]).sort(), ['desc', 'id', 'messageCount', 'surfaceId']);
    assert.ok(
      list.some((item) => item.id === DEFAULT_SCENARIO_ID),
      `默认场景 ${DEFAULT_SCENARIO_ID} 必须在列表里`,
    );
  });
});

describe('scenarios / 接口', () => {
  let server: Server;
  let base = '';

  before(() => {
    ({ server, base } = listen(makeConfig()));
  });

  after(() => close(server));

  it('GET /api/a2ui/scenarios 返回全部场景与默认项', async () => {
    const response = await fetch(`${base}/api/a2ui/scenarios`);
    const body = (await response.json()) as {
      scenarios: Array<{ id: string; surfaceId: string; messageCount: number }>;
      defaultId: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.scenarios.length, SCENARIOS.length);
    assert.equal(body.defaultId, DEFAULT_SCENARIO_ID);
  });

  it('GET /api/a2ui/scenarios/:id 返回原始 fixture（一行一条）', async () => {
    const response = await fetch(`${base}/api/a2ui/scenarios/weather`);
    const body = (await response.json()) as {
      id: string;
      surfaceId: string;
      lines: string[];
    };

    assert.equal(response.status, 200);
    assert.equal(body.id, 'weather');
    assert.equal(body.surfaceId, 'weather');
    assert.deepEqual(body.lines, getScenario('weather')?.lines);
  });

  it('未知场景取 fixture 返回 404', async () => {
    const response = await fetch(`${base}/api/a2ui/scenarios/not-a-scenario`);

    assert.equal(response.status, 404);
  });

  it('场景经 SSE 跑出来的消息与 fixture 逐条一致', async () => {
    const response = await post(base, '/api/a2ui/run', {
      threadId: 'sc-e2e',
      scenario: 'weather',
    });
    const events = await readSse(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    // 关键断言：示例数据走的是真链路 —— 服务端把它拼成 JSONL、切块、再抽取回来，
    // 结果必须与素材一模一样，否则「演示用例等于真实用例」这句话就不成立。
    assert.deepEqual(a2uiMessages(events), getScenario('weather')?.messages);
  });

  it('a2ui.surface 给的 surfaceId 就是 fixture 自带那个', async () => {
    const response = await post(base, '/api/a2ui/run', {
      threadId: 'sc-surface',
      scenario: 'weather',
    });
    const value = surfaceEvent(await readSse(response));

    assert.equal(value?.surfaceId, 'weather');
    assert.equal(value?.provider, 'mock');
  });

  it('未知场景 → 开流之前就 400', async () => {
    const response = await post(base, '/api/a2ui/run', {
      threadId: 'sc-bad',
      scenario: 'not-a-scenario',
    });

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  });

  it('只有 scenario、没有 message 也能跑（入参三选一）', async () => {
    const response = await post(base, '/api/a2ui/run?stream=false', {
      threadId: 'sc-only',
      scenario: 'weather',
    });
    const body = (await response.json()) as { messages: unknown[] };

    assert.equal(response.status, 200);
    assert.deepEqual(body.messages, getScenario('weather')?.messages);
  });

  it('场景不夺走对话会话的活跃 surface', async () => {
    // 先用一句话开一个会话，记下它的活跃 surface。
    const first = await post(base, '/api/a2ui/run?stream=false', {
      threadId: 'sc-mixed',
      message: '先做一个界面',
    });
    const created = (await first.json()) as { surfaceId: string };

    // 同一个 thread 上跑一个场景。
    await post(base, '/api/a2ui/run?stream=false', {
      threadId: 'sc-mixed',
      scenario: 'weather',
    });

    const snapshot = (await (
      await fetch(`${base}/api/a2ui/session/sc-mixed`)
    ).json()) as { surfaceId: string; surfaces: Array<{ surfaceId: string }> };

    // 场景消息进了缓存，但活跃 surface 还是对话那个 —— 否则再发一句话就画到示例界面上去了。
    assert.equal(snapshot.surfaceId, created.surfaceId);
    assert.ok(snapshot.surfaces.some((item) => item.surfaceId === 'weather'));
  });
});

describe('scenarios / 与当前 provider 无关', () => {
  let server: Server;
  let base = '';

  before(() => {
    // 配了 openai（给个假 Key，代码路径只会在真的调用模型时才用到它）。
    ({ server, base } = listen(
      makeConfig({
        agentProvider: 'openai',
        openai: { apiKey: 'sk-not-used-for-scenarios', baseURL: undefined, model: 'gpt-4o-mini', temperature: 0.2 },
      }),
    ));
  });

  after(() => close(server));

  it('openai 配置下场景仍走 fixture，provider 如实回 mock', async () => {
    const response = await post(base, '/api/a2ui/run', {
      threadId: 'sc-openai',
      scenario: 'weather',
    });
    const events = await readSse(response);

    // 场景是内置素材、不是模型产出。若这里落到真实模型，模型会收到一条空输入然后自由发挥，
    // 出来的东西和 fixture 毫无关系 —— 所以无论配的哪个 provider，场景都必须走 fixture。
    assert.deepEqual(a2uiMessages(events), getScenario('weather')?.messages);
    assert.equal(surfaceEvent(events)?.provider, 'mock');
  });
});
