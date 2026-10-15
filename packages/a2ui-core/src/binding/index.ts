/**
 * 协议取值对象（bound value）的解析。
 *
 * 标准目录里几乎所有「值」都是同一种形状：`{ literalString }` / `{ literalNumber }` /
 * `{ literalBoolean }` / `{ literalArray }` 二选一地与 `{ path }` 存在于一个对象里
 * （见 standard_catalog_definition.json 各组件属性）。这里把这套形状的解析收成一处，
 * 让各组件渲染器只关心「我要一个字符串 / 数字 / 布尔 / 字符串数组」。
 *
 * 纯协议形态、与框架无关，因此放在 core。
 */

/** 协议里的取值对象：要么带一个 `literal*`，要么带 `path`。 */
export interface BoundValue {
  literalString?: unknown;
  literalNumber?: unknown;
  literalBoolean?: unknown;
  literalArray?: unknown;
  path?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * 按 path 在数据模型上取值。
 *
 * path 兼容 `'/user/name'` 与 `'user/name'` 两种写法（按 `/` 切分并过滤空段），
 * 逐层下钻遇到非对象即返回 `undefined`。与 `dataModelUpdate` 的 path 语义保持一致。
 *
 * 中间层若为**数组**（如 `/items/0/name`），则该段按数字下标取值 —— 用于 List 的
 * template 遍历裸数组（协议没有 valueArray，但宿主可能直塞数组进数据模型）。
 */
export const readPath = (dataModel: Record<string, unknown>, path: string): unknown => {
  const segments = path.split('/').filter((segment) => segment !== '');
  let current: unknown = dataModel;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) && index >= 0 ? current[index] : undefined;
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[segment];
  }

  return current;
};

/**
 * 按 path 把 `value` 写进数据模型，返回**新的**数据模型对象（immutable，不改入参）。
 *
 * 与 `readPath` 对称，是「客户端写回数据模型」的底层原语（表单控件交互时由
 * `RenderContext.updateModel` 调起）。path 兼容 `'/user/name'` 与 `'user/name'`。
 * 逐层下钻时，中间层若缺失或不是对象，会被当作空对象重建。
 *
 * path 为空表示「整体替换」：value 是对象时直接作为新数据模型返回，否则保守返回原对象。
 */
export const writePath = (
  dataModel: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> => {
  const segments = path.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : dataModel;
  }

  const [head, ...rest] = segments;

  if (rest.length === 0) {
    // 最后一个 segment：直接把 value 写到 head，无需再下钻。
    return { ...dataModel, [head]: value };
  }

  const existing = dataModel[head];
  const child =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...dataModel, [head]: writePath(child, rest.join('/'), value) };
};

/**
 * 取字符串。
 *
 * 兼顾三种输入：取值对象、裸字符串（协议不允许，但宽松处理）、以及 path 指向数字/布尔时转字符串。
 */
export const readString = (
  value: unknown,
  read: (path: string) => unknown,
  fallback = '',
): string => {
  if (typeof value === 'string') {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return fallback;
  }

  if (typeof record.literalString === 'string') {
    return record.literalString;
  }

  if (typeof record.path === 'string') {
    const resolved = read(record.path);
    if (typeof resolved === 'string') return resolved;
    if (typeof resolved === 'number' || typeof resolved === 'boolean') return String(resolved);
    return fallback;
  }

  return fallback;
};

/** 取数字；path 指向数字字符串时也接受。 */
export const readNumber = (
  value: unknown,
  read: (path: string) => unknown,
  fallback = 0,
): number => {
  const record = asRecord(value);
  if (!record) {
    return typeof value === 'number' ? value : fallback;
  }

  if (typeof record.literalNumber === 'number') {
    return record.literalNumber;
  }

  if (typeof record.path === 'string') {
    const resolved = read(record.path);
    if (typeof resolved === 'number' && Number.isFinite(resolved)) return resolved;
    if (typeof resolved === 'string' && resolved.trim() !== '') {
      const parsed = Number(resolved);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return fallback;
};

/** 取布尔；path 指向 `'true'` / `'false'` 字符串时也接受。 */
export const readBoolean = (
  value: unknown,
  read: (path: string) => unknown,
  fallback = false,
): boolean => {
  const record = asRecord(value);
  if (!record) {
    return typeof value === 'boolean' ? value : fallback;
  }

  if (typeof record.literalBoolean === 'boolean') {
    return record.literalBoolean;
  }

  if (typeof record.path === 'string') {
    const resolved = read(record.path);
    if (typeof resolved === 'boolean') return resolved;
    if (resolved === 'true') return true;
    if (resolved === 'false') return false;
  }

  return fallback;
};

/** 取字符串数组；非字符串元素会被转成字符串。 */
export const readStringArray = (
  value: unknown,
  read: (path: string) => unknown,
  fallback: string[] = [],
): string[] => {
  const record = asRecord(value);
  const source = record
    ? typeof record.path === 'string'
      ? read(record.path)
      : record.literalArray
    : value;

  if (!Array.isArray(source)) {
    return fallback;
  }

  return source.map((item) => (typeof item === 'string' ? item : String(item)));
};
