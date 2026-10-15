import { strict as assert } from 'assert';

import { columnRowMixMessages } from '../mock/column-row-mix';
import { columnTextsMessages } from '../mock/column-texts';
import { createJSONLStream, parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  clearStore,
  getAllTrees,
  getTree,
  init,
  resetA2UIStore,
} from '../src/store';
import { getTreeRenderer, setTreeRenderer } from '../src/tree-render';
import type { TreeMap } from '../src/treebuilder/types';

/** 只回一个标记：本文件关心的是「渲染器何时被调、拿到什么」，不是渲染成什么。 */
const MARKER_RENDER_MAP = {
  Column: () => 'COLUMN',
  Row: () => 'ROW',
  Card: () => 'CARD',
  Divider: () => 'DIVIDER',
  Button: () => 'BUTTON',
  Text: () => 'TEXT',
};

/**
 * 记录每次调用的参数，供断言。
 *
 * `calls` 里同时记下「回调时刻 store 里的 treeMap」——如果 SDK 在写 store 之前回调，
 * 宿主读 store 会拿到旧值，那是很隐蔽的时序 bug，这里直接把它钉在测试里。
 */
const createSpy = () => {
  const calls: TreeMap[] = [];
  const storeAtCallTime: TreeMap[] = [];

  const spy = (treeMap: TreeMap): void => {
    calls.push(treeMap);
    storeAtCallTime.push(getAllTrees());
  };

  return { spy, calls, storeAtCallTime };
};

describe('A2UI 组件树渲染器（init 第二参 / 渲染时机由 core 决定）', () => {
  beforeEach(() => {
    resetA2UIStore();
    // renderMap 与 treeRenderer 都是模块级配置，不随 store 重置，需手动设回。
    setRenderMap(MARKER_RENDER_MAP);
    setTreeRenderer(null);
  });

  describe('注册与解除', () => {
    it('should register the tree renderer passed to init', () => {
      const { spy } = createSpy();

      assert.equal(getTreeRenderer(), null, '默认没有渲染器');

      init(MARKER_RENDER_MAP, spy);

      assert.equal(getTreeRenderer(), spy, 'init 的第二参应被登记为树渲染器');
    });

    it('should keep the previous renderer when init is called without one', () => {
      const { spy } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      // getA2UIStore() 内部会调 init()（无参），不能把已注册的渲染器清掉。
      init(MARKER_RENDER_MAP);

      assert.equal(getTreeRenderer(), spy);
    });

    it('should unregister when set to null', () => {
      const { spy } = createSpy();
      init(MARKER_RENDER_MAP, spy);
      setTreeRenderer(null);

      assert.equal(getTreeRenderer(), null);
    });

    it('should survive resetA2UIStore (it is configuration, not state)', () => {
      const { spy } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      resetA2UIStore();

      assert.equal(
        getTreeRenderer(),
        spy,
        '与 renderMap 一致：重置 store 不清配置，测试里需自行 setTreeRenderer(null)',
      );
    });
  });

  describe('一次性解析（parseA2UI）', () => {
    it('should render exactly once per parse, with the freshly built treeMap', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      parseA2UI(columnTextsMessages.join('\n'));

      assert.equal(calls.length, 1, '整段解析只建一次树 → 只回调一次');

      const treeMap = calls[0];
      assert.deepEqual(Object.keys(treeMap), ['column-texts'], '回调收到的是完整 treeMap');
      assert.equal(treeMap['column-texts'].root.componentId, 'root');
      assert.deepEqual(
        treeMap['column-texts'].root.children.map((child) => child.componentId),
        ['title', 'body', 'caption'],
        '回调里的树就是组装好的那棵（三个子节点顺序与 explicitList 一致）',
      );
    });

    it('should call back only after the store already holds the new tree', () => {
      const { spy, storeAtCallTime } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      parseA2UI(columnTextsMessages.join('\n'));

      assert.deepEqual(
        storeAtCallTime[0],
        getAllTrees(),
        '回调时刻 store.treeMap 必须已是新树，宿主要在回调里读 store 才不会拿到旧值',
      );
    });

    it('should not call back when no renderer is registered', () => {
      // 不注册渲染器时，解析照常工作，只是没人负责挂载 —— 不能因此抛错。
      assert.doesNotThrow(() => parseA2UI(columnTextsMessages.join('\n')));
      assert.ok(getTree('column-texts'), 'store 侧照常建树');
    });
  });

  describe('流式解析（createJSONLStream）', () => {
    it('should call back on every push that produced a message', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      const stream = createJSONLStream();
      const head = columnRowMixMessages.slice(0, 5);

      head.forEach((line, index) => {
        stream.push(`${line}\n`);
        assert.equal(calls.length, index + 1, `第 ${index + 1} 次 push 后应回调 ${index + 1} 次`);
      });
    });

    it('should not call back when a push produced no message', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      const stream = createJSONLStream();

      stream.push('');
      assert.equal(calls.length, 0, '空串不产消息，也就不该触发渲染');

      stream.push('\n\n   \n');
      assert.equal(calls.length, 0, '只推空行同样不触发（缓冲本来就是空的）');

      stream.push(columnRowMixMessages[0].slice(0, 12));
      assert.equal(calls.length, 0, '半行还留在缓冲里，不该触发渲染');
    });

    it('should call back once from end() when a trailing line is flushed', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      const stream = createJSONLStream();
      stream.push(columnRowMixMessages.slice(0, 2).join('\n'));
      assert.equal(calls.length, 1, '只有第 1 行带换行，push 阶段回调 1 次');

      stream.end();
      assert.equal(calls.length, 2, 'end() 补处理最后一行 → 再回调 1 次');
    });

    it('should report an empty treeMap while the surface is not born yet', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      const stream = createJSONLStream();
      const componentLines = columnRowMixMessages.filter(
        (line) => Object.keys(JSON.parse(line))[0] === 'surfaceUpdate',
      );

      for (const line of componentLines) {
        stream.push(`${line}\n`);
      }

      assert.equal(calls.length, 26, '每条组件消息都算一次建树');
      assert.deepEqual(
        calls[calls.length - 1],
        {},
        'beginRendering 未到 → 没有 surface 也没有树，回调应收到空对象（宿主据此清空预览）',
      );
    });
  });

  describe('clearStore', () => {
    it('should call back with an empty treeMap so the host can drop the old tree', () => {
      const { spy, calls } = createSpy();
      init(MARKER_RENDER_MAP, spy);

      parseA2UI(columnTextsMessages.join('\n'));
      assert.equal(calls.length, 1);

      clearStore();

      assert.equal(calls.length, 2, '清空 store 也要通知渲染器一次');
      assert.deepEqual(calls[1], {}, '收到空 treeMap');
      assert.deepEqual(getAllTrees(), {}, 'store 侧同样已清空');
    });

    it('should be a no-op when no renderer is registered', () => {
      assert.doesNotThrow(() => clearStore());
    });
  });
});
