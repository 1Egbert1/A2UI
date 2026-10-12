import type { CSSProperties } from 'vue';

/**
 * 组件渲染用到的样式表。
 *
 * 全部走**内联样式**，不引入 CSS 文件：a2ui-vue 是要被宿主应用打包的渲染引擎，
 * 让它同时分发样式资源会带来构建配置负担（当前 playground 直接引 src，也没有 CSS 入口）。
 * 代价是没法用媒体查询/伪类，后续要正式做主题时再换成 CSS 变量 + 样式注入。
 */

/** 布局容器的统一间距。 */
export const GAP = '8px';

const JUSTIFY_CONTENT: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
};

const ALIGN_ITEMS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

/** 容器的 distribution → CSS justify-content；取不到时退回 start（协议默认靠起始端排列）。 */
export const justifyOf = (distribution: unknown): string =>
  JUSTIFY_CONTENT[String(distribution)] ?? 'flex-start';

/** 容器的 alignment → CSS align-items；取不到时退回 stretch（协议默认拉伸填满交叉轴）。 */
export const alignOf = (alignment: unknown): string => ALIGN_ITEMS[String(alignment)] ?? 'stretch';

/** 通用弹性容器。 */
export const flexContainer = (direction: 'row' | 'column', gap = GAP): CSSProperties => ({
  display: 'flex',
  flexDirection: direction,
  gap,
  boxSizing: 'border-box',
});

// ---- Text ----

/** Text.usageHint → 标签名（枚举取自 standard_catalog_definition.json）。 */
const USAGE_HINT_TAGS: Record<string, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  caption: 'small',
  body: 'p',
};

export const tagOfText = (usageHint: unknown): string =>
  USAGE_HINT_TAGS[String(usageHint)] ?? 'span';

const TEXT_STYLES: Record<string, CSSProperties> = {
  h1: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.25, margin: '0.25rem 0' },
  h2: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, margin: '0.25rem 0' },
  h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35, margin: '0.2rem 0' },
  h4: { fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4, margin: '0.2rem 0' },
  h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4, margin: '0.2rem 0' },
  caption: { fontSize: '0.78rem', color: '#6b7280', margin: 0 },
  body: { fontSize: '0.95rem', lineHeight: 1.5, margin: 0 },
};

export const textStyleOf = (usageHint: unknown): CSSProperties => ({
  fontFamily: 'inherit',
  ...(TEXT_STYLES[String(usageHint)] ?? { fontSize: '0.95rem', margin: 0 }),
});

// ---- Image ----

const IMAGE_SIZES: Record<string, CSSProperties> = {
  icon: { width: '24px', height: '24px' },
  avatar: { width: '40px', height: '40px', borderRadius: '50%' },
  smallFeature: { width: '120px', height: '90px' },
  mediumFeature: { width: '240px', height: '160px' },
  largeFeature: { width: '480px', height: '320px' },
  header: { width: '100%', height: '200px' },
};

export const imageStyleOf = (usageHint: unknown, fit: unknown): CSSProperties => ({
  display: 'block',
  borderRadius: '6px',
  objectFit: (fit ? String(fit) : 'cover') as CSSProperties['objectFit'],
  ...(IMAGE_SIZES[String(usageHint)] ?? { maxWidth: '100%' }),
});

// ---- Icon ----
//
// ⚠️ 占位实现：标准目录规定了 47 个图标名，但没有规定图形资源，本包也不该绑定某个
// 图标库。这里用一张「图标名 → 字符/emoji」表先保证能渲染出可辨识的占位图形，
// 正式接入图标字体或 SVG 图标集时只需要替换这张表（以及 Icon 渲染器内部）。

export const ICON_GLYPHS: Record<string, string> = {
  accountCircle: '👤',
  add: '➕',
  arrowBack: '⬅️',
  arrowForward: '➡️',
  attachFile: '📎',
  calendarToday: '📅',
  call: '📞',
  camera: '📷',
  check: '✅',
  close: '❌',
  delete: '🗑️',
  download: '⬇️',
  edit: '✏️',
  error: '❗',
  event: '🗓️',
  favorite: '❤️',
  favoriteOff: '🤍',
  folder: '📁',
  help: '❓',
  home: '🏠',
  info: 'ℹ️',
  locationOn: '📍',
  lock: '🔒',
  lockOpen: '🔓',
  mail: '✉️',
  menu: '☰',
  moreVert: '⋮',
  moreHoriz: '⋯',
  notificationsOff: '🔕',
  notifications: '🔔',
  payment: '💳',
  person: '🧑',
  phone: '☎️',
  photo: '🖼️',
  print: '🖨️',
  refresh: '🔄',
  search: '🔍',
  send: '➤',
  settings: '⚙️',
  share: '↗️',
  shoppingCart: '🛒',
  star: '⭐',
  starHalf: '⯨',
  starOff: '☆',
  upload: '⬆️',
  visibility: '👁️',
  visibilityOff: '⊘',
  warning: '⚠️',
};

/** 图标名取不到时用的中性占位符。 */
export const FALLBACK_GLYPH = '▢';

export const ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.25rem',
  lineHeight: 1,
  verticalAlign: 'middle',
};
