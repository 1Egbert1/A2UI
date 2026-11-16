export * from './renderMap';

/**
 * 诊断用：报告一个组件 `styles` 里会被丢弃的键、以及可疑的 `lineHeight`。
 *
 * 导出成公共 API 是刻意的 —— 白名单只存在于这一层（`internal/styles.ts`），
 * 诊断方（playground 气泡里的「本轮提示」）必须拿到**同一份**表，
 * 否则迟早会出现「服务端以为支持、渲染端其实丢弃」的分歧。
 */
export { auditStyles } from './internal/styles';
export type { StyleAudit } from './internal/styles';
