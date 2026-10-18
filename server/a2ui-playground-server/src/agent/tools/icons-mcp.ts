/**
 * 图标查询的 **MCP 服务器**与**内嵌客户端**。
 *
 * 为什么是 MCP 而不是几个普通函数：图标查询是一个「能力提供方」，将来完全可能被别的
 * 宿主（Claude Desktop / WorkBuddy / 其它 agent）复用。做成标准 MCP Server，
 * 同一个实现既能被本服务的 agent 内嵌调用（`createIconToolExecutor`，走内存通道），
 * 也能独立跑 stdio 给外部客户端用（`src/bin/icons-mcp.ts`）。
 *
 * 为什么用内存通道而不是 spawn 子进程：开发态服务端是 ts-node 直跑源码，
 * spawn 一个「先构建再运行」的 bin 反而添一层脆弱。内存通道仍是完整的 MCP 协议
 * （JSON-RPC 双向），换成 stdio 只是换 transport 一行代码。
 *
 * 用低层 `Server` + 请求处理器而不是高层 `registerTool`：后者要引 zod 只为几个
 * 字符串/数字参数，而工具 Schema 本来就要以纯 JSON Schema 形态透给 OpenAI ——
 * 一份纯对象同时喂两边，少一个依赖也少一处漂移。
 */
import type { ToolExecutor } from '../../types';
import { ICON_TOOL_DEFS, executeIconTool } from './icon-tools';

// 类型导入（编译期擦除）；运行期用动态 import 拿真身 —— SDK 是 ESM-only 包，
// 动态 import 在 CommonJS 产物与 ts-node 下都能工作（Node ≥22 支持 require(esm)）。
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const SERVER_INFO = { name: 'a2ui-icons', version: '0.0.1' };

/** 建一个只暴露图标查询能力的 MCP Server（尚未连接任何 transport）。 */
export const createIconsMcpServer = async (): Promise<Server> => {
  const [{ Server: McpServer }, { ListToolsRequestSchema, CallToolRequestSchema }] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/server/index.js'),
      import('@modelcontextprotocol/sdk/types.js'),
    ]);

  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ICON_TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const text = executeIconTool(name, args);
    return { content: [{ type: 'text', text }] };
  });

  return server;
};

/**
 * 连上内嵌的图标 MCP Server，拿到「定义 + 执行」一体的执行器。
 *
 * 执行器是懒加载 + 单例的：整个进程共用一条 MCP 连接；连接失败由调用方决定
 * 是降级（不带工具继续生成）还是报错。
 */
export const createIconToolExecutor = async (): Promise<ToolExecutor> => {
  const [{ InMemoryTransport }, { Client }] = await Promise.all([
    import('@modelcontextprotocol/sdk/inMemory.js'),
    import('@modelcontextprotocol/sdk/client/index.js'),
  ]);

  const server = await createIconsMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'a2ui-agent', version: '0.0.1' });
  await client.connect(clientTransport);

  // 定义从 MCP 侧拿（listTools），不在客户端手抄一份 —— 服务器加了工具，
  // 模型这里自动就能看到。
  const listed = await client.listTools();
  const definitions = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  }));

  return {
    definitions,
    async execute(name, args) {
      const startedAt = Date.now();
      const result = (await client.callTool({
        name,
        arguments:
          typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
      })) as { content?: unknown };

      // SDK 的 callTool 返回类型偏松（content: unknown），按协议形状自己收窄。
      const content = Array.isArray(result.content) ? result.content : [];
      const first = content.find(
        (item): item is { type: string; text?: string } =>
          typeof item === 'object' &&
          item !== null &&
          (item as { type?: unknown }).type === 'text',
      );
      const text = typeof first?.text === 'string' ? first.text : JSON.stringify(content);
      // 一行日志回答两个排障问题：模型有没有真的按需查图标、查了什么。
      console.log(
        `[agent] 图标 MCP ${name}(${JSON.stringify(args)}) → ${text.slice(0, 140)}` +
          `（${Date.now() - startedAt}ms）`,
      );
      return text;
    },
  };
};
