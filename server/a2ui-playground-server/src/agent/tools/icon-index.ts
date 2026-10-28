/**
 * Element Plus 图标索引：图标名清单 + 中文概念别名 + 搜索。
 *
 * 存在的意义：**不让 agent 把 293 个图标名背进 prompt**。系统提示里只留一句
 * 「用 Element Plus 导出名，不确定就先调 searchIcons」，具体名字由模型按需查询 ——
 * 不涉及图标的请求因此完全不付这份上下文的钱。
 *
 * 名字清单的唯一来源是 `@element-plus/icons-vue` 的导出键（运行时读取，不复制一份
 * 手抄清单 —— 那样升级图标库就会漂）。懒加载：只有真建图标工具时才读，启动路径不付成本。
 */
import type * as ElementPlusIconsModule from '@element-plus/icons-vue';

let cachedNames: string[] | undefined;

/** 全部图标名（PascalCase，排序）。 */
export const iconNames = (): string[] => {
  if (cachedNames === undefined) {
    // 图标包同时发 ESM/CJS；服务端是 CommonJS，走 require 直接拿 CJS 产物。
    // 过滤掉 default / 内部标记，剩下的就是图标组件名。
    const mod = require('@element-plus/icons-vue') as Record<string, unknown>;
    cachedNames = Object.keys(mod)
      .filter((key) => key !== 'default' && !key.startsWith('__'))
      .sort();
  }
  return cachedNames;
};

/** 仅供类型文档：本模块只用到该包的导出键，不引用具体组件。 */
export type ElementPlusIcons = typeof ElementPlusIconsModule;

/**
 * 中文概念 → 图标名。值里的名字都来自 `@element-plus/icons-vue` 真实导出
 * （写之前逐个核对过；没有对应图标的概念——如「飞机」「心形」——刻意不收，
 * 搜索不到时模型会自己换一个，比给个似是而非的名字好）。
 */
const ICON_ALIASES: Record<string, string[]> = {
  搜索: ['Search'],
  查找: ['Search', 'ZoomIn'],
  放大镜: ['Search'],
  设置: ['Setting', 'SetUp', 'Tools'],
  配置: ['Setting', 'SetUp'],
  工具: ['Tools', 'MagicStick'],
  首页: ['HomeFilled'],
  主页: ['HomeFilled', 'House'],
  房子: ['House'],
  用户: ['User', 'UserFilled', 'Avatar'],
  我的: ['UserFilled'],
  账户: ['User'],
  头像: ['Avatar'],
  添加: ['Plus', 'CirclePlus'],
  新增: ['Plus', 'CirclePlus'],
  删除: ['Delete', 'DeleteFilled', 'Remove'],
  移除: ['Remove', 'Delete'],
  编辑: ['EditPen', 'Edit'],
  修改: ['EditPen', 'Edit'],
  文档: ['Document', 'Files', 'Folder'],
  文件: ['Files', 'Folder', 'Document'],
  文件夹: ['Folder', 'FolderOpened'],
  图片: ['Picture', 'PictureRounded'],
  照片: ['Picture', 'Camera'],
  相册: ['PictureRounded'],
  相机: ['Camera', 'CameraFilled'],
  视频: ['VideoCamera', 'VideoPlay', 'Film'],
  播放: ['VideoPlay'],
  暂停: ['VideoPause'],
  影片: ['Film'],
  音频: ['Microphone', 'Headset'],
  麦克风: ['Microphone', 'Mic'],
  耳机: ['Headset'],
  静音: ['Mute'],
  消息: ['Message', 'ChatDotRound', 'ChatLineRound'],
  聊天: ['ChatDotRound', 'ChatLineRound', 'ChatRound'],
  对话: ['ChatDotSquare', 'ChatLineSquare'],
  评论: ['Comment'],
  通知: ['Bell', 'BellFilled', 'Notification'],
  铃铛: ['Bell'],
  提醒: ['AlarmClock', 'Bell'],
  闹钟: ['AlarmClock'],
  购物车: ['ShoppingCart', 'ShoppingTrolley', 'ShoppingCartFull'],
  商品: ['Goods', 'GoodsFilled'],
  货物: ['Goods'],
  商店: ['Shop'],
  售卖: ['Sell', 'SoldOut'],
  收藏: ['Star', 'StarFilled'],
  星星: ['Star'],
  标签: ['PriceTag', 'CollectionTag'],
  优惠: ['Discount'],
  折扣: ['Discount'],
  钱包: ['Wallet', 'WalletFilled'],
  金钱: ['Money', 'Coin'],
  支付: ['CreditCard', 'Money'],
  银行卡: ['CreditCard'],
  日历: ['Calendar'],
  日期: ['Calendar'],
  时钟: ['Clock'],
  时间: ['Clock', 'Timer'],
  计时: ['Timer', 'Stopwatch'],
  秒表: ['Stopwatch'],
  手表: ['Watch'],
  位置: ['Location', 'LocationFilled'],
  定位: ['LocationInformation', 'MapLocation', 'Position'],
  地图: ['MapLocation', 'Location'],
  导航: ['Position', 'Compass'],
  地址: ['LocationInformation'],
  电话: ['Phone', 'PhoneFilled'],
  手机: ['Cellphone', 'Iphone'],
  邮件: ['Message', 'Promotion'],
  邮箱: ['Message'],
  对勾: ['Check', 'Select'],
  成功: ['SuccessFilled', 'CircleCheckFilled'],
  完成: ['Finished', 'CircleCheck'],
  关闭: ['Close', 'CircleClose'],
  取消: ['CircleClose', 'CloseBold'],
  错误: ['CircleCloseFilled', 'Failed'],
  失败: ['Failed'],
  警告: ['Warning', 'WarningFilled', 'WarnTriangleFilled'],
  提示: ['InfoFilled', 'QuestionFilled'],
  帮助: ['Help', 'HelpFilled'],
  信息: ['InfoFilled'],
  加载: ['Loading'],
  刷新: ['Refresh', 'RefreshRight'],
  全屏: ['FullScreen'],
  隐藏: ['Hide'],
  显示: ['View'],
  查看: ['View', 'ZoomIn'],
  排序: ['Sort', 'SortUp', 'SortDown'],
  筛选: ['Filter'],
  过滤: ['Filter'],
  列表: ['List'],
  网格: ['Grid'],
  菜单: ['Menu'],
  更多: ['More', 'MoreFilled'],
  复制: ['CopyDocument'],
  下载: ['Download'],
  上传: ['Upload', 'UploadFilled'],
  分享: ['Share'],
  链接: ['Link'],
  锁: ['Lock'],
  解锁: ['Unlock'],
  安全: ['Lock'],
  打印: ['Printer'],
  男性: ['Male'],
  女性: ['Female'],
  学校: ['School'],
  教育: ['Reading', 'Notebook'],
  学习: ['Reading', 'Notebook'],
  办公: ['OfficeBuilding', 'Briefcase'],
  工作: ['Briefcase', 'Suitcase'],
  数据: ['DataAnalysis', 'DataBoard', 'DataLine'],
  图表: ['TrendCharts', 'Histogram', 'PieChart'],
  统计: ['Histogram', 'DataAnalysis'],
  报表: ['DataBoard', 'TrendCharts'],
  趋势: ['TrendCharts'],
  奖杯: ['Trophy', 'TrophyBase'],
  奖励: ['Medal', 'GoldMedal'],
  排名: ['Rank'],
  食物: ['Food', 'Burger'],
  餐饮: ['ForkSpoon', 'KnifeFork'],
  咖啡: ['Coffee', 'CoffeeCup'],
  奶茶: ['MilkTea'],
  天气: ['Sunny', 'Cloudy'],
  晴: ['Sunny'],
  多云: ['Cloudy', 'MostlyCloudy', 'PartlyCloudy'],
  云: ['Cloudy', 'MostlyCloudy', 'PartlyCloudy'],
  阴: ['Cloudy'],
  雨: ['Drizzling', 'Pouring'],
  小雨: ['Drizzling'],
  大雨: ['Pouring'],
  月亮: ['Moon', 'MoonNight'],
  睡眠: ['MoonNight', 'Moon'],
  太阳: ['Sunny', 'Sunrise', 'Sunset'],
  风: ['WindPower'],
  伞: ['Umbrella'],
  闪电: ['Lightning'],
  运动: ['Soccer', 'Football', 'Baseball'],
  健身: ['Basketball', 'Soccer'],
  篮球: ['Basketball'],
  足球: ['Soccer', 'Football'],
  医疗: ['FirstAidKit'],
  急救: ['FirstAidKit'],
  禁止: ['NoSmoking'],
  开关: ['Switch', 'SwitchButton', 'SwitchFilled'],
  电器: ['Monitor', 'Cpu'],
  设备: ['Cpu', 'Monitor'],
  插件: ['Connection', 'MagicStick'],
  附件: ['Paperclip'],
  放大: ['ZoomIn'],
  缩小: ['ZoomOut'],
  裁剪: ['Crop'],
  返回: ['Back', 'ArrowLeft'],
  前进: ['Right', 'ArrowRight'],
  上: ['ArrowUp', 'Top'],
  下: ['ArrowDown', 'Bottom'],
  左: ['ArrowLeft'],
  右: ['ArrowRight'],
  展开: ['Expand'],
  火车: ['Train'],
  汽车: ['Van'],
  自行车: ['Bicycle'],
  快递: ['Van', 'Box'],
  礼物: ['Present'],
  票: ['Ticket', 'Tickets'],
  票据: ['Ticket', 'Stamp'],
  酒店: ['House', 'OfficeBuilding'],
  建筑: ['OfficeBuilding'],
  团队: ['User', 'Management'],
  管理: ['Management', 'SetUp'],
  客服: ['Service', 'Headset'],
  服务: ['Service'],
  反馈: ['Comment', 'EditPen'],
  意见: ['ChatDotSquare', 'Comment'],
  屏幕: ['Monitor'],
  电脑: ['Monitor', 'Cpu'],
  鼠标: ['Mouse'],
  网络: ['Connection', 'Link'],
  信号: ['Connection'],
};

/**
 * 反查表：图标名 → 概念词。搜索时按「这个名字有哪些概念」取，不必每次遍历整张表
 * （293 个名字 × 每次查询都过一遍 213 条别名，纯浪费）。
 */
const ICON_ALIAS_TERMS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [term, names] of Object.entries(ICON_ALIASES)) {
    for (const name of names) {
      const terms = map.get(name);
      if (terms === undefined) {
        map.set(name, [term]);
      } else {
        terms.push(term);
      }
    }
  }
  return map;
})();

const normalize = (text: string): string => text.toLowerCase().replace(/[\s_-]+/g, '');

export interface IconSearchResult {
  query: string;
  /** 实际返回的条数（受 limit 截断）。 */
  total: number;
  icons: string[];
}

/**
 * 把查询拆成若干个「概念」。
 *
 * 模型不会只问一个词 —— 它会写 `天气 晴 云`、`水 风 太阳`、`sunny cloud`。只按整串
 * 匹配会让这类查询**全部落空**，而落空之后模型会转去 `listIcons` 逐个字母翻 293 个
 * 图标名，把工具轮数烧光（线上 `AGENT_ERROR：工具调用连续 4 轮` 就是这条链路）。
 */
const splitQuery = (query: string): string[] =>
  query
    .split(/[\s,，、+|\/]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');

/** 单个词对某个图标名的打分。整串与分词共用这一套规则，避免两处漂移。 */
const scoreToken = (
  name: string,
  lowerName: string,
  flatName: string,
  token: string,
): number => {
  const lower = token.toLowerCase();
  const flat = normalize(token);

  let score = 0;
  if (lowerName === lower) {
    score = 1000;
  } else if (flatName === flat) {
    score = 950;
  } else if (lowerName.startsWith(lower)) {
    score = 700;
  } else if (lowerName.includes(lower)) {
    score = 500;
  } else if (flatName.startsWith(flat)) {
    score = 420;
  } else if (flatName.includes(flat)) {
    score = 300;
  }

  if (score < 900) {
    // 别名整词命中（「购物车」）压过任何子串命中；别名被查询包含（「购物」）次之。
    for (const term of ICON_ALIAS_TERMS.get(name) ?? []) {
      if (term === token) {
        score = Math.max(score, 900);
      } else if (token.length >= 2 && term.includes(token)) {
        score = Math.max(score, 600);
      }
    }
  }

  return score;
};

/** 多词命中同一个图标的加成：能同时答上两个概念的，排在只答上一个的前面。 */
const MULTI_TOKEN_BONUS = 120;

/**
 * 搜索图标名。中文概念走别名表，英文走名字子串，两者都支持；**查询可以含多个概念**，
 * 用空格 / 逗号 / 顿号 / 加号 / 竖线分隔即可（`天气 晴`、`cart, user`）。
 *
 * 打分只追求一个性质：**越"就是它"排越前**。精确 > 别名精确 > 前缀 > 包含，
 * 同分按字母序（稳定输出，便于测试与人工核对）。
 */
export const searchIcons = (query: string, limit = 12): IconSearchResult => {
  const trimmed = query.trim();
  const tokens = splitQuery(trimmed);
  if (trimmed === '' || tokens.length === 0) {
    return { query: trimmed, total: 0, icons: [] };
  }

  const cap = Math.min(Math.max(Math.trunc(limit) || 12, 1), 30);
  const single = tokens.length === 1;
  const scored: Array<{ name: string; score: number }> = [];

  for (const name of iconNames()) {
    const lowerName = name.toLowerCase();
    const flatName = normalize(name);

    let score = 0;
    if (single) {
      // 单词查询与改造前逐字节等价：整串就是一个词。
      score = scoreToken(name, lowerName, flatName, trimmed);
    } else {
      // 多词：逐个概念打分取最高，再按「答上了几个概念」加一点权重。
      let best = 0;
      let matched = 0;
      for (const token of tokens) {
        const tokenScore = scoreToken(name, lowerName, flatName, token);
        if (tokenScore > 0) {
          matched += 1;
          if (tokenScore > best) {
            best = tokenScore;
          }
        }
      }
      score = matched === 0 ? 0 : best + (matched - 1) * MULTI_TOKEN_BONUS;
    }

    if (score > 0) {
      scored.push({ name, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const icons = scored.slice(0, cap).map((item) => item.name);
  return { query: trimmed, total: icons.length, icons };
};

/** 按首字母浏览图标（不传则返回全部，受 limit 截断）。 */
export const listIcons = (letter?: string, limit = 60): string[] => {
  const cap = Math.min(Math.max(Math.trunc(limit) || 60, 1), 300);
  const head = letter?.trim().toLowerCase() ?? '';
  return iconNames()
    .filter((name) => head === '' || name.toLowerCase().startsWith(head))
    .slice(0, cap);
};

export interface IconLookup {
  name: string;
  exists: boolean;
  /** 命中时给出库里的规范名（大小写/分隔符差异会被纠正）。 */
  canonical?: string;
  /** 未命中时的近似候选。 */
  suggestions: string[];
};

/** 校验一个图标名是否存在；大小写与 snake/kebab/camel 差异都算命中并给出规范名。 */
export const getIcon = (name: string): IconLookup => {
  const trimmed = name.trim();
  const names = iconNames();

  const exact = names.find((item) => item === trimmed);
  if (exact !== undefined) {
    return { name: trimmed, exists: true, canonical: exact, suggestions: [] };
  }

  const flat = normalize(trimmed);
  const loose = names.find((item) => normalize(item) === flat);
  if (loose !== undefined) {
    return { name: trimmed, exists: true, canonical: loose, suggestions: [] };
  }

  return { name: trimmed, exists: false, suggestions: searchIcons(trimmed, 3).icons };
};
