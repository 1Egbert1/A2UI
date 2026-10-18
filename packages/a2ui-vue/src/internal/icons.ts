/**
 * 图标名解析：**Element Plus 图标库优先**，内置 emoji 表兜底。
 *
 * 背景：模型生成的 `Icon.name` 现在是 Element Plus 图标库的导出名（PascalCase，
 * 如 `Search` / `HomeFilled` / `ShoppingCart`）—— 名字由 agent 经 MCP 工具按需查询
 * （见服务端 `src/agent/tools/`），不靠 prompt 背清单。
 *
 * 这里负责「名字 → 真实图标」的最后一跳，按序尝试：
 *   1. 精确命中（PascalCase 原名）；
 *   2. 规范化后命中（`search` / `home_filled` / `homeFilled` → `Search` / `HomeFilled`）；
 *   3. 内置 emoji 表（`lookupGlyph`，兼容早期 mock 场景里的旧名字）；
 *   4. 占位符 ▢。
 *
 * 第 3 步是过渡期的安全网：老场景/老输出里的名字（`home`、`cloud`、`flight_takeoff`…）
 * 仍能显示，不会因为换图标库而集体变 ▢。
 */
import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { Component } from 'vue';
import { lookupGlyph } from './styles';

const EP_ICONS = ElementPlusIcons as Record<string, unknown>;

/** 任意分隔符/驼峰风格 → PascalCase（`home_filled`、`homeFilled` → `HomeFilled`）。 */
const toPascalCase = (name: string): string =>
  name
    .replace(/[_\-\s]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');

/** 解析图标名 → Element Plus 组件；解析不到返回 null（调用方回退 emoji 表）。 */
export const resolveIconComponent = (name: string): Component | null => {
  if (name === '') {
    return null;
  }
  const direct = EP_ICONS[name];
  if (direct !== undefined) {
    return direct as Component;
  }
  const pascal = toPascalCase(name);
  if (pascal !== name) {
    const normalized = EP_ICONS[pascal];
    if (normalized !== undefined) {
      return normalized as Component;
    }
  }
  return null;
};

/**
 * 图标的最终内容：Element Plus 组件优先，其次内置 emoji，最后占位符。
 *
 * EP 组件的根元素是不带尺寸的 `<svg>`（靠宿主 `el-icon` 才有 1em），
 * 所以渲染时必须显式传尺寸 —— 见 `renderIcon` 里的 `ICON_COMPONENT_STYLE`。
 */
export const iconContentOf = (name: string): Component | string =>
  resolveIconComponent(name) ?? lookupGlyph(name);
