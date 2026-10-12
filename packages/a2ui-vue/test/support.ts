import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { VNode } from 'vue';

import { readPath, type RenderContext } from 'a2ui-core';

/** 用 SSR 把 vnode 渲成 HTML 字符串 —— 组件测试都在 Node 里跑，不开浏览器。 */
export const renderHtml = (vnode: VNode | null): Promise<string> =>
  renderToString(createSSRApp({ render: () => vnode }));

interface ContextOptions {
  componentId?: string;
  surfaceId?: string;
  /** `resolve` 的返回值表：componentId → 该组件的 `_vnode`。 */
  nodes?: Record<string, unknown>;
  /** `read` 的数据来源，模拟 surface 的数据模型。 */
  data?: Record<string, unknown>;
}

/** 手搓一个渲染上下文，用来单独驱动某个组件的渲染函数。 */
export const fakeContext = ({
  componentId = 'component',
  surfaceId = 'surface',
  nodes = {},
  data = {},
}: ContextOptions = {}): RenderContext => ({
  componentId,
  surfaceId,
  resolve: (id: string) => nodes[id] ?? null,
  read: (path: string) => readPath(data, path),
});

/** 把官方示例的 JSON 数组转成 JSONL（每行一条消息），与线上协议一致。 */
export const jsonl = (messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

const CATALOG_ROOT = new URL('../../../specification/v0_8/json/', import.meta.url);

/** 读取 specification 下的协议文件（相对 v0_8/json 目录）。 */
export const readSpecJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, CATALOG_ROOT)), 'utf8')) as T;
