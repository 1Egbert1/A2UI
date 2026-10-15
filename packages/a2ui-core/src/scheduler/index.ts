/**
 * 刷新调度：决定「请求刷新」与「真正刷新」之间隔多久。
 *
 * 为什么需要它：`refreshDerivedState` 是**全量重算**（hydrate 所有节点 → 重建整棵树 →
 * 整树重画），而流式推送可能比帧率还密（服务端一次 flush 出几十片）。每片都同步重算的话，
 * 同一帧内会反复做一模一样的全量工作，只有最后一次的结果会被看到 —— 纯浪费，而且中途的
 * 重复建树/重画会变成可观测的卡顿。
 *
 * 设计沿用本库一贯的「职责单一 + 可注入」：core 只负责**发起**刷新请求，什么时候真正跑
 * 由这里决定。默认策略是**能力驱动**的：
 * - 有 `requestAnimationFrame`（浏览器）→ 合并到下一帧，同一帧内多次请求只跑一次；
 * - 没有（Node / SSR / 单测）→ **立即执行**，保持同步语义。
 *
 * 「无 rAF 就同步」这条兜底是刻意的：它让服务端渲染与单测里不引入不确定的异步边界
 * （写完就能断言），而浏览器里自动拿到合帧。宿主也可注入自己的调度器
 * （`setRefreshScheduler`）——例如接到 `requestIdleCallback`，或测试里换成手动触发。
 */

/** 调度器：拿到「执行这次刷新」的回调，自行决定何时调用（至多调用一次）。 */
export type RefreshScheduler = (flush: () => void) => void;

/** 有 rAF 时用 —— 合并到下一帧。 */
const frameScheduler: RefreshScheduler = (flush) => {
  requestAnimationFrame(() => flush());
};

/** 无 rAF 时用 —— 直接同步跑，不引入异步边界。 */
const immediateScheduler: RefreshScheduler = (flush) => {
  flush();
};

let injected: RefreshScheduler | null = null;

/** 当前调度器：注入过就用注入的，否则按环境能力选（rAF → 合帧，否则同步）。 */
export const getRefreshScheduler = (): RefreshScheduler =>
  injected ?? (typeof requestAnimationFrame === 'function' ? frameScheduler : immediateScheduler);

/**
 * 注入自定义调度器；传 `null`（或不传）恢复「按环境能力选」的默认行为。
 *
 * 调度器只在**请求刷新**那一刻被读取，所以切换不影响已经挂起的那一次。
 */
export const setRefreshScheduler = (scheduler?: RefreshScheduler | null): void => {
  injected = scheduler ?? null;
};
