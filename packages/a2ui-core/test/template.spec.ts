import { strict as assert } from 'assert';

import { readString } from '../src/binding';
import { listTemplateMessages } from '../mock/list-template';
import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import { getHydrateNode, resetA2UIStore, setDataModel } from '../src/store';
import { setTreeRenderer } from '../src/tree-render';

/**
 * 递归假渲染器：验证 `children.template` 的展开与「item 相对绑定」。
 *
 * - `List` 调 `context.renderTemplate(componentId, dataBinding)`，拿到一组 `{ key, node }` 条目；
 *   `key` 是集合里的键，渲染引擎用它当子节点的稳定身份；
 * - `Card` / `Column` 递归 `context.resolve` 下钻子树；
 * - `Text` 用真实 `readString` 读 `path`，断言能读到「item 段被替换后」的值。
 *
 * 每个渲染结果都带上 `itemKey`，用来断言 item 作用域是否正确传递。
 */
const installRenderers = () => {
  setRenderMap({
    Column: (props, context) => {
      const explicitList = (props.children as { explicitList?: unknown } | undefined)?.explicitList;
      const ids = Array.isArray(explicitList)
        ? explicitList.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        type: 'Column',
        itemKey: context.itemKey,
        children: ids.map((id) => context.resolve(id)),
      };
    },
    List: (props, context) => {
      const template = (props.children as { template: { componentId: string; dataBinding: string } })
        .template;
      return {
        type: 'List',
        items: context.renderTemplate(template.componentId, template.dataBinding),
      };
    },
    Card: (props, context) => ({
      type: 'Card',
      itemKey: context.itemKey,
      child: context.resolve(String(props.child ?? '')),
    }),
    Text: (props, context) => ({
      type: 'Text',
      itemKey: context.itemKey,
      text: readString(props.text, context.read),
    }),
  });
};

describe('List children.template 动态渲染', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
    setTreeRenderer(null);
    installRenderers();
  });

  it('should render one template instance per collection item', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const list = getHydrateNode('list')!._vnode as { type: string; items: unknown[] };
    assert.equal(list.type, 'List');
    assert.equal(list.items.length, 3, '集合里有 3 个 item，应渲染出 3 份模板');
  });

  it('should expose each item key alongside its node, for the renderer to key on', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const list = getHydrateNode('list')!._vnode as { items: Array<{ key: string }> };
    assert.deepEqual(
      list.items.map((item) => item.key),
      ['p1', 'p2', 'p3'],
      '模板展开应把集合的键一起交出来（渲染引擎拿它当子节点的稳定身份）',
    );
  });

  it('should tag each item with its own itemKey scope', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const list = getHydrateNode('list')!._vnode as {
      items: Array<{ node: { itemKey: string } }>;
    };
    assert.deepEqual(
      list.items.map((item) => item.node.itemKey),
      ['p1', 'p2', 'p3'],
      '每个 item 应带上自己的 key 作用域',
    );
  });

  it('should resolve the relative `item` token in nested bindings', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const list = getHydrateNode('list')!._vnode as {
      items: Array<{ node: { child: { children: Array<{ text: string }> } } }>;
    };

    const first = list.items[0].node.child.children.map((node) => node.text);
    const last = list.items[2].node.child.children.map((node) => node.text);

    assert.deepEqual(first, ['Product A', 'The first product'], 'p1 的相对绑定应命中 /items/p1/*');
    assert.deepEqual(last, ['Product C', 'The third product'], 'p3 的相对绑定应命中 /items/p3/*');
  });

  it('should treat a raw array as a collection indexed by position', () => {
    // 协议没有 valueArray，这里是「宿主直塞数组进数据模型」的兼容路径：
    // readCollection 按下标做 key，readPath 支持数组下标下钻。
    const jsonl = [
      '{"surfaceUpdate":{"surfaceId":"arr","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["list"]}}}},{"id":"list","component":{"List":{"children":{"template":{"componentId":"item","dataBinding":"/arr"}}}}},{"id":"item","component":{"Text":{"text":{"path":"/arr/item/name"}}}}]}}',
      '{"beginRendering":{"surfaceId":"arr","root":"root"}}',
    ].join('\n');

    setDataModel('arr', { arr: [{ name: 'Zero' }, { name: 'One' }] });
    parseA2UI(jsonl);

    const list = getHydrateNode('list')!._vnode as {
      items: Array<{ key: string; node: { itemKey: string; text: string } }>;
    };
    assert.equal(list.items.length, 2);
    assert.deepEqual(
      list.items.map((item) => item.node.itemKey),
      ['0', '1'],
      '数组按下标作为 item key',
    );
    assert.deepEqual(
      list.items.map((item) => item.key),
      ['0', '1'],
      '交出来的条目 key 同样按下标',
    );
    assert.equal(list.items[0].node.text, 'Zero', '相对绑定 /arr/item/name → /arr/0/name');
    assert.equal(list.items[1].node.text, 'One', '相对绑定 /arr/item/name → /arr/1/name');
  });

  it('should render nothing when the dataBinding path is missing', () => {
    const jsonl = [
      '{"surfaceUpdate":{"surfaceId":"empty","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["list"]}}}},{"id":"list","component":{"List":{"children":{"template":{"componentId":"item","dataBinding":"/nope"}}}}},{"id":"item","component":{"Text":{"text":{"path":"/nope/item/name"}}}}]}}',
      '{"beginRendering":{"surfaceId":"empty","root":"root"}}',
    ].join('\n');

    parseA2UI(jsonl);

    const list = getHydrateNode('list')!._vnode as { items: unknown[] };
    assert.deepEqual(list.items, [], 'dataBinding 指向不存在的 path 时应渲染为空');
  });
});
