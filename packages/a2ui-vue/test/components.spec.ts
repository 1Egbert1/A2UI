import { strict as assert } from 'assert';

import { h } from 'vue';
import type { VNode } from 'vue';

import { ErrorType, getAllErrors, resetA2UIStore } from 'a2ui-core';
import {
  renderAudioPlayer,
  renderButton,
  renderCard,
  renderCheckBox,
  renderColumn,
  renderDateTimeInput,
  renderDivider,
  renderIcon,
  renderImage,
  renderList,
  renderModal,
  renderMultipleChoice,
  renderRow,
  renderSlider,
  renderTabs,
  renderText,
  renderTextField,
  renderVideo,
} from '../src/renderMap';
import { fakeContext, renderHtml } from './support';

/** 子节点的渲染结果，模拟「已经 hydration 完的兄弟组件」。 */
const CHILDREN = {
  a: h('span', { class: 'child-a' }, 'A'),
  b: h('span', { class: 'child-b' }, 'B'),
  label: h('span', 'Add to Cart'),
  panel: h('div', 'panel-content'),
  trigger: h('span', 'Open'),
};

describe('A2UI Vue 组件渲染器', () => {
  beforeEach(() => {
    resetA2UIStore();
  });

  describe('Text', () => {
    it('should map usageHint to a tag', async () => {
      const html = await renderHtml(renderText({ text: { literalString: 'Hello' }, usageHint: 'h1' }, fakeContext()));

      assert.match(html, /^<h1[^>]*>Hello<\/h1>$/);
    });

    it('should fall back to span without usageHint', async () => {
      const html = await renderHtml(renderText({ text: { literalString: 'Hello' } }, fakeContext()));

      assert.match(html, /^<span[^>]*>Hello<\/span>$/);
    });

    it('should render caption as small', async () => {
      const html = await renderHtml(renderText({ text: { literalString: 'tiny' }, usageHint: 'caption' }, fakeContext()));

      assert.match(html, /^<small[^>]*>tiny<\/small>$/);
    });

    it('should read the text from the data model when a path is given', async () => {
      const context = fakeContext({ data: { doc: { title: 'From data model' } } });

      const html = await renderHtml(renderText({ text: { path: '/doc/title' } }, context));

      assert.match(html, /From data model/);
    });

    it('should render an empty element when the bound value is missing', async () => {
      const html = await renderHtml(renderText({ text: { path: '/nope' } }, fakeContext()));

      assert.match(html, /^<span[^>]*><\/span>$/);
    });
  });

  describe('Image', () => {
    it('should render src, object-fit and usageHint size', async () => {
      const html = await renderHtml(
        renderImage({ url: { literalString: 'https://x/y.png' }, fit: 'contain', usageHint: 'avatar' }, fakeContext()),
      );

      assert.match(html, /<img/);
      assert.match(html, /src="https:\/\/x\/y\.png"/);
      assert.match(html, /object-fit:contain/);
      assert.match(html, /width:40px/);
      assert.match(html, /border-radius:50%/);
    });

    it('should read the url from the data model', async () => {
      const context = fakeContext({ data: { imageUrl: 'https://x/z.png' } });

      const html = await renderHtml(renderImage({ url: { path: '/imageUrl' } }, context));

      assert.match(html, /src="https:\/\/x\/z\.png"/);
    });
  });

  describe('Icon', () => {
    it('should render a glyph for a known icon name', async () => {
      const html = await renderHtml(renderIcon({ name: { literalString: 'check' } }, fakeContext()));

      assert.match(html, /✅/);
      assert.match(html, /title="check"/);
    });

    it('should fall back to a placeholder for an unknown name', async () => {
      const html = await renderHtml(renderIcon({ name: { literalString: 'no-such-icon' } }, fakeContext()));

      assert.match(html, /▢/);
    });

    it('should read the icon name from the data model', async () => {
      const context = fakeContext({ data: { action: 'search' } });

      const html = await renderHtml(renderIcon({ name: { path: '/action' } }, context));

      assert.match(html, /🔍/);
    });
  });

  describe('Video', () => {
    it('should render a video element with controls', async () => {
      const html = await renderHtml(renderVideo({ url: { literalString: 'https://x/v.mp4' } }, fakeContext()));

      assert.match(html, /<video/);
      assert.match(html, /src="https:\/\/x\/v\.mp4"/);
      assert.match(html, /controls/);
    });
  });

  describe('AudioPlayer', () => {
    it('should render the description above the audio element', async () => {
      const html = await renderHtml(
        renderAudioPlayer(
          { url: { literalString: 'https://x/a.mp3' }, description: { literalString: 'Song title' } },
          fakeContext(),
        ),
      );

      assert.match(html, /<audio/);
      assert.match(html, /src="https:\/\/x\/a\.mp3"/);
      assert.match(html, /Song title/);
    });

    it('should omit the description when it is not provided', async () => {
      const html = await renderHtml(renderAudioPlayer({ url: { literalString: 'https://x/a.mp3' } }, fakeContext()));

      assert.equal((html.match(/<div/g) ?? []).length, 1, '没有 description 时只应剩外层容器');
    });
  });

  describe('Divider', () => {
    it('should render a horizontal rule by default', async () => {
      const html = await renderHtml(renderDivider({}, fakeContext()));

      assert.match(html, /<hr/);
    });

    it('should render a vertical separator when axis is vertical', async () => {
      const html = await renderHtml(renderDivider({ axis: 'vertical' }, fakeContext()));

      assert.match(html, /aria-orientation="vertical"/);
    });
  });

  describe('Row / Column / List', () => {
    it('should render the explicit children in order', async () => {
      const html = await renderHtml(
        renderRow({ children: { explicitList: ['a', 'b'] } }, fakeContext({ nodes: CHILDREN })),
      );

      assert.match(html, /child-a[\s\S]*child-b/);
      assert.match(html, /display:flex/);
      assert.match(html, /flex-direction:row/);
    });

    it('should map distribution and alignment to flex properties', async () => {
      const html = await renderHtml(
        renderRow(
          { children: { explicitList: [] }, distribution: 'spaceBetween', alignment: 'center' },
          fakeContext(),
        ),
      );

      assert.match(html, /justify-content:space-between/);
      assert.match(html, /align-items:center/);
    });

    it('should lay out Column vertically', async () => {
      const html = await renderHtml(renderColumn({ children: { explicitList: [] } }, fakeContext()));

      assert.match(html, /flex-direction:column/);
    });

    it('should lay out List horizontally when direction is horizontal', async () => {
      const html = await renderHtml(
        renderList({ children: { explicitList: [] }, direction: 'horizontal' }, fakeContext()),
      );

      assert.match(html, /flex-direction:row/);
    });

    it('should expand children.template through renderTemplate', async () => {
      const calls: Array<[string, string]> = [];
      const context = fakeContext({
        componentId: 'board',
        surfaceId: 's',
        renderTemplate: (componentId: string, dataBinding: string) => {
          calls.push([componentId, dataBinding]);
          return [{ key: 'i0', node: h('span', null, 'ITEM') }];
        },
      });

      const html = await renderHtml(
        renderColumn({ children: { template: { componentId: 'x', dataBinding: '/items' } } }, context),
      );

      assert.deepEqual(calls, [['x', '/items']], 'template 应调用 renderTemplate(componentId, dataBinding)');
      assert.match(html, /ITEM/, 'renderTemplate 返回的节点应渲染进容器');
    });

    it('should key template items by the collection key so they move with their item', () => {
      const context = fakeContext({
        componentId: 'board',
        surfaceId: 's',
        renderTemplate: () => [
          { key: 'c1', node: h('span', null, 'A') },
          { key: 'c2', node: h('span', null, 'B') },
          { key: 'c3', node: h('span', null, 'C') },
        ],
      });

      const vnode = renderList(
        { children: { template: { componentId: 'x', dataBinding: '/items' } } },
        context,
      ) as VNode;
      const children = vnode.children as VNode[];

      assert.deepEqual(
        children.map((child) => child.key),
        ['c1', 'c2', 'c3'],
        '每个模板子节点应带上集合的 key（插入/删除时 Vue 才能跟着 item 移动节点）',
      );
    });

    it('should leave explicitList children unkeyed (protocol order is static)', () => {
      const context = fakeContext({ nodes: { a: h('span', null, 'A'), b: h('span', null, 'B') } });

      const vnode = renderRow({ children: { explicitList: ['a', 'b'] } }, context) as VNode;
      const children = vnode.children as VNode[];

      assert.deepEqual(
        children.map((child) => child.key ?? null),
        [null, null],
        'explicitList 由协议写死、顺序不会变，不需要 key',
      );
    });

    it('should treat a missing children property as empty', async () => {
      const html = await renderHtml(renderRow({}, fakeContext()));

      assert.match(html, /<div[^>]*><\/div>/);
    });
  });

  describe('Card', () => {
    it('should wrap the referenced child', async () => {
      const html = await renderHtml(renderCard({ child: 'panel' }, fakeContext({ nodes: CHILDREN })));

      assert.match(html, /panel-content/);
      assert.match(html, /border-radius:12px/);
    });

    it('should render an empty card when the child is unknown', async () => {
      const html = await renderHtml(renderCard({ child: 'missing' }, fakeContext()));

      assert.match(html, /^<div[^>]*>/);
      assert.equal(html.replace(/<[^>]*>/g, '').trim(), '', '子组件取不到时卡片应为空');
    });
  });

  describe('Tabs', () => {
    const props = {
      tabItems: [
        { title: { literalString: 'First' }, child: 'a' },
        { title: { literalString: 'Second' }, child: 'b' },
      ],
    };

    it('should render every tab title', async () => {
      const html = await renderHtml(renderTabs(props, fakeContext({ nodes: CHILDREN })));

      assert.match(html, />First</);
      assert.match(html, />Second</);
    });

    it('should render only the active panel content', async () => {
      const html = await renderHtml(renderTabs(props, fakeContext({ nodes: CHILDREN })));

      assert.match(html, /child-a/);
      assert.doesNotMatch(html, /child-b/);
    });

    it('should resolve a title from the data model', async () => {
      const context = fakeContext({
        nodes: CHILDREN,
        data: { options: { title: 'From model' } },
      });

      const html = await renderHtml(
        renderTabs({ tabItems: [{ title: { path: '/options/title' }, child: 'a' }] }, context),
      );

      assert.match(html, /From model/);
    });
  });

  describe('Modal', () => {
    it('should render the entry point and hide the content initially', async () => {
      const html = await renderHtml(
        renderModal({ entryPointChild: 'trigger', contentChild: 'panel' }, fakeContext({ nodes: CHILDREN })),
      );

      assert.match(html, /Open/);
      assert.doesNotMatch(html, /panel-content/, '弹层未打开时不应渲染内容');
    });
  });

  describe('Button', () => {
    it('should render the referenced child as its label', async () => {
      const html = await renderHtml(
        renderButton({ child: 'label', action: { name: 'addToCart' } }, fakeContext({ nodes: CHILDREN })),
      );

      assert.match(html, /<button[^>]*type="button"/);
      assert.match(html, /Add to Cart/);
      assert.match(html, /background:#ffffff/, '非主按钮应是浅色底');
    });

    it('should style the primary variant', async () => {
      const html = await renderHtml(
        renderButton({ child: 'label', primary: true, action: { name: 'x' } }, fakeContext({ nodes: CHILDREN })),
      );

      assert.match(html, /background:#409eff/);
    });

    it('should dispatch the protocol action as a bubbling custom event', () => {
      const action = { name: 'addToCart', context: [{ key: 'sku', value: { literalString: 'A-1' } }] };
      const vnode = renderButton({ child: 'label', action }, fakeContext({ nodes: CHILDREN })) as VNode;

      const received: unknown[] = [];
      const fakeTarget = { dispatchEvent: (event: unknown) => received.push(event) };

      (vnode.props as { onClick: (event: unknown) => void }).onClick({ currentTarget: fakeTarget });

      assert.equal(received.length, 1, '点击应下发一次 action');
      const event = received[0] as CustomEvent;
      assert.equal(event.type, 'a2ui-action');
      assert.equal(event.bubbles, true);
      assert.deepEqual(event.detail, action);
    });

    it('should not dispatch when the action is missing', () => {
      const vnode = renderButton({ child: 'label' }, fakeContext({ nodes: CHILDREN })) as VNode;

      const received: unknown[] = [];
      const fakeTarget = { dispatchEvent: (event: unknown) => received.push(event) };

      (vnode.props as { onClick: (event: unknown) => void }).onClick({ currentTarget: fakeTarget });

      assert.deepEqual(received, []);
    });
  });

  describe('CheckBox', () => {
    it('should render the label and the literal checked state', async () => {
      const html = await renderHtml(
        renderCheckBox({ label: { literalString: 'Remember me' }, value: { literalBoolean: true } }, fakeContext()),
      );

      assert.match(html, /Remember me/);
      assert.match(html, /<input[^>]*type="checkbox"/);
      assert.match(html, /<input[^>]*checked/);
    });

    it('should leave the box unchecked by default', async () => {
      const html = await renderHtml(
        renderCheckBox({ label: { literalString: 'x' }, value: { path: '/nope' } }, fakeContext()),
      );

      assert.doesNotMatch(html, /checked/);
    });

    it('should read the value from the data model', async () => {
      const context = fakeContext({ data: { filter: { open: true } } });

      const html = await renderHtml(
        renderCheckBox({ label: { literalString: 'Open only' }, value: { path: '/filter/open' } }, context),
      );

      assert.match(html, /checked/);
    });
  });

  describe('TextField', () => {
    it('should render the label and a short text input by default', async () => {
      const html = await renderHtml(renderTextField({ label: { literalString: 'Name' } }, fakeContext()));

      assert.match(html, /Name/);
      assert.match(html, /<input[^>]*type="text"/);
    });

    it('should map textFieldType to the native input type', async () => {
      const number = await renderHtml(
        renderTextField({ label: { literalString: 'Age' }, textFieldType: 'number' }, fakeContext()),
      );
      const password = await renderHtml(
        renderTextField({ label: { literalString: 'Pwd' }, textFieldType: 'obscured' }, fakeContext()),
      );

      assert.match(number, /type="number"/);
      assert.match(password, /type="password"/);
    });

    it('should render a textarea for longText', async () => {
      const html = await renderHtml(
        renderTextField({ label: { literalString: 'Bio' }, textFieldType: 'longText' }, fakeContext()),
      );

      assert.match(html, /<textarea/);
    });

    it('should pass validationRegexp as the pattern attribute', async () => {
      const html = await renderHtml(
        renderTextField({ label: { literalString: 'Zip' }, validationRegexp: '\\d{5}' }, fakeContext()),
      );

      assert.match(html, /pattern="\\d\{5\}"/);
    });

    it('should prefill text from a path', async () => {
      const context = fakeContext({ data: { user: { name: 'Bob' } } });

      const html = await renderHtml(
        renderTextField({ label: { literalString: 'Name' }, text: { path: '/user/name' } }, context),
      );

      assert.match(html, /value="Bob"/);
    });
  });

  describe('DateTimeInput', () => {
    it('should render a date input by default', async () => {
      const html = await renderHtml(renderDateTimeInput({ value: { literalString: '2026-10-12' } }, fakeContext()));

      assert.match(html, /<input[^>]*type="date"/);
      assert.match(html, /value="2026-10-12"/);
    });

    it('should render a datetime-local input when both date and time are enabled', async () => {
      const html = await renderHtml(
        renderDateTimeInput({ value: { literalString: '' }, enableDate: true, enableTime: true }, fakeContext()),
      );

      assert.match(html, /type="datetime-local"/);
    });

    it('should render a time input when only time is enabled', async () => {
      const html = await renderHtml(
        renderDateTimeInput({ value: { literalString: '' }, enableDate: false, enableTime: true }, fakeContext()),
      );

      assert.match(html, /type="time"/);
    });
  });

  describe('MultipleChoice', () => {
    const props = {
      selections: { literalArray: ['b'] },
      options: [
        { label: { literalString: 'Alpha' }, value: 'a' },
        { label: { literalString: 'Beta' }, value: 'b' },
      ],
    };

    it('should render every option as a checkbox with the selections applied', async () => {
      const html = await renderHtml(renderMultipleChoice(props, fakeContext()));

      assert.match(html, /Alpha/);
      assert.match(html, /Beta/);
      assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
      assert.equal((html.match(/checked/g) ?? []).length, 1, '只应勾选 selections 里的那一项');
    });

    it('should render chips for the chips variant', async () => {
      const html = await renderHtml(renderMultipleChoice({ ...props, variant: 'chips' }, fakeContext()));

      assert.match(html, /aria-pressed="true"/);
      assert.match(html, /aria-pressed="false"/);
      assert.doesNotMatch(html, /type="checkbox"/);
    });

    it('should render a filter box when filterable', async () => {
      const html = await renderHtml(renderMultipleChoice({ ...props, filterable: true }, fakeContext()));

      assert.match(html, /<input[^>]*type="search"/);
    });

    it('should read selections and option labels from the data model', async () => {
      const context = fakeContext({
        data: { tags: ['x'], labels: { first: 'From model' } },
      });

      const html = await renderHtml(
        renderMultipleChoice(
          {
            selections: { path: '/tags' },
            options: [{ label: { path: '/labels/first' }, value: 'x' }],
          },
          context,
        ),
      );

      assert.match(html, /From model/);
      assert.match(html, /checked/);
    });

    it('should record a PARSE_ERROR when options are missing', () => {
      renderMultipleChoice({ selections: { literalArray: [] } }, fakeContext({ componentId: 'picker' }));

      const errors = Object.values(getAllErrors());
      assert.equal(errors.length, 1);
      assert.equal(errors[0].type, ErrorType.PARSE_ERROR);
      assert.match(errors[0].content, /picker/);
    });
  });

  describe('Slider', () => {
    it('should render a range input with min, max and value', async () => {
      const html = await renderHtml(
        renderSlider({ value: { literalNumber: 40 }, minValue: 10, maxValue: 90 }, fakeContext()),
      );

      assert.match(html, /type="range"/);
      assert.match(html, /min="10"/);
      assert.match(html, /max="90"/);
      assert.match(html, /value="40"/);
    });

    it('should default min and max when they are omitted', async () => {
      const html = await renderHtml(renderSlider({ value: { literalNumber: 5 } }, fakeContext()));

      assert.match(html, /min="0"/);
      assert.match(html, /max="100"/);
    });

    it('should read the value from the data model', async () => {
      const context = fakeContext({ data: { restaurant: { cost: 3 } } });

      const html = await renderHtml(
        renderSlider({ value: { path: '/restaurant/cost' }, minValue: 1, maxValue: 5 }, context),
      );

      assert.match(html, /value="3"/);
    });
  });
});
