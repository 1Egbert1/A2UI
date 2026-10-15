import { strict as assert } from 'assert';

import { resolveAction, type ActionEnvironment } from '../src/action';
import { readBoundValue } from '../src/binding';
import { localActionMessages } from '../mock/local-action';
import { parseA2UI } from '../src/parser';
import { setRenderMap, splitComponent } from '../src/renderer';
import {
  getDataModel,
  getHydrateNode,
  init,
  resetA2UIStore,
  updateDataModelPath,
} from '../src/store';
import { setTreeRenderer } from '../src/tree-render';

/** 固定时钟：断言 timestamp 时不踩真实时间。 */
const FIXED_NOW = () => new Date('2026-10-15T12:00:00.000Z');

/** 造一个 action 解析环境，数据模型用普通对象模拟。 */
const env = (data: Record<string, unknown> = {}): ActionEnvironment => ({
  surfaceId: 's',
  componentId: 'btn',
  read: (path) => path.split('/').filter((s) => s !== '').reduce<unknown>(
    (acc, key) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    data,
  ),
  now: FIXED_NOW,
});

describe('readBoundValue（通用取值对象）', () => {
  it('should read every literal type', () => {
    assert.equal(readBoundValue({ literalString: 'hi' }, () => undefined), 'hi');
    assert.equal(readBoundValue({ literalNumber: 0 }, () => undefined), 0, '0 不应被当成未命中');
    assert.equal(
      readBoundValue({ literalBoolean: false }, () => undefined),
      false,
      'false 不应被当成未命中',
    );
    assert.deepEqual(readBoundValue({ literalArray: ['a'] }, () => undefined), ['a']);
  });

  it('should resolve a path through the reader', () => {
    assert.equal(readBoundValue({ path: '/user/name' }, () => 'Alice'), 'Alice');
  });

  it('should prefer literals over path when both are present', () => {
    assert.equal(readBoundValue({ literalString: 'literal', path: '/x' }, () => 'from-path'), 'literal');
  });

  it('should pass a bare value through unchanged', () => {
    assert.equal(readBoundValue('raw', () => undefined), 'raw');
    assert.equal(readBoundValue(42, () => undefined), 42);
  });

  it('should return undefined when nothing matches', () => {
    assert.equal(readBoundValue({}, () => undefined), undefined);
  });
});

describe('resolveAction（客户端动作解析）', () => {
  describe('非法输入', () => {
    it('should return null for a non-object action', () => {
      assert.equal(resolveAction(null, env()), null);
      assert.equal(resolveAction('go', env()), null);
      assert.equal(resolveAction([{ name: 'go' }], env()), null, '数组不是合法 action');
    });

    it('should return null when the required name is missing or empty', () => {
      assert.equal(resolveAction({}, env()), null);
      assert.equal(resolveAction({ name: 42 }, env()), null);
      assert.equal(resolveAction({ name: '' }, env()), null);
    });
  });

  describe('服务端分支（缺省）', () => {
    it('should default to the server branch when type is absent', () => {
      const resolved = resolveAction({ name: 'addToCart' }, env());

      assert.equal(resolved?.kind, 'server');
    });

    it('should build a message matching client_to_server.json', () => {
      const resolved = resolveAction({ name: 'addToCart' }, env());

      assert.equal(resolved?.kind, 'server');
      if (resolved?.kind !== 'server') return;

      assert.deepEqual(resolved.message, {
        userAction: {
          name: 'addToCart',
          surfaceId: 's',
          sourceComponentId: 'btn',
          timestamp: '2026-10-15T12:00:00.000Z',
          context: {},
        },
      });
    });

    it('should resolve the context array into an object, evaluating every value', () => {
      const resolved = resolveAction(
        {
          name: 'checkout',
          context: [
            { key: 'sku', value: { literalString: 'A-1' } },
            { key: 'qty', value: { literalNumber: 3 } },
            { key: 'note', value: { path: '/user/name' } },
          ],
        },
        env({ user: { name: 'Alice' } }),
      );

      assert.equal(resolved?.kind, 'server');
      if (resolved?.kind !== 'server') return;

      assert.deepEqual(resolved.message.userAction.context, { sku: 'A-1', qty: 3, note: 'Alice' });
    });

    it('should skip malformed context entries instead of throwing', () => {
      const resolved = resolveAction(
        { name: 'go', context: [{ key: 'ok', value: { literalString: 'v' } }, 'nonsense', { value: {} }] },
        env(),
      );

      assert.equal(resolved?.kind, 'server');
      if (resolved?.kind !== 'server') return;

      assert.deepEqual(resolved.message.userAction.context, { ok: 'v' });
    });

    it('should pass a non-array context through unchanged', () => {
      const resolved = resolveAction({ name: 'go', context: { raw: 1 } }, env());

      assert.equal(resolved?.kind, 'server');
      if (resolved?.kind !== 'server') return;

      assert.deepEqual(resolved.message.userAction.context, { raw: 1 });
    });

    it('should treat an unknown type as the server branch rather than silently going local', () => {
      const resolved = resolveAction({ name: 'go', type: 'updateDataModel' }, env());

      assert.equal(resolved?.kind, 'server', '只有显式 type: "local" 才走本地');
    });
  });

  describe('本地分支（type: "local"）', () => {
    it('should resolve the local operations with values already evaluated', () => {
      const resolved = resolveAction(
        {
          name: 'refresh',
          type: 'local',
          local: [{ type: 'updateDataModel', path: '/message', value: { literalString: '新文案' } }],
        },
        env(),
      );

      assert.equal(resolved?.kind, 'local');
      if (resolved?.kind !== 'local') return;

      assert.equal(resolved.name, 'refresh');
      assert.deepEqual(resolved.operations, [
        { type: 'updateDataModel', path: '/message', value: '新文案' },
      ]);
    });

    it('should keep the order of multiple operations', () => {
      const resolved = resolveAction(
        {
          name: 'swap',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/a', value: { literalString: '1' } },
            { type: 'updateDataModel', path: '/b', value: { literalNumber: 2 } },
            { type: 'updateDataModel', path: '/c', value: { literalBoolean: true } },
          ],
        },
        env(),
      );

      assert.equal(resolved?.kind, 'local');
      if (resolved?.kind !== 'local') return;

      assert.deepEqual(
        resolved.operations.map((operation) => operation.path),
        ['/a', '/b', '/c'],
      );
    });

    it('should resolve a path-valued operation from the data model (copy a value)', () => {
      const resolved = resolveAction(
        {
          name: 'copy',
          type: 'local',
          local: [{ type: 'updateDataModel', path: '/draft', value: { path: '/saved' } }],
        },
        env({ saved: '已保存的内容' }),
      );

      assert.equal(resolved?.kind, 'local');
      if (resolved?.kind !== 'local') return;

      assert.equal(resolved.operations[0]?.value, '已保存的内容');
    });

    it('should skip malformed operations but keep the valid ones', () => {
      const resolved = resolveAction(
        {
          name: 'go',
          type: 'local',
          local: [
            'nonsense',
            { path: '/no-type', value: { literalString: 'x' } },
            { type: 'unknownOperation', path: '/future', value: { literalString: 'x' } },
            { type: 'updateDataModel', value: { literalString: 'x' } },
            { type: 'updateDataModel', path: '', value: { literalString: 'x' } },
            { type: 'updateDataModel', path: '/kept', value: { literalString: 'ok' } },
          ],
        },
        env(),
      );

      assert.equal(resolved?.kind, 'local');
      if (resolved?.kind !== 'local') return;

      assert.deepEqual(resolved.operations, [
        { type: 'updateDataModel', path: '/kept', value: 'ok' },
      ]);
    });

    it('should yield no operations when local is missing or not an array', () => {
      const missing = resolveAction({ name: 'go', type: 'local' }, env());
      const wrongType = resolveAction({ name: 'go', type: 'local', local: 'oops' }, env());

      assert.equal(missing?.kind, 'local');
      assert.equal(wrongType?.kind, 'local');
      if (missing?.kind !== 'local' || wrongType?.kind !== 'local') return;

      assert.deepEqual(missing.operations, [], 'local 缺失 → 本地什么都不做');
      assert.deepEqual(wrongType.operations, []);
    });
  });
});

describe('端到端：本地动作驱动的按钮更新文案', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
    setTreeRenderer(null);
  });

  /** 取某个组件登记在 store 里的属性对象（等价于渲染引擎 hydrate 时拿到的那份）。 */
  const propsOf = (componentId: string): Record<string, unknown> => {
    const node = getHydrateNode(componentId);
    assert.ok(node, `组件 ${componentId} 应已登记`);
    return splitComponent(JSON.parse(node.protocol)).props;
  };

  it('should update the bound text when the local action is applied', () => {
    let renders = 0;
    setTreeRenderer(() => {
      renders += 1;
    });
    // 假渲染器：Text 直接返回它读到的值，好断言「写回后文案变了」。
    setRenderMap({
      Text: (props, context) => context.read((props.text as { path: string }).path),
      Button: (props) => props.action,
    });

    parseA2UI(localActionMessages.join('\n'));

    assert.equal(getHydrateNode('message')?._vnode, '点击下方按钮，用本地动作更新这行文案');
    assert.equal(renders, 1, 'parseA2UI 应触发一次渲染');

    // 模拟点击：解析 Button 的 action，把本地操作当成 updateModel 依次写回。
    const action = propsOf('refresh-button').action;
    const resolved = resolveAction(action, {
      surfaceId: 'local-action',
      componentId: 'refresh-button',
      read: () => undefined,
      now: FIXED_NOW,
    });

    assert.equal(resolved?.kind, 'local');
    if (resolved?.kind !== 'local') return;

    for (const operation of resolved.operations) {
      updateDataModelPath('local-action', operation.path, operation.value);
    }

    assert.deepEqual(getDataModel('local-action'), {
      message: '✅ 这行文案已由本地动作更新（没有经过服务端）',
    });
    assert.equal(renders, 2, '本地写回应触发一次重渲染');
    assert.equal(
      getHydrateNode('message')?._vnode,
      '✅ 这行文案已由本地动作更新（没有经过服务端）',
      '绑同一 path 的 Text 应看到新文案',
    );
  });

  it('should keep the data model initialised before any click', () => {
    init();
    setRenderMap({ Text: () => null, Button: () => null });
    setTreeRenderer(null);

    parseA2UI(localActionMessages.join('\n'));

    assert.deepEqual(getDataModel('local-action'), {
      message: '点击下方按钮，用本地动作更新这行文案',
    });
  });
});
