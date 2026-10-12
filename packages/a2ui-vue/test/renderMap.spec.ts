import { strict as assert } from 'assert';

import { renderMap } from '../src/renderMap';
import { readSpecJson } from './support';

interface Catalog {
  components: Record<string, unknown>;
}

/**
 * 覆盖度守卫：renderMap 必须与标准目录**完全对齐**。
 *
 * 少一个 → 该组件会在 core 的 errorMap 里冒 RENDERER_NOT_FOUND；
 * 多一个 → 协议里根本没有这个类型，属于无效登记。
 * 这条用例让「实现是否齐全」不再靠人肉核对。
 */
describe('A2UI Vue renderMap 覆盖度', () => {
  const catalog = readSpecJson<Catalog>('standard_catalog_definition.json');
  const declared = Object.keys(catalog.components).sort();

  it('should register every component declared in the standard catalog', () => {
    assert.deepEqual(
      Object.keys(renderMap).sort(),
      declared,
      'renderMap 的键必须与 standard_catalog_definition.json 的 components 完全一致',
    );
  });

  it('should not contain non-function entries', () => {
    for (const [type, renderer] of Object.entries(renderMap)) {
      assert.equal(typeof renderer, 'function', `${type} 应登记为渲染函数`);
    }
  });

  it('should declare at least the components this test suite covers', () => {
    // 防止有人为了「对齐」而把渲染器删空。
    assert.ok(declared.length >= 18, `标准目录应当有 18 个组件，实际 ${declared.length}`);
  });
});
