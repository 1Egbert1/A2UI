import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { assembleStream, createA2UIAgent } from '../src/agent';
import { buildChatMessages } from '../src/agent/messages';
import { buildMockMessages, chunkText, createMockAgent, messagesToText } from '../src/agent/mock';
import type { AgentImplementation } from '../src/agent/provider';
import { buildSystemPrompt } from '../src/agent/prompt';
import type { AgentRequest, A2UIMessage } from '../src/types';
import { makeConfig as configOf } from './helpers';

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
      streamed += chunk.content ?? '';
    }

    assert.equal(streamed, await mock.complete(request));
  });

  it('可修复的坏行（实测抓到的多括号案例）自动修复并采纳', async () => {
    // 这个坏行是**实测抓到的**：DeepSeek 把 surfaceUpdate 的括号多写了一个。
    // 过去它整条被丢掉、客户端却显示「已生成界面」，预览一片空白；现在 recoverJson 自动补好。
    const scripted: AgentImplementation = {
      name: 'openai',
      complete: async () => '',
      stream: async function* () {
        yield { content: '{"surfaceUpdate":{"surfaceId":"sf-1","components":[]}}}\n' };
        yield { content: '{"beginRendering":{"surfaceId":"sf-1","root":"root"}}\n' };
      },
    };

    const warnings: string[] = [];
    const produced: string[] = [];
    for await (const chunk of assembleStream(scripted.stream(requestOf()))) {
      if (chunk.warning) warnings.push(chunk.warning);
      if (chunk.message) produced.push(Object.keys(chunk.message)[0] ?? '');
    }

    // 修复后 surfaceUpdate 照常采纳，且不中断这一轮 —— 一次多括号不该毁掉整棵组件树。
    assert.match(warnings[0] ?? '', /多了一个 `}`/);
    assert.deepEqual(produced, ['surfaceUpdate', 'beginRendering']);
  });

  it('修不了的坏行变成 warning 上报，而不是静默丢掉', async () => {
    // 截断的半行：什么括号修复都救不回来，必须显式告警且不中断整轮。
    const scripted: AgentImplementation = {
      name: 'openai',
      complete: async () => '',
      stream: async function* () {
        yield { content: '{"surfaceUpdate":{"surfaceId":"sf-1","components":[{"id"\n' };
        yield { content: '{"beginRendering":{"surfaceId":"sf-1","root":"root"}}\n' };
      },
    };

    const warnings: string[] = [];
    const produced: string[] = [];
    for await (const chunk of assembleStream(scripted.stream(requestOf()))) {
      if (chunk.warning) warnings.push(chunk.warning);
      if (chunk.message) produced.push(Object.keys(chunk.message)[0] ?? '');
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /JSON 解析失败/);
    // 坏行**不中断这一轮**：后面的合法消息照样产出来（一次坏行不该毁掉整轮）。
    assert.deepEqual(produced, ['beginRendering']);
  });

  it('思考内容单独成片，且**不进抽取器**', async () => {
    // 造一个「先思考、再产出协议」的假 provider：这正是思考模式模型的真实形态。
    const scripted: AgentImplementation = {
      name: 'openai',
      complete: async () => '',
      stream: async function* () {
        yield { reasoning: '让我想想' };
        yield { reasoning: '，用户要一个购物车。' };
        yield { content: '{"beginRendering":{"surfaceId":"sf-1","root":"root"}}' };
      },
    };

    const chunks: string[] = [];
    const messages: string[] = [];
    for await (const chunk of assembleStream(scripted.stream(requestOf()))) {
      if (chunk.reasoning) chunks.push(chunk.reasoning);
      if (chunk.delta) chunks.push(`[delta]${chunk.delta}`);
      if (chunk.message) messages.push(Object.keys(chunk.message)[0] ?? '');
    }

    // 思考内容原样透传（供客户端显示中间状态）……
    assert.deepEqual(chunks.slice(0, 2), ['让我想想', '，用户要一个购物车。']);
    // ……但**只有 content 进装配器**：否则这段散文会被当成模型输出，
    // 既抽不出协议消息，还会污染「查看原始输出」。
    assert.deepEqual(messages, ['beginRendering']);
    assert.equal(chunks.at(-1), '[delta]{"beginRendering":{"surfaceId":"sf-1","root":"root"}}');
  });
});

describe('agent / 提示词', () => {
  it('system prompt 里带上目标 surfaceId 与输出硬约束', () => {
    const prompt = buildSystemPrompt('sf-42');

    assert.match(prompt, /sf-42/);
    assert.match(prompt, /只输出 JSONL/);
    assert.match(prompt, /恰好包含一个顶层键/);
    // 分块流式规约：root 随第一条到达、随后立刻 beginRendering（不再压尾）
    assert.match(prompt, /分块流式输出/);
    assert.match(prompt, /立刻发 beginRendering/);
    assert.match(prompt, /前向引用/);
    // 元素引用约定：playground 点选元素后往输入框里插 @组件id
    assert.match(prompt, /元素引用/);
    assert.match(prompt, /@组件id/);
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
    assert.match(first[1].content as string, /^做一个购物车$/);

    const later = buildChatMessages(
      requestOf({ history: [{ role: 'user', content: '上轮' }, { role: 'assistant', content: '[]' }] }),
    );
    assert.equal(later.length, 4);
    assert.equal(later[1].content as string, '上轮');
    assert.match(later[3].content as string, /这是对已有 surface「sf-1」的修改/);
    assert.match(later[3].content as string, /用户：做一个购物车/);
    // 增量约束不该污染 system。
    assert.doesNotMatch(later[0].content as string, /这是对已有 surface/);
  });

  it('带图时 user 消息是 content 分片数组（text + image_url），hint 在点题', () => {
    const messages = buildChatMessages(
      requestOf({ images: [{ dataUrl: 'data:image/png;base64,AAAA' }, { url: 'https://x/y.png' }] }),
    );

    const user = messages[messages.length - 1];
    assert.equal(user.role, 'user');

    // 带图时 content 必须是分片数组，不再是纯字符串。
    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    assert.ok(Array.isArray(parts));
    assert.equal(parts[0].type, 'text');
    assert.match(parts[0].text ?? '', /附上了 2 张图片/);
    assert.match(parts[0].text ?? '', /做一个购物车/);
    // 图片按原样转成 image_url 分片，dataUrl 优先、url 兜底。
    assert.equal(parts[1].type, 'image_url');
    assert.equal(parts[1].image_url?.url, 'data:image/png;base64,AAAA');
    assert.equal(parts[2].type, 'image_url');
    assert.equal(parts[2].image_url?.url, 'https://x/y.png');
  });

  it('不带图时 user 消息仍是纯字符串（最小差异）', () => {
    const first = buildChatMessages(requestOf());
    assert.equal(typeof first[1].content, 'string');
  });
});
