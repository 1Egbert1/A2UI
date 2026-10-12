import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { h, type VNode } from 'vue';

import { init, parseA2UI, resetA2UIStore } from 'a2ui-core';
import { renderMap, renderText } from '../src/renderMap';
import { fakeContext, renderHtml } from './support';

/**
 * 渲染根元素的 id。
 *
 * 约定（由 `withRootId` 统一实现，见 src/internal/node.ts）：每个组件渲染出的**根元素**
 * 都带上 `id = "${surfaceId}-${componentId}"`。id 不是协议属性，而是渲染引擎附加的身份
 * 标记，用来把 DOM 反查回 store 里的组件。
 */

const COLUMN_MOCK = new URL('../../a2ui-core/mock/column-texts.jsonl', import.meta.url);
const MIX_MOCK = new URL('../../a2ui-core/mock/column-row-mix.jsonl', import.meta.url);

/** 混排 mock 里的组件总数（一组件一 id），用来锁住「id 不丢也不重」。 */
const MIX_COMPONENT_COUNT = 26;

/** 子组件渲染结果，给需要引用其它组件的 Card / Button / Tabs / Modal 用。 */
const CHILDREN = {
  a: h('span', 'A'),
  label: h('span', 'Add to Cart'),
  panel: h('div', 'panel-content'),
  trigger: h('span', 'Open'),
};

/** 取 HTML 的第一个标签（到第一个 `>` 为止），也就是「根元素的开标签」。 */
const rootTag = (html: string): string => {
  const end = html.indexOf('>');
  return end === -1 ? html : html.slice(0, end + 1);
};

/** 从一段 HTML 里捞出所有 id 值。 */
const idsIn = (html: string): string[] =>
  [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);

/** 每个组件类型的最小可用属性，用来驱动渲染器。 */
const CASES: Array<{ type: string; props: Record<string, unknown> }> = [
  { type: 'Text', props: { text: { literalString: 'T' }, usageHint: 'h1' } },
  { type: 'Image', props: { url: { literalString: 'https://x/y.png' } } },
  { type: 'Icon', props: { name: { literalString: 'check' } } },
  { type: 'Video', props: { url: { literalString: 'https://x/v.mp4' } } },
  { type: 'AudioPlayer', props: { url: { literalString: 'https://x/a.mp3' } } },
  { type: 'Divider', props: {} },
  { type: 'Row', props: { children: { explicitList: [] } } },
  { type: 'Column', props: { children: { explicitList: [] } } },
  { type: 'List', props: { children: { explicitList: [] } } },
  { type: 'Card', props: { child: 'panel' } },
  { type: 'Tabs', props: { tabItems: [{ title: { literalString: 'One' }, child: 'a' }] } },
  { type: 'Modal', props: { entryPointChild: 'trigger', contentChild: 'panel' } },
  { type: 'Button', props: { child: 'label' } },
  { type: 'CheckBox', props: { label: { literalString: 'C' } } },
  { type: 'TextField', props: { label: { literalString: 'F' } } },
  { type: 'DateTimeInput', props: { value: { literalString: '' } } },
  { type: 'MultipleChoice', props: { options: [{ label: { literalString: 'A' }, value: 'a' }] } },
  { type: 'Slider', props: { value: { literalNumber: 1 } } },
];

describe('A2UI Vue：渲染根元素的 id', () => {
  beforeEach(() => {
    resetA2UIStore();
  });

  describe('标准目录全组件覆盖', () => {
    for (const { type, props } of CASES) {
      it(`should put the surface-prefixed id on the ${type} root element`, async () => {
        const componentId = `c-${type}`;

        const vnode = renderMap[type](
          props,
          fakeContext({ componentId, surfaceId: 's', nodes: CHILDREN }),
        ) as VNode | null;
        assert.ok(vnode, `${type} 应渲染出节点`);

        const html = await renderHtml(vnode);
        assert.ok(
          rootTag(html).includes(`id="s-${componentId}"`),
          `${type} 的根元素开标签应含 id="s-${componentId}"，实际为 ${rootTag(html)}`,
        );
      });
    }
  });

  describe('id 的格式与来源', () => {
    it('should join surfaceId and componentId with a dash', async () => {
      const html = await renderHtml(
        renderMap.Text(
          { text: { literalString: 'Hi' } },
          fakeContext({ componentId: 'headline', surfaceId: 'home' }),
        ),
      );

      assert.match(html, /id="home-headline"/);
      assert.doesNotMatch(html, /id="headline"/, '裸 componentId 不带 surfaceId 前缀是不对的');
    });

    it('should keep the raw renderer unstamped (id is added by the map entry)', async () => {
      const raw = await renderHtml(
        renderText({ text: { literalString: 'Hi' } }, fakeContext({ componentId: 'headline' })),
      );

      assert.doesNotMatch(raw, /id=/, '直接调用渲染器不应带 id —— 加 id 是 renderMap 那一层的职责');
    });

    it('should carry no id when the renderer produces nothing', () => {
      // 缺 options 时 MultipleChoice 返回 null。
      const vnode = renderMap.MultipleChoice({}, fakeContext({ componentId: 'picker' }));

      assert.equal(vnode, null, 'renderer 返回 null 时没有根元素，也就没有 id 可挂');
    });
  });

  describe('唯一性', () => {
    it('should tell apart the same componentId across different surfaces', async () => {
      const contextOf = (surfaceId: string) =>
        fakeContext({ componentId: 'root', surfaceId, nodes: CHILDREN });

      const a = await renderHtml(renderMap.Column({ children: { explicitList: [] } }, contextOf('a')));
      const b = await renderHtml(renderMap.Column({ children: { explicitList: [] } }, contextOf('b')));

      assert.match(a, /id="a-root"/);
      assert.match(b, /id="b-root"/);
      assert.notEqual(idsIn(a)[0], idsIn(b)[0], '不同 surface 的同名组件必须拿到不同 id');
    });

    it('should give every component of the mix mock a distinct id', async () => {
      init(renderMap);
      const state = parseA2UI(readFileSync(fileURLToPath(MIX_MOCK), 'utf8'));

      const html = await renderHtml(state.treeMap['column-row-mix'].root.vnode as VNode);

      const ids = idsIn(html);
      assert.equal(ids.length, MIX_COMPONENT_COUNT, `混排 mock 应有 ${MIX_COMPONENT_COUNT} 个组件各带一个 id`);
      assert.equal(new Set(ids).size, ids.length, '渲染结果里的 id 必须两两不同');
    });
  });

  describe('组件 vnode 的属性透传（Tabs / Modal）', () => {
    it('should let the id fall through to the A2UITabs root div', async () => {
      const html = await renderHtml(
        renderMap.Tabs(
          { tabItems: [{ title: { literalString: 'One' }, child: 'a' }] },
          fakeContext({ componentId: 'tabs-1', surfaceId: 's', nodes: CHILDREN }),
        ),
      );

      assert.match(rootTag(html), /^<div/);
      assert.ok(rootTag(html).includes('id="s-tabs-1"'), `实际为 ${rootTag(html)}`);
    });

    it('should let the id fall through to the A2UIModal root div', async () => {
      const html = await renderHtml(
        renderMap.Modal(
          { entryPointChild: 'trigger', contentChild: 'panel' },
          fakeContext({ componentId: 'modal-1', surfaceId: 's', nodes: CHILDREN }),
        ),
      );

      assert.match(rootTag(html), /^<div/);
      assert.ok(rootTag(html).includes('id="s-modal-1"'), `实际为 ${rootTag(html)}`);
    });
  });

  describe('真实解析链路（mock/column-texts.jsonl）', () => {
    beforeEach(() => {
      init(renderMap);
    });

    it('should stamp every component in the rendered tree with its id', async () => {
      const state = parseA2UI(readFileSync(fileURLToPath(COLUMN_MOCK), 'utf8'));

      const html = await renderHtml(state.treeMap['column-texts'].root.vnode as VNode);

      for (const componentId of ['root', 'title', 'body', 'caption']) {
        assert.match(html, new RegExp(`id="column-texts-${componentId}"`), `${componentId} 应有对应 id`);
      }

      // id 要落在正确的元素上：Column 是外层 div，三个 Text 分别是 h2 / p / small。
      assert.match(html, /<div[^>]*id="column-texts-root"/);
      assert.match(html, /<h2[^>]*id="column-texts-title"/);
      assert.match(html, /<p[^>]*id="column-texts-body"/);
      assert.match(html, /<small[^>]*id="column-texts-caption"/);
    });

    it('should expose the id on the stored vnode, not only in the DOM', () => {
      const state = parseA2UI(readFileSync(fileURLToPath(COLUMN_MOCK), 'utf8'));

      const root = state.treeMap['column-texts'].root;
      assert.equal((root.vnode as VNode).props?.id, 'column-texts-root');
      assert.equal((root.children[0].vnode as VNode).props?.id, 'column-texts-title');
    });
  });
});
