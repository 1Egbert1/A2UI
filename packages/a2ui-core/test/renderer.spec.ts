import { strict as assert } from 'assert';

import { parseA2UI } from '../src/parser';
import { getRenderMap, resolveRenderer, setRenderMap, splitComponent } from '../src/renderer';
import { clearStore, ErrorType, getAllErrors, getHydrateNode, init, resetA2UIStore } from '../src/store';

const jsonl = (...messages: unknown[]): string => messages.map((m) => JSON.stringify(m)).join('\n');

/** 只含单个组件的 surfaceUpdate，组件定义由调用方给出。 */
const surfaceUpdate = (surfaceId: string, id: string, component: Record<string, unknown>) => ({
  surfaceUpdate: { surfaceId, components: [{ id, component }] },
});

const TEXT_COMPONENT = { Text: { text: { literalString: 'Hello, A2UI!' } } };

describe('A2UI Renderer', () => {
  beforeEach(() => {
    // renderMap 是模块级配置，不随 store 重置，需手动清空避免用例互相污染。
    resetA2UIStore();
    setRenderMap({});
  });

  describe('splitComponent', () => {
    it('should split the single-key wrapper into type and props', () => {
      const payload = splitComponent({ Text: { text: { literalString: 'Hi' } } });

      assert.equal(payload.type, 'Text');
      assert.deepEqual(payload.props, { text: { literalString: 'Hi' } });
    });

    it('should take the first key when the wrapper carries more than one', () => {
      const payload = splitComponent({ Text: { text: {} }, Button: { label: {} } });

      assert.equal(payload.type, 'Text');
      assert.deepEqual(payload.props, { text: {} });
    });

    it('should fall back to an empty payload for malformed input', () => {
      assert.deepEqual(splitComponent(null), { type: '', props: {} });
      assert.deepEqual(splitComponent('Text'), { type: '', props: {} });
      assert.deepEqual(splitComponent({}), { type: '', props: {} });
    });

    it('should fall back to empty props when the value is not an object', () => {
      const payload = splitComponent({ Text: 'not-an-object' });

      assert.equal(payload.type, 'Text');
      assert.deepEqual(payload.props, {});
    });
  });

  describe('renderMap 注册表', () => {
    it('should resolve a registered renderer', () => {
      const renderer = () => 'rendered';
      setRenderMap({ Text: renderer });

      assert.equal(resolveRenderer('Text'), renderer);
      assert.equal(resolveRenderer('Missing'), undefined);
    });

    it('should expose the injected map as-is', () => {
      const map = { Text: () => 'x' };
      setRenderMap(map);

      assert.equal(getRenderMap(), map);
    });

    it('should accept the renderMap through init', () => {
      const map = { Text: () => 'from-init' };
      init(map);

      assert.equal(getRenderMap(), map);
    });
  });

  describe('hydrate 时渲染', () => {
    it('should store the renderer output into _vnode', () => {
      setRenderMap({ Text: (props) => ({ kind: 'vnode', props }) });

      parseA2UI(jsonl(surfaceUpdate('s', 'root', TEXT_COMPONENT)));

      assert.deepEqual(getHydrateNode('root')!._vnode, {
        kind: 'vnode',
        props: { text: { literalString: 'Hello, A2UI!' } },
      });
    });

    it('should pass the component props to the renderer', () => {
      let received: Record<string, unknown> | undefined;
      setRenderMap({
        Text: (props) => {
          received = props;
          return null;
        },
      });

      parseA2UI(jsonl(surfaceUpdate('s', 'root', TEXT_COMPONENT)));

      assert.deepEqual(received, { text: { literalString: 'Hello, A2UI!' } });
    });

    it('should render every component of the message', () => {
      setRenderMap({ Text: (props) => `rendered:${JSON.stringify(props)}` });

      parseA2UI(
        jsonl({
          surfaceUpdate: {
            surfaceId: 's',
            components: [
              { id: 'a', component: { Text: { text: { literalString: 'A' } } } },
              { id: 'b', component: { Text: { text: { literalString: 'B' } } } },
            ],
          },
        }),
      );

      assert.match(String(getHydrateNode('a')!._vnode), /"A"/);
      assert.match(String(getHydrateNode('b')!._vnode), /"B"/);
    });

    it('should leave _vnode null when the component type has no renderer', () => {
      parseA2UI(jsonl(surfaceUpdate('s', 'root', TEXT_COMPONENT)));

      assert.equal(getHydrateNode('root')!._vnode, null);
    });

    it('should record a RENDERER_NOT_FOUND error when a renderer is missing', () => {
      parseA2UI(jsonl(surfaceUpdate('s', 'root', TEXT_COMPONENT)));

      const errors = Object.values(getAllErrors());
      assert.equal(errors.length, 1, '缺渲染器应记一条错误');
      assert.equal(errors[0].type, ErrorType.RENDERER_NOT_FOUND);
      assert.match(errors[0].content, /Text/);
    });

    it('should still keep the raw protocol alongside the rendered node', () => {
      setRenderMap({ Text: () => 'vnode' });

      parseA2UI(jsonl(surfaceUpdate('s', 'root', TEXT_COMPONENT)));

      assert.match(getHydrateNode('root')!.protocol, /Hello, A2UI!/);
    });
  });

  describe('renderMap 是配置而非状态', () => {
    it('should survive clearStore', () => {
      setRenderMap({ Text: () => 'x' });

      clearStore();

      assert.ok(resolveRenderer('Text'), 'clearStore 只清数据，不该清掉渲染表');
    });
  });
});
