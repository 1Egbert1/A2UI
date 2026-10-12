/**
 * 错误记录入口。
 *
 * store 的 `addError(errorId, error)` 要求调用方自己提供 id，散落在各处生成很容易重号。
 * 这里把「生成 id + 写入 errorMap」收成一处，解析器与消息处理器都通过 recordError 记录。
 */

import { addError } from '../store';
import { ErrorType } from '../store/types';

/** 错误 id 前缀，按错误类型区分，便于在页面上按类型筛出错误。 */
const ID_PREFIX: Record<ErrorType, string> = {
  [ErrorType.PARSE_ERROR]: 'parse-error',
  [ErrorType.RENDERER_NOT_FOUND]: 'renderer-error',
  [ErrorType.UNSUPPORTED_FEATURE]: 'unsupported-error',
};

/** 错误 id 自增序号，保证同一进程内不重号。 */
let errorSeq = 0;

/**
 * 记录一条错误到 `store.errorMap`，返回它的 id（形如 `parse-error-1`）。
 *
 * 只负责登记，不抛错 —— 调用方决定这次错误是否要中断当前流程。
 */
export const recordError = (type: ErrorType, content: string): string => {
  errorSeq += 1;
  const errorId = `${ID_PREFIX[type]}-${errorSeq}`;
  addError(errorId, { type, content });
  return errorId;
};
