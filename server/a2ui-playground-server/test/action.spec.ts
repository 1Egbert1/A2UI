/**
 * `POST /api/a2ui/action`：客户端动作回传。
 *
 * 这条链路过去是断的 —— 渲染层派发了 `a2ui-action`，但宿主没人监听，点了等于没点。
 * 这里守住三件事：
 * 1. **任何动作都有回执**（默认 fallback 写 `__lastAction`），哪怕没注册业务 handler；
 * 2. 注册了 handler 就走业务逻辑，且 `handledBy` 能说明是谁处理的；
 * 3. 入参问题（缺 threadId / 缺 name / 会话不存在）在动 handler 之前就挡掉。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'mocha';
import { createActionRouter } from '../src/actions';
import { close, listen, makeConfig, post } from './helpers';

const THREAD = 'thread-action-1';

/** 先跑一轮生成，让会话存在（动作接口要求 threadId 有效）。 */
const seedSession = async (base: string): Promise<void> => {
  const response = await post(base, '/api/a2ui/run?stream=false', {
    threadId: THREAD,
    message: '显示一个欢迎卡片',
  });
  assert.equal(response.status, 200);
};

const sendAction = (base: string, body: unknown): Promise<Response> =>
  post(base, '/api/a2ui/action', body);

describe('POST /api/a2ui/action', () => {
  let server: ReturnType<typeof listen>['server'];
  let base = '';

  before(async () => {
    const started = listen(makeConfig());
    server = started.server;
    base = started.base;
    await seedSession(base);
  });

  after(async () => {
    await close(server);
  });

  it('缺 threadId 时 400，且不进入 handler', async () => {
    const response = await sendAction(base, { userAction: { name: 'submit' } });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /threadId/);
  });

  it('userAction 缺 name 时 400', async () => {
    const response = await sendAction(base, { threadId: THREAD, userAction: { context: {} } });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /name/);
  });

  it('会话不存在时 404', async () => {
    const response = await sendAction(base, {
      threadId: 'thread-does-not-exist',
      userAction: { name: 'submit' },
    });
    assert.equal(response.status, 404);
  });

  it('未注册 handler 的动作走 fallback，回执写进 __lastAction', async () => {
    const response = await sendAction(base, {
      threadId: THREAD,
      userAction: {
        name: 'checkout',
        surfaceId: '',
        sourceComponentId: 'btn-pay',
        context: { amount: 128 },
      },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      handledBy: string;
      messageCount: number;
      surfaceId: string;
      messages: Array<Record<string, unknown>>;
    };

    assert.equal(body.handledBy, 'fallback');
    assert.equal(body.messageCount, 1);
    assert.ok(body.surfaceId.length > 0, 'surfaceId 应由会话活跃 surface 补上');

    const message = body.messages[0].dataModelUpdate as {
      surfaceId: string;
      path: string;
      contents: Array<{ key: string; valueString?: string }>;
    };
    assert.equal(message.path, '__lastAction');
    assert.equal(message.surfaceId, body.surfaceId);
    assert.equal(message.contents.find((entry) => entry.key === 'name')?.valueString, 'checkout');
    assert.equal(
      message.contents.find((entry) => entry.key === 'sourceComponentId')?.valueString,
      'btn-pay',
    );
    assert.ok(message.contents.find((entry) => entry.key === 'at')?.valueString);
  });

  it('回执会进会话缓存，客户端刷新后能整段回放', async () => {
    const snapshot = await fetch(`${base}/api/a2ui/session/${THREAD}`);
    assert.equal(snapshot.status, 200);
    const body = (await snapshot.json()) as {
      surfaces: Array<{ surfaceId: string; messages: Array<Record<string, unknown>> }>;
    };

    const flat = body.surfaces.flatMap((surface) => surface.messages);
    assert.ok(
      flat.some((message) => {
        const update = message.dataModelUpdate as { path?: string } | undefined;
        return update?.path === '__lastAction';
      }),
      '会话快照里应能看到动作回执',
    );
  });

  it('注册的 handler 优先于 fallback，且能返回多条消息', async () => {
    const actions = createActionRouter({
      refund: (action, context) => [
        {
          dataModelUpdate: {
            surfaceId: context.surfaceId,
            path: 'order',
            contents: [{ key: 'status', valueString: 'refunded' }],
          },
        },
        {
          dataModelUpdate: {
            surfaceId: context.surfaceId,
            path: '__lastAction',
            contents: [{ key: 'name', valueString: action.name }],
          },
        },
      ],
    });

    const started = listen(makeConfig(), { actions });
    try {
      await post(started.base, '/api/a2ui/run?stream=false', {
        threadId: 'thread-custom',
        message: '显示一个订单卡片',
      });

      const response = await sendAction(started.base, {
        threadId: 'thread-custom',
        userAction: { name: 'refund', sourceComponentId: 'btn-refund' },
      });

      const body = (await response.json()) as {
        handledBy: string;
        messageCount: number;
        messages: Array<Record<string, unknown>>;
      };

      assert.equal(body.handledBy, 'refund');
      assert.equal(body.messageCount, 2);
      const first = body.messages[0].dataModelUpdate as {
        path: string;
        contents: Array<{ key: string; valueString?: string }>;
      };
      assert.equal(first.path, 'order');
      assert.equal(first.contents[0].valueString, 'refunded');
    } finally {
      await close(started.server);
    }
  });

  it('handler 抛错时回 200 + error，不打断客户端', async () => {
    const actions = createActionRouter({
      boom: () => {
        throw new Error('下游接口超时');
      },
    });

    const started = listen(makeConfig(), { actions });
    try {
      await post(started.base, '/api/a2ui/run?stream=false', {
        threadId: 'thread-boom',
        message: '显示一个卡片',
      });

      const response = await sendAction(started.base, {
        threadId: 'thread-boom',
        userAction: { name: 'boom' },
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        handledBy: string;
        messageCount: number;
        messages: unknown[];
        error?: string;
      };
      assert.equal(body.handledBy, 'error');
      assert.equal(body.messageCount, 0);
      assert.deepEqual(body.messages, []);
      assert.match(body.error ?? '', /下游接口超时/);
    } finally {
      await close(started.server);
    }
  });
});
