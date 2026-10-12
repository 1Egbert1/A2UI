import { fileURLToPath, URL } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // 数组形式保证匹配顺序：更长的前缀必须排在前面，
    // 否则 'a2ui-core/mock/...' 会先被 'a2ui-core' 命中并错误拼接。
    alias: [
      {
        find: 'a2ui-core/mock',
        replacement: fileURLToPath(new URL('../../packages/a2ui-core/mock', import.meta.url)),
      },
      {
        find: 'a2ui-core',
        replacement: fileURLToPath(new URL('../../packages/a2ui-core/src/index.ts', import.meta.url)),
      },
      {
        find: 'a2ui-vue',
        replacement: fileURLToPath(new URL('../../packages/a2ui-vue/src/index.ts', import.meta.url)),
      },
    ],
  },
  optimizeDeps: {
    exclude: ['a2ui-core', 'a2ui-vue'],
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
});
