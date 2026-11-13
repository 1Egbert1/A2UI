/**
 * WorkBuddy 落地页场景：把一份「看起来完整、实际渲染不出来」的生成结果补成可渲染的协议流。
 *
 * 原始输出（用户提供）的问题写在 `docs/a2ui-generation-review.md`：
 * 没有 beginRendering、没有统一 root、15 个悬空引用、6 处 path 没有数据模型。
 * 这里按它的**原意**补齐，不改设计：补 root / 补缺失的列表与图标 / 补数据模型。
 *
 * 切法遵守流式规约：root 第一条 → beginRendering 第二条 → dataModelUpdate 第三条
 * → 之后按 6 个组件一条分块。root 的 explicitList 前向引用尚未到达的区块，界面边收边长。
 *
 * 两处刻意的写法（都是为了绕开/验证白名单，见 `docs/a2ui-styles-extension.md`）：
 * - **单边分隔线用 `boxShadow: inset`**：白名单里只有 `border`，没有 `borderBottom`/`borderRight`，
 *   方向性边框会被静默丢弃。`inset 0 -1px 0 #f0f0f0` 能表达同样的东西且在白名单内。
 * - **`lineHeight` 用字符串**：`lineHeight` 的规整类型是 `number`（支持 1.2 这种倍数写法），
 *   所以像素值必须写成 `'20px'`；写成裸数字 20 会被 CSS 当成 20 倍行高。
 */
const SURFACE_ID = 'workbuddy';

interface DataEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataEntry[];
}

/** 普通 JSON → 协议 `DataEntry[]`（协议没有原生数组，列表用对象 map + item 占位）。 */
const toDataEntries = (value: unknown): DataEntry[] => {
  const source = Array.isArray(value)
    ? Object.fromEntries(value.map((item, index) => [String(index), item]))
    : (value as Record<string, unknown>);

  return Object.entries(source).map(([key, item]) => {
    if (typeof item === 'string') {
      return { key, valueString: item };
    }
    if (typeof item === 'number') {
      return { key, valueNumber: item };
    }
    if (typeof item === 'boolean') {
      return { key, valueBoolean: item };
    }
    return { key, valueMap: toDataEntries(item) };
  });
};

type Node = Record<string, unknown>;

const DATA_MODEL = {
  ui: {
    hint: '演示：点「立即下载」或「发送」，回执写进数据模型（本页右侧面板可见）',
  },
  nav: {
    links: {
      l1: { label: '产品', hot: '' },
      l2: { label: '解决方案', hot: '' },
      l3: { label: '定价', hot: '' },
      l4: { label: '企业版', hot: 'HOT' },
      l5: { label: '文档', hot: '' },
    },
  },
  app: {
    title: 'WorkBuddy 能帮你做什么？',
    placeholder: '描述你要完成的任务，WorkBuddy 会直接开始执行…',
    chips: {
      c1: { icon: 'Document', label: '写一份周报' },
      c2: { icon: 'DataAnalysis', label: '分析销售数据' },
      c3: { icon: 'Calendar', label: '安排下周会议' },
    },
    skills: {
      s1: { icon: 'EditPen', label: '写作' },
      s2: { icon: 'PieChart', label: '分析' },
      s3: { icon: 'Picture', label: '设计' },
      s4: { icon: 'VideoCamera', label: '视频' },
    },
    side: {
      s1: { icon: 'ChatDotRound', label: '新建对话', trail: '⌘N' },
      s2: { icon: 'Search', label: '搜索', trail: '⌘K' },
      s3: { icon: 'Folder', label: '最近文件', trail: '' },
      s4: { icon: 'Star', label: '收藏', trail: '' },
    },
  },
};

/**
 * 全部组件，顺序即「分块顺序」：按区块（导航 → 主视觉 → 预览卡壳 → 侧栏列表 → 主区 → 列表项）
 * 排，而不是按 id 字母序 —— 这样流式过程中每一块到达时都是完整可看的。
 */
const COMPONENTS: Array<[string, Node]> = [
  // ── root：原输出完全没有的东西 ──
  [
    'root',
    {
      Column: {
        children: { explicitList: ['nav', 'hero', 'preview-body', 'ui-hint'] },
        alignment: 'stretch',
        styles: { width: '100%', minHeight: 700, backgroundColor: '#ffffff', gap: 0 },
      },
    },
  ],

  // ── 导航条 ──
  [
    'nav',
    {
      Row: {
        children: { explicitList: ['logo-row', 'nav-list', 'nav-right'] },
        distribution: 'spaceBetween',
        alignment: 'center',
        styles: {
          padding: '10px 24px',
          backgroundColor: '#ffffff',
          // 单边分隔线：白名单没有 borderBottom，用 inset 阴影表达。
          boxShadow: 'inset 0 -1px 0 #f0f0f0',
        },
      },
    },
  ],
  [
    'logo-row',
    {
      Row: {
        children: { explicitList: ['logo-mark', 'logo-text'] },
        alignment: 'center',
        styles: { gap: 8 },
      },
    },
  ],
  [
    'logo-mark',
    {
      Row: {
        children: { explicitList: ['logo-mark-icon'] },
        alignment: 'center',
        distribution: 'center',
        styles: { width: 24, height: 24, borderRadius: 7, backgroundColor: '#5fded4' },
      },
    },
  ],
  [
    'logo-mark-icon',
    {
      Icon: {
        name: { literalString: 'ChatDotRound' },
        styles: { width: 14, height: 14, color: '#ffffff' },
      },
    },
  ],
  [
    'logo-text',
    { Text: { text: { literalString: 'WorkBuddy' }, styles: { fontSize: 15, fontWeight: 600, color: '#111111' } } },
  ],
  [
    'nav-list',
    {
      List: {
        children: { template: { componentId: 'nav-link-item', dataBinding: '/nav/links' } },
        direction: 'horizontal',
        alignment: 'center',
        styles: { gap: 2 },
      },
    },
  ],
  [
    'nav-right',
    {
      Row: {
        children: { explicitList: ['nav-login', 'nav-download'] },
        alignment: 'center',
        styles: { gap: 10 },
      },
    },
  ],
  [
    'nav-login',
    { Text: { text: { literalString: '登录' }, styles: { fontSize: 13, color: '#374151' } } },
  ],
  [
    'nav-download',
    {
      Button: {
        child: 'nav-download-label',
        styles: { backgroundColor: '#111111', borderRadius: 8, padding: '6px 14px' },
        action: {
          name: 'downloadApp',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/hint',
              value: { literalString: '已记录：点击了导航栏「下载 WorkBuddy」' },
            },
          ],
        },
      },
    },
  ],
  [
    'nav-download-label',
    { Text: { text: { literalString: '下载 WorkBuddy' }, styles: { fontSize: 12, color: '#ffffff', fontWeight: 500 } } },
  ],

  // ── 主视觉 ──
  [
    'hero',
    {
      Column: {
        children: { explicitList: ['hero-title-row', 'hero-sub', 'hero-cta', 'hero-link'] },
        alignment: 'center',
        styles: { padding: '26px 24px 18px', gap: 10, backgroundColor: '#f7fdfb' },
      },
    },
  ],
  [
    'hero-title-row',
    {
      Row: {
        children: { explicitList: ['hero-w', 'hero-logo', 'hero-rk'] },
        alignment: 'center',
        styles: { gap: 2 },
      },
    },
  ],
  [
    'hero-w',
    { Text: { text: { literalString: 'W' }, styles: { fontSize: 44, fontWeight: 700, color: '#111111', lineHeight: 1.05 } } },
  ],
  [
    'hero-logo',
    {
      Row: {
        children: { explicitList: ['hero-logo-icon'] },
        alignment: 'center',
        distribution: 'center',
        styles: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#5fded4' },
      },
    },
  ],
  [
    'hero-logo-icon',
    {
      Icon: {
        name: { literalString: 'ChatDotRound' },
        styles: { width: 18, height: 18, color: '#ffffff' },
      },
    },
  ],
  [
    'hero-rk',
    { Text: { text: { literalString: 'rkBuddy' }, styles: { fontSize: 44, fontWeight: 700, color: '#111111', lineHeight: 1.05 } } },
  ],
  [
    'hero-sub',
    {
      Text: {
        text: {
          literalString:
            'WorkBuddy 是腾讯出品的全场景 AI 办公工作台。说出要求、开始执行任务、交付完整成果。',
        },
        usageHint: 'body',
        styles: {
          fontSize: 13,
          color: '#5b6472',
          textAlign: 'center',
          // 像素行高必须带单位：写成裸数字 20 会被当成 20 倍行高。
          lineHeight: '20px',
          maxWidth: 560,
          margin: '0',
        },
      },
    },
  ],
  [
    'hero-cta',
    {
      Button: {
        child: 'hero-cta-label',
        styles: { backgroundColor: '#00a870', borderRadius: 9, padding: '9px 20px' },
        action: {
          name: 'downloadApp',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/hint',
              value: { literalString: '已记录：点击了「立即下载 WorkBuddy」' },
            },
          ],
        },
      },
    },
  ],
  [
    'hero-cta-label',
    { Text: { text: { literalString: '立即下载 WorkBuddy' }, styles: { fontSize: 13, fontWeight: 600, color: '#ffffff' } } },
  ],
  [
    'hero-link',
    { Text: { text: { literalString: '在线使用 WorkBuddy ›' }, usageHint: 'caption', styles: { fontSize: 12, color: '#00a870' } } },
  ],

  // ── 预览卡：外壳 ──
  [
    'preview-body',
    {
      Row: {
        children: { explicitList: ['sidebar', 'main'] },
        alignment: 'stretch',
        styles: {
          width: '100%',
          maxWidth: 820,
          minHeight: 330,
          margin: '0 auto 20px',
          borderRadius: 14,
          border: '1px solid #f0f0f0',
          boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
          backgroundColor: '#ffffff',
        },
      },
    },
  ],
  // ── 侧栏 ──
  [
    'sidebar',
    {
      Column: {
        children: { explicitList: ['win-dots', 'side-brand', 'side-list', 'side-tasks', 'side-space'] },
        alignment: 'stretch',
        styles: {
          width: 190,
          padding: 10,
          gap: 3,
          backgroundColor: '#fcfcfc',
          boxShadow: 'inset -1px 0 0 #f2f2f2',
        },
      },
    },
  ],
  [
    'win-dots',
    {
      Row: {
        children: { explicitList: ['dot-red', 'dot-yellow', 'dot-green'] },
        alignment: 'center',
        styles: { gap: 4, padding: '2px 6px 8px' },
      },
    },
  ],
  ['dot-red', { Text: { text: { literalString: '●' }, styles: { fontSize: 7, color: '#ff5f57' } } }],
  ['dot-yellow', { Text: { text: { literalString: '●' }, styles: { fontSize: 7, color: '#febc2e' } } }],
  ['dot-green', { Text: { text: { literalString: '●' }, styles: { fontSize: 7, color: '#28c840' } } }],
  [
    'side-brand',
    { Text: { text: { literalString: 'WorkBuddy' }, usageHint: 'caption', styles: { fontSize: 11, fontWeight: 600, color: '#333333', padding: '2px 6px' } } },
  ],
  [
    'side-list',
    {
      List: {
        children: { template: { componentId: 'side-item', dataBinding: '/app/side' } },
        direction: 'vertical',
        alignment: 'stretch',
        styles: { gap: 0 },
      },
    },
  ],
  [
    'side-tasks',
    { Text: { text: { literalString: '任务 (18)' }, usageHint: 'caption', styles: { fontSize: 11, color: '#888888', padding: '8px 6px 2px' } } },
  ],
  [
    'side-space',
    { Text: { text: { literalString: '空间 (20)' }, usageHint: 'caption', styles: { fontSize: 11, color: '#888888', padding: '2px 6px' } } },
  ],

  // ── 主区外壳 ──
  [
    'main',
    {
      Column: {
        children: { explicitList: ['main-title', 'chip-row', 'skill-row', 'prompt-card', 'main-footer'] },
        alignment: 'center',
        // 纵向居中：卡片有 minHeight，内容少于它时留白会全堆在底部（截图里像没加载完）。
        distribution: 'center',
        styles: { flexGrow: 1, padding: '18px 22px 12px', gap: 10, backgroundColor: '#ffffff' },
      },
    },
  ],
  [
    'main-title',
    {
      Text: {
        text: { path: '/app/title' },
        usageHint: 'h3',
        styles: { fontSize: 18, fontWeight: 700, color: '#111111', textAlign: 'center' },
      },
    },
  ],
  [
    'chip-row',
    {
      List: {
        children: { template: { componentId: 'chip-item', dataBinding: '/app/chips' } },
        direction: 'horizontal',
        alignment: 'center',
        styles: { gap: 6 },
      },
    },
  ],
  [
    'skill-row',
    {
      List: {
        children: { template: { componentId: 'skill-item', dataBinding: '/app/skills' } },
        direction: 'horizontal',
        alignment: 'center',
        styles: { gap: 4 },
      },
    },
  ],
  [
    'prompt-card',
    {
      Column: {
        children: { explicitList: ['prompt-inner'] },
        alignment: 'stretch',
        styles: { width: '100%', maxWidth: 480 },
      },
    },
  ],
  [
    'prompt-inner',
    {
      Column: {
        children: { explicitList: ['prompt-ph', 'prompt-tools'] },
        alignment: 'stretch',
        styles: {
          width: '100%',
          minHeight: 84,
          borderRadius: 14,
          border: '1px solid #eaeaea',
          boxShadow: '0 6px 18px rgba(0,0,0,0.04)',
          padding: 12,
          gap: 16,
        },
      },
    },
  ],
  [
    'prompt-ph',
    { Text: { text: { path: '/app/placeholder' }, usageHint: 'caption', styles: { fontSize: 12, color: '#b0b0b0' } } },
  ],
  [
    'prompt-tools',
    {
      Row: {
        children: { explicitList: ['prompt-plus', 'prompt-send'] },
        distribution: 'spaceBetween',
        alignment: 'center',
      },
    },
  ],
  ['prompt-plus', { Text: { text: { literalString: '＋' }, styles: { fontSize: 15, color: '#b8bec8' } } }],
  [
    'prompt-send',
    {
      Button: {
        child: 'prompt-send-label',
        styles: { backgroundColor: '#00a870', borderRadius: 8, padding: '5px 12px' },
        action: {
          name: 'submitPrompt',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/hint',
              value: { literalString: '已记录：点击了输入框「发送」' },
            },
          ],
        },
      },
    },
  ],
  ['prompt-send-label', { Text: { text: { literalString: '发送' }, styles: { fontSize: 12, color: '#ffffff' } } }],
  [
    'main-footer',
    { Text: { text: { literalString: '空间选择 ˅ 　默认权限 ˅' }, usageHint: 'caption', styles: { fontSize: 11, color: '#aaaaaa', textAlign: 'center' } } },
  ],
  [
    'ui-hint',
    { Text: { text: { path: '/ui/hint' }, usageHint: 'caption', styles: { fontSize: 11, color: '#98a2b3', textAlign: 'center', padding: '0 0 16px' } } },
  ],

  // ── 列表项模板（被 List 的 template 引用，本身不直接进树） ──
  [
    'nav-link-item',
    {
      Row: {
        children: { explicitList: ['nav-link-text', 'nav-hot'] },
        alignment: 'center',
        styles: { gap: 3, padding: '4px 8px' },
      },
    },
  ],
  [
    'nav-link-text',
    { Text: { text: { path: '/nav/links/item/label' }, styles: { fontSize: 13, color: '#374151' } } },
  ],
  [
    'nav-hot',
    { Text: { text: { path: '/nav/links/item/hot' }, styles: { fontSize: 9, fontWeight: 600, color: '#ff6b6b' } } },
  ],
  [
    'side-item',
    {
      Row: {
        children: { explicitList: ['side-item-icon', 'side-item-label', 'side-item-trail'] },
        alignment: 'center',
        distribution: 'start',
        styles: { gap: 6, padding: '5px 6px', borderRadius: 6 },
      },
    },
  ],
  [
    'side-item-icon',
    { Icon: { name: { path: '/app/side/item/icon' }, styles: { width: 13, height: 13, color: '#6b7280' } } },
  ],
  [
    'side-item-label',
    { Text: { text: { path: '/app/side/item/label' }, styles: { fontSize: 12, color: '#333333', flexGrow: 1 } } },
  ],
  [
    'side-item-trail',
    { Text: { text: { path: '/app/side/item/trail' }, styles: { fontSize: 10, color: '#b8b8b8' } } },
  ],
  [
    'chip-item',
    {
      Row: {
        children: { explicitList: ['chip-icon', 'chip-label'] },
        alignment: 'center',
        styles: {
          gap: 4,
          padding: '5px 10px',
          borderRadius: 16,
          border: '1px solid #ebebeb',
          backgroundColor: '#ffffff',
        },
      },
    },
  ],
  [
    'chip-icon',
    { Icon: { name: { path: '/app/chips/item/icon' }, styles: { width: 12, height: 12, color: '#00a870' } } },
  ],
  [
    'chip-label',
    { Text: { text: { path: '/app/chips/item/label' }, styles: { fontSize: 12, color: '#374151' } } },
  ],
  [
    'skill-item',
    {
      Row: {
        children: { explicitList: ['skill-icon', 'skill-label'] },
        alignment: 'center',
        styles: { gap: 3, padding: '2px 6px' },
      },
    },
  ],
  [
    'skill-icon',
    { Icon: { name: { path: '/app/skills/item/icon' }, styles: { width: 11, height: 11, color: '#9aa4b2' } } },
  ],
  [
    'skill-label',
    { Text: { text: { path: '/app/skills/item/label' }, styles: { fontSize: 11, color: '#888888' } } },
  ],
];

/** 每个分块几条组件。6 是「一屏内能看到变化、又不至于一条消息太大」的折中。 */
const CHUNK_SIZE = 6;

const build = (): string[] => {
  const messages: string[] = [];

  // #1 root 先到：它的 explicitList 前向引用后面才到的区块。
  messages.push(
    JSON.stringify({
      surfaceUpdate: {
        surfaceId: SURFACE_ID,
        components: [{ id: 'root', component: COMPONENTS[0]?.[1] }],
      },
    }),
  );
  // #2 surface 从这一刻诞生。
  messages.push(JSON.stringify({ beginRendering: { surfaceId: SURFACE_ID, root: 'root' } }));
  // #3 数据模型先到：后续所有 path 绑定都依赖它。
  messages.push(
    JSON.stringify({
      dataModelUpdate: { surfaceId: SURFACE_ID, contents: toDataEntries(DATA_MODEL) },
    }),
  );

  // 其余组件按区块分块下发。
  const rest = COMPONENTS.slice(1);
  for (let index = 0; index < rest.length; index += CHUNK_SIZE) {
    messages.push(
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: SURFACE_ID,
          components: rest.slice(index, index + CHUNK_SIZE).map(([id, component]) => ({ id, component })),
        },
      }),
    );
  }

  return messages;
};

/** WorkBuddy 落地页：一条一条的 JSONL（最后一条是 beginRendering 之外的补充块）。 */
export const workbuddyMessages: string[] = build();
