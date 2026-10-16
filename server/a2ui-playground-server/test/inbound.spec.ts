import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import {
  BadRequestError,
  createRunId,
  createSessionId,
  createSurfaceId,
  describeUserAction,
  normalizeChatRequest,
  normalizeGenerateRequest,
} from '../src/inbound';

describe('inbound / normalizeGenerateRequest', () => {
  it('接受简写 { message }，并补齐会话与 surface', () => {
    const result = normalizeGenerateRequest({ message: '做一个登录表单' });

    assert.equal(result.message, '做一个登录表单');
    assert.match(result.sessionId, /^session-/);
    assert.match(result.surfaceId, /^surface-/);
    assert.equal(result.runId, undefined);
  });

  it('接受 AG-UI 的 RunAgentInput（threadId/runId/messages）', () => {
    const result = normalizeGenerateRequest({
      threadId: 'thr-1',
      runId: 'run-1',
      messages: [
        { id: 'm1', role: 'user', content: '第一轮' },
        { id: 'm2', role: 'assistant', content: '收到' },
        { id: 'm3', role: 'user', content: '再来一个购物车' },
      ],
    });

    assert.equal(result.sessionId, 'thr-1');
    assert.equal(result.runId, 'run-1');
    // 取**最后一条** user 消息：前面的 user 是更早的轮次。
    assert.equal(result.message, '再来一个购物车');
  });

  it('支持 AG-UI 的内容分片数组（多模态形状）', () => {
    const result = normalizeGenerateRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '第一段' }, { type: 'image', url: 'x' }] },
      ],
    });

    assert.equal(result.message, '第一段');
  });

  it('sessionId 作为 threadId 的旧名仍可用', () => {
    const result = normalizeGenerateRequest({ sessionId: 's-9', message: 'hi' });
    assert.equal(result.sessionId, 's-9');
  });

  it('action 可来自顶层，也可来自 forwardedProps', () => {
    const direct = normalizeGenerateRequest({
      action: { name: 'submit', surfaceId: 'sf-1', sourceComponentId: 'btn', context: { a: 1 } },
    });
    assert.equal(direct.surfaceId, 'sf-1');
    assert.match(direct.message, /submit/);

    const viaProps = normalizeGenerateRequest({
      message: '点了一下',
      forwardedProps: {
        action: { name: 'buy', surfaceId: 'sf-2', sourceComponentId: 'buy-btn', context: {} },
      },
    });
    assert.equal(viaProps.surfaceId, 'sf-2');
    // 两种来源合成同一段文本：用户说的话在前，动作描述在后。
    assert.match(viaProps.message, /^点了一下\n用户点击了组件「buy-btn」/);
  });

  it('请求里的 surfaceId 优先于 action 里的', () => {
    const result = normalizeGenerateRequest({
      surfaceId: 'explicit',
      action: { name: 'a', surfaceId: 'from-action', sourceComponentId: 'c', context: {} },
    });
    assert.equal(result.surfaceId, 'explicit');
  });

  it('缺 message 与 action 时抛 BadRequestError', () => {
    assert.throws(() => normalizeGenerateRequest({}), BadRequestError);
    assert.throws(() => normalizeGenerateRequest({ message: '   ' }), BadRequestError);
  });

  it('action 缺必填字段时抛 BadRequestError', () => {
    assert.throws(
      () => normalizeGenerateRequest({ action: { name: '', sourceComponentId: 'c' } }),
      BadRequestError,
    );
    assert.throws(
      () => normalizeGenerateRequest({ action: { name: 'a' } }),
      BadRequestError,
    );
  });

  it('非对象请求体抛 BadRequestError', () => {
    assert.throws(() => normalizeGenerateRequest(null), BadRequestError);
    assert.throws(() => normalizeGenerateRequest([1, 2]), BadRequestError);
    assert.throws(() => normalizeGenerateRequest('hi'), BadRequestError);
  });

  it('images 带 dataUrl 原样透传到 normalized.images', () => {
    const result = normalizeGenerateRequest({
      message: '复刻这张图',
      images: [{ dataUrl: 'data:image/png;base64,AAAA', name: 'mock.png' }],
    });

    assert.equal(result.images?.length, 1);
    assert.equal(result.images?.[0].dataUrl, 'data:image/png;base64,AAAA');
    assert.equal(result.images?.[0].name, 'mock.png');
  });

  it('images 只给 url 也能通过', () => {
    const result = normalizeGenerateRequest({
      message: '参考这张',
      images: [{ url: 'https://example.com/x.png' }],
    });

    assert.equal(result.images?.[0].url, 'https://example.com/x.png');
  });

  it('images 每项既没 dataUrl 也没 url 时抛 BadRequestError', () => {
    assert.throws(
      () => normalizeGenerateRequest({ message: 'x', images: [{ name: 'broken' }] }),
      BadRequestError,
    );
  });

  it('images 不是数组时抛 BadRequestError', () => {
    assert.throws(
      () => normalizeGenerateRequest({ message: 'x', images: 'not-an-array' }),
      BadRequestError,
    );
  });

  it('仅有图片、没有文字也视为合法输入', () => {
    // 多模态：用户可能只甩一张设计稿过来，要求复刻。
    const result = normalizeGenerateRequest({ images: [{ dataUrl: 'data:image/png;base64,AAAA' }] });
    assert.equal(result.images?.length, 1);
    assert.equal(result.message, '');
  });
});

describe('inbound / normalizeChatRequest（多模态）', () => {
  it('images 合并进最后一条 user 消息，变成 content 分片数组', () => {
    const { messages } = normalizeChatRequest(
      {
        message: '描述这张图',
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }, { url: 'https://x/y.png' }],
      },
      '你是一个助手',
    );

    const user = messages.filter((message) => message.role === 'user').at(-1);
    assert.ok(user, '应当有一条 user 消息');

    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    assert.ok(Array.isArray(parts), '带图时 content 必须是分片数组');
    assert.equal(parts[0].type, 'text');
    assert.match(parts[0].text ?? '', /描述这张图/);
    assert.equal(parts[1].image_url?.url, 'data:image/png;base64,AAAA');
    assert.equal(parts[2].image_url?.url, 'https://x/y.png');
  });

  it('没有图片时 chat 消息仍是纯字符串', () => {
    const { messages } = normalizeChatRequest({ message: '你好' }, '你是一个助手');
    const user = messages.filter((message) => message.role === 'user').at(-1);
    assert.equal(typeof user?.content, 'string');
  });
});

describe('inbound / id 与动作描述', () => {
  it('id 带可读前缀且不重复', () => {
    assert.match(createSessionId(), /^session-/);
    assert.match(createSurfaceId(), /^surface-/);
    assert.match(createRunId(), /^run-/);
    assert.notEqual(createRunId(), createRunId());
  });

  it('describeUserAction 把上下文里的值一起带出', () => {
    const text = describeUserAction({
      name: 'login',
      surfaceId: 'sf',
      sourceComponentId: 'submit',
      context: { username: 'ada' },
    });

    assert.match(text, /submit/);
    assert.match(text, /login/);
    assert.match(text, /"username":"ada"/);
  });
});
