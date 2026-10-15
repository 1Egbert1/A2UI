import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session';
import type { A2UIMessage } from '../src/types';

const surfaceUpdate = (surfaceId: string, id: string): A2UIMessage => ({
  surfaceUpdate: { surfaceId, components: [{ id, component: { Divider: {} } }] },
});

describe('session / 会话与 surface 缓存', () => {
  it('新建会话时登记初始 surface', () => {
    const store = new SessionStore({ historyLimit: 3 });
    const session = store.getOrCreate('s1', 'sf-1');

    assert.equal(session.surfaceId, 'sf-1');
    assert.equal(session.history.length, 0);
    assert.equal(session.surfaces.get('sf-1')?.messages.length, 0);
    assert.equal(store.size, 1);
  });

  it('已有会话不会再被传入的 surfaceId 顶掉（保住正在编辑的界面）', () => {
    const store = new SessionStore({ historyLimit: 3 });
    store.getOrCreate('s1', 'sf-1');
    const again = store.getOrCreate('s1', 'sf-other');

    assert.equal(again.surfaceId, 'sf-1');
  });

  it('appendTurn 按轮裁剪：超出上限时丢最早的整轮', () => {
    const store = new SessionStore({ historyLimit: 2 });
    const session = store.getOrCreate('s1', 'sf-1');

    for (const index of [1, 2, 3]) {
      store.appendTurn(session, { role: 'user', content: `u${index}` });
      store.appendTurn(session, { role: 'assistant', content: `a${index}` });
    }

    // historyLimit=2 → 最多 4 条，剩下的是最近两轮。
    assert.deepEqual(
      session.history.map((turn) => turn.content),
      ['u2', 'a2', 'u3', 'a3'],
    );
  });

  it('recordSurface 增量累积消息并切换活跃 surface', () => {
    const store = new SessionStore({ historyLimit: 3 });
    const session = store.getOrCreate('s1', 'sf-1');

    store.recordSurface(session, 'sf-1', [surfaceUpdate('sf-1', 'a')]);
    store.recordSurface(session, 'sf-1', [surfaceUpdate('sf-1', 'b')]);
    store.recordSurface(session, 'sf-2', [surfaceUpdate('sf-2', 'c')]);

    assert.equal(session.surfaces.get('sf-1')?.messages.length, 2);
    assert.equal(session.surfaces.get('sf-2')?.messages.length, 1);
    assert.equal(session.surfaceId, 'sf-2');
  });

  it('snapshot 可直接 JSON 化（surface 是 Map，不能直接回给客户端）', () => {
    const store = new SessionStore({ historyLimit: 3 });
    const session = store.getOrCreate('s1', 'sf-1');
    store.appendTurn(session, { role: 'user', content: 'hi' });
    store.recordSurface(session, 'sf-1', [surfaceUpdate('sf-1', 'a')]);

    const snapshot = store.snapshot(session);

    assert.equal(snapshot.sessionId, 's1');
    assert.equal(snapshot.surfaces.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).surfaces[0].messages.length, 1);
  });
});

describe('session / TTL 回收', () => {
  it('空转超时的会话在下次取用时就地回收', () => {
    let clock = 1_000;
    const store = new SessionStore({ historyLimit: 3, ttlMs: 100, now: () => clock });

    store.getOrCreate('old', 'sf-1');
    clock += 200;
    store.getOrCreate('fresh', 'sf-2');

    assert.equal(store.get('old'), undefined);
    assert.equal(store.size, 1);
  });

  it('ttlMs 为 0 表示不回收', () => {
    let clock = 1_000;
    const store = new SessionStore({ historyLimit: 3, ttlMs: 0, now: () => clock });

    store.getOrCreate('s1', 'sf-1');
    clock += 10_000_000;
    store.getOrCreate('s2', 'sf-2');

    assert.equal(store.size, 2);
  });
});
