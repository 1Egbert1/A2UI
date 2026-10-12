import { splitComponent } from '../renderer';
import type { HydrateNode, Surface } from '../store/types';
import type { TreeNode, TreeMap } from './types';

export * from './types';

/**
 * 取出某个组件定义里声明的子组件 id 列表。
 *
 * 协议把父子关系统一写在容器的 `children` 字段上（见 standard_catalog_definition.json
 * 的 Row / Column / List / Card / Tabs / Modal 定义）：
 *
 * - `explicitList`：固定的 componentId 数组，本函数处理的就是它；
 * - `template`：按数据列表动态生成子节点（`{ componentId, dataBinding }`），
 *   尚未实现——渲染侧会记一条 UNSUPPORTED_FEATURE，这里当作没有子节点。
 *
 * 只认 `explicitList` 是有意的：它是**协议层通用**的父子关系，core 不需要知道
 * 「Column 长什么样」就能把树拼出来。而单子节点属性（Card.child、Modal.contentChild、
 * Tabs.tabItems[].child）是各组件自己的字段，属于渲染期由 `resolve` 处理的细节，
 * 不属于通用树关系，因此不在这里展开。
 */
export const explicitChildIds = (node: HydrateNode): string[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(node.protocol);
  } catch {
    // protocol 不是合法 JSON：节点在 hydrate 阶段已经记过 PARSE_ERROR，这里不再重复报。
    return [];
  }

  const { props } = splitComponent(payload);
  const children = props.children as { explicitList?: unknown } | null | undefined;

  if (!children || typeof children !== 'object' || !Array.isArray(children.explicitList)) {
    return [];
  }

  return children.explicitList.filter((id): id is string => typeof id === 'string');
};

/**
 * 把 hydrateNode 组装成组件树。
 *
 * 触发时机：`parseA2UI` 处理完一整段 JSONL、并完成 `hydrate` 之后调用一次，全量重建 treeMap。
 * 之所以放在整段之后而不是逐行之后，是因为一行 surfaceUpdate 只登记节点，
 * 真正确定根节点的是后面的 beginRendering —— 逐行组装会得到半成品。
 *
 * 组装规则：以 `surface.rootNode` 为根，按每个节点自己声明的 `children.explicitList`
 * 递归展开。子节点引用在 `hydrateNodeMap` 里按 componentId 反查，且**限制在同一 surface 内**。
 *
 * tree 是 surfaceMap 的**派生结果**：不持有新状态，只是把已渲染的 `_vnode`
 * 组织成树形交给渲染引擎，因此可以随时安全地全量重建。
 */
export const buildTree = (
  surfaceMap: Record<string, Surface>,
  hydrateNodeMap: Record<string, HydrateNode>,
): TreeMap => {
  const trees: TreeMap = {};

  for (const [surfaceId, surface] of Object.entries(surfaceMap)) {
    trees[surfaceId] = {
      surfaceId,
      root: toTreeNode(surface.rootNode, surfaceId, null, hydrateNodeMap, new Set()),
    };
  }

  return trees;
};

/**
 * HydrateNode → TreeNode，沿 `children.explicitList` 递归展开子树。
 *
 * 三种边界一律**静默跳过**，不写 errorMap：树是派生视图，错误面已经在
 * parser（PARSE_ERROR）与 hydrate（RENDERER_NOT_FOUND）两处把住了，
 * 在这里再报一次只会产生重复噪音。
 *
 * - 子 id 未登记，或归属别的 surface（跨 surface 引用在协议上不成立）；
 * - 环引用：`ancestors` 是**当前路径**上的 componentId 集合，只拦环，
 *   不拦「同一组件被多个父节点引用」（那是合法的 DAG，展开成多份即可）；
 * - `protocol` 不是合法 JSON（`explicitChildIds` 已兜底为空）。
 */
const toTreeNode = (
  node: HydrateNode,
  surfaceId: string,
  parentId: string | null,
  hydrateNodeMap: Record<string, HydrateNode>,
  ancestors: ReadonlySet<string>,
): TreeNode => {
  // 复制一份再把自己加进去：兄弟节点各自从「父节点的祖先链」重新分叉，互不影响。
  const visited = new Set(ancestors);
  visited.add(node.componentId);

  const children: TreeNode[] = [];
  for (const childId of explicitChildIds(node)) {
    const child = hydrateNodeMap[childId];
    if (!child || child.ownerSurfaceId !== surfaceId || visited.has(childId)) {
      continue;
    }
    children.push(toTreeNode(child, surfaceId, node.componentId, hydrateNodeMap, visited));
  }

  return {
    componentId: node.componentId,
    parentId,
    vnode: node._vnode,
    children,
  };
};
