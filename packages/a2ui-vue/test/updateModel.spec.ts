import { strict as assert } from 'assert';

import type { VNode } from 'vue';

import {
  renderCheckBox,
  renderDateTimeInput,
  renderMultipleChoice,
  renderSlider,
  renderTextField,
} from '../src/renderMap';
import { fakeContext } from './support';

/** 收集 updateModel 调用的 spy：每次调用记下 (path, value)。 */
const spyContext = () => {
  const calls: Array<[string, unknown]> = [];
  const context = fakeContext({
    updateModel: (path: string, value: unknown) => {
      calls.push([path, value]);
    },
  });
  return { calls, context };
};

/** 从 VNode 上取某个事件回调；没有时为 undefined。 */
const handler = (vnode: VNode | null, name: string): ((event: unknown) => void) | undefined =>
  (vnode?.props as Record<string, unknown> | undefined)?.[name] as
    | ((event: unknown) => void)
    | undefined;

/** label 包 input 的组件（CheckBox / TextField），取第 n 个子节点。 */
const child = (vnode: VNode | null, index: number): VNode | null => {
  const children = vnode?.children;
  return Array.isArray(children) ? (children[index] as VNode | null) ?? null : null;
};

describe('表单控件数据写回（updateModel）', () => {
  it('TextField 带 path 时 onInput 会写回字符串', () => {
    const { calls, context } = spyContext();
    const vnode = renderTextField(
      { label: { literalString: 'Name' }, text: { path: '/name' } },
      context,
    );
    const onInput = handler(child(vnode, 1), 'onInput');

    assert.equal(typeof onInput, 'function', '带 path 的 TextField 应挂 onInput');
    onInput?.({ target: { value: 'Alice' } });

    assert.deepEqual(calls, [['/name', 'Alice']]);
  });

  it('TextField 纯字面量时不挂写回', () => {
    const { context } = spyContext();
    const vnode = renderTextField({ label: { literalString: 'Name' }, text: { literalString: 'Hi' } }, context);

    assert.equal(handler(child(vnode, 1), 'onInput'), undefined, '纯字面量不该写回');
  });

  it('CheckBox 带 path 时 onChange 会写回布尔', () => {
    const { calls, context } = spyContext();
    const vnode = renderCheckBox(
      { label: { literalString: 'Open' }, value: { path: '/open' } },
      context,
    );
    const onChange = handler(child(vnode, 0), 'onChange');

    assert.equal(typeof onChange, 'function', '带 path 的 CheckBox 应挂 onChange');
    onChange?.({ target: { checked: true } });

    assert.deepEqual(calls, [['/open', true]]);
  });

  it('CheckBox 纯字面量时不挂写回', () => {
    const { context } = spyContext();
    const vnode = renderCheckBox(
      { label: { literalString: 'Open' }, value: { literalBoolean: true } },
      context,
    );

    assert.equal(handler(child(vnode, 0), 'onChange'), undefined, '纯字面量不该写回');
  });

  it('Slider 带 path 时 onInput 会写回数字', () => {
    const { calls, context } = spyContext();
    const vnode = renderSlider({ value: { path: '/cost' }, minValue: 0, maxValue: 100 }, context);
    const onInput = handler(vnode, 'onInput');

    assert.equal(typeof onInput, 'function', '带 path 的 Slider 应挂 onInput');
    onInput?.({ target: { value: '42' } });

    assert.deepEqual(calls, [['/cost', 42]]);
  });

  it('Slider 纯字面量时不挂写回', () => {
    const { context } = spyContext();
    const vnode = renderSlider({ value: { literalNumber: 40 } }, context);

    assert.equal(handler(vnode, 'onInput'), undefined, '纯字面量不该写回');
  });

  it('DateTimeInput 带 path 时 onChange 会写回字符串', () => {
    const { calls, context } = spyContext();
    const vnode = renderDateTimeInput({ value: { path: '/dob' } }, context);
    const onChange = handler(vnode, 'onChange');

    assert.equal(typeof onChange, 'function', '带 path 的 DateTimeInput 应挂 onChange');
    onChange?.({ target: { value: '2026-10-15' } });

    assert.deepEqual(calls, [['/dob', '2026-10-15']]);
  });

  it('MultipleChoice 带 path 时 onUpdate 会写回字符串数组', () => {
    const { calls, context } = spyContext();
    const vnode = renderMultipleChoice(
      {
        selections: { path: '/tags' },
        options: [
          { label: { literalString: 'Alpha' }, value: 'a' },
          { label: { literalString: 'Beta' }, value: 'b' },
        ],
      },
      context,
    );
    const onUpdate = handler(vnode, 'onUpdate');

    assert.equal(typeof onUpdate, 'function', '带 path 的 MultipleChoice 应挂 onUpdate');
    (onUpdate as (selections: string[]) => void)?.(['a', 'b']);

    assert.deepEqual(calls, [['/tags', ['a', 'b']]]);
  });

  it('MultipleChoice 纯字面量时不挂写回', () => {
    const { context } = spyContext();
    const vnode = renderMultipleChoice(
      {
        selections: { literalArray: ['a'] },
        options: [{ label: { literalString: 'Alpha' }, value: 'a' }],
      },
      context,
    );

    assert.equal(handler(vnode, 'onUpdate'), undefined, '纯字面量不该写回');
  });
});
