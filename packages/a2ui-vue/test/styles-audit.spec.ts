import { strict as assert } from 'assert';

import { auditStyles } from '../src/internal/styles';

describe('styles / auditStyles（诊断，不改渲染行为）', () => {
  it('白名单内的键不报问题', () => {
    const audit = auditStyles({ color: '#111111', fontSize: 13, padding: '0 8px', gap: 4 });
    assert.deepEqual(audit.dropped, []);
    assert.equal(audit.suspiciousLineHeight, undefined);
  });

  it('方向性边框与 overflow 会被报成丢弃（它们确实不在白名单）', () => {
    const audit = auditStyles({
      borderBottom: '1px solid #eee',
      borderRight: '1px solid #eee',
      overflow: 'hidden',
    });
    assert.deepEqual(audit.dropped.sort(), ['borderBottom', 'borderRight', 'overflow']);
  });

  it('kebab-case 与 camelCase 一视同仁', () => {
    assert.deepEqual(auditStyles({ 'border-bottom': '1px solid #eee' }).dropped, ['borderBottom']);
    assert.deepEqual(auditStyles({ 'font-size': 13 }).dropped, []);
  });

  it('lineHeight 给裸数字 20 判为可疑（20 是倍数，13px 字号会变 260px 行高）', () => {
    assert.equal(auditStyles({ lineHeight: 20 }).suspiciousLineHeight, 20);
  });

  it('lineHeight 的倍数写法（1.1）与带单位字符串（"20px"）都不报警', () => {
    assert.equal(auditStyles({ lineHeight: 1.1 }).suspiciousLineHeight, undefined);
    assert.equal(auditStyles({ lineHeight: '20px' }).suspiciousLineHeight, undefined);
  });

  it('非对象输入直接返回空结论（组件没写 styles 是常态）', () => {
    for (const value of [undefined, null, 'red', 42, []]) {
      assert.deepEqual(auditStyles(value), { dropped: [] });
    }
  });
});
