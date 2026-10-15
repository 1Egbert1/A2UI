import { strict as assert } from 'assert';

import {
  columnRowMixCompactMessages,
  columnRowMixCompactStreamMessages,
  columnRowMixMessages,
} from '../mock/column-row-mix';
import {
  chunkText,
  createA2UIBuffer,
  extractPartialItems,
  normalizeToJSONL,
  parseA2UI,
  scanJSONValues,
  simulateTextStream,
} from '../src/parser';
import type { A2UIBuffer } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getAllErrors,
  getAllHydrateNodes,
  getAllSurfaces,
  getDataModel,
  getTree,
  resetA2UIStore,
} from '../src/store';
import type { TreeNode } from '../src/treebuilder';

/**
 * JSON 缓冲流的验收基准同样是「与一次性解析（parseA2UI）终态一致」。
 * 数据源仍用 `mock/column-row-mix`（28 条），它的两种形态正好覆盖两件事：
 * - 拆好的逐条形态（`columnRowMixMessages`）验证「任意切片都能正确拼回」；
 * - 紧凑形态（`columnRowMixCompactMessages`，一条 surfaceUpdate 装 26 个组件）
 *   验证「协议补全」——一条多组件消息必须被拆成 26 条独立完整消息。
 */
const MIX_LINES = columnRowMixMessages;
const MIX_JSONL = `${MIX_LINES.join('\n')}\n`;
const MIX_SURFACE = 'column-row-mix';

/** 每个组件的渲染器只回一个标记——本文件只关心「有没有渲染出东西」。 */
const MARKER_RENDER_MAP = {
  Column: () => 'COLUMN',
  Row: () => 'ROW',
  Card: () => 'CARD',
  Divider: () => 'DIVIDER',
  Button: () => 'BUTTON',
  Text: () => 'TEXT',
};

/** 把当前 store 的**实质内容**投影成可 deepEqual 的对象（与 stream.spec 同一套口径）。 */
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
    componentIds: Object.keys(nodes).sort(),
    protocols: Object.fromEntries(
      Object.entries(nodes)
        .map(([id, node]) => [id, node.protocol])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    surfaces: Object.keys(getAllSurfaces()).sort(),
    dataModel: getDataModel(MIX_SURFACE),
    treeShapes: shapes,
    errors: Object.values(getAllErrors())
      .map((error) => error.content)
      .sort(),
  };
};

const firstKey = (line: string): string => Object.keys(JSON.parse(line))[0];

describe('scanJSONValues', () => {
  it('should extract a single complete object', () => {
    assert.deepEqual(scanJSONValues('{"a":1}'), { values: ['{"a":1}'], rest: '' });
  });

  it('should extract several objects that are not separated by anything', () => {
    assert.deepEqual(scanJSONValues('{"a":1}{"b":2}'), {
      values: ['{"a":1}', '{"b":2}'],
      rest: '',
    });
  });

  it('should ignore whitespace and newlines between values', () => {
    assert.deepEqual(scanJSONValues('{"a":1}\n{"b":2}\n'), {
      values: ['{"a":1}', '{"b":2}'],
      rest: '',
    });
  });

  it('should keep an unclosed tail as rest', () => {
    assert.deepEqual(scanJSONValues('{"a":1}{"b":'), {
      values: ['{"a":1}'],
      rest: '{"b":',
    });
  });

  it('should not count braces that live inside a string', () => {
    assert.deepEqual(scanJSONValues('{"a":"}{"}'), { values: ['{"a":"}{"}'], rest: '' });
  });

  it('should honour escaped quotes inside strings', () => {
    const text = '{"a":"x\\"y"}';
    assert.deepEqual(scanJSONValues(text), { values: [text], rest: '' });
  });

  it('should walk nested objects and arrays', () => {
    const text = '{"a":{"b":[1,2,{"c":3}]}}';
    assert.deepEqual(scanJSONValues(text), { values: [text], rest: '' });
  });

  it('should take a top-level array as one value', () => {
    const text = '[{"a":1},{"b":2}]';
    assert.deepEqual(scanJSONValues(text), { values: [text], rest: '' });
  });

  it('should ignore noise before, between and after values', () => {
    assert.deepEqual(scanJSONValues('```json\n{"a":1}\n```'), {
      values: ['{"a":1}'],
      rest: '',
    });
    assert.deepEqual(scanJSONValues('}}"),{"a":1}'), { values: ['{"a":1}'], rest: '' });
  });

  it('should return nothing for empty or bracket-free input', () => {
    assert.deepEqual(scanJSONValues(''), { values: [], rest: '' });
    assert.deepEqual(scanJSONValues('   \n  '), { values: [], rest: '' });
    assert.deepEqual(scanJSONValues('}}'), { values: [], rest: '' });
  });
});

describe('normalizeToJSONL', () => {
  it('should pass a single-message value through as one line', () => {
    const line = '{"beginRendering":{"surfaceId":"s","root":"r"}}';
    assert.deepEqual(normalizeToJSONL(line), [line]);
  });

  it('should split a surfaceUpdate into one message per component', () => {
    const value = JSON.stringify({
      surfaceUpdate: {
        surfaceId: 's',
        components: [
          { id: 'a', component: { Text: { text: { literalString: 'a' } } } },
          { id: 'b', component: { Text: { text: { literalString: 'b' } } } },
          { id: 'c', component: { Divider: {} } },
        ],
      },
    });

    const lines = normalizeToJSONL(value);
    assert.equal(lines.length, 3, '3 个组件应补全成 3 条独立消息');

    assert.deepEqual(
      lines.map((line) => {
        const { surfaceUpdate } = JSON.parse(line) as {
          surfaceUpdate: { surfaceId: string; components: Array<{ id: string }> };
        };
        assert.equal(surfaceUpdate.surfaceId, 's', '每一条都带上原 surfaceId');
        assert.equal(surfaceUpdate.components.length, 1, '每一条恰好一个组件');
        return surfaceUpdate.components[0].id;
      }),
      ['a', 'b', 'c'],
      '拆分必须保持组件顺序',
    );
  });

  it('should keep a one-component surfaceUpdate as a single line', () => {
    const value = JSON.stringify({
      surfaceUpdate: { surfaceId: 's', components: [{ id: 'a', component: { Text: {} } }] },
    });
    assert.deepEqual(normalizeToJSONL(value), [value]);
  });

  it('should expand a top-level array into one line per element', () => {
    const value = JSON.stringify([
      { beginRendering: { surfaceId: 's', root: 'r' } },
      { deleteSurface: { surfaceId: 's' } },
    ]);

    const lines = normalizeToJSONL(value);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(firstKey), ['beginRendering', 'deleteSurface']);
  });

  it('should collapse a pretty-printed value onto a single line', () => {
    const value = JSON.stringify({ beginRendering: { surfaceId: 's', root: 'r' } }, null, 2);
    assert.ok(value.includes('\n'), '前提：这个值确实带换行');

    const [line] = normalizeToJSONL(value);
    assert.ok(!line.includes('\n'), '补全后的 JSONL 必须是一行');
  });

  it('should hand invalid JSON back unchanged so the parser can report it', () => {
    assert.deepEqual(normalizeToJSONL('{oops'), ['{oops']);
  });
});

describe('createA2UIBuffer', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap(MARKER_RENDER_MAP);
  });

  describe('与一次性解析等价', () => {
    it('should produce the same store when the whole text arrives at once', () => {
      const buffer = createA2UIBuffer();
      const sent = buffer.push(MIX_JSONL);

      assert.equal(sent, MIX_LINES.length, '一次喂入应补全出 28 条消息');
      assert.equal(buffer.valueCount, MIX_LINES.length, '28 个 JSON 值');
      assert.equal(buffer.pending, '');

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize(), '缓冲流与一次性解析的终态必须完全一致');
    });

    it('should be insensitive to fixed 50-char slices', () => {
      const buffer = createA2UIBuffer();
      for (const chunk of chunkText(MIX_JSONL, 50)) {
        buffer.push(chunk);
      }

      assert.equal(buffer.pending, '', '结尾是换行，不该有残留');

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize(), '50 字符一片（必然切在 JSON 中间）也要收敛到同一结果');
    });

    it('should be insensitive to 1-char-at-a-time feeding', () => {
      const buffer = createA2UIBuffer();
      for (const char of MIX_JSONL) {
        buffer.push(char);
      }

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize());
    });
  });

  describe('缓冲与半截消息', () => {
    it('should hold an unclosed value in pending and leave the store untouched', () => {
      const buffer = createA2UIBuffer();
      const half = MIX_LINES[0].slice(0, Math.floor(MIX_LINES[0].length / 2));

      const sent = buffer.push(half);

      assert.equal(sent, 0, '没有闭合 → 不产出消息');
      assert.equal(buffer.pending, half, '未闭合的内容应留在缓冲里');
      assert.equal(buffer.valueCount, 0);
      assert.deepEqual(getAllHydrateNodes(), {}, '未闭合不得写进 store');
      assert.deepEqual(getAllErrors(), {}, '半条消息不是错误');

      const completed = buffer.push(`${MIX_LINES[0].slice(half.length)}\n`);

      assert.equal(completed, 1, '补齐闭合括号后应产出 1 条消息');
      assert.equal(buffer.pending, '');
      assert.equal(Object.keys(getAllHydrateNodes()).length, 1);
    });

    it('should ignore noise between values without reporting an error', () => {
      const buffer = createA2UIBuffer();
      buffer.push(`sure! here it is: ${MIX_LINES[0]}\n`);

      assert.equal(Object.keys(getAllHydrateNodes()).length, 1);
      assert.deepEqual(getAllErrors(), {}, '噪声只是被跳过，不是解析错误');
    });

    it('should handle values that are pretty-printed across many lines', () => {
      const buffer = createA2UIBuffer();
      const pretty = JSON.stringify(
        { surfaceUpdate: { surfaceId: MIX_SURFACE, components: [{ id: 'solo', component: { Text: {} } }] } },
        null,
        2,
      );

      const sent = buffer.push(`${pretty}\n`);

      assert.equal(sent, 1);
      assert.equal(Object.keys(getAllHydrateNodes()).length, 1);
      assert.deepEqual(getAllErrors(), {});
    });
  });

  describe('协议补全：surfaceUpdate 按 component 拆开', () => {
    it('should split one multi-component surfaceUpdate into N complete messages', () => {
      const buffer = createA2UIBuffer();
      const value = JSON.stringify({
        surfaceUpdate: {
          surfaceId: 'split',
          components: [
            { id: 'p', component: { Column: { children: { explicitList: ['x', 'y'] } } } },
            { id: 'x', component: { Text: { text: { literalString: 'x' } } } },
            { id: 'y', component: { Text: { text: { literalString: 'y' } } } },
          ],
        },
      });

      const sent = buffer.push(value);

      assert.equal(buffer.valueCount, 1, '原始只有 1 个 JSON 值');
      assert.equal(sent, 3, '补全后应产出 3 条消息');
      assert.equal(buffer.messageCount, 3);
      assert.equal(buffer.emitted.length, 3);
      assert.deepEqual(
        buffer.emitted.map((line) => {
          const { surfaceUpdate } = JSON.parse(line) as {
            surfaceUpdate: { surfaceId: string; components: Array<{ id: string }> };
          };
          return [surfaceUpdate.surfaceId, surfaceUpdate.components.length];
        }),
        [
          ['split', 1],
          ['split', 1],
          ['split', 1],
        ],
        '每条都是完整可解析的 surfaceUpdate，且只含一个组件',
      );

      assert.deepEqual(Object.keys(getAllHydrateNodes()).sort(), ['p', 'x', 'y']);
    });

    it('should converge a compact surfaceUpdate to the same store as the split form', () => {
      // 紧凑形态：26 条组件消息被压成 1 条 surfaceUpdate。
      const buffer = createA2UIBuffer();
      buffer.push(`${columnRowMixCompactMessages.join('\n')}\n`);

      assert.equal(buffer.valueCount, 3, '1 条 surfaceUpdate + beginRendering + dataModelUpdate');
      assert.equal(buffer.messageCount, 28, '26 个组件补全成 26 条 + 其余 2 条');
      assert.equal(buffer.emitted.filter((line) => firstKey(line) === 'surfaceUpdate').length, 26);

      const compacted = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(compacted, summarize(), '紧凑进、补全出，终态必须与逐条形态一致');
    });

    it('should stream a compact surfaceUpdate chunk by chunk to the same end state', () => {
      const text = `${columnRowMixCompactStreamMessages.join('\n')}\n`;
      const buffer = createA2UIBuffer();

      for (const chunk of chunkText(text, 50)) {
        buffer.push(chunk);
      }

      const streamed = summarize();

      resetA2UIStore();
      parseA2UI(MIX_JSONL);

      assert.deepEqual(streamed, summarize(), '50 字符的字符流喂紧凑数据，终态仍需一致');
    });
  });

  describe('计数与重置', () => {
    it('should count values and messages separately', () => {
      const buffer = createA2UIBuffer();
      buffer.push(`${columnRowMixCompactMessages.join('\n')}\n`);

      assert.equal(buffer.valueCount, 3);
      assert.equal(buffer.messageCount, 28);
      assert.notEqual(buffer.valueCount, buffer.messageCount, '拆分后两者不应相等');
    });

    it('should reset buffers and counters but leave the store untouched', () => {
      const buffer = createA2UIBuffer();
      buffer.push(`${MIX_LINES[0]}\n`);
      buffer.push(MIX_LINES[1].slice(0, 10));

      assert.equal(buffer.messageCount, 1);
      assert.notEqual(buffer.pending, '');

      buffer.reset();

      assert.equal(buffer.pending, '', '缓冲应清空');
      assert.equal(buffer.valueCount, 0);
      assert.equal(buffer.messageCount, 0);
      assert.equal(buffer.emitted.length, 0);
      assert.equal(
        Object.keys(getAllHydrateNodes()).length,
        1,
        'reset() 只清流自身的状态，不动 store',
      );
    });
  });
});

/**
 * 手工造一条「装 3 个组件」的批量 surfaceUpdate，并切出「前两个组件已闭合、第三个还没吐完」的半截。
 * 增量提取（子项粒度）要的正是这种输入。
 */
const BATCH = JSON.stringify({
  surfaceUpdate: {
    surfaceId: 'inc',
    components: [
      { id: 'a', component: { Text: { text: { literalString: 'a' } } } },
      { id: 'b', component: { Text: { text: { literalString: 'b' } } } },
      { id: 'c', component: { Text: { text: { literalString: 'c' } } } },
    ],
  },
});
const BATCH_HEAD = BATCH.slice(0, BATCH.indexOf('{"id":"c"'));

/** 取一条补全消息里的组件 id（此刻它必然只含一个组件）。 */
const componentIdOf = (line: string): string => {
  const { surfaceUpdate } = JSON.parse(line) as {
    surfaceUpdate: { components: Array<{ id: string }> };
  };
  return surfaceUpdate.components[0].id;
};

describe('extractPartialItems', () => {
  it('should pull out the components that already closed before the value does', () => {
    const { total, messages } = extractPartialItems(BATCH_HEAD);

    assert.equal(total, 2, '半截里有两个组件已经闭合');
    assert.deepEqual(messages.map(componentIdOf), ['a', 'b'], '顺序必须与原文一致');
  });

  it('should complete each pulled component into a full parseable surfaceUpdate', () => {
    for (const line of extractPartialItems(BATCH_HEAD).messages) {
      const { surfaceUpdate } = JSON.parse(line) as {
        surfaceUpdate: { surfaceId: string; components: unknown[] };
      };
      assert.equal(surfaceUpdate.surfaceId, 'inc', '补齐的信封必须带上 surfaceId');
      assert.equal(surfaceUpdate.components.length, 1, '每条恰好一个组件');
    }
  });

  it('should produce byte-for-byte the same lines as the whole-value path', () => {
    // 「增量 = 整值拆分的前缀」是硬保证：改写补全逻辑时先跑它。
    assert.deepEqual(
      extractPartialItems(BATCH_HEAD).messages,
      normalizeToJSONL(BATCH).slice(0, 2),
    );
  });

  it('should only return items past the skip cursor', () => {
    const { total, messages } = extractPartialItems(BATCH_HEAD, 1);

    assert.equal(total, 2, 'total 是「扫到的总数」，与 skip 无关');
    assert.deepEqual(messages.map(componentIdOf), ['b']);
  });

  it('should wait while the fields before the array are still streaming', () => {
    assert.deepEqual(extractPartialItems('{"surfaceUpdate":{"surfaceId":"col'), {
      total: 0,
      messages: [],
    });
  });

  it('should refuse an envelope whose split array comes first', () => {
    // 数组后面可能还跟着必填字段（如 surfaceId）——补出来会缺字段，交给整值粒度处理。
    assert.deepEqual(extractPartialItems('{"surfaceUpdate":{"components":[{"id":"a"}'), {
      total: 0,
      messages: [],
    });
  });

  it('should ignore messages that are not batch messages', () => {
    assert.deepEqual(extractPartialItems('{"beginRendering":{"surfaceId":"s","root":"r"'), {
      total: 0,
      messages: [],
    });
  });

  it('should ignore a top-level array value', () => {
    assert.deepEqual(extractPartialItems('[{"surfaceUpdate":{"surfaceId":"s","components":['), {
      total: 0,
      messages: [],
    });
  });

  it('should stop at the element that is still incomplete', () => {
    const { total, messages } = extractPartialItems(
      `${BATCH_HEAD}{"id":"c","component":{"Text":`,
    );

    assert.equal(total, 2, '第三个组件只吐了一半，不能算');
    assert.deepEqual(messages.map(componentIdOf), ['a', 'b']);
  });

  it('should honour braces that live inside a string', () => {
    const value = JSON.stringify({
      surfaceUpdate: {
        surfaceId: 'inc',
        components: [
          { id: 'x', component: { Text: { text: { literalString: '}{' } } } },
          { id: 'y', component: { Text: {} } },
        ],
      },
    });
    const head = value.slice(0, value.indexOf('{"id":"y"'));

    assert.deepEqual(extractPartialItems(head).messages.map(componentIdOf), ['x']);
  });
});

describe('createA2UIBuffer 增量提取（子项粒度）', () => {
  beforeEach(() => {
    resetA2UIStore();
    setRenderMap(MARKER_RENDER_MAP);
  });

  it('should emit the closed components even though the value is still open', () => {
    const buffer = createA2UIBuffer();
    const sent = buffer.push(BATCH_HEAD);

    assert.equal(sent, 2, '整值没闭合，但两个组件已闭合 → 先吐两条');
    assert.equal(buffer.valueCount, 0, '整值未闭合，不计入 valueCount');
    assert.equal(buffer.pending, BATCH_HEAD, '已吐的子项仍留在缓冲里（整值还没结算）');
    assert.deepEqual(Object.keys(getAllHydrateNodes()).sort(), ['a', 'b'], 'store 里已有这两个组件');
    assert.deepEqual(getAllErrors(), {}, '半条消息不是错误');
  });

  it('should not re-emit drained components when the value finally closes', () => {
    const buffer = createA2UIBuffer();
    buffer.push(BATCH_HEAD);

    const sent = buffer.push(BATCH.slice(BATCH_HEAD.length));

    assert.equal(sent, 1, '闭环时只补吐剩下的那一条');
    assert.equal(buffer.valueCount, 1, '整值闭合后才计入 valueCount');
    assert.equal(buffer.messageCount, 3);
    assert.equal(new Set(buffer.emitted).size, 3, '每条消息只吐一次');
    assert.deepEqual(Object.keys(getAllHydrateNodes()).sort(), ['a', 'b', 'c']);
  });

  it('should converge to the same store as a whole-value push, whatever the slicing', () => {
    const run = (feed: (buffer: A2UIBuffer) => void) => {
      resetA2UIStore();
      setRenderMap(MARKER_RENDER_MAP);
      const buffer = createA2UIBuffer();
      feed(buffer);

      return {
        ids: Object.keys(getAllHydrateNodes()).sort(),
        protocols: Object.fromEntries(
          Object.entries(getAllHydrateNodes())
            .map(([id, node]) => [id, node.protocol])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
        errors: Object.values(getAllErrors()).map((error) => error.content),
      };
    };

    const text = `${BATCH}\n`;
    const whole = run((buffer) => void buffer.push(text));
    const byChar = run((buffer) => {
      for (const char of text) buffer.push(char);
    });
    const bySeven = run((buffer) => {
      for (const chunk of chunkText(text, 7)) buffer.push(chunk);
    });

    assert.deepEqual(byChar, whole, '逐字符喂入必须与整段喂入同终态');
    assert.deepEqual(bySeven, whole, '7 字符一片也必须与整段喂入同终态');
  });

  it('should keep the batch value in pending until it closes', () => {
    const buffer = createA2UIBuffer();
    buffer.push(BATCH_HEAD);

    assert.equal(buffer.pending, BATCH_HEAD, '整值未闭合 → 仍留在缓冲里');
    assert.notEqual(buffer.messageCount, 0, '但子项已经吐出去了');
  });
});

describe('chunkText', () => {
  it('should split into fixed-size pieces with a short tail', () => {
    assert.deepEqual(chunkText('abcdefg', 3), ['abc', 'def', 'g']);
  });

  it('should return a single piece when size covers the whole text', () => {
    assert.deepEqual(chunkText('abc', 3), ['abc']);
    assert.deepEqual(chunkText('abc', 10), ['abc']);
  });

  it('should return nothing for empty text', () => {
    assert.deepEqual(chunkText('', 5), []);
  });

  it('should split every character when size is 1', () => {
    assert.deepEqual(chunkText('abc', 1), ['a', 'b', 'c']);
  });

  it('should reject a non-positive size', () => {
    assert.throws(() => chunkText('abc', 0), RangeError);
    assert.throws(() => chunkText('abc', -1), RangeError);
    assert.throws(() => chunkText('abc', 1.5), RangeError);
  });
});

describe('simulateTextStream', () => {
  it('should emit the first chunk synchronously', () => {
    const seen: string[] = [];
    const stop = simulateTextStream('abcdef', {
      chunkSize: 4,
      intervalMs: 5,
      onChunk: (chunk) => seen.push(chunk),
    });

    assert.deepEqual(seen, ['abcd'], '第一片同步立即吐出，避免开头静默一拍');

    stop();
    assert.deepEqual(seen, ['abcd'], 'stop() 之后不再吐片');
  });

  it('should finish synchronously when the text fits in one chunk', () => {
    let ended = false;
    simulateTextStream('ab', {
      chunkSize: 50,
      onChunk: () => {},
      onEnd: () => {
        ended = true;
      },
    });

    assert.equal(ended, true);
  });

  it('should call onEnd immediately for empty text without emitting', () => {
    let ended = false;
    simulateTextStream('', {
      onChunk: () => assert.fail('空文本不应吐片'),
      onEnd: () => {
        ended = true;
      },
    });

    assert.equal(ended, true);
  });

  it('should emit every chunk and then call onEnd', async () => {
    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      simulateTextStream('abcdefgh', {
        chunkSize: 3,
        intervalMs: 1,
        onChunk: (chunk) => seen.push(chunk),
        onEnd: () => resolve(),
      });
    });

    assert.deepEqual(seen, ['abc', 'def', 'gh']);
  });
});
