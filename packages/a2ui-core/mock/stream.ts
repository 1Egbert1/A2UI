/**
 * 流式演示的通用派生工具。
 *
 * 任何一份「一行一条消息」的 A2UI JSONL mock，都能用这里的函数派生出流式面板需要的
 * 四种形态：**协议顺序 / 流式友好** × **逐条 / 紧凑**。这样 Stream 面板不用再写死某一份
 * mock，而是跟随下拉选中的内容实时派生。
 *
 * 四种形态的语义（与 `mock/column-row-mix.ts` 里原来的手工版本完全一致）：
 *
 * - **协议顺序（逐条）**：原样消息。`beginRendering` 在最后，surface 直到最后一条才诞生，
 *   前面组件全推完树仍是空的；
 * - **流式友好（逐条）**：把 `beginRendering` 移到「定义 root 组件的 surfaceUpdate」之后，
 *   root 一到 surface 就成立，后续子组件每到达一条就挂上一批，预览区「边到边长大」；
 * - **紧凑（两种顺序各一份）**：把所有 surfaceUpdate 合并成一条（components 拼在一起），
 *   这是 `createA2UIBuffer` 协议补全的反向操作——紧凑形态进、补全形态出。
 */

/** 一条 server → client 消息的协议形状（只声明这里要用到的字段）。 */
export interface A2UIMessage {
  surfaceUpdate?: {
    surfaceId: string;
    components: Array<{ id: string; component: Record<string, unknown> }>;
  };
  dataModelUpdate?: { surfaceId: string; contents: Array<{ key: string }> };
  beginRendering?: { surfaceId: string; root: string };
  deleteSurface?: { surfaceId: string };
}

/** 解析一行 JSONL。 */
export const parseMessage = (line: string): A2UIMessage => JSON.parse(line) as A2UIMessage;

/** 从协议里找出根组件的 id（`beginRendering.root`）。 */
export const findRootId = (lines: string[]): string | undefined => {
  for (const line of lines) {
    const root = parseMessage(line).beginRendering?.root;
    if (root) return root;
  }
  return undefined;
};

/**
 * 把 `beginRendering` 移到「定义 root 组件的 surfaceUpdate」之后。
 *
 * 这比「无条件移到第一条之后」更通用：root 不一定出现在第一条（某些 mock 把全部组件压进
 * 一条 surfaceUpdate，root 只是其中一项）。找到真正装 root 的那条，紧跟在它后面让 surface
 * 尽早成立，其余消息顺序不变。
 */
export const toStreamFriendly = (lines: string[]): string[] => {
  const root = findRootId(lines);
  if (!root) return [...lines];

  const beginIndex = lines.findIndex((line) => parseMessage(line).beginRendering !== undefined);
  if (beginIndex < 0) return [...lines];

  let rootIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (parseMessage(lines[i]).surfaceUpdate?.components.some((c) => c.id === root)) {
      rootIndex = i;
      break;
    }
  }
  if (rootIndex < 0) return [...lines];

  const begin = lines[beginIndex];
  const rest = lines.filter((_, i) => i !== beginIndex);
  // 移除 begin 后，若 begin 原本在 root 之前，root 的下标会前移一位，需补偿。
  const shiftedRoot = beginIndex < rootIndex ? rootIndex - 1 : rootIndex;
  rest.splice(shiftedRoot + 1, 0, begin);
  return rest;
};

/** 把所有 surfaceUpdate 合并成一条（components 拼在一起），其余消息保持原有相对顺序。 */
export const compactSurfaceUpdates = (lines: string[]): string[] => {
  let surfaceId: string | undefined;
  const components: unknown[] = [];
  const passthrough = new Set<number>();
  let firstSurfaceUpdate = -1;

  lines.forEach((line, index) => {
    const message = parseMessage(line);
    if (message.surfaceUpdate) {
      surfaceId = message.surfaceUpdate.surfaceId;
      components.push(...message.surfaceUpdate.components);
      if (firstSurfaceUpdate < 0) firstSurfaceUpdate = index;
      return;
    }
    passthrough.add(index);
  });

  // 一条 surfaceUpdate 都没有：原样返回，不做无谓的重排。
  if (firstSurfaceUpdate < 0) return [...lines];

  const merged = JSON.stringify({ surfaceUpdate: { surfaceId, components } });
  const result: string[] = [];
  lines.forEach((line, index) => {
    if (index === firstSurfaceUpdate) {
      result.push(merged);
      return;
    }
    if (passthrough.has(index)) result.push(line);
  });
  return result;
};

/**
 * 流式友好的紧凑版：**root 单独一条 → beginRendering → 其余组件压成一条**。
 *
 * 不能对 `toStreamFriendly()` 的结果整体做 `compactSurfaceUpdates`——那会把合并后的大
 * surfaceUpdate 放回「第一条 surfaceUpdate」的位置，beginRendering 只能跟在它后面，
 * 「紧随 root」就失效了（所有组件一起到，预览仍是一次性出现）。
 *
 * 所以手工分三段：root 单独拎出来 → beginRendering → 其余组件压成一条。字符流喂进去时：
 * root 到 → root 登记；beginRendering 到 → surface 成立、树有 1 个节点；随后那条大
 * surfaceUpdate 边吐边被 buffer 逐个抽出，组件逐个登记、树逐层长大。
 */
export const toStreamFriendlyCompact = (lines: string[]): string[] => {
  const root = findRootId(lines);
  if (!root) return compactSurfaceUpdates(lines);

  const begin = lines.find((line) => parseMessage(line).beginRendering !== undefined);
  const rootParts: unknown[] = [];
  const restLines: string[] = [];
  let surfaceId: string | undefined;

  for (const line of lines) {
    const message = parseMessage(line);
    if (message.beginRendering) continue;
    if (message.surfaceUpdate) {
      surfaceId = message.surfaceUpdate.surfaceId;
      rootParts.push(...message.surfaceUpdate.components.filter((c) => c.id === root));
      const others = message.surfaceUpdate.components.filter((c) => c.id !== root);
      if (others.length) {
        restLines.push(JSON.stringify({ surfaceUpdate: { surfaceId, components: others } }));
      }
      continue;
    }
    restLines.push(line);
  }

  const result: string[] = [];
  if (rootParts.length) {
    result.push(JSON.stringify({ surfaceUpdate: { surfaceId, components: rootParts } }));
  }
  if (begin !== undefined) result.push(begin);
  result.push(...compactSurfaceUpdates(restLines));
  return result;
};

/** 流式面板的一种推送顺序（协议顺序 / 流式友好），含逐条与紧凑两种形态。 */
export interface StreamOrder {
  label: string;
  desc: string;
  messages: string[];
  compact: string[];
}

/** 一次性派生四种形态，返回 [协议顺序, 流式友好]。 */
export const deriveStreamOrders = (lines: string[]): [StreamOrder, StreamOrder] => [
  {
    label: '协议顺序',
    desc: 'beginRendering 在最后',
    messages: lines,
    compact: compactSurfaceUpdates(lines),
  },
  {
    label: '流式友好',
    desc: 'beginRendering 紧随 root',
    messages: toStreamFriendly(lines),
    compact: toStreamFriendlyCompact(lines),
  },
];
