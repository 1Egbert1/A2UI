import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import {
  BadRequestError,
  createRunId,
  createSessionId,
  createSurfaceId,
  describeUserAction,
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
