import { strict as assert } from 'assert';

import type { VNode } from 'vue';

import { dataBindingMessages } from '../../a2ui-core/mock/data-binding';
import { getDataModel, getHydrateNode, init, parseA2UI, resetA2UIStore } from 'a2ui-core';
import { renderMap } from '../src/renderMap';
import { renderHtml } from './support';

const SURFACE_ID = 'data-binding';
const jsonl = dataBindingMessages.join('\n');

/** 从 VNode 上取某个 prop；没有时为 undefined。 */
const prop = (vnode: VNode | null, name: string): unknown =>
  (vnode?.props as Record<string, unknown> | undefined)?.[name];

/** label 包 input 的组件（CheckBox / TextField），取第 n 个子节点。 */
const child = (vnode: VNode | null, index: number): VNode | null => {
  const children = vnode?.children;
  return Array.isArray(children) ? (children[index] as VNode | null) ?? null : null;
};

/** 取某个组件 hydrate 后的真实 vnode。 */
const vnodeOf = (componentId: string): VNode => getHydrateNode(componentId)!._vnode as VNode;

describe('数据绑定端到端（真实渲染器）', () => {
  beforeEach(() => {
    resetA2UIStore();
    init(renderMap); // 注入真实 Vue 渲染器
  });

  it('should hydrate every bound value through the real renderer', async () => {
    parseA2UI(jsonl);

    // Text 绑定 /user/name，usageHint=h3 → <h3>Alice</h3>
    assert.match(await renderHtml(vnodeOf('greeting')), /<h3[^>]*>Alice<\/h3>/);

    // TextField 绑定 /user/name → input 的 value 是 Alice
    assert.equal(prop(child(vnodeOf('name-field'), 1), 'value'), 'Alice');

    // CheckBox 绑定 /prefs/subscribe → input 的 checked 是 false
    assert.equal(prop(child(vnodeOf('subscribe'), 0), 'checked'), false);

    // Slider 绑定 /prefs/volume → input 的 value 是 70（已被局部更新）
    assert.equal(prop(vnodeOf('volume'), 'value'), 70);
  });

  it('should write back through the real TextField and update the store + bound Text', async () => {
    parseA2UI(jsonl);

    const onInput = prop(child(vnodeOf('name-field'), 1), 'onInput') as (
      event: unknown,
    ) => void;
    assert.equal(typeof onInput, 'function', 'text 带 path 的 TextField 应挂 onInput');

    onInput({ target: { value: 'Bob' } });

    assert.deepEqual(getDataModel(SURFACE_ID)!.user, { name: 'Bob' }, 'store 的数据模型应更新');
    // 写回触发重渲染：greeting 的 Text 现在读到 Bob。
    assert.match(await renderHtml(vnodeOf('greeting')), /<h3[^>]*>Bob<\/h3>/);
  });

  it('should write back through the real CheckBox and Slider', () => {
    parseA2UI(jsonl);

    const onChange = prop(child(vnodeOf('subscribe'), 0), 'onChange') as (event: unknown) => void;
    assert.equal(typeof onChange, 'function', 'value 带 path 的 CheckBox 应挂 onChange');
    onChange({ target: { checked: true } });
    assert.equal(
      (getDataModel(SURFACE_ID)!.prefs as Record<string, unknown>).subscribe,
      true,
    );

    const onInput = prop(vnodeOf('volume'), 'onInput') as (event: unknown) => void;
    assert.equal(typeof onInput, 'function', 'value 带 path 的 Slider 应挂 onInput');
    onInput({ target: { value: '90' } });
    assert.equal((getDataModel(SURFACE_ID)!.prefs as Record<string, unknown>).volume, 90);
  });
});
