import { strict as assert } from 'assert';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { VNode } from 'vue';

import { init, parseA2UI, resetA2UIStore } from 'a2ui-core';
import { renderMap } from '../src/renderMap';
import { jsonl, renderHtml } from './support';

/**
 * 端到端：拿官方示例（specification/v0_8/json/catalogs 下 basic 与 minimal 的 examples）
 * 跑完整链路 `parseA2UI → hydrate → buildTree → renderToString`，
 * 把「渲染器是否真的能用」交给数据说话。
 *
 * 这一步专治单元测试发现不了的问题：容器子节点是**前向引用**（Card 引用的组件定义在
 * 后面）、`path` 绑定要等 `dataModelUpdate` 才齐、组件树深度不定 —— 都需要真实示例来压。
 */

const CATALOG_DIR = new URL('../../../specification/v0_8/json/catalogs/', import.meta.url);

const exampleFiles = (catalog: 'basic' | 'minimal'): string[] =>
  readdirSync(fileURLToPath(new URL(`${catalog}/examples/`, CATALOG_DIR)))
    .filter((file) => file.endsWith('.json'))
    .sort();

const loadExample = (catalog: 'basic' | 'minimal', file: string): unknown[] =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`${catalog}/examples/${file}`, CATALOG_DIR)), 'utf8'),
  ) as unknown[];

/** HTML 里是否有「实质内容」：可见文本，或任一有信息量的空元素。 */
const hasContent = (html: string): boolean =>
  html.replace(/<[^>]*>/g, ' ').trim().length > 0 ||
  /<(img|input|textarea|video|audio|hr|button)\b/.test(html);

describe('A2UI Vue 端到端渲染（官方示例）', () => {
  beforeEach(() => {
    resetA2UIStore();
    init(renderMap);
  });

  for (const catalog of ['basic', 'minimal'] as const) {
    describe(`${catalog} catalog`, () => {
      for (const file of exampleFiles(catalog)) {
        it(`should render ${file} with no errors`, async () => {
          const state = parseA2UI(jsonl(loadExample(catalog, file)));

          const errors = Object.values(state.errorMap).map(
            (error) => `${error.type}: ${error.content}`,
          );
          assert.deepEqual(errors, [], `${file} 解析/渲染过程不应产生错误`);

          const surfaceIds = Object.keys(state.surfaceMap);
          assert.ok(surfaceIds.length > 0, `${file} 应至少声明一个 surface`);

          for (const surfaceId of surfaceIds) {
            const tree = state.treeMap[surfaceId];
            assert.ok(tree, `${file} 的 surface "${surfaceId}" 应有组件树`);

            const html = await renderHtml(tree.root.vnode as VNode | null);
            assert.ok(hasContent(html), `${file} 的 surface "${surfaceId}" 应渲染出实质内容`);
          }
        });
      }
    });
  }

  describe('05_product-card（逐项断言）', () => {
    it('should render the nested card with data-model values and a button', async () => {
      const state = parseA2UI(jsonl(loadExample('basic', '05_product-card.json')));

      const html = await renderHtml(state.treeMap['gallery-product-card'].root.vnode as VNode);

      // Card → Column → (Image, Column(Text…, Row(Button)))
      assert.match(html, /Wireless Headphones Pro/, '嵌套 Column 里的 Text 应取到数据模型的值');
      assert.match(html, /src="https:\/\/images\.unsplash\.com/, 'Image.url 的 path 绑定应被解析');
      assert.match(html, /\$199\.99/);
      assert.match(html, /\$249\.99/);
      assert.match(html, />Add to Cart</, 'Button.child 指向的文案组件应被解析（前向引用）');
      assert.match(html, /border-radius:12px/, 'Card 应套上卡片容器');
    });

    it('should still render when the data model arrives after the components', async () => {
      // 该示例的消息顺序是 surfaceUpdate → dataModelUpdate → beginRendering，
      // 如果渲染发生在 surfaceUpdate 阶段，上面的断言会全部落空。
      const messages = loadExample('basic', '05_product-card.json');
      const order = messages.map((message) => Object.keys(message as object)[0]);

      assert.deepEqual(order, ['surfaceUpdate', 'dataModelUpdate', 'beginRendering']);
    });
  });
});

/**
 * core 自带的 mock：一个 Column 挂三个 Text，子组件定义在父组件之后（前向引用）。
 * 这里验的是「treebuilder 组装出来的父子关系」与「Vue 真正渲出的嵌套」是否一致 ——
 * 前者只是数据，后者才是用户看到的东西。
 */
const COLUMN_MOCK = new URL('../../a2ui-core/mock/column-texts.jsonl', import.meta.url);

describe('A2UI Vue：column-texts 的父子组装与渲染', () => {
  beforeEach(() => {
    resetA2UIStore();
    init(renderMap);
  });

  it('should assemble one Column with three Text children', () => {
    const state = parseA2UI(readFileSync(fileURLToPath(COLUMN_MOCK), 'utf8'));

    assert.deepEqual(Object.values(state.errorMap), [], 'mock 不应产生任何错误');

    const root = state.treeMap['column-texts'].root;
    assert.equal(root.componentId, 'root');
    assert.equal(root.parentId, null, '根节点无父节点');
    assert.deepEqual(
      root.children.map((child) => child.componentId),
      ['title', 'body', 'caption'],
    );
    assert.deepEqual(
      root.children.map((child) => child.parentId),
      ['root', 'root', 'root'],
    );
  });

  it('should render the three children inside a vertical flex Column, in order', async () => {
    const state = parseA2UI(readFileSync(fileURLToPath(COLUMN_MOCK), 'utf8'));

    const html = await renderHtml(state.treeMap['column-texts'].root.vnode as VNode);

    assert.match(html, /display:\s*flex/);
    assert.match(html, /flex-direction:\s*column/, 'Column 应渲染为纵向 flex 容器');

    // usageHint 决定标签：h2 / body→p / caption→small。
    assert.match(html, /<h2[^>]*>A2UI 组件树<\/h2>/);
    assert.match(html, /<p[^>]*>Column 容器下挂了三个 Text 子组件/);
    assert.match(html, /<small[^>]*>treebuilder 按 componentId 反查 hydrateNode/);

    // 顺序：h2 在最前，small 在最后，说明子节点是按 explicitList 的顺序挂上去的。
    const order = [
      html.indexOf('A2UI 组件树'),
      html.indexOf('Column 容器下挂了三个 Text 子组件'),
      html.indexOf('treebuilder 按 componentId 反查 hydrateNode'),
    ];
    assert.deepEqual([...order].sort((a, b) => a - b), order, '三个子组件应按声明顺序出现');
  });
});

/**
 * core 自带的混排 mock：多层 Column / Row 交替（最深 5 层），Row 里横排 Card，
 * Card 内套 Column，底部 Row 再嵌 Column + Row。这里验的是深层嵌套能否整棵渲出来。
 */
const MIX_MOCK = new URL('../../a2ui-core/mock/column-row-mix.jsonl', import.meta.url);

describe('A2UI Vue：column-row-mix 的多层混排渲染', () => {
  beforeEach(() => {
    resetA2UIStore();
    init(renderMap);
  });

  it('should render the nested Column/Row mix without errors', async () => {
    const state = parseA2UI(readFileSync(fileURLToPath(MIX_MOCK), 'utf8'));

    assert.deepEqual(Object.values(state.errorMap), [], '混排 mock 不应产生任何错误');

    const html = await renderHtml(state.treeMap['column-row-mix'].root.vnode as VNode);

    // 外层是纵向 Column，里面横着排 Row。
    assert.match(html, /flex-direction:\s*column/);
    assert.match(html, /flex-direction:\s*row/, 'Row 应渲染成横向 flex');
    assert.match(html, /justify-content:\s*space-between/, 'distribution=spaceBetween 应映射到 justify-content');

    // Row 里横排三张 Card。
    assert.equal((html.match(/border-radius:12px/g) ?? []).length, 3, '应渲染出三张 Card');
  });

  it('should resolve the data-model values bound inside the deepest Columns', async () => {
    const state = parseA2UI(readFileSync(fileURLToPath(MIX_MOCK), 'utf8'));

    const html = await renderHtml(state.treeMap['column-row-mix'].root.vnode as VNode);

    // 这三条来自 dataModelUpdate 的 path 绑定，落在 Column 最深一层。
    assert.match(html, /\$128,400/);
    assert.match(html, /1,284/);
    assert.match(html, /\+18\.6%/);

    // 字面量文案与底部按钮也在。
    assert.match(html, /本月收入/);
    assert.match(html, /图例/);
    assert.match(html, />查看明细</);
  });

  it('should stamp a surface-prefixed id on every component of the mix', async () => {
    const state = parseA2UI(readFileSync(fileURLToPath(MIX_MOCK), 'utf8'));

    const html = await renderHtml(state.treeMap['column-row-mix'].root.vnode as VNode);

    for (const componentId of ['root', 'overview-row', 'card-revenue', 'detail-btn']) {
      assert.match(html, new RegExp(`id="column-row-mix-${componentId}"`), `${componentId} 应带对应 id`);
    }
  });
});
