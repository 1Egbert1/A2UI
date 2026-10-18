import { describe, it } from 'mocha';
import assert from 'node:assert/strict';
import { executeIconTool, ICON_TOOL_DEFS } from '../src/agent/tools/icon-tools';
import { createIconToolExecutor } from '../src/agent/tools/icons-mcp';

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

describe('icon-tools（定义与分发）', () => {
  it('三个工具，Schema 都是合法的 JSON Schema 对象', () => {
    assert.deepEqual(
      ICON_TOOL_DEFS.map((def) => def.name),
      ['searchIcons', 'listIcons', 'getIcon'],
    );
    for (const def of ICON_TOOL_DEFS) {
      assert.equal(def.inputSchema.type, 'object');
      assert.ok(typeof def.inputSchema.properties === 'object');
      assert.ok(def.description.length > 10);
    }
  });

  it('searchIcons 分发：中文概念命中', () => {
    const result = parse(executeIconTool('searchIcons', { query: '购物车' }));
    assert.ok((result.icons as string[]).includes('ShoppingCart'));
  });

  it('getIcon 分发：规范化纠正', () => {
    const result = parse(executeIconTool('getIcon', { name: 'home_filled' }));
    assert.equal(result.exists, true);
    assert.equal(result.canonical, 'HomeFilled');
  });

  it('listIcons 分发：按字母', () => {
    const result = parse(executeIconTool('listIcons', { letter: 's', limit: 5 }));
    assert.equal((result.icons as string[]).length, 5);
  });

  it('未知工具返回可读错误而不是抛异常', () => {
    const result = parse(executeIconTool('nope', {}));
    assert.match(String(result.error), /未知工具/);
    assert.ok(Array.isArray(result.available));
  });

  it('参数类型不对时按缺省值走，不崩', () => {
    const result = parse(executeIconTool('searchIcons', { query: 42 }));
    assert.deepEqual(result.icons, []);
  });
});

describe('icons-mcp（MCP 协议往返）', () => {
  it('客户端能 listTools 拿到三个工具定义', async () => {
    const executor = await createIconToolExecutor();
    assert.deepEqual(
      executor.definitions.map((def) => def.name),
      ['searchIcons', 'listIcons', 'getIcon'],
    );
  });

  it('客户端能 callTool 并拿到搜索结果（走完整 JSON-RPC）', async () => {
    const executor = await createIconToolExecutor();
    const text = await executor.execute('searchIcons', { query: '设置' });
    const result = parse(text);
    assert.ok((result.icons as string[]).includes('Setting'));
  });

  it('客户端执行未知工具时不抛异常', async () => {
    const executor = await createIconToolExecutor();
    const text = await executor.execute('nope', {});
    assert.match(text, /未知工具/);
  });
});
