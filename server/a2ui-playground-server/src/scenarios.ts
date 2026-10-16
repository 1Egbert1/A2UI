/**
 * 示例场景注册表：把 core 的 mock fixture 变成**可由接口取到的命名场景**。
 *
 * 动机：示例数据此前是 playground 在浏览器里 `import` 进来直接渲染的，整条 HTTP + SSE +
 * AG-UI 链路只有「自由输入」那一条会走。登记成场景之后，每个示例都真的过一遍完整链路 ——
 * 协议消息由服务端产出、经 SSE 逐条下发、客户端再解析渲染，与真实模型走的是同一条路。
 *
 * 数据从 core 的**构建产物**加载（`dist/mock`，CommonJS），原因有两条：
 *   1. 本机 `node_modules/a2ui-core` 是空目录（workspace 软链建不出来），`import 'a2ui-core/mock'`
 *      在 Node 侧解析不到；
 *   2. 走 dist 能保证「服务端发出去的 fixture」与「客户端解析的协议」来自同一次构建。
 *   前置条件：先构建 core（根目录 `pnpm -r build`，`-r` 会按依赖顺序把 core 排在前）。
 */
import * as coreMock from '../../../packages/a2ui-core/dist/mock';
import type { A2UIMessage, ScenarioOrder, ScenarioSummary } from './types';

export interface ScenarioDefinition {
  id: string;
  desc: string;
  /**
   * fixture 里消息自带的 surfaceId。
   *
   * **必须原样用作本轮运行的 surfaceId**：客户端拿到 AG-UI 的 `a2ui.surface` 事件后会用它
   * 去 `treeMap` 里找树，对不上就是白板。注意它不一定等于 id（`product-card` 的 fixture
   * 用的是 `gallery-product-card`），所以只能从数据里读、不能拿 id 顶替。
   */
  surfaceId: string;
  /** 一行一条的协议消息，与 core mock 的形态一致。 */
  lines: string[];
  /** 解析后的消息对象，接口直接回给客户端用。 */
  messages: A2UIMessage[];
}

/**
 * 从 fixture 里读出唯一的 surfaceId。
 *
 * 顺带当**不变量检查**：一份 fixture 只该面向一个 surface。真出现两个（多半是复制粘贴
 * 改漏了），宁可启动就炸 —— 放过去的结果是客户端静默渲染空白，比报错难查得多。
 */
const readSurfaceId = (id: string, lines: string[]): string => {
  const seen = new Set<string>();

  for (const line of lines) {
    const message = JSON.parse(line) as Record<string, { surfaceId?: unknown } | undefined>;
    for (const value of Object.values(message)) {
      if (value !== null && typeof value === 'object' && typeof value.surfaceId === 'string') {
        seen.add(value.surfaceId);
      }
    }
  }

  if (seen.size === 0) {
    throw new Error(`场景「${id}」的 fixture 里没有任何 surfaceId`);
  }
  if (seen.size > 1) {
    throw new Error(`场景「${id}」的 fixture 涉及多个 surface：${[...seen].join(' / ')}`);
  }

  return [...seen][0];
};

/** 登记表。`desc` 是下拉里给人看的一句话说明。 */
const TABLE: Array<{ id: string; desc: string; lines: string[] }> = [
  { id: 'simple-text', desc: '单个 Text，最小示例', lines: coreMock.simpleTextMessages },
  { id: 'product-card', desc: '官方 05 示例，Card + Row + Column', lines: coreMock.productCardMessages },
  { id: 'column-texts', desc: '一父三子，验证父子组装', lines: coreMock.columnTextsMessages },
  { id: 'column-row-mix', desc: 'Column / Row 混排，最深 5 层', lines: coreMock.columnRowMixMessages },
  { id: 'data-binding', desc: '数据绑定：输入 / 勾选 / 拖动写回数据模型', lines: coreMock.dataBindingMessages },
  { id: 'list-template', desc: 'List 动态渲染：按数据列表展开模板组件', lines: coreMock.listTemplateMessages },
  { id: 'shopping-cart', desc: '购物车列表：List 模板 + 图片 + 合计绑定', lines: coreMock.shoppingCartMessages },
  {
    id: 'local-action',
    desc: '本地动作：按钮点击写回数据模型（不经过服务端）',
    lines: coreMock.localActionMessages,
  },
];

/** 全部场景，顺序即下拉顺序。 */
export const SCENARIOS: ScenarioDefinition[] = TABLE.map(({ id, desc, lines }) => ({
  id,
  desc,
  surfaceId: readSurfaceId(id, lines),
  lines,
  messages: lines.map((line) => JSON.parse(line) as A2UIMessage),
}));

/** id 缺省时用哪个场景（与 playground 的默认下拉项保持一致）。 */
export const DEFAULT_SCENARIO_ID = 'column-row-mix';

export const listScenarios = (): ScenarioSummary[] =>
  SCENARIOS.map(({ id, desc, surfaceId, lines }) => ({
    id,
    desc,
    surfaceId,
    messageCount: lines.length,
  }));

export const getScenario = (id: string): ScenarioDefinition | undefined =>
  SCENARIOS.find((scenario) => scenario.id === id);

/** 一次场景字符流的推送方案。 */
export interface ScenarioStreamPlan {
  id: string;
  surfaceId: string;
  order: ScenarioOrder;
  /** 真正要吐出去的整段文本 —— 紧凑形态拼成的 JSONL（结尾补换行）。 */
  text: string;
}

/**
 * 按顺序派生「字符流要吐的那段文本」。
 *
 * 形态刻意取**紧凑版**（多条 surfaceUpdate 压成一条）：字符流面板要压的就是
 * `createA2UIBuffer()` 的括号配对与协议补全 —— 紧凑形态进去、补全形态出来。若吐的是
 * 「一行一条消息」的规整 JSONL，那按换行切就够了，缓冲区里那段逻辑根本不会被执行到。
 *
 * 派生用的是 core 的 `deriveStreamOrders()`，与客户端逐条模式看到的顺序**同一份实现** ——
 * 否则同一个「流式友好」在两条路上含义不同，对比就失去意义了。
 */
export const getScenarioStreamPlan = (
  id: string,
  order: ScenarioOrder,
): ScenarioStreamPlan | undefined => {
  const scenario = getScenario(id);
  if (scenario === undefined) {
    return undefined;
  }

  const [protocol, stream] = coreMock.deriveStreamOrders(scenario.lines);
  const picked = order === 'stream' ? stream : protocol;

  return { id, surfaceId: scenario.surfaceId, order, text: `${picked.compact.join('\n')}\n` };
};
