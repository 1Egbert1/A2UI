import { strict as assert } from 'assert';

import { writePath } from '../src/binding';
import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getDataModel,
  getHydrateNode,
  init,
  resetA2UIStore,
  setDataModel,
  updateDataModelPath,
} from '../src/store';
import { setTreeRenderer } from '../src/tree-render';

describe('updateModel（数据模型写回）', () => {
  describe('writePath', () => {
    it('should write a top-level value', () => {
      assert.deepEqual(writePath({}, '/name', 'Bob'), { name: 'Bob' });
    });

    it('should accept a path without a leading slash', () => {
      assert.deepEqual(writePath({}, 'name', 'Bob'), { name: 'Bob' });
    });

    it('should write a nested value', () => {
      const next = writePath({ user: { address: { city: 'A' } } }, '/user/address/city', 'B');

      assert.deepEqual(next, { user: { address: { city: 'B' } } });
    });

    it('should create intermediate objects for new paths', () => {
      assert.deepEqual(writePath({}, '/a/b/c', 1), { a: { b: { c: 1 } } });
    });

    it('should not mutate the input model', () => {
      const model = { user: { name: 'Bob' } };
      writePath(model, '/user/name', 'Alice');

      assert.equal((model.user as { name: string }).name, 'Bob', '原对象不该被改动');
    });

    it('should preserve sibling keys at every level', () => {
      const next = writePath({ a: 1, user: { name: 'Bob', age: 30 } }, '/user/name', 'Alice');

      assert.deepEqual(next, { a: 1, user: { name: 'Alice', age: 30 } });
    });

    it('should replace the whole model when the path is empty and the value is an object', () => {
      assert.deepEqual(writePath({ old: true }, '', { fresh: 1 }), { fresh: 1 });
    });

    it('should keep the original model when the path is empty and the value is a primitive', () => {
      assert.deepEqual(writePath({ old: true }, '', 42), { old: true });
    });

    it('should write arrays as a value', () => {
      assert.deepEqual(writePath({}, '/tags', ['a', 'b']), { tags: ['a', 'b'] });
    });
  });

  describe('updateDataModelPath', () => {
    beforeEach(() => {
      resetA2UIStore();
    });

    it('should write a value into the surface data model', () => {
      init();
      setDataModel('s1', { user: { name: 'Bob' } });

      updateDataModelPath('s1', '/user/name', 'Alice');

      assert.deepEqual(getDataModel('s1'), { user: { name: 'Alice' } });
    });

    it('should create the data model when the surface has none', () => {
      init();

      updateDataModelPath('s1', '/x', 1);

      assert.deepEqual(getDataModel('s1'), { x: 1 });
    });

    it('should keep sibling surfaces untouched', () => {
      init();
      setDataModel('s1', { a: 1 });
      setDataModel('s2', { b: 2 });

      updateDataModelPath('s1', '/a', 99);

      assert.deepEqual(getDataModel('s2'), { b: 2 }, '别的 surface 的数据模型不应受影响');
    });
  });

  describe('端到端：写回触发重渲染', () => {
    beforeEach(() => {
      resetA2UIStore();
      setRenderMap({});
      setTreeRenderer(null);
    });

    it('should write back and re-render bound components with the new value', () => {
      let renders = 0;
      setTreeRenderer(() => {
        renders += 1;
      });
      // 假渲染器：Text 直接读出 path 指向的值，好验证「写回后组件看到新值」。
      setRenderMap({
        Text: (props, context) => context.read((props.text as { path: string }).path),
      });

      parseA2UI(
        [
          '{"surfaceUpdate":{"surfaceId":"s","components":[{"id":"root","component":{"Text":{"text":{"path":"/name"}}}}]}}',
          '{"dataModelUpdate":{"surfaceId":"s","contents":[{"key":"name","valueString":"Bob"}]}}',
          '{"beginRendering":{"surfaceId":"s","root":"root"}}',
        ].join('\n'),
      );

      assert.equal(renders, 1, 'parseA2UI 应触发一次渲染');
      assert.equal(getHydrateNode('root')?._vnode, 'Bob', '初始值应来自数据模型');

      // 模拟表单写回：把 /name 改成 Alice。
      updateDataModelPath('s', '/name', 'Alice');

      assert.equal(renders, 2, '写回数据模型应再触发一次重渲染');
      assert.equal(getHydrateNode('root')?._vnode, 'Alice', '重渲染后组件应看到新值');
      assert.deepEqual(getDataModel('s'), { name: 'Alice' });
    });
  });
});
