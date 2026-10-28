/**
 * 天气页场景：从真实 store 快照重建的完整协议序列（流式）。
 *
 * 与其它 mock 的差别只在「怎么来的」：别的场景是手写协议，这个是**照搬真实生成结果**
 * ——组件与数据都来自用户在 playground 里跑出的那一页（`surface-0e80513a`），见
 * `weather-data.ts` 顶部说明。这里只做一件事：把它切成符合流式规约的消息序列。
 *
 * 切法与 prompt 规约一致（见 `docs/a2ui-agent-prompt.md`）：
 *   #1 surfaceUpdate(root) → #2 beginRendering → #3 dataModelUpdate → 之后按 7 个组件一条分块。
 * root 的 `explicitList` 允许前向引用尚未到达的子 id，所以先发 root 就能「边收边长出整页」。
 */
import {
  WEATHER_COMPONENTS,
  WEATHER_DATA_MODEL,
  WEATHER_ORPHAN_COMPONENTS,
} from './weather-data';

const SURFACE_ID = 'weather';

/** 一条 `DataEntry`（协议的数据模型条目，嵌套 map 用邻接表表达）。 */
interface DataEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataEntry[];
}

/**
 * 普通 JSON → 协议的 `DataEntry[]`。
 *
 * 协议的数据模型**没有原生数组**：数组与对象都用 `valueMap`（对象 map）表达，
 * 「列表」靠 `List` 的 `item` 占位路径展开。这里遇到数组就按对象 map 转（键为下标），
 * 与真实生成结果一致。
 */
const toDataEntries = (value: unknown): DataEntry[] => {
  const source = Array.isArray(value)
    ? Object.fromEntries(value.map((item, index) => [String(index), item]))
    : (value as Record<string, unknown>);

  return Object.entries(source).map(([key, item]) => {
    if (typeof item === 'string') {
      return { key, valueString: item };
    }
    if (typeof item === 'number') {
      return { key, valueNumber: item };
    }
    if (typeof item === 'boolean') {
      return { key, valueBoolean: item };
    }
    return { key, valueMap: toDataEntries(item) };
  });
};

const build = (): string[] => {
  const all = [...WEATHER_COMPONENTS, ...WEATHER_ORPHAN_COMPONENTS];
  const [root, ...rest] = all;

  const messages: string[] = [
    // #1 先把 root 发出去：它的 explicitList 会前向引用后面才到的子节点。
    JSON.stringify({
      surfaceUpdate: {
        surfaceId: SURFACE_ID,
        components: [{ id: root[0], component: root[1] }],
      },
    }),
    // #2 紧接着 beginRendering，界面从这一刻开始「存在」。
    JSON.stringify({ beginRendering: { surfaceId: SURFACE_ID, root: root[0] } }),
    // #3 数据模型先到：后面所有 Text/Icon 的 path 绑定都依赖它。
    JSON.stringify({
      dataModelUpdate: {
        surfaceId: SURFACE_ID,
        contents: toDataEntries(WEATHER_DATA_MODEL),
      },
    }),
  ];

  const BLOCK = 7;
  for (let i = 0; i < rest.length; i += BLOCK) {
    messages.push(
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: SURFACE_ID,
          components: rest.slice(i, i + BLOCK).map(([id, component]) => ({ id, component })),
        },
      }),
    );
  }

  return messages;
};

/** 一行一条消息，数组顺序即发送顺序。 */
export const weatherMessages: string[] = build();
