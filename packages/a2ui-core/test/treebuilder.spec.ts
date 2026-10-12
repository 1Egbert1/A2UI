import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  clearStore,
  getAllErrors,
  getAllTrees,
  getHydrateNode,
  getSurface,
  getTree,
  resetA2UIStore,
} from '../src/store';
import type { HydrateNode, Surface } from '../src/store/types';
import { buildTree, explicitChildIds, type TreeNode } from '../src/treebuilder';

const jsonl = (...messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

const surfaceUpdate = (surfaceId: string, id: string, text: string) => ({
  surfaceUpdate: {
    surfaceId,
    components: [{ id, component: { Text: { text: { literalString: text } } } }],
  },
});

/** 造一个 hydrateNode，`_vnode` 用 componentId 做标记，方便断言树里的引用来自哪个节点。 */
const node = (
  componentId: string,
  component: Record<string, unknown>,
  surfaceId = 's',
): HydrateNode => ({
  componentId,
  _vnode: `vnode:${componentId}`,
  ownerSurfaceId: surfaceId,
  protocol: JSON.stringify(component),
});

/** Column 组件定义；children.explicitList 即子组件 id 列表。 */
const columnOf = (...childIds: string[]) => ({
  Column: { children: { explicitList: childIds } },
});

const textOf = (text: string) => ({ Text: { text: { literalString: text } } });

/**
 * 把一个 surface 的节点表与它的 Surface 分开返回。
 *
 * 刻意不把两者塞进同一个对象：hydrateNodeMap 是按 componentId 索引的，
 * 混入额外的 key 会污染查找（虽然当前不会撞名，但结构上就不该允许）。
 */
const surfaceOf = (
  surfaceId: string,
  nodes: HydrateNode[],
  rootId: string,
): { surface: Surface; nodes: Record<string, HydrateNode> } => {
  const map: Record<string, HydrateNode> = {};
  for (const item of nodes) {
    map[item.componentId] = { ...item, ownerSurfaceId: surfaceId };
  }
  return {
    surface: { surfaceId, beginRender: true, rootNode: map[rootId] },
    nodes: map,
  };
};

/**
 * 深度优先遍历整棵树，对每个节点回调一次，并带上它在树里的父节点。
 *
 * 断言「整棵树的父子关系自洽」时，逐节点手写会随结构变化而失效；用它遍历一遍即可。
 */
const walk = (
  node: TreeNode,
  parent: TreeNode | null,
  visit: (node: TreeNode, parent: TreeNode | null) => void,
): void => {
  visit(node, parent);
  for (const child of node.children) {
    walk(child, node, visit);
  }
};

/** 把树投影成「id / parentId / children」的纯结构，忽略 vnode，便于对整棵形状做 deepEqual。 */
const shapeOf = (node: TreeNode): unknown => ({
  id: node.componentId,
  parentId: node.parentId,
  children: node.children.map(shapeOf),
});

/** 统计树里的节点总数与叶子数。 */
const sizeOf = (node: TreeNode): { total: number; leaves: number } => {
  let total = 0;
  let leaves = 0;
  walk(node, null, (current) => {
    total += 1;
    if (current.children.length === 0) {
      leaves += 1;
    }
  });
  return { total, leaves };
};

/**
 * 由 column-texts 的形状扩展出的两层 Column 嵌套，用来验证「多层结构」也走真实
 * parser 路径（既有的多层用例是在 buildTree 单元层手搓节点，不经过解析与 hydrate）。
 */
const nestedJsonl = jsonl(
  {
    surfaceUpdate: {
      surfaceId: 'nested',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['outer'] } } } },
        { id: 'outer', component: { Column: { children: { explicitList: ['inner'] } } } },
        { id: 'inner', component: { Column: { children: { explicitList: ['leaf'] } } } },
        { id: 'leaf', component: { Text: { text: { literalString: 'deep' } } } },
      ],
    },
  },
  { beginRendering: { surfaceId: 'nested', root: 'root' } },
);

const mockFilePath = fileURLToPath(new URL('../mock/simple-text.jsonl', import.meta.url));
const simpleTextJsonl = readFileSync(mockFilePath, 'utf8');
const columnMockPath = fileURLToPath(new URL('../mock/column-texts.jsonl', import.meta.url));
const columnTextsJsonl = readFileSync(columnMockPath, 'utf8');

describe('A2UI TreeBuilder', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap({});
  });

  describe('explicitChildIds', () => {
    it('should read component ids from children.explicitList', () => {
      assert.deepEqual(explicitChildIds(node('root', columnOf('a', 'b'))), ['a', 'b']);
    });

    it('should return an empty list for a leaf component', () => {
      assert.deepEqual(explicitChildIds(node('t', textOf('hi'))), []);
    });

    it('should drop non-string entries and ignore children.template', () => {
      const mixed = node('root', { Column: { children: { explicitList: ['a', 1, null] } } });
      assert.deepEqual(explicitChildIds(mixed), ['a']);

      const templated = node('root', {
        Column: { children: { template: { componentId: 'row', dataBinding: '/items' } } },
      });
      assert.deepEqual(explicitChildIds(templated), [], 'template 形态尚未支持，应视为无子节点');
    });

    it('should tolerate a malformed protocol string', () => {
      const broken: HydrateNode = { ...node('root', columnOf('a')), protocol: '{not json' };
      assert.deepEqual(explicitChildIds(broken), []);
    });
  });

  describe('buildTree 基础', () => {
    it('should build one tree per surface, keyed by surfaceId', () => {
      const a = surfaceOf('a', [node('a-root', textOf('A'))], 'a-root');
      const b = surfaceOf('b', [node('b-root', textOf('B'))], 'b-root');

      const trees = buildTree(
        { a: a.surface, b: b.surface },
        { ...a.nodes, ...b.nodes },
      );

      assert.deepEqual(Object.keys(trees).sort(), ['a', 'b']);
      assert.equal(trees.a.root.componentId, 'a-root');
      assert.equal(trees.b.root.componentId, 'b-root');
    });

    it('should take surface.rootNode as the tree root and mark it parentless', () => {
      const s = surfaceOf('s', [node('root', textOf('x'))], 'root');

      const tree = buildTree({ s: s.surface }, s.nodes);

      assert.equal(tree.s.root.componentId, 'root');
      assert.equal(tree.s.root.parentId, null, '根节点没有父节点');
    });

    it('should mirror the rendered vnode onto the tree node without copying', () => {
      const s = surfaceOf('s', [node('root', textOf('x'))], 'root');

      const tree = buildTree({ s: s.surface }, s.nodes);

      assert.equal(tree.s.root.vnode, 'vnode:root');
      assert.equal(tree.s.root.vnode, s.nodes.root._vnode, '应复用同一个节点实例');
    });

    it('should give a leaf node no children', () => {
      const s = surfaceOf('s', [node('root', textOf('x'))], 'root');

      assert.deepEqual(buildTree({ s: s.surface }, s.nodes).s.root.children, []);
    });

    it('should return an empty map for an empty surfaceMap', () => {
      assert.deepEqual(buildTree({}, {}), {});
    });
  });

  describe('buildTree 父子组装', () => {
    it('should attach children in explicitList order', () => {
      const s = surfaceOf(
        's',
        [
          node('root', columnOf('title', 'body', 'caption')),
          node('title', textOf('t')),
          node('body', textOf('b')),
          node('caption', textOf('c')),
        ],
        'root',
      );

      const root = buildTree({ s: s.surface }, s.nodes).s.root;

      assert.deepEqual(
        root.children.map((child) => child.componentId),
        ['title', 'body', 'caption'],
      );
      assert.deepEqual(
        root.children.map((child) => child.parentId),
        ['root', 'root', 'root'],
      );
      assert.deepEqual(
        root.children.map((child) => child.vnode),
        ['vnode:title', 'vnode:body', 'vnode:caption'],
      );
    });

    it('should nest deeper than one level', () => {
      const s = surfaceOf(
        's',
        [
          node('root', columnOf('outer')),
          node('outer', columnOf('inner')),
          node('inner', textOf('deep')),
        ],
        'root',
      );

      const root = buildTree({ s: s.surface }, s.nodes).s.root;
      const outer = root.children[0];
      const inner = outer.children[0];

      assert.equal(outer.componentId, 'outer');
      assert.equal(inner.componentId, 'inner');
      assert.equal(inner.parentId, 'outer');
      assert.deepEqual(inner.children, [], 'Text 是叶子');
      assert.equal(root.children[0].parentId, 'root');
    });

    it('should skip child ids that were never registered', () => {
      const s = surfaceOf(
        's',
        [node('root', columnOf('ghost', 'real')), node('real', textOf('r'))],
        'root',
      );

      const root = buildTree({ s: s.surface }, s.nodes).s.root;

      assert.deepEqual(
        root.children.map((child) => child.componentId),
        ['real'],
        '未登记的子 id 应被跳过，而不是产生空壳节点',
      );
    });

    it('should skip a child that belongs to another surface', () => {
      const s = surfaceOf('s', [node('root', columnOf('foreign'))], 'root');
      const foreign = node('foreign', textOf('f'), 'other');

      const root = buildTree({ s: s.surface }, { ...s.nodes, foreign }).s.root;

      assert.deepEqual(root.children, [], '跨 surface 引用不成立，应跳过');
    });

    it('should break reference cycles instead of recursing forever', () => {
      const s = surfaceOf('s', [node('root', columnOf('a')), node('a', columnOf('root'))], 'root');

      const root = buildTree({ s: s.surface }, s.nodes).s.root;

      assert.equal(root.children.length, 1);
      assert.equal(root.children[0].componentId, 'a');
      assert.deepEqual(root.children[0].children, [], '指回祖先的边应被丢弃');
    });

    it('should expand a shared child under each parent', () => {
      const s = surfaceOf(
        's',
        [
          node('root', columnOf('left', 'right')),
          node('left', columnOf('shared')),
          node('right', columnOf('shared')),
          node('shared', textOf('s')),
        ],
        'root',
      );

      const root = buildTree({ s: s.surface }, s.nodes).s.root;
      const left = root.children[0];
      const right = root.children[1];

      assert.equal(left.children[0].componentId, 'shared');
      assert.equal(right.children[0].componentId, 'shared');
      assert.notEqual(left.children[0], right.children[0], '树是展开视图，每个父节点各持一份');
      assert.equal(left.children[0].parentId, 'left');
      assert.equal(right.children[0].parentId, 'right');
    });

    it('should still assemble structure when no renderer is registered', () => {
      const s = surfaceOf('s', [node('root', columnOf('child')), node('child', textOf('c'))], 'root');

      const root = buildTree({ s: s.surface }, s.nodes).s.root;

      assert.equal(root.children.length, 1, '树结构来自协议，与是否渲染成功无关');
    });
  });

  describe('parseA2UI 结束后组装', () => {
    it('should populate treeMap once the whole JSONL is parsed', () => {
      const state = parseA2UI(simpleTextJsonl);

      assert.deepEqual(Object.keys(state.treeMap), ['simple-text']);
      assert.equal(getTree('simple-text')!.root.componentId, 'root');
    });

    it('should expose the same node instance the store holds', () => {
      parseA2UI(simpleTextJsonl);

      const tree = getTree('simple-text');
      assert.equal(
        tree!.root.vnode,
        getHydrateNode('root')!._vnode,
        '树的 vnode 应就是 hydrateNode 上那个实例',
      );
      assert.equal(tree!.root.vnode, getSurface('simple-text')!.rootNode._vnode);
    });

    it('should rebuild the tree from scratch on every parse call', () => {
      parseA2UI(simpleTextJsonl);
      const first = getTree('simple-text');
      assert.ok(first);

      parseA2UI(simpleTextJsonl);

      assert.notEqual(getTree('simple-text'), first, '每次解析都应整体重建，而不是复用旧对象');
    });

    it('should not build a tree when no surface was rendered', () => {
      // 只有 surfaceUpdate，没有 beginRendering —— 节点登记了，但 surface 还没诞生。
      parseA2UI(jsonl(surfaceUpdate('s', 'root', 'Hi')));

      assert.ok(getHydrateNode('root'), '节点应已登记');
      assert.deepEqual(getAllTrees(), {}, '没有 surface 就没有树');
    });

    it('should keep the renderer output reachable from the tree root', () => {
      setRenderMap({
        Text: (props) => `rendered:${String((props.text as { literalString: string }).literalString)}`,
      });

      parseA2UI(simpleTextJsonl);

      assert.equal(getTree('simple-text')!.root.vnode, 'rendered:Hello, A2UI!');
    });
  });

  describe('mock/column-texts.jsonl（端到端：一父三子）', () => {
    beforeEach(() => {
      // Column/Text 都注册成简单标记，方便同时断言「树结构」与「渲染结果」。
      setRenderMap({
        Column: () => 'COLUMN',
        Text: (props) => `TEXT:${String((props.text as { literalString: string }).literalString)}`,
      });
    });

    it('should assemble a Column root with three Text children', () => {
      parseA2UI(columnTextsJsonl);

      const tree = getTree('column-texts');
      assert.ok(tree, '应生成 surface "column-texts" 的树');

      const root = tree!.root;
      assert.equal(root.componentId, 'root');
      assert.equal(root.vnode, 'COLUMN');
      assert.deepEqual(
        root.children.map((child) => child.componentId),
        ['title', 'body', 'caption'],
        '子节点顺序应与 explicitList 一致，即使子组件定义在父组件之后（前向引用）',
      );
    });

    it('should point every child back at its parent', () => {
      parseA2UI(columnTextsJsonl);

      const root = getTree('column-texts')!.root;

      assert.deepEqual(
        root.children.map((child) => child.parentId),
        ['root', 'root', 'root'],
      );
      assert.deepEqual(
        root.children.map((child) => child.children),
        [[], [], []],
        'Text 是叶子，不应再有子节点',
      );
    });

    it('should render every node and produce no errors', () => {
      parseA2UI(columnTextsJsonl);

      const root = getTree('column-texts')!.root;
      assert.deepEqual(
        root.children.map((child) => child.vnode),
        [
          'TEXT:A2UI 组件树',
          'TEXT:Column 容器下挂了三个 Text 子组件，父子关系由 children.explicitList 声明。',
          'TEXT:treebuilder 按 componentId 反查 hydrateNode，递归展开子树。',
        ],
      );
      assert.deepEqual(getAllErrors(), {}, '合法 mock 配齐渲染器后不应产生任何错误');
    });

    it('should keep the tree vnodes identical to the hydrate nodes', () => {
      parseA2UI(columnTextsJsonl);

      const root = getTree('column-texts')!.root;
      assert.equal(root.vnode, getHydrateNode('root')!._vnode);
      assert.equal(root.children[0].vnode, getHydrateNode('title')!._vnode);
      assert.equal(root.children[2].vnode, getHydrateNode('caption')!._vnode);
    });

    it('should reproduce the exact one-parent / three-leaf shape', () => {
      parseA2UI(columnTextsJsonl);

      assert.deepEqual(shapeOf(getTree('column-texts')!.root), {
        id: 'root',
        parentId: null,
        children: [
          { id: 'title', parentId: 'root', children: [] },
          { id: 'body', parentId: 'root', children: [] },
          { id: 'caption', parentId: 'root', children: [] },
        ],
      });
    });

    it('should count four nodes in total, three of them leaves', () => {
      parseA2UI(columnTextsJsonl);

      assert.deepEqual(sizeOf(getTree('column-texts')!.root), { total: 4, leaves: 3 });
    });

    it('should keep parentId equal to the parent componentId for every node', () => {
      parseA2UI(columnTextsJsonl);
      const root = getTree('column-texts')!.root;

      const visited: string[] = [];
      walk(root, null, (current, parent) => {
        visited.push(current.componentId);
        assert.equal(
          current.parentId,
          parent ? parent.componentId : null,
          `${current.componentId} 的 parentId 应指向它的父节点`,
        );
      });
      assert.deepEqual(
        visited,
        ['root', 'title', 'body', 'caption'],
        '深度优先顺序应完整覆盖四个节点，不多不少',
      );
    });

    it('should read the child order straight from the stored root protocol', () => {
      parseA2UI(columnTextsJsonl);

      assert.deepEqual(
        explicitChildIds(getHydrateNode('root')!),
        ['title', 'body', 'caption'],
        '树的子节点顺序应直接来自协议里的 explicitList',
      );
    });

    it('should trace every tree node back to a hydrate node of the same surface', () => {
      parseA2UI(columnTextsJsonl);
      const tree = getTree('column-texts')!;

      assert.equal(tree.surfaceId, 'column-texts');
      walk(tree.root, null, (current) => {
        const hydrate = getHydrateNode(current.componentId);
        assert.ok(hydrate, `${current.componentId} 应能在 store 中反查到 hydrateNode`);
        assert.equal(hydrate!.ownerSurfaceId, 'column-texts');
        assert.equal(
          current.vnode,
          hydrate!._vnode,
          `${current.componentId} 的 vnode 应复用 hydrateNode 上的实例`,
        );
      });
    });

    it('should rebuild an identical shape on a second parse', () => {
      parseA2UI(columnTextsJsonl);
      const first = shapeOf(getTree('column-texts')!.root);

      parseA2UI(columnTextsJsonl);
      const second = shapeOf(getTree('column-texts')!.root);

      assert.deepEqual(second, first, '重复解析应得到相同形状，而不是累积或残留');
    });

    it('should let a leaf navigate back up to the surface root', () => {
      parseA2UI(columnTextsJsonl);
      const tree = getTree('column-texts')!;
      const caption = tree.root.children[2];

      assert.equal(caption.parentId, tree.root.componentId, '沿 parentId 可回溯到根');
      assert.equal(getSurface('column-texts')!.rootNode.componentId, tree.root.componentId);
    });

    it('should assemble a multi-level Column chain through the real parser', () => {
      parseA2UI(nestedJsonl);

      assert.deepEqual(shapeOf(getTree('nested')!.root), {
        id: 'root',
        parentId: null,
        children: [
          {
            id: 'outer',
            parentId: 'root',
            children: [
              {
                id: 'inner',
                parentId: 'outer',
                children: [{ id: 'leaf', parentId: 'inner', children: [] }],
              },
            ],
          },
        ],
      });
    });
  });

  describe('mock/column-row-mix.jsonl（多层 Column / Row 混排）', () => {
    const mixJsonl = readFileSync(
      fileURLToPath(new URL('../mock/column-row-mix.jsonl', import.meta.url)),
      'utf8',
    );

    beforeEach(() => {
      // 只关心树结构，渲染器给个标记即可。
      setRenderMap({
        Column: () => 'COLUMN',
        Row: () => 'ROW',
        Card: () => 'CARD',
        Divider: () => 'DIVIDER',
        Button: () => 'BUTTON',
        Text: () => 'TEXT',
      });
    });

    it('should assemble only the explicitList edges, leaving private-child components out', () => {
      parseA2UI(mixJsonl);

      assert.deepEqual(getAllErrors(), {}, '合法 mock 配齐渲染器后不应产生任何错误');
      assert.equal(
        sizeOf(getTree('column-row-mix')!.root).total,
        16,
        'mock 有 26 个组件，但 Card.child / Button.child 是组件私有字段、不参与建树，' +
          '所以树里只有 16 个节点',
      );
    });

    it('should take the root children in explicitList order', () => {
      parseA2UI(mixJsonl);

      assert.deepEqual(
        getTree('column-row-mix')!.root.children.map((child) => child.componentId),
        ['title', 'subtitle', 'divider-top', 'overview-row', 'divider-bottom', 'footer-row'],
      );
    });

    it('should treat a Card as a leaf because its content is a private child field', () => {
      parseA2UI(mixJsonl);
      const root = getTree('column-row-mix')!.root;

      const overviewRow = root.children.find((child) => child.componentId === 'overview-row')!;
      assert.deepEqual(
        overviewRow.children.map((child) => child.componentId),
        ['stat-revenue', 'stat-orders', 'stat-growth'],
        'Row 的三个 Card 是 explicitList 子节点',
      );
      assert.deepEqual(
        overviewRow.children[0].children,
        [],
        'Card 的 child 指向正文 Column，但那是私有字段，树里不再往下展开',
      );
    });

    it('should alternate Column and Row down to 5 levels through explicitList', () => {
      parseA2UI(mixJsonl);
      const root = getTree('column-row-mix')!.root;

      // root(Column) → footer-row(Row) → legend(Column) → legend-items(Row) → legend-income(Text)
      const footerRow = root.children.find((child) => child.componentId === 'footer-row')!;
      const legend = footerRow.children.find((child) => child.componentId === 'legend')!;
      const legendItems = legend.children.find((child) => child.componentId === 'legend-items')!;
      const leaf = legendItems.children[0];

      assert.deepEqual(
        [
          root.componentId,
          footerRow.componentId,
          legend.componentId,
          legendItems.componentId,
          leaf.componentId,
        ],
        ['root', 'footer-row', 'legend', 'legend-items', 'legend-income'],
        'Column / Row 应交替嵌套到第 5 层',
      );
      assert.deepEqual(leaf.children, [], '最深处的 Text 是叶子');
    });

    it('should keep parentId consistent along that 5-level path', () => {
      parseA2UI(mixJsonl);
      const root = getTree('column-row-mix')!.root;

      const footerRow = root.children.find((child) => child.componentId === 'footer-row')!;
      const legend = footerRow.children.find((child) => child.componentId === 'legend')!;
      const legendItems = legend.children.find((child) => child.componentId === 'legend-items')!;

      assert.deepEqual(
        [footerRow.parentId, legend.parentId, legendItems.parentId, legendItems.children[0].parentId],
        ['root', 'footer-row', 'legend', 'legend-items'],
      );
    });
  });

  describe('与级联清理的配合', () => {
    it('should drop the tree when its surface is deleted', () => {
      parseA2UI(simpleTextJsonl);
      assert.ok(getTree('simple-text'));

      parseA2UI(jsonl({ deleteSurface: { surfaceId: 'simple-text' } }));

      assert.equal(getTree('simple-text'), undefined, 'surface 被删后树也应级联清除');
      assert.deepEqual(getAllTrees(), {});
    });

    it('should clear every tree on clearStore', () => {
      parseA2UI(simpleTextJsonl);

      clearStore();

      assert.deepEqual(getAllTrees(), {});
    });
  });
});
