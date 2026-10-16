import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import {
  createLineAssembler,
  extractLine,
  extractMessages,
  stripCodeFences,
  validateMessage,
} from '../src/agent/extract';

const MESSAGE = '{"beginRendering":{"surfaceId":"sf","root":"root"}}';

describe('extract / validateMessage', () => {
  it('接受四种消息类型', () => {
    assert.equal(
      validateMessage({ beginRendering: { surfaceId: 'sf', root: 'root' } }).ok,
      true,
    );
    assert.equal(
      validateMessage({ surfaceUpdate: { surfaceId: 'sf', components: [] } }).ok,
      true,
    );
    assert.equal(
      validateMessage({ dataModelUpdate: { surfaceId: 'sf', contents: [] } }).ok,
      true,
    );
    assert.equal(validateMessage({ deleteSurface: { surfaceId: 'sf' } }).ok, true);
  });

  it('顶层必须恰好一个键（对齐 schema 的 additionalProperties: false）', () => {
    assert.equal(validateMessage({}).ok, false);
    assert.equal(validateMessage({ beginRendering: { surfaceId: 'sf', root: 'r' }, extra: 1 }).ok, false);
    assert.equal(validateMessage({ unknownType: { surfaceId: 'sf' } }).ok, false);
  });

  it('校验各自必填字段', () => {
    assert.equal(validateMessage({ beginRendering: { surfaceId: 'sf' } }).ok, false);
    assert.equal(validateMessage({ surfaceUpdate: { surfaceId: 'sf' } }).ok, false);
    assert.equal(validateMessage({ dataModelUpdate: { surfaceId: 'sf' } }).ok, false);
    assert.equal(validateMessage({ deleteSurface: {} }).ok, false);
    assert.equal(validateMessage({ beginRendering: { surfaceId: '', root: 'r' } }).ok, false);
  });

  it('非对象直接拒绝', () => {
    assert.equal(validateMessage(null).ok, false);
    assert.equal(validateMessage('x').ok, false);
    assert.equal(validateMessage([1]).ok, false);
  });
});

describe('extract / stripCodeFences', () => {
  it('剥掉成对的 ```json 围栏', () => {
    assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it('没有围栏或围栏没闭合时原样返回', () => {
    assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
    assert.equal(stripCodeFences('```json\n{"a":1}'), '```json\n{"a":1}');
  });
});

describe('extract / extractLine', () => {
  it('单行单消息', () => {
    const result = extractLine(MESSAGE);
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result.warnings, []);
  });

  it('一行是数组时展开成多条', () => {
    const result = extractLine(`[${MESSAGE},{"deleteSurface":{"surfaceId":"sf"}}]`);
    assert.equal(result.messages.length, 2);
  });

  it('空行既不算消息也不算错误', () => {
    assert.deepEqual(extractLine('   '), { messages: [], warnings: [] });
  });

  it('坏 JSON 记 warning 不抛错', () => {
    const result = extractLine('{"beginRendering":');
    assert.equal(result.messages.length, 0);
    assert.match(result.warnings[0], /JSON 解析失败/);
  });

  it('数组元素后多一个 } 时自动修复并采纳', () => {
    const good =
      '{"surfaceUpdate":{"surfaceId":"sf","components":[{"id":"a","component":{"Text":{"text":{"literalString":"hi"}}}}]}}';
    // 在 components 数组闭合前多塞一个 }，模拟模型在组件收尾处多写一个括号。
    const bad = good.replace(']}}', '}]}}');
    const result = extractLine(bad);

    assert.equal(result.messages.length, 1);
    const message = result.messages[0];
    assert.ok('surfaceUpdate' in message);
    if ('surfaceUpdate' in message) {
      assert.equal(message.surfaceUpdate.components.length, 1);
    }
    assert.match(result.warnings[0] ?? '', /已自动修复/);
  });

  it('不是「多 }」的坏行（如少逗号）照旧记坏行、不误伤', () => {
    // 两个对象间少了逗号：V8 报 Unexpected token，不属于可修复的「多 }」模式。
    const result = extractLine(
      '{"surfaceUpdate":{"surfaceId":"sf","components":[]}}{"beginRendering":{"surfaceId":"sf","root":"r"}}',
    );
    assert.equal(result.messages.length, 0);
    assert.match(result.warnings[0], /JSON 解析失败/);
  });

  it('合法 JSON 但不是协议消息时给出具体原因', () => {
    const result = extractLine('{"foo":1}');
    assert.equal(result.messages.length, 0);
    assert.match(result.warnings[0], /未知消息类型/);
  });
});

describe('extract / extractMessages', () => {
  it('混着废话、围栏与坏行时只挑出合法消息', () => {
    const text = [
      '好的，这是你要的界面：',
      '```json',
      '{"surfaceUpdate":{"surfaceId":"sf","components":[{"id":"root","component":{"Text":{}}}]}}',
      '{"beginRendering":',
      '{"beginRendering":{"surfaceId":"sf","root":"root"}}',
      '```',
    ].join('\n');

    const { messages, warnings } = extractMessages(text);

    assert.equal(messages.length, 2);
    // 「好的…」那行落在围栏外，被连围栏一起剥掉了；真正失败的只有 `{"beginRendering":` 这一行。
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /第 2 行/);
    assert.match(warnings[0], /JSON 解析失败/);
  });

  it('围栏外的中文说明行落进 warning（不影响后续消息）', () => {
    const text = [
      '好的，我生成了两条消息：',
      '{"beginRendering":{"surfaceId":"sf","root":"root"}}',
      '{"deleteSurface":{"surfaceId":"sf"}}',
    ].join('\n');

    const { messages, warnings } = extractMessages(text);

    assert.equal(messages.length, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /第 1 行/);
  });

  it('逐行全失败时回退到「整段当一个 JSON 解析」（兜漂亮打印的多行）', () => {
    const pretty = JSON.stringify(
      { beginRendering: { surfaceId: 'sf', root: 'root' } },
      null,
      2,
    );

    const { messages } = extractMessages(pretty);
    assert.equal(messages.length, 1);
  });

  it('空输入不产生消息也不产生警告', () => {
    assert.deepEqual(extractMessages('   \n  '), { messages: [], warnings: [] });
  });
});

describe('extract / createLineAssembler', () => {
  it('把跨 chunk 的半行拼回完整行', () => {
    const assembler = createLineAssembler();

    assert.deepEqual(assembler.push('{"a"'), []);
    assert.deepEqual(assembler.push(':1}\n{"b"'), ['{"a":1}']);
    assert.deepEqual(assembler.push(':2}\n'), ['{"b":2}']);
    assert.deepEqual(assembler.flush(), []);
  });

  it('flush 取出最后没有换行收尾的残留', () => {
    const assembler = createLineAssembler();
    assembler.push('{"a":1}\n{"b":2}');

    assert.deepEqual(assembler.flush(), ['{"b":2}']);
    // flush 之后状态清空，不会重复吐出。
    assert.deepEqual(assembler.flush(), []);
  });

  it('CRLF 也算行边界', () => {
    const assembler = createLineAssembler();
    assert.deepEqual(assembler.push('a\r\nb\r\n'), ['a', 'b']);
  });
});
