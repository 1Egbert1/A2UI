/**
 * core 自带的 mock 数据。
 *
 * 全部以 **TS 模块**的形式提供（导出一组「一行一条消息」的字符串数组），
 * 而不是独立的 `.jsonl` 文件——这样调用方可以直接 import、按序号逐条推送，
 * 不需要 `?raw` 导入再自己 split。
 */

export * from './simple-text';
export * from './product-card';
export * from './column-texts';
export * from './column-row-mix';
