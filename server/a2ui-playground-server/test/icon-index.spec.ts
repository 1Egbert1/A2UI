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

  // 多词查询是线上事故的源头：模型很自然地写 `天气 晴 云`，而改造前只按整串匹配，
  // 这类查询一律返回 0 条 → 模型转去 listIcons 逐个字母翻目录 → 工具轮烧光报错。
  it('searchIcons：多词中文查询不再落空', () => {
    const result = searchIcons('天气 晴 云');
    assert.ok(result.total > 0, '多词查询必须能查出来');
    assert.ok(result.icons.includes('Sunny'), JSON.stringify(result));
    assert.ok(result.icons.includes('Cloudy'), JSON.stringify(result));
  });

  it('searchIcons：多词英文查询也能命中', () => {
    const result = searchIcons('cloudy weather');
    assert.ok(result.icons.includes('Cloudy'), JSON.stringify(result));
    assert.ok(result.icons.includes('MostlyCloudy'));
  });

  it('searchIcons：逗号 / 顿号 / 加号 / 竖线都算分隔符', () => {
    for (const query of ['天气, 晴', '天气、晴', '天气+晴', '天气|晴', '天气　晴']) {
      assert.ok(searchIcons(query).icons.includes('Sunny'), `${query} 应能切词`);
    }
  });

  it('searchIcons：同时答上多个概念的排在只答上一个的前面', () => {
    // Sunny 同时命中「晴」和「天气」两个概念，应当排在只命中「天气」的图标之前。
    assert.equal(searchIcons('天气 晴').icons[0], 'Sunny');
  });

  it('searchIcons：多词中个别词查不到时，其余词照常返回', () => {
    const result = searchIcons('飞机 天气');
    assert.ok(result.icons.includes('Cloudy'), JSON.stringify(result));
    // 全是查不到的概念，仍然返回空 —— 「能拆词」不等于「开始瞎编」。
    assert.deepEqual(searchIcons('飞机 火箭').icons, []);
  });

  it('searchIcons：单词查询的结果不受切词改造影响', () => {
    assert.equal(searchIcons('晴').icons[0], 'Sunny');
    assert.equal(searchIcons('雨').icons[0], 'Drizzling');
    assert.ok(searchIcons('cart').icons.includes('ShoppingCart'));
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
