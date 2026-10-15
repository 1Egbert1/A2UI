import { strict as assert } from 'assert';

import {
  columnRowMixCompactMessages,
  columnRowMixCompactStreamMessages,
  columnRowMixMessages,
  columnRowMixStreamMessages,
} from '../mock/column-row-mix';
import {
  compactSurfaceUpdates,
  deriveStreamOrders,
  findRootId,
  parseMessage,
  toStreamFriendly,
  toStreamFriendlyCompact,
} from '../mock/stream';
import { productCardMessages, simpleTextMessages } from '../mock';

const kindOf = (line: string): string => Object.keys(parseMessage(line))[0];

describe('mock/stream 派生工具', () => {
  it('findRootId 从 beginRendering 里取出 root', () => {
    assert.equal(findRootId(columnRowMixMessages), 'root');
    assert.equal(findRootId(productCardMessages), 'root');
    assert.equal(findRootId(simpleTextMessages), 'root');
  });

  it('deriveStreamOrders 返回「协议顺序 + 流式友好」两份', () => {
    const orders = deriveStreamOrders(columnRowMixMessages);
    assert.equal(orders.length, 2);
    assert.equal(orders[0].label, '协议顺序');
    assert.equal(orders[1].label, '流式友好');
    // 协议顺序的 messages 是原样引用（不重排）
    assert.equal(orders[0].messages, columnRowMixMessages);
  });

  it('toStreamFriendly 把 beginRendering 移到 root 之后，其余顺序不变', () => {
    // root 独占第一条 surfaceUpdate 的 case（column-row-mix）
    assert.deepEqual(toStreamFriendly(columnRowMixMessages), columnRowMixStreamMessages);

    // root 藏在「14 组件一条 surfaceUpdate」里的 case（product-card），验证通用性
    const cardFriendly = toStreamFriendly(productCardMessages);
    assert.deepEqual(cardFriendly.map(kindOf), [
      'surfaceUpdate',
      'beginRendering',
      'dataModelUpdate',
    ]);
  });

  it('compactSurfaceUpdates 把所有 surfaceUpdate 压成一条，其余消息保序', () => {
    const compact = compactSurfaceUpdates(columnRowMixMessages);
    assert.deepEqual(compact, columnRowMixCompactMessages);
    // 第一条装 26 个组件
    assert.equal(parseMessage(compact[0]).surfaceUpdate!.components.length, 26);
  });

  it('toStreamFriendlyCompact 保住「root 单独一条 → beginRendering → 其余压一条」', () => {
    const compact = toStreamFriendlyCompact(columnRowMixMessages);
    assert.deepEqual(compact, columnRowMixCompactStreamMessages);

    assert.deepEqual(compact.map(kindOf), [
      'surfaceUpdate',
      'beginRendering',
      'surfaceUpdate',
      'dataModelUpdate',
    ]);
    // 第一条只有 root
    assert.equal(parseMessage(compact[0]).surfaceUpdate!.components.length, 1);
    assert.equal(parseMessage(compact[0]).surfaceUpdate!.components[0].id, 'root');
    // 第三条是其余 25 个组件压成的一条
    assert.equal(parseMessage(compact[2]).surfaceUpdate!.components.length, 25);
  });

  it('deriveStreamOrders 与 column-row-mix 的手工导出一致', () => {
    const orders = deriveStreamOrders(columnRowMixMessages);
    assert.deepEqual(orders[0].messages, columnRowMixMessages);
    assert.deepEqual(orders[0].compact, columnRowMixCompactMessages);
    assert.deepEqual(orders[1].messages, columnRowMixStreamMessages);
    assert.deepEqual(orders[1].compact, columnRowMixCompactStreamMessages);
  });
});
