import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { createA2UIAgent } from '../src/agent';
import { buildChatMessages } from '../src/agent/messages';
import { buildMockMessages, chunkText, createMockAgent, messagesToText } from '../src/agent/mock';
import { buildSystemPrompt } from '../src/agent/prompt';
import type { ServerConfig } from '../src/config';
import type { AgentRequest, A2UIMessage } from '../src/types';

const configOf = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 0,
  agentProvider: 'mock',
  openai: { apiKey: '', baseURL: undefined, model: 'gpt-4o-mini', temperature: 0.2 },
  historyLimit: 12,
  sessionTtlMs: 0,
  mockStreamDelayMs: 0,
  ...overrides,
});

const requestOf = (overrides: Partial<AgentRequest> = {}): AgentRequest => ({
  message: '做一个购物车',
  surfaceId: 'sf-1',
  history: [],
  ...overrides,
});

describe('agent / provider 选择', () => {
  it('默认走 mock', () => {
    assert.equal(createA2UIAgent(configOf()).provider, 'mock');
  });

  it('显式配 openai 却没 Key：启动就报错，不留到运行期', () => {
    assert.throws(
      () => createA2UIAgent(configOf({ agentProvider: 'openai' })),
      /OPENAI_API_KEY/,
    );
  });
});

describe('agent / mock 的产出', () => {
  it('首轮产出「组件 → 数据 → 开始渲染」三条消息', () => {
    const messages = buildMockMessages(requestOf());

    assert.equal(messages.length, 3);
    assert.ok('surfaceUpdate' in messages[0]);
    assert.ok('dataModelUpdate' in messages[1]);
    assert.deepEqual(messages[2], { beginRendering: { surfaceId: 'sf-1', root: 'root' } });
  });

  it('后续轮次只回一条增量 surfaceUpdate，且不再 beginRendering', () => {
    const messages = buildMockMessages(
      requestOf({ history: [{ role: 'user', content: '上轮' }, { role: 'assistant', content: '[]' }] }),
    );

    assert.equal(messages.length, 1);
    assert.ok('surfaceUpdate' in messages[0]);
    // 增量只带被改的那个组件，不会把整棵树重发。
    const update = (messages[0] as { surfaceUpdate: { components: Array<{ id: string }> } })
      .surfaceUpdate;
    assert.deepEqual(update.components.map((component) => component.id), ['title']);
  });

  it('超长输入被截断，不会把标题撑爆', () => {
    const messages = buildMockMessages(requestOf({ message: 'x'.repeat(200) }));
    const update = messages[0] as unknown as {
      surfaceUpdate: { components: Array<{ component: { Text: { text: { literalString: string } } } }> };
    };

    assert.ok(update.surfaceUpdate.components[1].component.Text.text.literalString.endsWith('…'));
    assert.ok(update.surfaceUpdate.components[1].component.Text.text.literalString.length <= 61);
  });

  it('chunkText 切块可复原，且切点落在 JSON 内部', () => {
    const text = messagesToText(buildMockMessages(requestOf()));
    const chunks = chunkText(text, 97);

    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(''), text);
    // 第一块不是完整行 —— 说明确实切在了行中间，装配器是真被考验到的。
    assert.ok(!chunks[0].endsWith('\n'));
  });
});

describe('agent / 门面（抽取 + 流式装配）', () => {
  it('generate：mock 文本能被抽成协议消息，且无警告', async () => {
    const agent = createA2UIAgent(configOf());
    const result = await agent.generate(requestOf());

    assert.equal(result.provider, 'mock');
    assert.equal(result.messages.length, 3);
    assert.deepEqual(result.warnings, []);
  });

  it('stream：逐片 delta + 逐条 message，最终消息与 generate 完全一致', async () => {
    const agent = createA2UIAgent(configOf());
    const request = requestOf();

    const messages: A2UIMessage[] = [];
    let deltaText = '';

    for await (const chunk of agent.stream(request)) {
      if (chunk.delta) {
        deltaText += chunk.delta;
      }
      if (chunk.message) {
        messages.push(chunk.message);
      }
    }

    const oneShot = await agent.generate(request);

    // 两条路径共用同一套抽取规则，产出必须逐字节一致 —— 这是分层没走样的证据。
    assert.deepEqual(messages, oneShot.messages);
    assert.equal(deltaText, oneShot.raw);
  });

  it('stream 能在文本流结束前就吐出消息（边到边，而非攒完再给）', async () => {
    const agent = createA2UIAgent(configOf({ mockStreamDelayMs: 0 }));
    const order: string[] = [];

    for await (const chunk of agent.stream(requestOf())) {
      order.push(chunk.message ? 'message' : 'delta');
    }

    // 消息不可能全排在最后：第一块 message 之前必然已经有 delta，
    // 且第一个 message 之后还有 delta（说明后续块继续在流里）。
    const firstMessage = order.indexOf('message');
    assert.ok(firstMessage > 0);
    assert.ok(order.slice(firstMessage).includes('delta'));
  });

  it('mock agent 的 complete 与 stream 文本一致', async () => {
    const mock = createMockAgent();
    const request = requestOf();

    let streamed = '';
    for await (const chunk of mock.stream(request)) {
      streamed += chunk;
    }

    assert.equal(streamed, await mock.complete(request));
  });
});

describe('agent / 提示词', () => {
  it('system prompt 里带上目标 surfaceId 与四条输出硬约束', () => {
    const prompt = buildSystemPrompt('sf-42');

    assert.match(prompt, /sf-42/);
    assert.match(prompt, /只输出 JSONL/);
    assert.match(prompt, /beginRendering 在最后/);
    assert.match(prompt, /恰好包含一个顶层键/);
  });

  it('组件目录覆盖渲染器支持的全部 18 个组件', () => {
    const prompt = buildSystemPrompt('sf');

    for (const name of [
      'Text', 'Image', 'Icon', 'Video', 'AudioPlayer', 'Divider',
      'Row', 'Column', 'List', 'Card', 'Tabs', 'Modal',
      'Button', 'CheckBox', 'TextField', 'DateTimeInput', 'MultipleChoice', 'Slider',
    ]) {
      assert.match(prompt, new RegExp(`\\b${name}:`), `提示词缺少组件 ${name}`);
    }
  });

  it('chat messages：首轮不带增量约束，后续轮次把增量约束放进 user 消息', () => {
    const first = buildChatMessages(requestOf());
    assert.equal(first.length, 2);
    assert.match(first[1].content, /^做一个购物车$/);

    const later = buildChatMessages(
      requestOf({ history: [{ role: 'user', content: '上轮' }, { role: 'assistant', content: '[]' }] }),
    );
    assert.equal(later.length, 4);
    assert.equal(later[1].content, '上轮');
    assert.match(later[3].content, /这是对已有 surface「sf-1」的修改/);
    assert.match(later[3].content, /用户：做一个购物车/);
    // 增量约束不该污染 system。
    assert.doesNotMatch(later[0].content, /这是对已有 surface/);
  });
});
