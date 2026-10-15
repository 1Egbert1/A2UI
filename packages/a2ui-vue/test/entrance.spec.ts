import { strict as assert } from 'assert';

import { type VNode } from 'vue';

import { ENTRANCE_DURATION, renderMap, renderText, withEntranceAnimation } from '../src/renderMap';
import { fakeContext } from './support';

/**
 * 入场动画（`withEntranceAnimation`）的单元测试。
 *
 * 这里不开浏览器：mount 钩子拿到的 DOM 元素用一个「假的 el」替代 —— 它只需要长得像
 * 带 `animate()` 的元素即可。这样能不依赖 jsdom 就把三条分支都压到：
 * 环境不支持动画、动画正常结束、动画被取消。
 */

/** 造一个渲染上下文，`markMounted` 用一个计数器收口。 */
const countingContext = (hasMounted: boolean) => {
  const state = { marked: 0 };
  const context = fakeContext({
    componentId: 'c',
    surfaceId: 's',
    hasMounted,
    markMounted: () => {
      state.marked += 1;
    },
  });
  return { context, state };
};

/** 手动触发 vnode 的挂载钩子（SSR 不会跑它，所以自己调）。 */
const fireMounted = (vnode: VNode, el: unknown): void => {
  const hook = vnode.props?.onVnodeMounted as ((vnode: VNode) => void) | undefined;
  assert.ok(hook, 'vnode 上应有 onVnodeMounted 钩子');
  hook({ el } as unknown as VNode);
};

/** 等一轮宏任务，冲掉 `finished.then(...)` 排入的微任务。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('A2UI Vue 入场动画', () => {
  describe('是否挂载动画钩子', () => {
    it('should attach the mount hook when the component has not mounted yet', () => {
      const wrapped = withEntranceAnimation(renderText);
      const vnode = wrapped({ text: { literalString: 'Hi' } }, fakeContext({ hasMounted: false })) as VNode;

      assert.equal(typeof vnode.props?.onVnodeMounted, 'function');
    });

    it('should not attach the hook once the component has already mounted', () => {
      const wrapped = withEntranceAnimation(renderText);
      const vnode = wrapped({ text: { literalString: 'Hi' } }, fakeContext({ hasMounted: true })) as VNode;

      assert.equal(
        vnode.props?.onVnodeMounted,
        undefined,
        '已经播过入场动画的组件不应再挂钩子（标记清除后的静止态）',
      );
    });

    it('should pass through a null render result untouched', () => {
      const wrapped = withEntranceAnimation(() => null);

      assert.equal(wrapped({}, fakeContext({ hasMounted: false })), null);
    });
  });

  describe('挂载后的行为', () => {
    it('should mark mounted immediately when the element cannot animate', () => {
      const { context, state } = countingContext(false);
      const vnode = withEntranceAnimation(renderText)(
        { text: { literalString: 'Hi' } },
        context,
      ) as VNode;

      // 没有 animate 方法（SSR / 老环境 / 非元素节点）。
      fireMounted(vnode, {});

      assert.equal(state.marked, 1, '不能播动画时应直接落位并清除标记');
    });

    it('should mark mounted only after the animation finishes', async () => {
      const { context, state } = countingContext(false);
      const vnode = withEntranceAnimation(renderText)(
        { text: { literalString: 'Hi' } },
        context,
      ) as VNode;

      let timing: KeyframeAnimationOptions | undefined;
      fireMounted(vnode, {
        animate: (_keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
          timing = options;
          return { finished: Promise.resolve() };
        },
      });

      assert.equal(state.marked, 0, '动画还没结束，不能提前清除标记');
      assert.equal(timing?.duration, ENTRANCE_DURATION, '动画时长应为 0.3s');

      await flush();
      assert.equal(state.marked, 1, '动画结束后应清除标记');
    });

    it('should keep the flag when the animation is cancelled', async () => {
      const { context, state } = countingContext(false);
      const vnode = withEntranceAnimation(renderText)(
        { text: { literalString: 'Hi' } },
        context,
      ) as VNode;

      fireMounted(vnode, {
        animate: () => ({ finished: Promise.reject(new Error('cancelled')) }),
      });

      await flush();
      assert.equal(state.marked, 0, '动画被取消时不标记，留给下一次渲染重播');
    });
  });

  describe('renderMap 集成', () => {
    it('should wrap every registered component with the entrance behavior', () => {
      const context = (hasMounted: boolean) => fakeContext({ componentId: 'c', surfaceId: 's', hasMounted });
      const fresh = renderMap.Text({ text: { literalString: 'Hi' } }, context(false));
      const settled = renderMap.Text({ text: { literalString: 'Hi' } }, context(true));

      assert.equal(typeof (fresh as VNode).props?.onVnodeMounted, 'function', '新组件应带入场钩子');
      assert.equal((settled as VNode).props?.onVnodeMounted, undefined, '已挂载组件不该带钩子');
      assert.equal((fresh as VNode).props?.id, 's-c', '入场包装不应影响 withRootId 打上的 id');
    });
  });
});
