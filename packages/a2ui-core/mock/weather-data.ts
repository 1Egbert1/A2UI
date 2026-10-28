/**
 * 天气页（武汉）的组件定义与数据模型 —— 从真实 store 快照重建。
 *
 * 来源：用户在 playground 里跑出的一页，导出的是 `hydrateNodeMap` / `dataModelMap` /
 * `treeMap` 的 store 快照，**不是原始 JSONL**（当时页面没有「导出 JSONL」入口）。
 * 这里按快照里的 `protocol` 原文逐个搬过来，未做任何设计上的增删 —— 包括快照里
 * 那些「登记了但没人引用」的节点（见 `weather.ts` 的说明）。
 *
 * 布局顺序即**流式下发顺序**：root → beginRendering → dataModel → 自上而下分块。
 * 这样回放时就是「边收边长出整页」，和真实生成一致。
 */

/** 组件 id → 协议对象（`surfaceUpdate.components[i].component` 的内容）。 */
export const WEATHER_COMPONENTS: Array<[string, unknown]> = [
  [
    'root',
    {
      Column: {
        children: {
          explicitList: ['hint-row', 'hero-card', 'daily-card', 'today-card', 'service-card', 'selected-bar'],
        },
        alignment: 'stretch',
        styles: {
          width: '100%',
          maxWidth: 800,
          marginLeft: 'auto',
          marginRight: 'auto',
          minHeight: '100vh',
          padding: '12px 12px 20px 12px',
          gap: 12,
          boxSizing: 'border-box',
          backgroundColor: '#f0f2f5',
        },
      },
    },
  ],
  [
    'hint-row',
    {
      Row: {
        children: { explicitList: ['hint-text', 'cancel-btn'] },
        distribution: 'center',
        alignment: 'center',
        styles: {
          padding: '8px 12px',
          width: '100%',
          boxSizing: 'border-box',
          gap: 8,
          backgroundColor: '#ffffff',
          borderRadius: 10,
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'hint-text',
    {
      Text: {
        text: { path: '/ui/hintText' },
        usageHint: 'caption',
        styles: { color: '#94a3b8', fontSize: 12 },
      },
    },
  ],
  [
    'cancel-btn',
    {
      Button: {
        child: 'cancel-label',
        action: {
          name: 'cancelHint',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '已取消优先展示，正在展示默认城市天气' },
            },
          ],
        },
      },
    },
  ],
  [
    'cancel-label',
    {
      Text: { text: { literalString: '取消' }, usageHint: 'caption', styles: { color: '#3b82f6' } },
    },
  ],
  [
    'hero-card',
    {
      Card: {
        child: 'hero-col',
        styles: {
          width: '100%',
          minWidth: '100%',
          padding: 0,
          margin: 0,
          border: 0,
          borderRadius: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          backgroundColor: 'transparent',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'hero-col',
    {
      Column: {
        children: { explicitList: ['hero-top', 'hero-main', 'temp-tabs'] },
        alignment: 'stretch',
        styles: {
          width: '100%',
          boxSizing: 'border-box',
          background: 'linear-gradient(180deg,#3f8fd2 0%,#5fa6de 45%,#8dc0e8 100%)',
          backgroundColor: '#5fa6de',
          borderRadius: 16,
          overflow: 'hidden',
          padding: '14px 0 10px 0',
          gap: 10,
        },
      },
    },
  ],
  [
    'hero-top',
    {
      Row: {
        children: { explicitList: ['city-entry', 'update-btn'] },
        distribution: 'spaceBetween',
        alignment: 'center',
        styles: { width: '100%', boxSizing: 'border-box', padding: '0 16px' },
      },
    },
  ],
  [
    'city-entry',
    {
      Row: {
        children: { explicitList: ['city-label', 'city-caret'] },
        alignment: 'center',
        styles: { gap: 2 },
      },
    },
  ],
  [
    'city-label',
    { Text: { text: { path: '/weather/city' }, styles: { fontSize: 16, fontWeight: 500, color: '#ffffff' } } },
  ],
  [
    'city-caret',
    { Icon: { name: { literalString: 'CaretBottom' }, styles: { width: 14, height: 14, color: '#ffffff' } } },
  ],
  [
    'update-btn',
    {
      Button: {
        child: 'update-label',
        styles: { padding: 0, backgroundColor: 'transparent', border: 'none' },
        action: {
          name: 'refreshWeather',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/weather/updated', value: { literalString: '刚刚更新' } },
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '天气数据已刷新（刚刚更新）' },
            },
          ],
        },
      },
    },
  ],
  [
    'update-label',
    {
      Text: {
        text: { path: '/weather/updated' },
        usageHint: 'caption',
        styles: { color: '#ffffff', fontSize: 12, opacity: 0.9 },
      },
    },
  ],
  [
    'hero-main',
    {
      Row: {
        children: { explicitList: ['hero-temp', 'hero-info'] },
        alignment: 'start',
        styles: { gap: 14, width: '100%', boxSizing: 'border-box', padding: '0 16px' },
      },
    },
  ],
  [
    'hero-temp',
    {
      Text: {
        text: { path: '/weather/temp' },
        styles: { fontSize: 68, fontWeight: 200, lineHeight: 1, color: '#ffffff', letterSpacing: -2 },
      },
    },
  ],
  [
    'hero-info',
    {
      Column: {
        children: { explicitList: ['hero-info-row', 'hero-info-feels', 'hero-wind'] },
        alignment: 'start',
        styles: { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingTop: 4 },
      },
    },
  ],
  [
    'hero-info-row',
    {
      Row: {
        children: { explicitList: ['hero-range', 'hero-desc', 'aqi-badge'] },
        alignment: 'center',
        styles: { gap: 10 },
      },
    },
  ],
  [
    'hero-range',
    {
      Text: {
        text: { path: '/weather/range' },
        styles: { color: '#ffffff', fontSize: 15, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'hero-desc',
    {
      Text: {
        text: { path: '/weather/desc' },
        styles: { color: '#ffffff', fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'aqi-badge',
    {
      Text: {
        text: { path: '/weather/aqi' },
        styles: {
          backgroundColor: 'rgba(245,196,66,0.95)',
          color: '#ffffff',
          fontSize: 11,
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          lineHeight: '16px',
        },
      },
    },
  ],
  [
    'hero-info-feels',
    {
      Row: {
        children: { explicitList: ['feels-icon', 'hero-feels'] },
        alignment: 'center',
        styles: { gap: 4 },
      },
    },
  ],
  [
    'feels-icon',
    {
      Icon: {
        name: { literalString: 'Odometer' },
        styles: { width: 13, height: 13, color: '#eaf4ff', opacity: 0.85 },
      },
    },
  ],
  [
    'hero-feels',
    {
      Text: {
        text: { path: '/weather/feels' },
        usageHint: 'caption',
        styles: { color: '#eaf4ff', fontSize: 12, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'hero-wind',
    {
      Text: {
        text: { path: '/weather/wind' },
        usageHint: 'caption',
        styles: { color: '#eaf4ff', fontSize: 12, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'temp-tabs',
    {
      Tabs: {
        tabItems: [
          { title: { literalString: '气温' }, child: 'temp-list' },
          { title: { literalString: '风力' }, child: 'wind-list' },
          { title: { literalString: '降水量' }, child: 'rain-list' },
          { title: { literalString: '紫外线' }, child: 'uv-list' },
        ],
        styles: {
          width: '100%',
          padding: '0 10px',
          margin: 0,
          fontSize: '.14rem',
          lineHeight: '.32rem',
          backgroundColor: 'transparent',
          borderBottom: 'none',
          color: '#ffffff',
          activeColor: '#ffffff',
          inactiveColor: 'rgba(255,255,255,0.75)',
          '--el-color-primary': '#ffffff',
          '--el-text-color-primary': 'rgba(255,255,255,0.75)',
          '--el-text-color-regular': 'rgba(255,255,255,0.75)',
        },
      },
    },
  ],
  [
    'temp-list',
    {
      List: {
        children: { template: { componentId: 'temp-item', dataBinding: '/weather/hourly' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: { width: '100%', boxSizing: 'border-box', padding: '6px 8px 0 8px', backgroundColor: 'transparent' },
      },
    },
  ],
  [
    'temp-item',
    {
      Column: {
        children: { explicitList: ['temp-item-time', 'temp-item-icon', 'temp-item-val', 'temp-item-aqi'] },
        alignment: 'center',
        distribution: 'start',
        styles: {
          gap: 8,
          padding: '0',
          margin: '0',
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          backgroundColor: 'transparent',
          boxSizing: 'border-box',
        },
      },
    },
  ],
  [
    'temp-item-time',
    {
      Text: {
        text: { path: '/weather/hourly/item/time' },
        styles: { color: '#ffffff', fontSize: 13, opacity: 0.95, whiteSpace: 'nowrap', lineHeight: '18px' },
      },
    },
  ],
  [
    'temp-item-icon',
    {
      Icon: { name: { path: '/weather/hourly/item/icon' }, styles: { width: 22, height: 22, color: '#ffffff' } },
    },
  ],
  [
    'temp-item-val',
    {
      Text: {
        text: { path: '/weather/hourly/item/temp' },
        styles: { color: '#ffffff', fontWeight: 300, fontSize: 17, lineHeight: '22px', whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'temp-item-aqi',
    {
      Text: {
        text: { path: '/weather/hourly/item/aqi' },
        styles: {
          // 注意：快照里这里写的就是 `{"path": ...}`，而样式白名单只接受字面量，
          // 渲染时这个属性会被静默丢弃（见 weather.ts 顶部的已知问题清单）。
          backgroundColor: { path: '/weather/hourly/item/aqiColor' },
          color: '#ffffff',
          fontSize: 11,
          fontWeight: 500,
          padding: '1px 6px',
          borderRadius: 3,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          boxSizing: 'border-box',
        },
      },
    },
  ],
  [
    'wind-list',
    {
      List: {
        children: { template: { componentId: 'wind-item', dataBinding: '/weather/hourly' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: { width: '100%', boxSizing: 'border-box', padding: '6px 8px 0 8px', backgroundColor: 'transparent' },
      },
    },
  ],
  [
    'wind-item',
    {
      Column: {
        children: { explicitList: ['wind-item-time', 'wind-item-val'] },
        alignment: 'center',
        styles: {
          gap: 8,
          margin: '0',
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'wind-item-time',
    {
      Text: {
        text: { path: '/weather/hourly/item/time' },
        styles: { color: '#ffffff', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'wind-item-val',
    {
      Text: {
        text: { path: '/weather/hourly/item/wind' },
        styles: { color: '#ffffff', fontSize: 13, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'rain-list',
    {
      List: {
        children: { template: { componentId: 'rain-item', dataBinding: '/weather/hourly' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: { width: '100%', boxSizing: 'border-box', padding: '6px 8px 0 8px', backgroundColor: 'transparent' },
      },
    },
  ],
  [
    'rain-item',
    {
      Column: {
        children: { explicitList: ['rain-item-time', 'rain-item-val'] },
        alignment: 'center',
        styles: {
          gap: 8,
          margin: '0',
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'rain-item-time',
    {
      Text: {
        text: { path: '/weather/hourly/item/time' },
        styles: { color: '#ffffff', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'rain-item-val',
    {
      Text: {
        text: { path: '/weather/hourly/item/rain' },
        styles: { color: '#ffffff', fontSize: 13, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'uv-list',
    {
      List: {
        children: { template: { componentId: 'uv-item', dataBinding: '/weather/hourly' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: { width: '100%', boxSizing: 'border-box', padding: '6px 8px 0 8px', backgroundColor: 'transparent' },
      },
    },
  ],
  [
    'uv-item',
    {
      Column: {
        children: { explicitList: ['uv-item-time', 'uv-item-val'] },
        alignment: 'center',
        styles: {
          gap: 8,
          margin: '0',
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'uv-item-time',
    {
      Text: {
        text: { path: '/weather/hourly/item/time' },
        styles: { color: '#ffffff', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'uv-item-val',
    {
      Text: {
        text: { path: '/weather/hourly/item/uv' },
        styles: { color: '#ffffff', fontSize: 13, whiteSpace: 'nowrap' },
      },
    },
  ],
  [
    'daily-card',
    {
      Card: {
        child: 'daily-col',
        styles: {
          width: '100%',
          minWidth: '100%',
          padding: 0,
          border: '1px solid #eceff3',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'daily-col',
    {
      Column: {
        children: { explicitList: ['daily-title', 'daily-tabs'] },
        alignment: 'stretch',
        styles: {
          gap: 6,
          width: '100%',
          boxSizing: 'border-box',
          padding: '14px 18px 18px 18px',
          borderRadius: 12,
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'daily-title',
    {
      Text: {
        text: { literalString: '15天预报' },
        usageHint: 'h3',
        styles: { fontSize: 18, fontWeight: 600, color: '#1f2937' },
      },
    },
  ],
  [
    'daily-tabs',
    {
      Tabs: {
        tabItems: [
          { title: { literalString: '趋势' }, child: 'trend-list' },
          { title: { literalString: '列表' }, child: 'daily-list' },
        ],
        styles: { width: '100%' },
      },
    },
  ],
  [
    'trend-list',
    {
      List: {
        children: { template: { componentId: 'daily-item-card', dataBinding: '/weather/daily15' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: {
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
          gap: 4,
          boxSizing: 'border-box',
        },
      },
    },
  ],
  [
    'daily-item-card',
    {
      Card: {
        child: 'daily-item-col',
        styles: {
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          width: 'auto',
          padding: 0,
          borderRadius: 8,
          border: '1px solid #eceff3',
          boxShadow: 'none',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'daily-item-col',
    {
      Column: {
        children: {
          explicitList: ['d-day', 'd-date', 'd-icon', 'd-pop', 'd-high', 'd-low', 'd-wind', 'd-badge'],
        },
        alignment: 'center',
        styles: {
          gap: 4,
          padding: '8px 2px',
          width: '100%',
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-day',
    {
      Text: {
        text: { path: '/weather/daily15/item/day' },
        usageHint: 'caption',
        styles: {
          fontSize: 11,
          color: '#374151',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-date',
    {
      Text: {
        text: { path: '/weather/daily15/item/date' },
        usageHint: 'caption',
        styles: {
          color: '#b0b7c3',
          fontSize: 10,
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-icon',
    {
      Icon: {
        name: { path: '/weather/daily15/item/icon' },
        styles: { width: 18, height: 18, color: '#9aa4b2', flexShrink: 0 },
      },
    },
  ],
  [
    'd-pop',
    {
      Text: {
        text: { path: '/weather/daily15/item/pop' },
        usageHint: 'caption',
        styles: {
          fontSize: 10,
          color: '#5b9bd5',
          lineHeight: '14px',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-high',
    {
      Text: {
        text: { path: '/weather/daily15/item/high' },
        styles: {
          fontWeight: 500,
          fontSize: 13,
          color: '#1f2937',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-low',
    {
      Text: {
        text: { path: '/weather/daily15/item/low' },
        usageHint: 'caption',
        styles: {
          color: '#9aa4b2',
          fontSize: 12,
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'd-wind',
    {
      Text: {
        text: { path: '/weather/daily15/item/wind' },
        usageHint: 'caption',
        styles: {
          fontSize: 10,
          color: '#8b95a5',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      },
    },
  ],
  [
    'd-badge',
    {
      Text: {
        text: { path: '/weather/daily15/item/badge' },
        usageHint: 'caption',
        styles: {
          fontSize: 10,
          color: '#c99400',
          backgroundColor: '#fff8e1',
          padding: '0 4px',
          borderRadius: 3,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        },
      },
    },
  ],
  [
    'daily-list',
    {
      List: {
        children: { template: { componentId: 'daily-row', dataBinding: '/weather/daily15' } },
        direction: 'vertical',
        alignment: 'stretch',
        styles: { width: '100%' },
      },
    },
  ],
  [
    'daily-row',
    {
      Row: {
        children: { explicitList: ['dr-day', 'dr-date', 'dr-icon', 'dr-range', 'dr-badge'] },
        distribution: 'spaceBetween',
        alignment: 'center',
        styles: { padding: '6px 4px', width: '100%', boxSizing: 'border-box' },
      },
    },
  ],
  ['dr-day', { Text: { text: { path: '/weather/daily15/item/day' }, usageHint: 'body' } }],
  [
    'dr-date',
    {
      Text: {
        text: { path: '/weather/daily15/item/date' },
        usageHint: 'caption',
        styles: { color: '#94a3b8' },
      },
    },
  ],
  [
    'dr-icon',
    {
      Icon: {
        name: { path: '/weather/daily15/item/icon' },
        styles: { width: 20, height: 20, color: '#64748b' },
      },
    },
  ],
  ['dr-range', { Text: { text: { path: '/weather/daily15/item/range' }, usageHint: 'body' } }],
  [
    'dr-badge',
    {
      Text: {
        text: { path: '/weather/daily15/item/badge' },
        usageHint: 'caption',
        styles: {
          fontSize: 10,
          color: '#a16207',
          backgroundColor: '#fef3c7',
          padding: '0 4px',
          borderRadius: 3,
        },
      },
    },
  ],
  [
    'today-card',
    {
      Card: {
        child: 'today-col',
        styles: {
          width: '100%',
          minWidth: '100%',
          padding: 0,
          border: '1px solid #eceff3',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'today-col',
    {
      Column: {
        children: { explicitList: ['today-summary', 'today-stats', 'forecast-btn'] },
        alignment: 'stretch',
        styles: {
          gap: 16,
          width: '100%',
          boxSizing: 'border-box',
          padding: '16px 18px 18px 18px',
          borderRadius: 12,
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'today-summary',
    {
      Text: {
        text: { path: '/weather/summary' },
        usageHint: 'h3',
        styles: { fontSize: 17, fontWeight: 600, color: '#1f2937' },
      },
    },
  ],
  [
    'today-stats',
    {
      List: {
        children: { template: { componentId: 'today-stat-item', dataBinding: '/weather/todayStats' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: { width: '100%' },
      },
    },
  ],
  [
    'today-stat-item',
    {
      Column: {
        children: { explicitList: ['stat-label', 'stat-value'] },
        alignment: 'center',
        styles: { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0, padding: 0 },
      },
    },
  ],
  [
    'stat-label',
    {
      Text: {
        text: { path: '/weather/todayStats/item/label' },
        usageHint: 'caption',
        styles: { color: '#8b95a5', fontSize: 12 },
      },
    },
  ],
  [
    'stat-value',
    {
      Text: {
        text: { path: '/weather/todayStats/item/value' },
        styles: { fontWeight: 500, fontSize: 14 },
      },
    },
  ],
  [
    'forecast-btn',
    {
      Button: {
        child: 'forecast-label',
        styles: {
          width: '100%',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          backgroundColor: '#ffffff',
          padding: '8px 0',
        },
        action: {
          name: 'openForecast',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '正在查看40天预报' },
            },
          ],
        },
      },
    },
  ],
  [
    'forecast-label',
    {
      Text: {
        text: { literalString: '查看40天预报 ›' },
        usageHint: 'caption',
        styles: { color: '#5b9bd5', fontSize: 12, textAlign: 'center' },
      },
    },
  ],
  [
    'service-card',
    {
      Card: {
        child: 'service-body',
        styles: {
          width: '100%',
          minWidth: '100%',
          padding: 0,
          border: '1px solid #eceff3',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
        },
      },
    },
  ],
  [
    'service-body',
    {
      Column: {
        children: { explicitList: ['service-header', 'service-grid-1', 'service-grid-2'] },
        alignment: 'stretch',
        styles: {
          width: '100%',
          boxSizing: 'border-box',
          padding: '14px 16px 16px 16px',
          gap: 10,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#ffffff',
        },
      },
    },
  ],
  [
    'service-header',
    {
      Text: {
        text: { literalString: '生活服务' },
        usageHint: 'h3',
        styles: {
          width: '100%',
          padding: 0,
          fontSize: 17,
          fontWeight: 600,
          color: '#1f2937',
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'service-grid-1',
    {
      List: {
        children: { template: { componentId: 'service-tile-1', dataBinding: '/weather/services1' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: {
          width: '100%',
          padding: 0,
          gap: 8,
          boxSizing: 'border-box',
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'service-tile-1',
    {
      Button: {
        child: 'st1-col',
        action: {
          name: 'pickService',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/selectedService',
              // 取值对象按路径取当前行的 title，由渲染上下文的 read 求值（不是固定值）。
              value: { path: '/weather/services1/item/title' },
            },
          ],
        },
        styles: {
          flexGrow: 1,
          flexShrink: 0,
          minWidth: 0,
          padding: 0,
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'st1-col',
    {
      Column: {
        children: { explicitList: ['st1-icon', 'st1-title', 'st1-sub'] },
        alignment: 'center',
        styles: {
          gap: 8,
          padding: '12px 4px',
          width: '100%',
          boxSizing: 'border-box',
          backgroundColor: '#f6f7f9',
          borderRadius: 10,
        },
      },
    },
  ],
  [
    'st1-icon',
    {
      Icon: {
        name: { path: '/weather/services1/item/icon' },
        styles: { width: 22, height: 22, color: '#4b5563' },
      },
    },
  ],
  [
    'st1-title',
    {
      Text: {
        text: { path: '/weather/services1/item/title' },
        usageHint: 'body',
        styles: { fontSize: 13, fontWeight: 500, color: '#1f2937' },
      },
    },
  ],
  [
    'st1-sub',
    {
      Text: {
        text: { path: '/weather/services1/item/sub' },
        usageHint: 'caption',
        styles: { color: '#9aa4b2', fontSize: 12 },
      },
    },
  ],
  [
    'service-grid-2',
    {
      List: {
        children: { template: { componentId: 'service-tile-2', dataBinding: '/weather/services2' } },
        direction: 'horizontal',
        alignment: 'stretch',
        styles: {
          width: '100%',
          padding: 0,
          gap: 8,
          boxSizing: 'border-box',
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'service-tile-2',
    {
      Button: {
        child: 'st2-col',
        action: {
          name: 'pickService',
          type: 'local',
          local: [
            {
              type: 'updateDataModel',
              path: '/ui/selectedService',
              value: { path: '/weather/services2/item/title' },
            },
          ],
        },
        styles: {
          flexGrow: 1,
          flexShrink: 0,
          minWidth: 0,
          padding: 0,
          backgroundColor: 'transparent',
        },
      },
    },
  ],
  [
    'st2-col',
    {
      Column: {
        children: { explicitList: ['st2-icon', 'st2-title', 'st2-sub'] },
        alignment: 'center',
        styles: {
          gap: 8,
          padding: '12px 4px',
          width: '100%',
          boxSizing: 'border-box',
          backgroundColor: '#f6f7f9',
          borderRadius: 10,
        },
      },
    },
  ],
  [
    'st2-icon',
    {
      Icon: {
        name: { path: '/weather/services2/item/icon' },
        styles: { width: 22, height: 22, color: '#334155' },
      },
    },
  ],
  [
    'st2-title',
    {
      Text: {
        text: { path: '/weather/services2/item/title' },
        usageHint: 'body',
        styles: { fontSize: 13, fontWeight: 500 },
      },
    },
  ],
  [
    'st2-sub',
    {
      Text: {
        text: { path: '/weather/services2/item/sub' },
        usageHint: 'caption',
        styles: { color: '#94a3b8' },
      },
    },
  ],
  [
    'selected-bar',
    {
      Text: {
        text: { path: '/ui/selectedService' },
        usageHint: 'caption',
        styles: {
          width: '100%',
          boxSizing: 'border-box',
          textAlign: 'center',
          padding: 8,
          backgroundColor: '#ffffff',
          borderRadius: 10,
          color: '#8b95a5',
          fontSize: 12,
        },
      },
    },
  ],
];

/**
 * 快照里登记了、但**没有任何节点引用**的组件（25 个）。
 *
 * 原样保留，是为了让重建结果与快照逐节点等价 —— 它们在协议里是合法的（只是挂在
 * hydrateNodeMap 上），但永远不会出现在树上，因此**看不到、也点不到**。分成三组：
 *
 * 1. 两组 Modal（城市选择、40 天预报）：组件本身能渲染，只是 `city-modal` / `forecast-modal`
 *    没被任何 `explicitList` 引用，所以入口按钮点了只改提示文案，不弹面板。
 * 2. `temp-tabs-wrap`：它引用了一个**根本不存在**的 `temp-tab-bar`（悬空引用，core 静默跳过）。
 * 3. 其余：重复写法（`hero-info-row2`）与八条分隔线/小圆点（`*-item-line` / `*-item-dot`）。
 */
export const WEATHER_ORPHAN_COMPONENTS: Array<[string, unknown]> = [
  ['city-modal', { Modal: { entryPointChild: 'city-entry', contentChild: 'city-panel' } }],
  [
    'city-panel',
    {
      Column: {
        children: {
          explicitList: [
            'city-panel-title',
            'city-opt-wuhan',
            'city-opt-beijing',
            'city-opt-shanghai',
            'city-opt-guangzhou',
          ],
        },
        styles: { gap: 8, padding: 8 },
      },
    },
  ],
  ['city-panel-title', { Text: { text: { literalString: '选择城市' }, usageHint: 'h4' } }],
  [
    'city-opt-wuhan',
    {
      Button: {
        child: 'city-opt-wuhan-label',
        action: {
          name: 'pickCity',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/weather/city', value: { literalString: '武汉' } },
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '已切换城市：武汉' },
            },
          ],
        },
      },
    },
  ],
  ['city-opt-wuhan-label', { Text: { text: { literalString: '武汉' } } }],
  [
    'city-opt-beijing',
    {
      Button: {
        child: 'city-opt-beijing-label',
        action: {
          name: 'pickCity',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/weather/city', value: { literalString: '北京' } },
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '已切换城市：北京' },
            },
          ],
        },
      },
    },
  ],
  ['city-opt-beijing-label', { Text: { text: { literalString: '北京' } } }],
  [
    'city-opt-shanghai',
    {
      Button: {
        child: 'city-opt-shanghai-label',
        action: {
          name: 'pickCity',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/weather/city', value: { literalString: '上海' } },
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '已切换城市：上海' },
            },
          ],
        },
      },
    },
  ],
  ['city-opt-shanghai-label', { Text: { text: { literalString: '上海' } } }],
  [
    'city-opt-guangzhou',
    {
      Button: {
        child: 'city-opt-guangzhou-label',
        action: {
          name: 'pickCity',
          type: 'local',
          local: [
            { type: 'updateDataModel', path: '/weather/city', value: { literalString: '广州' } },
            {
              type: 'updateDataModel',
              path: '/ui/hintText',
              value: { literalString: '已切换城市：广州' },
            },
          ],
        },
      },
    },
  ],
  ['city-opt-guangzhou-label', { Text: { text: { literalString: '广州' } } }],
  ['forecast-modal', { Modal: { entryPointChild: 'forecast-btn', contentChild: 'forecast-panel' } }],
  [
    'forecast-panel',
    {
      Column: {
        children: { explicitList: ['fp-title', 'fp-text'] },
        styles: { gap: 8, padding: 8 },
      },
    },
  ],
  ['fp-title', { Text: { text: { literalString: '40天预报' }, usageHint: 'h4' } }],
  [
    'fp-text',
    {
      Text: {
        text: {
          literalString: '未来40天以多云为主，气温逐步下降，11月中旬有一次明显降温过程。',
        },
        usageHint: 'body',
      },
    },
  ],
  [
    // 引用了一个不存在的 temp-tab-bar —— 保留原样，悬空引用会被 core 静默跳过。
    'temp-tabs-wrap',
    {
      Column: {
        children: { explicitList: ['temp-tab-bar', 'temp-tabs'] },
        alignment: 'stretch',
        styles: { width: '100%', backgroundColor: 'transparent', gap: 10, padding: 0 },
      },
    },
  ],
  [
    'hero-info-row2',
    {
      Row: {
        children: { explicitList: ['feels-icon', 'hero-feels', 'hero-wind'] },
        alignment: 'center',
        styles: { gap: 8 },
      },
    },
  ],
  [
    'temp-item-line',
    {
      Divider: {
        axis: 'horizontal',
        styles: {
          width: '100%',
          borderColor: 'rgba(255,255,255,0.55)',
          margin: '0',
          borderTop: '1px solid rgba(255,255,255,0.55)',
        },
      },
    },
  ],
  [
    'temp-item-dot',
    {
      Text: {
        text: { literalString: '○' },
        styles: {
          color: 'rgba(255,255,255,0.85)',
          fontSize: 8,
          lineHeight: '8px',
          marginTop: -4,
          opacity: 1,
        },
      },
    },
  ],
  [
    'wind-item-line',
    {
      Divider: {
        axis: 'horizontal',
        styles: {
          width: '100%',
          borderColor: 'rgba(255,255,255,0.55)',
          margin: '0',
          borderTop: '1px solid rgba(255,255,255,0.55)',
        },
      },
    },
  ],
  [
    'wind-item-dot',
    {
      Text: {
        text: { literalString: '○' },
        styles: {
          color: 'rgba(255,255,255,0.85)',
          fontSize: 8,
          lineHeight: '8px',
          marginTop: -4,
        },
      },
    },
  ],
  [
    'rain-item-line',
    {
      Divider: {
        axis: 'horizontal',
        styles: {
          width: '100%',
          borderColor: 'rgba(255,255,255,0.55)',
          margin: '0',
          borderTop: '1px solid rgba(255,255,255,0.55)',
        },
      },
    },
  ],
  [
    'rain-item-dot',
    {
      Text: {
        text: { literalString: '○' },
        styles: {
          color: 'rgba(255,255,255,0.85)',
          fontSize: 8,
          lineHeight: '8px',
          marginTop: -4,
        },
      },
    },
  ],
  [
    'uv-item-line',
    {
      Divider: {
        axis: 'horizontal',
        styles: {
          width: '100%',
          borderColor: 'rgba(255,255,255,0.55)',
          margin: '0',
          borderTop: '1px solid rgba(255,255,255,0.55)',
        },
      },
    },
  ],
  [
    'uv-item-dot',
    {
      Text: {
        text: { literalString: '○' },
        styles: {
          color: 'rgba(255,255,255,0.85)',
          fontSize: 8,
          lineHeight: '8px',
          marginTop: -4,
        },
      },
    },
  ],
];

/** 数据模型：与快照的 `dataModelMap.surface-0e80513a` 一致。 */
export const WEATHER_DATA_MODEL: unknown = {
  ui: {
    hintText: '正在查看40天预报',
    selectedService: '点击下方生活服务卡片查看今日建议',
  },
  weather: {
    city: '武汉',
    updated: '15:25更新',
    temp: '19°',
    descRange: '15~20°C 多云',
    aqi: '54 良',
    feels: '体感19°',
    summary: '阴转多云 15~20°C',
    hourly: {
      h0: {
        time: '现在',
        temp: '19°',
        icon: 'Sunny',
        wind: '东南风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
      h1: {
        time: '16:00',
        temp: '20°',
        icon: 'Cloudy',
        wind: '东南风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '优',
        aqiColor: 'rgba(92,190,72,0.9)',
      },
      h2: {
        time: '17:00',
        temp: '20°',
        icon: 'Cloudy',
        wind: '东风2级',
        rain: '0%',
        uv: '弱',
        aqi: '优',
        aqiColor: 'rgba(92,190,72,0.9)',
      },
      h3: {
        time: '18:00',
        temp: '19°',
        icon: 'MostlyCloudy',
        wind: '东风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '优',
        aqiColor: 'rgba(92,190,72,0.9)',
      },
      h4: {
        time: '19:00',
        temp: '17°',
        icon: 'MostlyCloudy',
        wind: '东北风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
      h5: {
        time: '20:00',
        temp: '16°',
        icon: 'MostlyCloudy',
        wind: '东北风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
      h6: {
        time: '21:00',
        temp: '16°',
        icon: 'MostlyCloudy',
        wind: '北风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
      h7: {
        time: '22:00',
        temp: '16°',
        icon: 'MostlyCloudy',
        wind: '北风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
      h8: {
        time: '23:00',
        temp: '15°',
        icon: 'MostlyCloudy',
        wind: '北风2级',
        rain: '0%',
        uv: '最弱',
        aqi: '良',
        aqiColor: 'rgba(228,167,36,0.9)',
      },
    },
    daily15: {
      d1: {
        day: '昨天',
        date: '10/27',
        icon: 'Cloudy',
        high: '21°',
        low: '15°',
        range: '21° / 15°',
        wind: '东北风 3级',
        badge: '良',
        pop: '',
        today: false,
      },
      d2: {
        day: '今天',
        date: '10/28',
        icon: 'Cloudy',
        high: '20°',
        low: '15°',
        range: '20° / 15°',
        wind: '东南风 2级',
        badge: '良',
        pop: '',
        today: true,
      },
      d3: {
        day: '明天',
        date: '10/29',
        icon: 'Pouring',
        high: '20°',
        low: '11°',
        range: '20° / 11°',
        wind: '西北风 2级',
        badge: '良',
        pop: '80%',
        today: false,
      },
      d4: {
        day: '周三',
        date: '10/30',
        icon: 'PartlyCloudy',
        high: '24°',
        low: '12°',
        range: '24° / 12°',
        wind: '东风 1级',
        badge: '良',
        pop: '',
        today: false,
      },
      d5: {
        day: '周六',
        date: '10/31',
        icon: 'Drizzling',
        high: '26°',
        low: '17°',
        range: '26° / 17°',
        wind: '东南风 3级',
        badge: '良',
        pop: '70%',
        today: false,
      },
      d6: {
        day: '周日',
        date: '11/01',
        icon: 'MostlyCloudy',
        high: '18°',
        low: '14°',
        range: '18° / 14°',
        wind: '北风 3级',
        badge: '良',
        pop: '',
        today: false,
      },
      d7: {
        day: '周一',
        date: '11/02',
        icon: 'Pouring',
        high: '23°',
        low: '14°',
        range: '23° / 14°',
        wind: '东北风 2级',
        badge: '良',
        pop: '90%',
        today: false,
      },
      d8: {
        day: '周二',
        date: '11/03',
        icon: 'Cloudy',
        high: '17°',
        low: '13°',
        range: '17° / 13°',
        wind: '东北风 2级',
        badge: '良',
        pop: '60%',
        today: false,
      },
    },
    todayStats: {
      s1: { label: '湿度', value: '68%' },
      s2: { label: '紫外线', value: '最弱' },
      s3: { label: '日出', value: '06:34' },
      s4: { label: '日落', value: '17:39' },
      s5: { label: '气压', value: '1019hPa' },
    },
    services1: {
      a1: { icon: 'ShoppingBag', title: '外套类', sub: '穿衣' },
      a2: { icon: 'Soccer', title: '适宜', sub: '运动' },
      a3: { icon: 'Sunny', title: '最弱', sub: '紫外线' },
      a4: { icon: 'Suitcase', title: '较适宜', sub: '旅游' },
      a5: { icon: 'MagicStick', title: '控油', sub: '化妆' },
    },
    services2: {
      b1: { icon: 'Ship', title: '不太适宜', sub: '钓鱼' },
      b2: { icon: 'Umbrella', title: '易发', sub: '感冒' },
      b3: { icon: 'Brush', title: '不宜', sub: '洗车' },
      b4: { icon: 'Calendar', title: '今日宜忌', sub: '万年历' },
      b5: { icon: 'Star', title: '今日运势', sub: '星座' },
    },
    range: '15~20°C',
    desc: '多云',
    wind: '东南风2级',
  },
};
