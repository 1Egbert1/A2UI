/**
 * 图标 MCP Server 的 stdio 独立入口。
 *
 * 给本服务之外的 MCP 客户端用（Claude Desktop / WorkBuddy / 其它 agent 框架）：
 *
 *   node dist/bin/icons-mcp.js        # 或：pnpm --filter a2ui-playground-server icons-mcp
 *
 * 客户端配置示例（JSON）：
 *   { "mcpServers": { "a2ui-icons": { "command": "node",
 *       "args": ["<仓库>/server/a2ui-playground-server/dist/bin/icons-mcp.js"] } } }
 *
 * 本服务的 agent 不走这个入口 —— 它用内存通道内嵌同一个 Server（见 tools/icons-mcp.ts）。
 */
import { createIconsMcpServer } from '../agent/tools/icons-mcp';

const main = async (): Promise<void> => {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = await createIconsMcpServer();
  await server.connect(new StdioServerTransport());
  // stdio 通道下 stderr 是唯一的日志出口（stdout 被协议占用）。
  console.error('[a2ui-icons-mcp] 已启动（stdio）');
};

main().catch((error: unknown) => {
  console.error('[a2ui-icons-mcp] 启动失败：', error);
  process.exitCode = 1;
});
