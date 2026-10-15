import { strict as assert } from 'assert';

import { hydrate } from '../src/hydrate';
import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getA2UIStore,
  getHydrateNode,
  getSurface,
  markHydrateNodeMounted,
  resetA2UIStore,
} from '../src/store';

/**
 * 入场动画的「标记 / 清除」两端。
 *
 * - 标记（mark）：`surfaceUpdate` 登记新组件时把 `hasMounted` 置为 `false`；
 * - 清除（clear）：渲染引擎在动画结束时回调 `markMounted` / `markHydrateNodeMounted`
 *   把同一位置回 `true`，此后不再重播。
 *
 * 这个文件锁住三件事：初始标记、清除的语义与幂等、以及清除后渲染器能读到新值。
 */

const jsonl = (...messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

const surfaceUpdate = (surfaceId: string, components: Array<{ id: string; component: unknown }>) => ({
  surfaceUpdate: { surfaceId, components },
});

const textUpdate = (surfaceId: string, id: string, literalString: string) =>
  surfaceUpdate(surfaceId, [{ id, component: { Text: { text: { literalString } } } }]);

const beginRendering = (surfaceId: string, root: string) => ({ beginRendering: { surfaceId, root } });

describe('A2UI 入场动画标记（hasMounted）', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
  });

  describe('标记：新组件从 false 开始', () => {
    it('should start every newly registered node as not yet mounted', () => {
      parseA2UI(jsonl(surfaceUpdate('s', [
        { id: 'root', component: { Text: { text: { literalString: 'Root' } } } },
        { id: 'child', component: { Text: { text: { literalString: 'Child' } } } },
      ])));

      assert.equal(getHydrateNode('root')!.hasMounted, false, '新组件应待播入场动画');
      assert.equal(getHydrateNode('child')!.hasMounted, false, '新组件应待播入场动画');
    });

    it('should keep the flag when the same component is redefined', () => {
      parseA2UI(jsonl(textUpdate('s', 'root', 'First')));
      markHydrateNodeMounted('root');
      assert.equal(getHydrateNode('root')!.hasMounted, true, '前置条件：标记已被清除');

      // 同一 componentId 又来一条 surfaceUpdate（协议允许）：只换协议内容，不该重播动画。
      parseA2UI(jsonl(textUpdate('s', 'root', 'Second')));

      assert.equal(getHydrateNode('root')!.hasMounted, true, '重复定义不应把已清除的标记又设回 false');
      assert.match(getHydrateNode('root')!.protocol, /Second/, '协议内容应更新为最新的一次定义');
    });
  });

  describe('清除：markHydrateNodeMounted', () => {
    beforeEach(() => {
      parseA2UI(
        jsonl(
          textUpdate('s', 'root', 'Hi'),
          beginRendering('s', 'root'),
        ),
      );
    });

    it('should flip hasMounted to true', () => {
      markHydrateNodeMounted('root');
      assert.equal(getHydrateNode('root')!.hasMounted, true);
    });

    it('should mutate the node in place, keeping Surface.rootNode identical', () => {
      const before = getSurface('s')!.rootNode;

      markHydrateNodeMounted('root');

      assert.equal(
        getSurface('s')!.rootNode,
        getHydrateNode('root'),
        '清除标记不能换掉节点对象，否则 Surface.rootNode 会与 hydrateNodeMap 失联',
      );
      assert.equal(getSurface('s')!.rootNode, before, '应是同一个对象（原地修改）');
    });

    it('should notify subscribers exactly once per real change', () => {
      const store = getA2UIStore();
      let notifications = 0;
      const unsubscribe = store.subscribe(() => {
        notifications += 1;
      });

      markHydrateNodeMounted('root');
      assert.equal(notifications, 1, '第一次清除应通知一次');

      markHydrateNodeMounted('root');
      assert.equal(notifications, 1, '已经是 true 时不应产生多余通知（幂等）');

      unsubscribe();
    });

    it('should be a silent no-op for an unknown componentId', () => {
      assert.doesNotThrow(() => markHydrateNodeMounted('nope'));
      assert.equal(getHydrateNode('nope'), undefined);
    });
  });

  describe('渲染上下文的两端', () => {
    it('should read hasMounted in the renderer and write it back via markMounted', () => {
      const seen: boolean[] = [];
      let mark: (() => void) | undefined;

      setRenderMap({
        Text: (_props, context) => {
          seen.push(context.hasMounted);
          mark = context.markMounted;
          return null;
        },
      });

      parseA2UI(
        jsonl(
          textUpdate('s', 'root', 'Hi'),
          beginRendering('s', 'root'),
        ),
      );

      assert.deepEqual(seen, [false], '首次渲染时渲染器应读到 hasMounted=false');
      assert.equal(typeof mark, 'function', '上下文应暴露 markMounted');

      // 模拟渲染引擎在动画结束时回调。
      mark!();
      assert.equal(getHydrateNode('root')!.hasMounted, true, 'markMounted 应把 store 里的标记置为 true');

      hydrate();
      assert.deepEqual(seen, [false, true], '清除后再渲染，渲染器应读到 true');
    });
  });
});
