/**
 * A2UI 四种消息类型的判别键。
 *
 * 为什么不在运行时从 `a2ui-core` 引：`a2ui-core` 的入口指向 `dist/`，
 * 服务端却要求「clone 下来不构建 core 也能 `pnpm dev`」。类型可以走 `import type`
 * （编译期擦除，运行时不需要 dist），**取值**不行 —— 所以这份 4 个字符串的常量
 * 在服务端本地声明一份。消息体类型仍然复用 core 的声明，见 `../types.ts`。
 *
 * 与 `packages/a2ui-core/src/parser/types.ts` 的 `MESSAGE_KEYS` 必须保持一致。
 */
export const MESSAGE_KEYS = [
  'surfaceUpdate',
  'beginRendering',
  'dataModelUpdate',
  'deleteSurface',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

export type { A2UIMessage } from '../types';
