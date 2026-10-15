import { strict as assert } from 'assert';

import { readBoolean, readNumber, readString } from '../src/binding';
import { dataBindingMessages } from '../mock/data-binding';
import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getAllErrors,
  getDataModel,
  getHydrateNode,
  getSurface,
  getTree,
  resetA2UIStore,
  updateDataModelPath,
} from '../src/store';
import { setTreeRenderer } from '../src/tree-render';

const SURFACE_ID = 'data-binding';
const jsonl = dataBindingMessages.join('\n');

/**
 * 假渲染器：每个组件返回它通过 binding helper 读到的绑定值。
 *
 * 用真实的 `readString` / `readBoolean` / `readNumber` 而非裸 `context.read`，是为了连
 * 「取值对象 → path 解析」这一层也一起验证 —— 断言 `_vnode` 就是数据模型里的值。
 */
const installBoundRenderers = () => {
  setRenderMap({
    Column: () => 'COLUMN',
    Text: (props, context) => readString(props.text, context.read),
    TextField: (props, context) => readString(props.text, context.read),
    CheckBox: (props, context) => readBoolean(props.value, context.read),
    Slider: (props, context) => readNumber(props.value, context.read),
  });
};

describe('数据绑定端到端（mock/data-binding 简单协议）', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
    setTreeRenderer(null);
    installBoundRenderers();
  });

  describe('parser', () => {
    it('should register 5 components and create the surface', () => {
      parseA2UI(jsonl);

      assert.ok(getSurface(SURFACE_ID), 'beginRendering 应创建 surface');
      for (const id of ['root', 'name-field', 'greeting', 'subscribe', 'volume']) {
        assert.ok(getHydrateNode(id), `组件 "${id}" 应已登记`);
      }
      assert.deepEqual(getAllErrors(), {}, '合法协议配齐渲染器后不应产生错误');
    });

    it('should assemble the tree in explicitList order', () => {
      parseA2UI(jsonl);

      const root = getTree(SURFACE_ID)!.root;
      assert.equal(root.componentId, 'root');
      assert.deepEqual(
        root.children.map((child) => child.componentId),
        ['name-field', 'greeting', 'subscribe', 'volume'],
      );
    });
  });

  describe('数据解析（dataModelUpdate）', () => {
    it('should resolve nested valueMap and typed values into the data model', () => {
      parseA2UI(jsonl);

      assert.deepEqual(getDataModel(SURFACE_ID), {
        user: { name: 'Alice' },
        prefs: { subscribe: false, volume: 70 },
      });
    });

    it('should apply a path-scoped update without dropping sibling keys', () => {
      parseA2UI(jsonl);

      const prefs = getDataModel(SURFACE_ID)!.prefs as Record<string, unknown>;
      assert.equal(prefs.subscribe, false, '消息 #3 的 path 局部更新不该丢同层兄弟键 subscribe');
      assert.equal(prefs.volume, 70, 'volume 应被最后一条更新覆盖为 70');
    });
  });

  describe('数据绑定（读）', () => {
    it('should read each bound path from the data model at hydrate time', () => {
      parseA2UI(jsonl);

      assert.equal(getHydrateNode('greeting')!._vnode, 'Alice', 'Text 应读到 /user/name');
      assert.equal(getHydrateNode('name-field')!._vnode, 'Alice', 'TextField 应读到 /user/name');
      assert.equal(getHydrateNode('subscribe')!._vnode, false, 'CheckBox 应读到 /prefs/subscribe');
      assert.equal(
        getHydrateNode('volume')!._vnode,
        70,
        'Slider 应读到 /prefs/volume（已被局部更新为 70）',
      );
    });
  });

  describe('数据绑定（写回）', () => {
    it('should write back and re-render every component bound to the same path', () => {
      parseA2UI(jsonl);

      updateDataModelPath(SURFACE_ID, '/user/name', 'Bob');

      assert.deepEqual(getDataModel(SURFACE_ID)!.user, { name: 'Bob' }, 'store 的数据模型应更新');
      assert.equal(getHydrateNode('greeting')!._vnode, 'Bob', '写回后 Text 应重渲染并读到新值');
      assert.equal(getHydrateNode('name-field')!._vnode, 'Bob', '写回后 TextField 应重渲染并读到新值');
    });

    it('should trigger the tree renderer on write-back', () => {
      let renders = 0;
      setTreeRenderer(() => {
        renders += 1;
      });

      parseA2UI(jsonl);
      assert.equal(renders, 1, 'parseA2UI 应触发一次渲染');

      updateDataModelPath(SURFACE_ID, '/prefs/volume', 90);
      assert.equal(renders, 2, '写回数据模型应再触发一次渲染');
      assert.equal(getHydrateNode('volume')!._vnode, 90, '重渲染后 Slider 应读到新值');
    });
  });
});
