/**
 * 图标查询工具的**定义**与**分发**。
 *
 * 定义只有一份：`ICON_TOOL_DEFS` 同时喂给两个消费方 ——
 * MCP Server 的 `listTools`（`inputSchema`）与 OpenAI 的 `tools`（`parameters`），
 * 两者本来就是同一个 JSON Schema，抄两份必然漂。
 *
 * 工具刻意保持三个、都很小：模型生成 Icon 前若不确定名字，查一下再写。
 * 没有「列出全部图标」这种工具 —— 那等于把清单换种方式塞回上下文，与
 * 「不进 prompt」的初衷相反。
 */
import type { AgentToolDef } from '../../types';
import { getIcon, listIcons, searchIcons } from './icon-index';

export const ICON_TOOL_DEFS: AgentToolDef[] = [
  {
    name: 'searchIcons',
    description:
      '搜索 Element Plus 图标库里可用的图标名。生成 Icon 组件前如果不确定准确的名字，先用它查。支持中文概念（如「购物车」「设置」「天气」）或英文关键词（如 cart、setting、weather）。返回按相关度排序的图标名列表（PascalCase）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '中文概念或英文关键词，如「购物车」「cart」「设置」',
        },
        limit: {
          type: 'integer',
          description: '返回数量，默认 12，最大 30',
          minimum: 1,
          maximum: 30,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'listIcons',
    description:
      '按首字母浏览 Element Plus 图标库的图标名。适合漫无目的地找图标（如先看 S 开头有哪些）。不传 letter 则返回全部（受 limit 限制）。',
    inputSchema: {
      type: 'object',
      properties: {
        letter: {
          type: 'string',
          description: '首字母，如 "s"；缺省返回全部',
        },
        limit: {
          type: 'integer',
          description: '返回数量，默认 60，最大 300',
          minimum: 1,
          maximum: 300,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'getIcon',
    description:
      '校验一个图标名是否真实存在于 Element Plus 图标库。存在时返回规范名（大小写/分隔符差异会被纠正）；不存在时给出最接近的候选。',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '待校验的图标名，如 "Search"、"home_filled"',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  return typeof value === 'string' ? value : '';
};

const numberArg = (args: Record<string, unknown>, key: string, fallback: number): number => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/** 执行一次图标工具调用，返回给模型的文本（JSON 字符串）。 */
export const executeIconTool = (name: string, args: unknown): string => {
  const record = asRecord(args);

  switch (name) {
    case 'searchIcons':
      return JSON.stringify(searchIcons(stringArg(record, 'query'), numberArg(record, 'limit', 12)));
    case 'listIcons': {
      const letter = stringArg(record, 'letter');
      return JSON.stringify({ icons: listIcons(letter, numberArg(record, 'limit', 60)) });
    }
    case 'getIcon':
      return JSON.stringify(getIcon(stringArg(record, 'name')));
    default:
      // 未知工具也要给模型一个能读的答复——抛出异常会让整个工具轮白跑。
      return JSON.stringify({ error: `未知工具：${name}`, available: ICON_TOOL_DEFS.map((def) => def.name) });
  }
};
