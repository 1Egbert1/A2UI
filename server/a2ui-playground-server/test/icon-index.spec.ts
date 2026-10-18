import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { getIcon, iconNames, listIcons, searchIcons } from '../src/agent/tools/icon-index';

describe('icon-index', () => {
  it('图标名清单来自 Element Plus 导出（量级在数百个）', () => {
    const names = iconNames();
    assert.ok(names.length > 250, `预期数百个图标，实际 ${names.length}`);
    // PascalCase、排序、无重复
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes('Search'));
    assert.ok(names.includes('HomeFilled'));
    assert.ok(names.includes('ShoppingCart'));
  });

  it('searchIcons：英文关键词按名字子串命中', () => {
    const result = searchIcons('cart');
    assert.ok(result.icons.includes('ShoppingCart'), JSON.stringify(result));
    assert.ok(result.icons.includes('ShoppingCartFull'));
    // 「trolley」是另一个词，不靠 cart 命中 —— 别把别名表的功劳算到子串头上
    assert.ok(!result.icons.includes('ShoppingTrolley'));
    assert.ok(searchIcons('trolley').icons.includes('ShoppingTrolley'));
  });

  it('searchIcons：中文概念走别名表，精确词排最前', () => {
    const result = searchIcons('购物车');
    assert.equal(result.icons[0], 'ShoppingCart');
    assert.ok(result.icons.includes('ShoppingTrolley'));
  });

  it('searchIcons：别名被查询包含时也命中（「购物」）', () => {
    const result = searchIcons('购物');
    assert.ok(result.icons.length > 0);
    assert.ok(result.icons.includes('ShoppingCart'));
  });

  it('searchIcons：精确名排第一', () => {
    assert.equal(searchIcons('Search').icons[0], 'Search');
    assert.equal(searchIcons('search').icons[0], 'Search');
  });

  it('searchIcons：limit 被夹在 [1,30]', () => {
    assert.equal(searchIcons('a', 0).icons.length <= 30, true);
    assert.ok(searchIcons('a', 1).icons.length <= 1);
  });

  it('searchIcons：空查询返回空', () => {
    assert.deepEqual(searchIcons('   '), { query: '', total: 0, icons: [] });
  });

  it('searchIcons：没有对应图标的概念返回空（不瞎编）', () => {
    assert.deepEqual(searchIcons('飞机').icons, []);
  });

  it('listIcons：按首字母过滤，不传则全量', () => {
    const sList = listIcons('s', 300);
    assert.ok(sList.length > 5);
    assert.ok(sList.every((name) => name.startsWith('S')));
    assert.equal(listIcons(undefined, 10).length, 10);
  });

  it('getIcon：大小写/分隔符差异算命中并给出规范名', () => {
    assert.deepEqual(getIcon('Search'), { name: 'Search', exists: true, canonical: 'Search', suggestions: [] });
    assert.deepEqual(getIcon('search'), { name: 'search', exists: true, canonical: 'Search', suggestions: [] });
    assert.deepEqual(getIcon('home_filled'), {
      name: 'home_filled',
      exists: true,
      canonical: 'HomeFilled',
      suggestions: [],
    });
  });

  it('getIcon：不存在时给近似候选', () => {
    const result = getIcon('Chart');
    assert.equal(result.exists, false);
    assert.ok(result.suggestions.length > 0, JSON.stringify(result));
  });
});
