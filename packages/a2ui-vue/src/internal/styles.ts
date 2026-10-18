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

  // —— Material Symbols 的 snake_case 命名（模型生成时最常用的形态，早年示例则是驼峰）——
  // 交通 / 旅行
  flight_takeoff: '🛫',
  flight_land: '🛬',
  flight: '✈️',
  local_airport: '🛫',
  train: '🚆',
  directions_bus: '🚌',
  directions_car: '🚗',
  hotel: '🏨',
  map: '🗺️',
  explore: '🧭',
  travel_explore: '🧭',
  luggage: '🧳',
  near_me: '🎯',
  place: '📍',
  traffic: '🚦',
  // 箭头 / 方向
  arrow_right_alt: '➡️',
  arrow_left_alt: '⬅️',
  arrow_upward: '⬆️',
  arrow_downward: '⬇️',
  arrow_right: '➡️',
  arrow_left: '⬅️',
  chevron_right: '›',
  chevron_left: '‹',
  east: '➡️',
  west: '⬅️',
  north: '⬆️',
  south: '⬇️',
  trending_up: '📈',
  trending_down: '📉',
  trending_flat: '➡️',
  swap_horiz: '↔️',
  expand_more: '⌄',
  expand_less: '⌃',
  // 时间 / 状态
  schedule: '🕐',
  access_time: '🕐',
  update: '🔄',
  history: '🕘',
  timer: '⏱️',
  pending: '⏳',
  hourglass_empty: '⏳',
  event_available: '✅',
  event_busy: '❌',
  bolt: '⚡',
  flag: '🚩',
  // 勾选 / 圆 / 叉
  check_circle: '✅',
  check_circle_outline: '✅',
  radio_button_unchecked: '○',
  radio_button_checked: '⚫',
  cancel: '❌',
  add_circle: '➕',
  remove_circle: '➖',
  block: '🚫',
  error_outline: '❗',
  priority_high: '❗',
  // 星 / 收藏 / 书签
  star_border: '☆',
  star_half: '⯨',
  grade: '⭐',
  bookmark: '🔖',
  bookmark_border: '🔖',
  favorite_border: '🤍',
  // 通讯 / 媒体
  chat: '💬',
  chat_bubble: '💬',
  comment: '💬',
  notifications_active: '🔔',
  volume_up: '🔊',
  volume_off: '🔇',
  mic: '🎤',
  videocam: '📹',
  message: '✉️',
  // 文件 / 云 / 支付
  folder_open: '📂',
  insert_drive_file: '📄',
  description: '📄',
  article: '📄',
  cloud: '☁️',
  cloud_upload: '☁️',
  cloud_download: '☁️',
  attach_money: '💰',
  credit_card: '💳',
  receipt: '🧾',
  savings: '🐷',
  wallet: '👛',
  // 用户 / 购物
  person_outline: '👤',
  group: '👥',
  logout: '🚪',
  login: '🔐',
  shopping_bag: '🛍️',
  store: '🏪',
  local_offer: '🏷️',
  sell: '🏷️',
  inventory: '📦',
  redeem: '🎁',
  // 天气 / 餐饮 / 健康
  wb_sunny: '☀️',
  ac_unit: '❄️',
  water_drop: '💧',
  restaurant: '🍽️',
  local_cafe: '☕',
  local_dining: '🍽️',
  local_pizza: '🍕',
  fastfood: '🍔',
  thermostat: '🌡️',
  medical_services: '🏥',
  health_and_safety: '🛡️',
  security: '🔒',
  shield: '🛡️',
  // 编辑 / 操作 / 视图
  edit_note: '✏️',
  create: '✏️',
  save: '💾',
  content_copy: '📋',
  content_paste: '📋',
  open_in_new: '↗️',
  fullscreen: '⛶',
  view_list: '☰',
  grid_view: '▦',
  filter_list: '⚲',
  sort: '↕️',
  sync: '🔄',
  play_arrow: '▶️',
  pause: '⏸️',
  stop: '⏹️',
  replay: '🔁',
  build: '🔧',
  handyman: '🔧',
  construction: '🚧',
  work: '💼',
  business: '💼',
  campaign: '📣',
  celebration: '🎉',
  emoji_events: '🎉',
  school: '🎓',
  science: '🔬',
  psychology: '🧠',
  cake: '🎂',
  // —— 业务场景常用（点餐 / 酒店 / 智能家居 / 健身 / 音乐 / 招聘等评测场景）——
  wifi: '📶',
  pool: '🏊',
  bed: '🛏️',
  shower: '🚿',
  bedroom: '🛋️',
  kitchen: '🍳',
  meeting_room: '👥',
  badge: '📛',
  lightbulb: '💡',
  coffee_maker: '☕',
  directions_run: '🏃',
  music_note: '🎵',
  skip_previous: '⏮️',
  skip_next: '⏭️',
  insights: '📊',
  checkout: '🧾',
};

/** 图标名取不到时用的中性占位符。 */
export const FALLBACK_GLYPH = '▢';

const toCamelCase = (name: string): string =>
  name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

const toSnakeCase = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * 查图标字形：先原样查，再把 snake_case ↔ camelCase 互相试一遍。
 *
 * 模型两种命名风格都可能吐（Material Symbols 官方是 snake_case，而早期示例用的是驼峰），
 * 规范化后命中率大增；三种都取不到才退回占位符。
 */
export const lookupGlyph = (name: string): string =>
  ICON_GLYPHS[name] ??
  ICON_GLYPHS[toCamelCase(name)] ??
  ICON_GLYPHS[toSnakeCase(name)] ??
  FALLBACK_GLYPH;

export const ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.25rem',
  lineHeight: 1,
  verticalAlign: 'middle',
};

/**
 * 组件级 `styles` 扩展：允许每个组件用内联 CSS 微调外观。
 *
 * 官方 v0.8 协议里 `styles` **只在 surface 级**（`beginRendering.styles`，只有 font /
 * primaryColor 两个字段），组件层没有这个属性。而「把 @title 改成红色加粗」这类诉求
 * 恰恰需要逐组件覆盖 —— 所以这里做一个**受控扩展**：不改 core，也不改渲染器契约，
 * 只在 `withRootId` 这一层把 `props.styles` 合进根元素的 style。
 *
 * 为什么是白名单而不是放行全部 CSS：`position: fixed` / `display: none` 这类属性会把
 * 预览布局整个搅乱，而模型生成的样式多半只需要字号、颜色、间距。白名单让「支持哪些」
 * 可枚举、可测试、可写进文档（`docs/a2ui-styles-extension.md`），也不会随模型发挥失控。
 *
 * 取值规则：
 * - 键名 camelCase 与 kebab-case 都认（`font-size` → `fontSize`）；
 * - 长度类属性给数字时自动补 `px`（`fontSize: 18` → `18px`）；
 * - 无单位/枚举类属性（opacity、fontWeight、textAlign…）原样使用；
 * - 白名单外的键、空字符串、非 string/number 值一律**忽略**（不报错）。
 */
const STYLE_RULES: Record<string, 'length' | 'number' | 'plain'> = {
  color: 'plain',
  backgroundColor: 'plain',
  background: 'plain',
  fontSize: 'length',
  fontWeight: 'number',
  fontStyle: 'plain',
  fontFamily: 'plain',
  lineHeight: 'number',
  letterSpacing: 'length',
  textAlign: 'plain',
  textDecoration: 'plain',
  textTransform: 'plain',
  whiteSpace: 'plain',
  opacity: 'number',
  padding: 'length',
  paddingTop: 'length',
  paddingRight: 'length',
  paddingBottom: 'length',
  paddingLeft: 'length',
  margin: 'length',
  marginTop: 'length',
  marginRight: 'length',
  marginBottom: 'length',
  marginLeft: 'length',
  gap: 'length',
  width: 'length',
  height: 'length',
  minWidth: 'length',
  minHeight: 'length',
  maxWidth: 'length',
  maxHeight: 'length',
  border: 'plain',
  borderWidth: 'length',
  borderStyle: 'plain',
  borderColor: 'plain',
  borderRadius: 'length',
  boxShadow: 'plain',
  objectFit: 'plain',
  flexGrow: 'number',
  flexShrink: 'number',
  alignSelf: 'plain',
  justifySelf: 'plain',
};

/** `font-size` / `font_size` → `fontSize`。 */
const toCamelProp = (key: string): string =>
  key.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/**
 * 把协议里的 `styles` 对象规整成 Vue 的 style 对象；没有任何合法属性时返回 undefined
 * （调用方据此完全不动原有样式，避免多挂一个空对象）。
 */
export const stylesOf = (raw: unknown): CSSProperties | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const prop = toCamelProp(key);
    const rule = STYLE_RULES[prop];
    if (rule === undefined) {
      continue;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      if (rule === 'length') {
        result[prop] = `${value}px`;
      } else if (rule === 'number') {
        result[prop] = value;
      }
      // plain 类属性（color / textAlign…）给数字没有意义 → 丢弃
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      result[prop] = value;
    }
  }

  return Object.keys(result).length > 0 ? (result as CSSProperties) : undefined;
};
