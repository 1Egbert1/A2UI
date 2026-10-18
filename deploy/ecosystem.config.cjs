/**
 * pm2 配置：只守护 Node 服务端；前端是静态文件，由 nginx 直接托管，不需要进程。
 *
 * 用 `.cjs` 后缀是因为根 package.json 没有 `"type": "module"`，但 pm2 会按 ESM 猜；
 * 显式 cjs 最稳。
 */
module.exports = {
  apps: [
    {
      name: 'a2ui-server',
      // 跑编译产物而不是 ts-node：ts-node 每次启动都要现编译，且常驻内存更高
      script: 'dist/index.js',
      cwd: '/opt/a2ui/server/a2ui-playground-server',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      out_file: '/var/log/a2ui/server.out.log',
      error_file: '/var/log/a2ui/server.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
