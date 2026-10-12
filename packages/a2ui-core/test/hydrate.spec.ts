import { strict as assert } from 'assert';

import { hydrate } from '../src/hydrate';
import { parseA2UI } from '../src/parser';
import { setRenderMap, type RenderContext } from '../src/renderer';
import { getHydrateNode, resetA2UIStore } from '../src/store';

const jsonl = (...messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

const surfaceUpdate = (surfaceId: string, components: Array<{ id: string; component: unknown }>) => ({
  surfaceUpdate: { surfaceId, components },
});

/** 只含单个 Text 组件的 surfaceUpdate。 */
const textUpdate = (surfaceId: string, id: string, literalString: string) =>
  surfaceUpdate(surfaceId, [{ id, component: { Text: { text: { literalString } } } }]);

describe('A2UI Hydrate', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
  });

  describe('渲染时机与数据绑定', () => {
    it('should see dataModelUpdate values that arrive after surfaceUpdate', () => {
      // 官方示例的消息顺序就是 surfaceUpdate → dataModelUpdate → beginRendering，
      // 如果渲染发生在 surfaceUpdate，这里读到的会是 undefined。
      setRenderMap({
        Text: (props, context) => context.read((props.text as { path: string }).path),
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', component: { Text: { text: { path: '/title' } } } }]),
          { dataModelUpdate: { surfaceId: 's', contents: [{ key: 'title', valueString: 'Hello' }] } },
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      assert.equal(getHydrateNode('root')!._vnode, 'Hello');
    });

    it('should expose componentId and surfaceId to the renderer', () => {
      let seen: Pick<RenderContext, 'componentId' | 'surfaceId'> | undefined;
      setRenderMap({
        Text: (_props, context) => {
          seen = { componentId: context.componentId, surfaceId: context.surfaceId };
          return null;
        },
      });

      parseA2UI(jsonl(textUpdate('s', 'root', 'Hi')));

      assert.deepEqual(seen, { componentId: 'root', surfaceId: 's' });
    });

    it('should re-render every node when hydrate runs again', () => {
      let calls = 0;
      setRenderMap({
        Text: () => {
          calls += 1;
          return 'vnode';
        },
      });

      parseA2UI(jsonl(textUpdate('s', 'a', 'A'), textUpdate('s', 'b', 'B')));
      assert.equal(calls, 2, '两个节点各渲染一次');

      hydrate();

      assert.equal(calls, 4, 'hydrate 是全量重渲染，不是增量');
    });

    it('should pick up a later dataModelUpdate on the next hydrate', () => {
      setRenderMap({
        Text: (props, context) => context.read((props.text as { path: string }).path),
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', component: { Text: { text: { path: '/title' } } } }]),
          { dataModelUpdate: { surfaceId: 's', contents: [{ key: 'title', valueString: 'First' }] } },
        ),
      );
      assert.equal(getHydrateNode('root')!._vnode, 'First');

      parseA2UI(
        jsonl({
          dataModelUpdate: { surfaceId: 's', contents: [{ key: 'title', valueString: 'Second' }] },
        }),
      );

      assert.equal(getHydrateNode('root')!._vnode, 'Second', '数据变了，节点应被重新渲染');
    });
  });

  describe('context.resolve 解析同 surface 的兄弟节点', () => {
    it('should resolve a sibling that is declared after the referring component', () => {
      setRenderMap({
        Text: (props) => `text:${(props.text as { literalString: string }).literalString}`,
        Column: (props, context) => {
          const ids = (props.children as { explicitList: string[] }).explicitList;
          // 容器约定：把子节点的解析推迟到真正渲染时再做（hydrate 单趟遍历时，
          // 定义在后面的兄弟节点还没渲染完，此刻立刻取会是 null）。
          return { render: () => ids.map((id) => context.resolve(id)) };
        },
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [
            { id: 'root', component: { Column: { children: { explicitList: ['a', 'b'] } } } },
            { id: 'a', component: { Text: { text: { literalString: 'A' } } } },
            { id: 'b', component: { Text: { text: { literalString: 'B' } } } },
          ]),
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      const column = getHydrateNode('root')!._vnode as { render: () => unknown[] };
      assert.deepEqual(column.render(), ['text:A', 'text:B']);
    });

    it('should return null for a component that is not registered', () => {
      setRenderMap({
        Column: (_props, context) => context.resolve('missing'),
      });

      parseA2UI(jsonl(surfaceUpdate('s', [{ id: 'root', component: { Column: {} } }])));

      assert.equal(getHydrateNode('root')!._vnode, null);
    });

    it('should not resolve a component that belongs to another surface', () => {
      setRenderMap({
        Text: () => 'text',
        Column: (_props, context) => context.resolve('other'),
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [
            { id: 'root', component: { Column: {} } },
            { id: 'other', component: { Text: { text: { literalString: 'X' } } } },
          ]),
          surfaceUpdate('t', [{ id: 'other', component: { Text: { text: { literalString: 'Y' } } } }]),
        ),
      );

      assert.equal(
        getHydrateNode('root')!._vnode,
        null,
        'componentId 相同但属于别的 surface 时不应被解析到',
      );
    });
  });
});
