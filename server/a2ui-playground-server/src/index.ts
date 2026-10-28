/**
 * 服务入口：加载 .env → 装配应用 → 监听端口。
 *
 * 只做「进程级」的事（环境、端口、退出信号）。应用怎么拼在 `app.ts`，
 * 于是测试可以直接调 `createApp()` 起一个临时端口，不必经过这里。
 */
import { resolve } from 'node:path';
import { createApp } from './app';
import { hasModelKey, loadEnvFile } from './config';

// 先读 .env 再装配：配置的读取只发生在 createApp 里，顺序不能反。
loadEnvFile(resolve(__dirname, '..', '.env'));

const { app, config, agent } = createApp();

const endpoints = [
  'GET  /health',
  'GET  /api/a2ui/scenarios           (示例场景列表)',
  'GET  /api/a2ui/scenarios/:id       (单个场景的原始 fixture)',
  'GET  /api/a2ui/scenarios/:id/stream (SSE · 原始字符流；?order=protocol|stream&chunk=50&delay=0)',
  'POST /api/a2ui/run       (默认 SSE · AG-UI 事件流；加 ?stream=false 收一次性 JSON)',
  'POST /api/a2ui/generate  (= run?stream=false 的固定别名)',
  'POST /api/a2ui/chat      (模型对话，不产出 A2UI；默认 SSE，?stream=false 收一次性 JSON)',
  'POST /api/a2ui/action    (客户端动作回传：userAction → 协议消息，一次性 JSON)',
  'GET  /api/a2ui/session/:threadId',
];

const server = app.listen(config.port, () => {
  console.log(`a2ui-server 已启动: http://localhost:${config.port}`);
  console.log(`agent: ${agent.provider}${agent.provider === 'openai' ? ` (${config.openai.model})` : ''}`);
  console.log(
    `模型链接: ${config.openai.model}${config.openai.baseURL ? ` @ ${config.openai.baseURL}` : ''}` +
      (hasModelKey(config.openai) ? '（已配 Key）' : '（**未配 Key**，/api/a2ui/chat 会返回 503）'),
  );
  console.log(`endpoints:\n  ${endpoints.join('\n  ')}`);

  if (agent.provider === 'mock' && config.openai.apiKey !== '') {
    // 配了 Key 却还是 mock，多半是忘了开开关 —— 这类「静默走错分支」最难排查，直接说破。
    console.log('提示: 检测到模型 Key，但 AGENT_PROVIDER 不是 openai，A2UI 生成仍走离线 mock。');
  }
});

const shutdown = (signal: string): void => {
  console.log(`收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
