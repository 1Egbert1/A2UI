import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  ErrorType,
  getAllDataModels,
  getAllErrors,
  getAllHydrateNodes,
  getDataModel,
  getHydrateNode,
  getSurface,
  resetA2UIStore,
} from '../src/store';

/**
 * A2UI 的线协议是 JSONL：每一行是一个独立的 JSON 对象，即一条消息。
 * 这个 helper 把若干消息对象拼成 JSONL 文本，避免手写容易出错的字符串。
 */
const jsonl = (...messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

/** 生成一个只含单个 Text 组件的 surfaceUpdate 消息。 */
const surfaceUpdate = (surfaceId: string, components: Array<{ id: string; text: string }>) => ({
  surfaceUpdate: {
    surfaceId,
    components: components.map(({ id, text }) => ({
      id,
      component: { Text: { text: { literalString: text } } },
    })),
  },
});

/** 组件定义原样给出的 surfaceUpdate，用于非 Text 或刻意畸形的组件。 */
const rawSurfaceUpdate = (surfaceId: string, components: Array<{ id: string; component: unknown }>) => ({
  surfaceUpdate: { surfaceId, components },
});

/** 取出 Text 组件属性里的 literalString，供渲染器断言入参。 */
const literalOf = (props: Record<string, unknown>): string =>
  (props.text as { literalString?: string } | undefined)?.literalString ?? '';

const mockFilePath = fileURLToPath(new URL('../mock/simple-text.jsonl', import.meta.url));
const simpleTextJsonl = readFileSync(mockFilePath, 'utf8');

const MOCK_SURFACE_ID = 'simple-text';
const MOCK_ROOT_ID = 'root';

describe('A2UI Parser', () => {
  beforeEach(() => {
    resetA2UIStore();
    // renderMap 是模块级配置，不随 store 重置，需手动清空避免用例互相污染。
    setRenderMap({});
  });

  describe('JSONL 分帧', () => {
    it('should treat each line as an independent message', () => {
      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      assert.ok(getHydrateNode('root'), '第 1 行的组件应被缓冲');
      assert.ok(getSurface('s'), '第 2 行的 beginRendering 应创建 surface');
    });

    it('should ignore blank lines and a trailing newline', () => {
      setRenderMap({ Text: () => null });
      const payload = `\n${jsonl(surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]))}\n\n`;

      parseA2UI(payload);

      assert.ok(getHydrateNode('root'), '空行不应影响解析');
      assert.deepEqual(getAllErrors(), {}, '空行不应产生错误');
    });
  });

  describe('surfaceUpdate', () => {
    it('should create one hydrate node per component, keyed by component id', () => {
      parseA2UI(
        jsonl(
          surfaceUpdate('s', [
            { id: 'root', text: 'Root' },
            { id: 'child', text: 'Child' },
          ]),
        ),
      );

      assert.deepEqual(Object.keys(getAllHydrateNodes()).sort(), ['child', 'root']);

      const node = getHydrateNode('root');
      assert.ok(node, '应创建 root 组件对应的 hydrate node');
      assert.equal(node!.componentId, 'root');
      assert.equal(node!.ownerSurfaceId, 's');
    });

    it('should keep the raw component protocol as a JSON string', () => {
      parseA2UI(jsonl(surfaceUpdate('s', [{ id: 'root', text: 'Hello, A2UI!' }])));

      const node = getHydrateNode('root');
      assert.equal(typeof node!.protocol, 'string');
      assert.doesNotThrow(() => JSON.parse(node!.protocol), 'protocol 应是合法 JSON 字符串');
      assert.match(node!.protocol, /Hello, A2UI!/, 'protocol 应保留原始组件定义');
    });
  });

  describe('渲染（hydrate 阶段）', () => {
    it('should call the renderer once per component and store its output in _vnode', () => {
      const rendered: string[] = [];
      setRenderMap({
        Text: (props) => {
          rendered.push(literalOf(props));
          return { kind: 'text', value: literalOf(props) };
        },
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ]),
        ),
      );

      assert.deepEqual(rendered, ['A', 'B'], '每个组件都应按顺序调用一次渲染器');
      assert.deepEqual(getHydrateNode('a')!._vnode, { kind: 'text', value: 'A' });
      assert.deepEqual(getHydrateNode('b')!._vnode, { kind: 'text', value: 'B' });
    });

    it('should pass the unwrapped component props to the renderer', () => {
      let received: Record<string, unknown> | undefined;
      setRenderMap({
        Text: (props) => {
          received = props;
          return null;
        },
      });

      parseA2UI(jsonl(surfaceUpdate('s', [{ id: 'root', text: 'Hi' }])));

      assert.deepEqual(
        received,
        { text: { literalString: 'Hi' } },
        '渲染器应拿到包装对象内层的属性，而不是整个包装对象',
      );
      assert.equal('Text' in (received ?? {}), false, '组件类型名不应混进属性');
    });

    it('should route each component type to its own renderer', () => {
      setRenderMap({
        Text: (props) => `text:${literalOf(props)}`,
        Button: (props) => `button:${String(props.label)}`,
      });

      parseA2UI(
        jsonl(
          rawSurfaceUpdate('s', [
            { id: 't', component: { Text: { text: { literalString: 'Hello' } } } },
            { id: 'b', component: { Button: { label: 'Submit' } } },
          ]),
        ),
      );

      assert.equal(getHydrateNode('t')!._vnode, 'text:Hello', 'Text 应命中 Text 渲染器');
      assert.equal(getHydrateNode('b')!._vnode, 'button:Submit', 'Button 应命中 Button 渲染器');
    });

    it('should render once per component, at hydrate time rather than per message', () => {
      let calls = 0;
      setRenderMap({
        Text: () => {
          calls += 1;
          return 'vnode';
        },
      });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      assert.equal(calls, 1, '渲染发生在整段 JSONL 解析完后的 hydrate 阶段，beginRendering 不触发渲染');
    });

    it('should expose the rendered node through surface.rootNode', () => {
      setRenderMap({ Text: (props) => ({ rendered: literalOf(props) }) });

      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      const surface = getSurface('s');
      assert.deepEqual(surface!.rootNode._vnode, { rendered: 'Hi' }, '渲染结果应随 rootNode 可访问');
      assert.equal(
        surface!.rootNode._vnode,
        getHydrateNode('root')!._vnode,
        'rootNode 与 hydrateNodeMap 中应是同一个节点对象',
      );
    });

    it('should re-render when a later surfaceUpdate replaces the same component', () => {
      setRenderMap({ Text: (props) => `v1:${literalOf(props)}` });
      parseA2UI(jsonl(surfaceUpdate('s', [{ id: 'root', text: 'First' }])));
      assert.equal(getHydrateNode('root')!._vnode, 'v1:First');

      setRenderMap({ Text: (props) => `v2:${literalOf(props)}` });
      parseA2UI(jsonl(surfaceUpdate('s', [{ id: 'root', text: 'Second' }])));

      assert.equal(
        getHydrateNode('root')!._vnode,
        'v2:Second',
        '同一 componentId 应被最新一次渲染结果覆盖，而不是保留旧节点',
      );
    });

    it('should record a RENDERER_NOT_FOUND error when the component type is not registered', () => {
      setRenderMap({ Text: () => 'vnode' });

      parseA2UI(jsonl(rawSurfaceUpdate('s', [{ id: 'img', component: { Image: { url: 'x' } } }])));

      assert.equal(getHydrateNode('img')!._vnode, null, '未注册的类型仍登记节点，但 _vnode 为空');

      const errors = Object.values(getAllErrors());
      assert.equal(errors.length, 1, '未注册渲染器应记且仅记一条错误');
      assert.equal(errors[0].type, ErrorType.RENDERER_NOT_FOUND);
      assert.match(errors[0].content, /Image/, '错误描述应点明缺失的组件类型');
      assert.match(errors[0].content, /"img"/, '错误描述应点明是哪个组件');
      assert.match(errors[0].content, /"s"/, '错误描述应点明属于哪个 surface');
    });

    it('should key renderer errors by their own id prefix', () => {
      parseA2UI(jsonl(rawSurfaceUpdate('s', [{ id: 'img', component: { Image: { url: 'x' } } }])));

      const [errorId] = Object.keys(getAllErrors());
      assert.match(errorId, /^renderer-error-/, '渲染层错误应与解析错误分开编号');
    });

    it('should record one error per unregistered component', () => {
      parseA2UI(
        jsonl(
          rawSurfaceUpdate('s', [
            { id: 'a', component: { Image: { url: 'x' } } },
            { id: 'b', component: { Video: { url: 'y' } } },
          ]),
        ),
      );

      const contents = Object.values(getAllErrors()).map((error) => error.content);
      assert.equal(contents.length, 2, '每个未注册的组件各记一条');
      assert.ok(contents.some((content) => content.includes('Image')));
      assert.ok(contents.some((content) => content.includes('Video')));
    });

    it('should record a PARSE_ERROR when a renderer throws, without dropping the node', () => {
      setRenderMap({
        Button: () => 'ok',
        Text: () => {
          throw new Error('boom');
        },
      });

      parseA2UI(
        jsonl(
          rawSurfaceUpdate('s', [
            { id: 'ok', component: { Button: { label: 'Submit' } } },
            { id: 'boom', component: { Text: { text: { literalString: 'Hi' } } } },
          ]),
        ),
      );

      assert.ok(
        Object.values(getAllErrors()).some(
          (error) => error.type === ErrorType.PARSE_ERROR && /boom/.test(error.content),
        ),
        '渲染器抛错应记为 PARSE_ERROR',
      );
      assert.equal(getHydrateNode('ok')!._vnode, 'ok', '抛错的组件不影响其它组件');
      assert.ok(getHydrateNode('boom'), '抛错的组件仍然登记，不会从 store 里消失');
      assert.equal(getHydrateNode('boom')!._vnode, null, '渲染失败时 _vnode 留空');
    });

    it('should record a PARSE_ERROR for a malformed component definition', () => {
      setRenderMap({ Text: (props) => ({ rendered: props }) });

      parseA2UI(jsonl(rawSurfaceUpdate('s', [{ id: 'empty', component: {} }])));

      assert.equal(getHydrateNode('empty')!._vnode, null, '拆不出类型时 _vnode 为空');
      assert.ok(
        Object.values(getAllErrors()).some(
          (error) => error.type === ErrorType.PARSE_ERROR && /empty/.test(error.content),
        ),
        '畸形组件定义应被显式记为 PARSE_ERROR，而不是静默丢弃',
      );
    });

    it('should call the renderer with empty props when the component payload is not an object', () => {
      setRenderMap({ Text: (props) => props });

      parseA2UI(jsonl(rawSurfaceUpdate('s', [{ id: 'bad', component: { Text: 'not-an-object' } }])));

      assert.deepEqual(getHydrateNode('bad')!._vnode, {}, '属性非对象时回退为空对象再交给渲染器');
    });
  });

  describe('beginRendering', () => {
    it('should mark the surface renderable and set its root node', () => {
      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          { beginRendering: { surfaceId: 's', root: 'root' } },
        ),
      );

      const surface = getSurface('s');
      assert.ok(surface, '应创建 surface');
      assert.equal(surface!.beginRender, true, 'beginRendering 后 beginRender 应为 true');
      assert.equal(surface!.rootNode.componentId, 'root');
      assert.deepEqual(surface!.rootNode, getHydrateNode('root'), 'rootNode 应指向对应 hydrate node');
    });

    it('should record a PARSE_ERROR when root references an unknown component', () => {
      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          { beginRendering: { surfaceId: 's', root: 'missing' } },
        ),
      );

      assert.ok(
        Object.values(getAllErrors()).some((error) => error.type === ErrorType.PARSE_ERROR),
        'root 指向不存在的组件应记录 PARSE_ERROR',
      );
    });
  });

  describe('dataModelUpdate', () => {
    it('should merge the resolved contents into the surface data model', () => {
      parseA2UI(
        jsonl({
          dataModelUpdate: {
            surfaceId: 's',
            contents: [
              { key: 'name', valueString: 'Bob' },
              { key: 'age', valueNumber: 30 },
              { key: 'isVerified', valueBoolean: true },
            ],
          },
        }),
      );

      assert.deepEqual(getDataModel('s'), { name: 'Bob', age: 30, isVerified: true });
    });

    it('should resolve valueMap entries into a nested object', () => {
      parseA2UI(
        jsonl({
          dataModelUpdate: {
            surfaceId: 's',
            contents: [
              {
                key: 'user',
                valueMap: [
                  { key: 'name', valueString: 'Bob' },
                  { key: 'city', valueString: 'Anytown' },
                ],
              },
            ],
          },
        }),
      );

      assert.deepEqual(getDataModel('s'), { user: { name: 'Bob', city: 'Anytown' } });
    });

    it('should apply contents under the given path', () => {
      parseA2UI(
        jsonl({
          dataModelUpdate: {
            surfaceId: 's',
            path: 'user',
            contents: [{ key: 'name', valueString: 'Bob' }],
          },
        }),
      );

      assert.deepEqual(getDataModel('s'), { user: { name: 'Bob' } });
    });
  });

  describe('deleteSurface', () => {
    it('should remove the surface, its hydrate nodes and its data model', () => {
      parseA2UI(
        jsonl(
          surfaceUpdate('s', [{ id: 'root', text: 'Hi' }]),
          {
            dataModelUpdate: {
              surfaceId: 's',
              contents: [{ key: 'name', valueString: 'Bob' }],
            },
          },
          { beginRendering: { surfaceId: 's', root: 'root' } },
          { deleteSurface: { surfaceId: 's' } },
        ),
      );

      assert.equal(getSurface('s'), undefined, 'surface 应被删除');
      assert.equal(getHydrateNode('root'), undefined, 'surface 下的 hydrate node 应被删除');
      assert.equal(getDataModel('s'), undefined, 'surface 的数据模型应被删除');
    });
  });

  describe('mock/simple-text.jsonl（端到端）', () => {
    // mock 里的组件是 Text；注册它代表「渲染引擎已就绪」，缺渲染器的情况由下面的用例单独覆盖。
    beforeEach(() => {
      setRenderMap({ Text: () => null });
    });

    it('should create exactly one surface keyed by surfaceId', () => {
      parseA2UI(simpleTextJsonl);

      const surface = getSurface(MOCK_SURFACE_ID);
      assert.ok(surface, '应创建 mock 对应的 surface');
      assert.equal(surface!.surfaceId, MOCK_SURFACE_ID);
      assert.equal(surface!.beginRender, true);
    });

    it('should create one hydrate node for the single component', () => {
      parseA2UI(simpleTextJsonl);

      assert.deepEqual(Object.keys(getAllHydrateNodes()), [MOCK_ROOT_ID]);

      const node = getHydrateNode(MOCK_ROOT_ID);
      assert.equal(node!.componentId, MOCK_ROOT_ID);
      assert.equal(node!.ownerSurfaceId, MOCK_SURFACE_ID);
      assert.match(node!.protocol, /Hello, A2UI!/);
    });

    it('should link surface.rootNode to the root hydrate node', () => {
      parseA2UI(simpleTextJsonl);

      const surface = getSurface(MOCK_SURFACE_ID);
      assert.equal(surface!.rootNode.componentId, MOCK_ROOT_ID);
      assert.deepEqual(surface!.rootNode, getHydrateNode(MOCK_ROOT_ID));
    });

    it('should produce no errors and no data model for the valid mock', () => {
      parseA2UI(simpleTextJsonl);

      assert.deepEqual(getAllErrors(), {}, '合法 mock 不应产生错误');
      assert.deepEqual(getAllDataModels(), {}, 'mock 未包含 dataModelUpdate，数据模型应为空');
    });

    it('should report the missing renderer when the mock is parsed without one', () => {
      setRenderMap({});

      parseA2UI(simpleTextJsonl);

      const errors = Object.values(getAllErrors());
      assert.equal(errors.length, 1);
      assert.equal(errors[0].type, ErrorType.RENDERER_NOT_FOUND);
      assert.match(errors[0].content, /Text/, '错误应指出 mock 里的 Text 没有渲染器');
      assert.equal(getHydrateNode(MOCK_ROOT_ID)!._vnode, null, '组件仍登记，只是渲染不出来');
    });
  });

  describe('错误处理', () => {
    it('should record a PARSE_ERROR when a line is not valid JSON', () => {
      parseA2UI('this is definitely not json');

      assert.ok(
        Object.values(getAllErrors()).some((error) => error.type === ErrorType.PARSE_ERROR),
        '非法 JSON 行应记录 PARSE_ERROR',
      );
    });
  });
});
