import { cloneVNode, isVNode, type VNode } from 'vue';
import type { ComponentRenderer } from 'a2ui-core';

import type { VueNode } from './node';

/**
 * 入场动画：新到的组件「淡入 + 轻微上浮」。
 *
 * 与「组件身份」（`withRootId`）是两件不同的事 —— 一个是给根元素打 id，一个是首帧播动画，
 * 所以拆成独立的一层包装，由 renderMap 组合使用。
 *
 * 为什么用 Web Animations API 而不是 CSS 动画：
 * a2ui-vue 刻意不引入 CSS 文件（见 `internal/styles.ts`），关键帧没法内联到 vnode 的 style 上；
 * WAAPI 是纯 JS、不依赖任何样式资源，而且 `animation.finished` 给了「动画结束」一个明确的
 * 可等待落点 —— 正好用来触发 core 的 `markMounted()`（「标记清除」里的清除）。
 *
 * 为什么动 `translate`（独立属性）而不是 `transform` 简写：
 * 动画会覆盖元素上的同名属性；用 `transform` 会盖掉渲染器可能设置的内联 transform。
 * `translate` 与 `transform` 相互独立，互不干扰。
 */

/** 动画时长（毫秒）。 */
export const ENTRANCE_DURATION = 300;

/** 关键帧：从「透明 + 下移 6px」进入「不透明 + 原位」。 */
const ENTRANCE_KEYFRAMES: Keyframe[] = [
  { opacity: 0, translate: '0 6px' },
  { opacity: 1, translate: '0 0' },
];

const ENTRANCE_TIMING: KeyframeAnimationOptions = {
  duration: ENTRANCE_DURATION,
  easing: 'ease-out',
  // both：起步前先按住首帧（避免挂载瞬间的闪一下），结束后停在末帧（opacity 1）。
  fill: 'both',
};

/** 用户在系统里开了「减少动态效果」时不播动画（无障碍）。 */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 给组件级渲染器加上「首帧播入场动画」的行为。
 *
 * 是否要播，由 core 通过 `context.hasMounted` 告诉渲染引擎（这就是「标记」）：
 * - `false` —— 这个组件第一次被渲染，挂上 `onVnodeMounted`；
 * - `true`  —— 已经播过了，原样返回，patch 复用旧 DOM 时不会重播。
 *
 * 为什么挂在 `onVnodeMounted` 而不是渲染时立刻 `el.animate()`：渲染函数返回的阶段还没有 DOM，
 * 只有挂载钩子拿得到 `vnode.el`；而且挂载钩子只在「新建 DOM」时触发，patch 复用时不触发 ——
 * 这正好等价于「只有新组件才播」，与 `hasMounted` 这个显式标记互为印证。
 *
 * 动画结束（或环境不支持动画）时调用 `context.markMounted()` 清除标记 —— 通过这条路径，
 * store 里的 `hasMounted` 被置为 `true`，下一次 hydrate 重建的 vnode 就不再带挂载钩子。
 */
export const withEntranceAnimation = (
  renderer: ComponentRenderer<VueNode>,
): ComponentRenderer<VueNode> =>
  (props, context) => {
    const node = renderer(props, context);

    // 渲染不出节点（返回 null），或这个组件已经播过入场动画：无需任何处理。
    if (!isVNode(node) || context.hasMounted) {
      return node;
    }

    return cloneVNode(node, {
      onVnodeMounted: (mounted: VNode) => {
        const el = mounted.el as Element | null;

        // 环境不支持动画（SSR、老浏览器、挂载到非元素节点），或用户要求减少动态效果：
        // 直接标记为已挂载，避免每次重渲染都再试一次。
        if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) {
          context.markMounted();
          return;
        }

        el.animate(ENTRANCE_KEYFRAMES, ENTRANCE_TIMING).finished.then(
          () => context.markMounted(),
          // 动画被中途取消（例如节点很快被替换掉）：不标记，留给下一次渲染重播。
          () => undefined,
        );
      },
    });
  };
