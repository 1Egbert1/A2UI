import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { createA2UIAgent } from '../src/agent';
import { A2UI_CUSTOM_EVENT, encodeSse, type AgUiEvent } from '../src/agui/events';
import { runA2UIStream } from '../src/agui/run';
import type { A2UIAgent } from '../src/agent';
import type { AgentProvider, AgentRequest, AgentStreamChunk, A2UIMessage } from '../src/types';
import { makeConfig as configOf } from './helpers';

const requestOf = (): AgentRequest => ({ message: '做一个购物车', surfaceId: 'sf-1', history: [] });

/** 用一个「只会流」的假 agent 精确摆布事件序列。 */
const scriptedAgent = (
  provider: AgentProvider,
  stream: () => AsyncGenerator<AgentStreamChunk>,
): A2UIAgent => ({
  provider,
  // 这个 stub 不区分场景，所以两个 provider 读取口报同一个值即可。
  providerFor: () => provider,
  generate: async () => {
    throw new Error('本测试不使用 generate');
  },
  stream,
});

const collect = async (agent: A2UIAgent, request = requestOf()) => {
  const events: AgUiEvent[] = [];
  const finishes: Array<{ messages: A2UIMessage[]; raw: string }> = [];

  for await (const event of runA2UIStream({
    agent,
    request,
    threadId: 'thr-1',
    runId: 'run-1',
    now: () => 1_700_000_000_000,
    onFinish: (result) => finishes.push(result),
  })) {
    events.push(event);
  }

  return { events, finishes, types: events.map((event) => event.type) };
};

const mockAgent = (): A2UIAgent => createA2UIAgent(configOf());

describe('agui / encodeSse', () => {
  it('一帧 = 一行 data: + 空行，且载荷是单行 JSON', () => {
    const frame = encodeSse({
      type: 'RUN_STARTED',
      threadId: 'thr-1',
      runId: 'run-1',
    });

    assert.ok(frame.startsWith('data: '));
    assert.ok(frame.endsWith('\n\n'));
    // 载荷里不能出现换行，否则 SSE 会把它当成多行 data 拼接。
    assert.equal(frame.split('\n').length, 3);
    assert.deepEqual(JSON.parse(frame.slice(6).trim()), {
      type: 'RUN_STARTED',
      threadId: 'thr-1',
      runId: 'run-1',
    });
  });
});

describe('agui / runA2UIStream 正常路径', () => {
  it('事件顺序：RUN_STARTED → surface → 文本 → 消息 → RUN_FINISHED', async () => {
    const { events, types, finishes } = await collect(mockAgent());

    assert.equal(types[0], 'RUN_STARTED');
    assert.equal(types[1], 'CUSTOM');
    assert.equal(types.at(-1), 'RUN_FINISHED');

    const surface = events[1] as Extract<AgUiEvent, { type: 'CUSTOM' }>;
    assert.equal(surface.name, A2UI_CUSTOM_EVENT.surface);
    assert.deepEqual(surface.value, { threadId: 'thr-1', surfaceId: 'sf-1', provider: 'mock' });

    // 文本消息必须先 START 再 CONTENT，最后 END。
    assert.equal(types.indexOf('TEXT_MESSAGE_START') < types.indexOf('TEXT_MESSAGE_CONTENT'), true);
    assert.equal(types.indexOf('TEXT_MESSAGE_END') > types.indexOf('TEXT_MESSAGE_CONTENT'), true);
    assert.equal(types.filter((type) => type === 'TEXT_MESSAGE_END').length, 1);

    // 每条 A2UI 消息一个 CUSTOM 事件，且在 RUN_FINISHED 之前。
    const a2uiEvents = events.filter(
      (event): event is Extract<AgUiEvent, { type: 'CUSTOM' }> =>
        event.type === 'CUSTOM' && event.name === A2UI_CUSTOM_EVENT.message,
    );
    assert.equal(a2uiEvents.length, 3);
    assert.ok(types.lastIndexOf('CUSTOM') < types.indexOf('RUN_FINISHED'));

    const finished = events.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;
    assert.equal(finished.threadId, 'thr-1');
    assert.equal(finished.runId, 'run-1');
    assert.equal((finished.result as { messageCount: number }).messageCount, 3);

    // onFinish 恰好一次，且带的是同一批消息。
    assert.equal(finishes.length, 1);
    assert.deepEqual(finishes[0].messages, a2uiEvents.map((event) => event.value));
  });

  it('所有事件共用注入的时钟', async () => {
    const { events } = await collect(mockAgent());
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.equal(event.timestamp, 1_700_000_000_000);
    }
  });

  it('一个字都没吐时不会留下空的文本消息', async () => {
    const agent = scriptedAgent('mock', async function* () {
      yield { message: { beginRendering: { surfaceId: 'sf-1', root: 'root' } } };
    });

    const { types, events } = await collect(agent);

    assert.ok(!types.includes('TEXT_MESSAGE_START'));
    assert.ok(!types.includes('TEXT_MESSAGE_END'));
    assert.equal(types.at(-1), 'RUN_FINISHED');
    assert.equal((events.at(-1) as { result: { messageCount: number } }).result.messageCount, 1);
  });
});

describe('agui / runA2UIStream 失败路径', () => {
  it('agent 抛错：已开文本消息会被闭合，然后 RUN_ERROR', async () => {
    const agent = scriptedAgent('mock', async function* () {
      yield { delta: '{"beginRendering":' };
      throw new Error('模型连接断开');
    });

    const { types, events, finishes } = await collect(agent);

    assert.equal(types.at(-1), 'RUN_ERROR');
    assert.ok(types.includes('TEXT_MESSAGE_END'));
    assert.equal(types.indexOf('TEXT_MESSAGE_END'), types.length - 2);

    const error = events.at(-1) as Extract<AgUiEvent, { type: 'RUN_ERROR' }>;
    assert.equal(error.message, '模型连接断开');
    assert.equal(error.code, 'AGENT_ERROR');

    // 出错也要落库（部分消息对用户仍然可见，不能丢）。
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].messages.length, 0);
    assert.equal(finishes[0].raw, '{"beginRendering":');
  });

  it('有文字但抽不出协议消息：以 EMPTY_OUTPUT 收场，不能假装成功', async () => {
    const agent = scriptedAgent('openai', async function* () {
      yield { delta: '好的，我来帮你生成一个购物车界面。' };
    });

    const { types, events } = await collect(agent);

    assert.equal(types.at(-1), 'RUN_ERROR');
    assert.ok(!types.includes('RUN_FINISHED'));
    const error = events.at(-1) as Extract<AgUiEvent, { type: 'RUN_ERROR' }>;
    assert.equal(error.code, 'EMPTY_OUTPUT');
  });

  it('完全静默：错误信息说明「没有产出任何输出」', async () => {
    const agent = scriptedAgent('openai', async function* () {
      // 什么都不吐
    });

    const { events } = await collect(agent);
    const error = events.at(-1) as Extract<AgUiEvent, { type: 'RUN_ERROR' }>;

    assert.equal(error.message, 'agent 没有产出任何输出');
  });

  it('坏行以 CUSTOM a2ui.warning 下发，且不打断这一轮', async () => {
    const agent = scriptedAgent('openai', async function* () {
      yield { warning: 'JSON 解析失败 — Expecting \',\' delimiter' };
      yield { message: { beginRendering: { surfaceId: 'sf-1', root: 'root' } } };
    });

    const { events, types } = await collect(agent);

    const warning = events.find(
      (event): event is Extract<AgUiEvent, { type: 'CUSTOM' }> =>
        event.type === 'CUSTOM' && event.name === A2UI_CUSTOM_EVENT.warning,
    );
    assert.ok(warning, '坏行必须以 CUSTOM a2ui.warning 下发');
    assert.match(String((warning.value as { message?: unknown }).message), /JSON 解析失败/);

    // 坏行**不打断这一轮**：后面那条消息照样下发，收尾仍是 RUN_FINISHED。
    // （静默丢掉才是错的：模型少写一个括号，整棵组件树消失而客户端毫不知情。）
    assert.equal(types.includes('RUN_FINISHED'), true);
    assert.equal(types.at(-1), 'RUN_FINISHED');
  });
});
