import { strict as assert } from 'assert';

import type { VNode } from 'vue';

import { listTemplateMessages } from '../../a2ui-core/mock/list-template';
import { getHydrateNode, init, parseA2UI, resetA2UIStore } from 'a2ui-core';
import { renderMap } from '../src/renderMap';
import { renderHtml } from './support';

/** 取某个组件 hydrate 后的真实 vnode。 */
const vnodeOf = (componentId: string): VNode => getHydrateNode(componentId)!._vnode as VNode;

/** 取 vnode 的 children（容器组件渲染成 div + 子节点数组）。 */
const childrenOf = (vnode: VNode): VNode[] => (vnode.children as VNode[]) ?? [];

describe('List children.template 动态渲染（真实渲染器）', () => {
  beforeEach(() => {
    resetA2UIStore();
    init(renderMap); // 注入真实 Vue 渲染器
  });

  it('should render one template instance per item', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const items = childrenOf(vnodeOf('list'));
    assert.equal(items.length, 3, '集合里有 3 个 item，List 应渲染出 3 个子节点');
  });

  it('should give every item its own unique id', () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const ids = childrenOf(vnodeOf('list')).map(
      (child) => (child.props as Record<string, unknown>).id,
    );
    assert.deepEqual(
      ids,
      [
        'list-template-item-card-p1',
        'list-template-item-card-p2',
        'list-template-item-card-p3',
      ],
      '同一模板渲染 N 次，每个实例都要有唯一 id（surfaceId-componentId-itemKey）',
    );
  });

  it('should render each item bound value via SSR', async () => {
    parseA2UI(listTemplateMessages.join('\n'));

    const html = await renderHtml(vnodeOf('list'));
    assert.match(html, /Product A/);
    assert.match(html, /Product B/);
    assert.match(html, /Product C/);
    assert.match(html, /The first product/);
  });
});
