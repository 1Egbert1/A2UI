import { strict as assert } from 'assert';

import { columnRowMixMessages, columnRowMixStreamMessages } from '../mock/column-row-mix';
import { createJSONLStream, parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getAllErrors,
  getAllHydrateNodes,
  getAllSurfaces,
  getDataModel,
  getSurface,
  getTree,
  resetA2UIStore,
} from '../src/store';
import type { TreeNode } from '../src/treebuilder';

/**
 * buffer stream 的验收基准是「与一次性解析（parseA2UI）终态一致」。
 * 用 `mock/column-row-mix`（已拆成每条消息只定义一个组件，26 条组件消息 +
 * dataModelUpdate + beginRendering，共 28 条）当数据源——它足够长，能覆盖
 * 「分片边界落在 JSON 中间 / 落在换行处 / 落在消息之间」三种情况。
 */
const MIX_LINES = columnRowMixMessages;
/** 拼回整段 JSONL 文本；结尾补换行，与真实的 `.jsonl` 文件形态一致。 */
const MIX_JSONL = `${MIX_LINES.join('\n')}\n`;
const MIX_SURFACE = 'column-row-mix';

/** 每个组件的渲染器只回一个标记——本文件只关心「有没有渲染出东西」，不关心渲染成什么。 */
const MARKER_RENDER_MAP = {
  Column: () => 'COLUMN',
  Row: () => 'ROW',
  Card: () => 'CARD',
  Divider: () => 'DIVIDER',
  Button: () => 'BUTTON',
  Text: () => 'TEXT',
};

const keyOf = (line: string): string => Object.keys(JSON.parse(line))[0];

/** 把当前 store 的**实质内容**投影成一个可 deepEqual 的对象（忽略内部 id、顺序等噪音）。 */
const summarize = () => {
  const tree = getTree(MIX_SURFACE)?.root;

  const shapes: string[] = [];
  const walk = (node: TreeNode, path: string) => {
    const current = path === '' ? node.componentId : `${path}>${node.componentId}`;
    shapes.push(current);
    node.children.forEach((child) => walk(child, current));
  };
  if (tree) {
    walk(tree, '');
  }

  const nodes = getAllHydrateNodes();

  return {
    // 组件 id 排序后比较，避免受「到达顺序」影响
    componentIds: Object.keys(nodes).sort(),
    // 每个组件的协议原文（含数据绑定表达式）
    protocols: Object.fromEntries(
      Object.entries(nodes)
        .map(([id, node]) => [id, node.protocol])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    surfaces: Object.keys(getAllSurfaces()).sort(),
    dataModel: getDataModel(MIX_SURFACE),
    // 树按「路径字符串」比较，顺序敏感——子节点顺序也是组装结果的一部分
    treeShapes: shapes,
    errors: Object.values(getAllErrors())
      .map((error) => error.content)
      .sort(),
  };
};

const countTreeNodes = (node: TreeNode): number =>
  1 + node.children.reduce((sum, child) => sum + countTreeNodes(child), 0);

describe('A2UI JSONL buffer stream', () => {
  beforeEach(() => {
    resetA2UIStore();
    // renderMap 是模块级配置，不随 store 重置，需手动设回。
    setRenderMap(MARKER_RENDER_MAP);
  });

  describe('与一次性解析等价', () => {
    it('should produce the same store as parseA2UI when fed in one shot', () => {
      const stream = createJSONLStream();
      const handled = stream.push(MIX_JSONL);
      const tail = stream.end();

      assert.equal(handled, MIX_LINES.length, '整段一次喂入应解析出全部 28 条消息');
      assert.equal(tail, 0, '文本以换行结尾，end() 无残留可处理');
      assert.equal(stream.pending, '');

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize(), '流式与一次性解析的终态必须完全一致');
    });

    it('should produce the same store when pushed one line at a time', () => {
      const stream = createJSONLStream();
      let handled = 0;
      for (const line of MIX_LINES) {
        handled += stream.push(`${line}\n`);
      }

      assert.equal(handled, MIX_LINES.length);
      assert.equal(stream.pending, '');

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize());
    });

    it('should be insensitive to chunk boundaries (fixed 7-char slices)', () => {
      const stream = createJSONLStream();
      const CHUNK = 7;

      for (let offset = 0; offset < MIX_JSONL.length; offset += CHUNK) {
        stream.push(MIX_JSONL.slice(offset, offset + CHUNK));
      }
      stream.end();

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(
        streamed,
        summarize(),
        '7 个字符一片地切（必然切在 JSON 中间）也必须得到同一结果',
      );
    });

    it('should be insensitive to 1-char-at-a-time feeding', () => {
      const stream = createJSONLStream();
      for (const char of MIX_JSONL) {
        stream.push(char);
      }
      stream.end();

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize());
    });
  });

  describe('分片与缓冲', () => {
    it('should buffer a partial line and expose it via pending', () => {
      const stream = createJSONLStream();
      const first = MIX_LINES[0];
      const cut = Math.floor(first.length / 2);

      const handled = stream.push(first.slice(0, cut));

      assert.equal(handled, 0, '没有换行结尾 → 不产出消息');
      assert.equal(stream.pending, first.slice(0, cut), '未成行的内容应留在缓冲里');
      assert.deepEqual(getAllHydrateNodes(), {}, '未成行不得写进 store');
      assert.deepEqual(getAllErrors(), {}, '半条消息不是错误');

      const completed = stream.push(`${first.slice(cut)}\n`);

      assert.equal(completed, 1, '补齐换行后应产出 1 条消息');
      assert.equal(stream.pending, '');
      assert.equal(Object.keys(getAllHydrateNodes()).length, 1);
    });

    it('should flush a final line that has no trailing newline via end()', () => {
      const stream = createJSONLStream();
      const text = MIX_LINES.slice(0, 2).join('\n');

      const handled = stream.push(text);

      assert.equal(handled, 1, '只有第 1 行有换行结尾');
      assert.equal(stream.pending, MIX_LINES[1], '第 2 行还留在缓冲里');

      assert.equal(stream.end(), 1, 'end() 应把残留的最后一行补上');
      assert.equal(Object.keys(getAllHydrateNodes()).length, 2);
    });

    it('should report 0 from end() when the buffer holds only whitespace', () => {
      const stream = createJSONLStream();
      stream.push(`${MIX_LINES[0]}\n`);

      assert.equal(stream.end(), 0);
      assert.equal(stream.lineCount, 1, '行号不应被空白残留多算一条');
    });

    it('should skip blank lines without counting them as messages', () => {
      const stream = createJSONLStream();
      const handled = stream.push('\n\n   \n');

      assert.equal(handled, 0);
      assert.equal(stream.messageCount, 0);
      assert.equal(stream.lineCount, 3, '空行仍会推进物理行号');
      assert.deepEqual(getAllErrors(), {}, '空行不计为错误');
    });

    it('should handle CRLF line endings', () => {
      const stream = createJSONLStream();
      const handled = stream.push(`${MIX_LINES.slice(0, 3).join('\r\n')}\r\n`);

      assert.equal(handled, 3);
      assert.deepEqual(getAllErrors(), {}, '\\r 应被 trim 掉，不产生解析错误');
      assert.equal(Object.keys(getAllHydrateNodes()).length, 3);
    });
  });

  describe('流式中间态（每片之后的 store 都应自洽）', () => {
    it('should grow hydrateNodeMap by exactly one per component message', () => {
      const stream = createJSONLStream();
      let expected = 0;

      for (const line of MIX_LINES) {
        stream.push(`${line}\n`);
        if (keyOf(line) === 'surfaceUpdate') {
          expected += 1;
        }
        assert.equal(
          Object.keys(getAllHydrateNodes()).length,
          expected,
          `推到「${keyOf(line)}」之后组件数应为 ${expected}`,
        );
      }
    });

    it('should keep treeMap empty until beginRendering arrives, then build it', () => {
      const stream = createJSONLStream();
      const componentLines = MIX_LINES.filter((line) => keyOf(line) === 'surfaceUpdate');

      assert.equal(componentLines.length, 26, '这份 mock 有 26 条组件消息');

      for (const line of componentLines) {
        stream.push(`${line}\n`);
      }

      assert.equal(Object.keys(getAllHydrateNodes()).length, 26, '组件应全部登记');
      assert.equal(
        Object.keys(getAllSurfaces()).length,
        0,
        'beginRendering 未到 → 不该有 surface（rootNode 无法确定）',
      );
      assert.equal(getTree(MIX_SURFACE), undefined, '没有 surface 就没有组件树');
      assert.deepEqual(getAllErrors(), {}, '半截数据不应报错');

      // 补上数据模型与 beginRendering
      for (const line of MIX_LINES.filter((line) => keyOf(line) !== 'surfaceUpdate')) {
        stream.push(`${line}\n`);
      }

      assert.ok(getSurface(MIX_SURFACE), 'beginRendering 之后 surface 应诞生');
      const tree = getTree(MIX_SURFACE);
      assert.ok(tree, 'beginRendering 之后应立刻有树');
      assert.equal(
        countTreeNodes(tree!.root),
        16,
        '树里只走 children.explicitList，Card.child 这类私有字段不建树 → 16 个节点',
      );
    });

    it('跨消息前向引用：root 先列出全部区块 id，后续 surfaceUpdate 逐块补全，树单调增长', () => {
      // 这正是分块流式规约（prompt 规则 4/5）依赖的语义：root 的 explicitList 可以
      // 一次性列出尚未到达的区块 id —— 客户端先跳过，组件到达后自动出现。
      const stream = createJSONLStream();
      const SURFACE = 'forward-ref';

      const line = (components: string): string =>
        `{"surfaceUpdate":{"surfaceId":"${SURFACE}","components":[${components}]}}`;

      // 第 1 条：root 的 explicitList 列出 a/b/c，但只定义 root 与 a（b/c 是前向引用）
      stream.push(
        `${line(
          '{"id":"root","component":{"Column":{"children":{"explicitList":["a","b","c"]}}}},' +
            '{"id":"a","component":{"Text":{"text":{"literalString":"首屏"}}}}',
        )}\n`,
      );
      assert.equal(Object.keys(getAllHydrateNodes()).length, 2, '只登记了 root 与 a');
      assert.equal(Object.keys(getAllSurfaces()).length, 0, 'beginRendering 未到 → 无 surface');

      // 第 2 条：root 已登记 → 立刻 beginRendering，树里只有 root + a（b/c 被静默跳过）
      stream.push(`{"beginRendering":{"surfaceId":"${SURFACE}","root":"root"}}\n`);
      const first = getTree(SURFACE);
      assert.ok(first, 'beginRendering 之后应有树');
      assert.equal(countTreeNodes(first!.root), 2, '前向引用的区块此时还不在树里');
      assert.deepEqual(getAllErrors(), {}, '前向引用不该报错');

      // 第 3 条：b 到达 → 树长出 b
      stream.push(`${line('{"id":"b","component":{"Text":{"text":{"literalString":"第二块"}}}}')}\n`);
      assert.equal(countTreeNodes(getTree(SURFACE)!.root), 3, 'b 到达后应进树');

      // 第 4 条：c 到达 → 树再长出 c
      stream.push(`${line('{"id":"c","component":{"Text":{"text":{"literalString":"第三块"}}}}')}\n`);
      assert.equal(countTreeNodes(getTree(SURFACE)!.root), 4, 'c 到达后应进树');

      assert.deepEqual(getAllErrors(), {}, '整条流式序列零报错');
    });

    it('should lay out the data model as soon as dataModelUpdate arrives', () => {
      const stream = createJSONLStream();
      for (const line of MIX_LINES) {
        if (keyOf(line) === 'beginRendering') {
          break;
        }
        stream.push(`${line}\n`);
      }

      assert.deepEqual(getDataModel(MIX_SURFACE), {
        revenue: '$128,400',
        orders: '1,284',
        growth: '+18.6%',
      });
    });

    it('should keep processing later lines after an invalid one', () => {
      const stream = createJSONLStream();
      stream.push('{ 这行不是合法 JSON \n');
      stream.push(`${MIX_LINES[0]}\n`);

      const errors = Object.values(getAllErrors());
      assert.equal(errors.length, 1);
      assert.match(errors[0].content, /第 1 行不是合法 JSON/);
      assert.equal(
        Object.keys(getAllHydrateNodes()).length,
        1,
        '后续行仍应被正常处理，不因前面出错而中断',
      );
    });
  });

  describe('重复与重置', () => {
    it('should be idempotent when the same messages are streamed twice', () => {
      const stream = createJSONLStream();

      stream.push(MIX_JSONL);
      stream.end();
      const first = summarize();

      stream.reset();
      stream.push(MIX_JSONL);
      stream.end();

      assert.deepEqual(summarize(), first, '同样 28 条消息再来一遍，终态不应变化');
    });

    it('should reset buffers and counters but leave the store untouched', () => {
      const stream = createJSONLStream();
      stream.push(`${MIX_LINES[0]}\n`);
      stream.push(MIX_LINES[1].slice(0, 10));

      assert.equal(stream.messageCount, 1);
      assert.notEqual(stream.pending, '');

      stream.reset();

      assert.equal(stream.pending, '', '缓冲应清空');
      assert.equal(stream.lineCount, 0);
      assert.equal(stream.messageCount, 0);
      assert.equal(
        Object.keys(getAllHydrateNodes()).length,
        1,
        'reset() 只清流自身的状态，不动 store',
      );
    });
  });

  /**
   * `beginRendering` 的位置对流式渲染是**硬约束**，不是风格问题：
   * `Surface.rootNode` 是必填字段（见 store/types），只有 beginRendering 能确定根是谁，
   * 所以在它到达之前，组件登记得再全也没有 surface、没有树，页面只能空白。
   */
  describe('beginRendering 的位置对流式渲染的影响', () => {
    it('should keep the surface unborn until the last message in protocol order', () => {
      const stream = createJSONLStream();
      const head = columnRowMixMessages.slice(0, -1);

      for (const line of head) {
        stream.push(`${line}\n`);
      }

      assert.equal(Object.keys(getAllHydrateNodes()).length, 26, '26 个组件已全部登记');
      assert.equal(Object.keys(getAllSurfaces()).length, 0, 'surface 尚未诞生');
      assert.equal(getTree(MIX_SURFACE), undefined, '没有 surface 就没有树 —— 预览区只能是空的');

      stream.push(`${columnRowMixMessages[columnRowMixMessages.length - 1]}\n`);

      assert.ok(getSurface(MIX_SURFACE), '最后一条 beginRendering 到达后 surface 才诞生');
      assert.ok(getTree(MIX_SURFACE), '树也随之出现');
    });

    it('should create the surface right after root in stream-friendly order', () => {
      const stream = createJSONLStream();
      const lines = columnRowMixStreamMessages;

      assert.match(lines[1], /"beginRendering"/, '第 2 条应是 beginRendering');

      stream.push(`${lines[0]}\n`);
      assert.equal(Object.keys(getAllSurfaces()).length, 0, '只推了 root 组件，还没有 beginRendering');

      stream.push(`${lines[1]}\n`);
      const tree = getTree(MIX_SURFACE);
      assert.ok(tree, '第 2 条一到就立刻有树，预览区从这里开始就非空');
      assert.equal(tree!.root.componentId, 'root');
      assert.deepEqual(tree!.root.children, [], '子组件还没到，此刻只有根节点');

      // 后续每推一条，树只会变大不会回退 —— 这正是「边到边长大」。
      let previous = countTreeNodes(tree!.root);
      let grew = false;
      for (const line of lines.slice(2)) {
        stream.push(`${line}\n`);
        const current = getTree(MIX_SURFACE);
        const size = current ? countTreeNodes(current.root) : 0;
        assert.ok(size >= previous, `节点数不应回退（${previous} → ${size}）`);
        grew ||= size > previous;
        previous = size;
      }

      assert.ok(grew, '应能观察到树随消息逐步长大');
      assert.equal(previous, 16, '终态节点数与协议顺序相同');
    });

    it('should converge to the identical store in both orders', () => {
      const stream = createJSONLStream();
      stream.push(`${columnRowMixStreamMessages.join('\n')}\n`);
      stream.end();
      const reordered = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(reordered, summarize(), '只是 beginRendering 换了位置，终态必须一致');
    });
  });
});
