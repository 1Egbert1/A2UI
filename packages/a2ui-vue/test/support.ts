import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { VNode } from 'vue';

import { readPath, type RenderContext, type TemplateItem } from 'a2ui-core';

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
  /** 该组件是否已播过入场动画（默认为 false，即「新组件，需要播」）。 */
  hasMounted?: boolean;
  /** 入场动画结束时的回调；默认是个记录不到任何东西的空函数。 */
  markMounted?: () => void;
  /** 写回数据模型的回调；默认是个记录不到任何东西的空函数。 */
  updateModel?: (path: string, value: unknown) => void;
  /** 按数据列表渲染模板组件的回调；默认返回空数组（不渲染任何子项）。 */
  renderTemplate?: (componentId: string, dataBinding: string) => TemplateItem[];
}

/** 手搓一个渲染上下文，用来单独驱动某个组件的渲染函数。 */
export const fakeContext = ({
  componentId = 'component',
  surfaceId = 'surface',
  nodes = {},
  data = {},
  hasMounted = false,
  markMounted = () => {},
  updateModel = () => {},
  renderTemplate = () => [],
}: ContextOptions = {}): RenderContext => ({
  componentId,
  surfaceId,
  resolve: (id: string) => nodes[id] ?? null,
  read: (path: string) => readPath(data, path),
  hasMounted,
  markMounted,
  updateModel,
  renderTemplate,
});

/** 把官方示例的 JSON 数组转成 JSONL（每行一条消息），与线上协议一致。 */
export const jsonl = (messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

const CATALOG_ROOT = new URL('../../../specification/v0_8/json/', import.meta.url);

/** 读取 specification 下的协议文件（相对 v0_8/json 目录）。 */
export const readSpecJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, CATALOG_ROOT)), 'utf8')) as T;
