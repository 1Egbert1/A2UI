import { h, type CSSProperties } from 'vue';
import { readString, type ComponentRenderer } from 'a2ui-core';

import { type VueNode } from '../internal/node';
import { iconContentOf } from '../internal/icons';
import {
  ICON_STYLE,
  imageStyleOf,
  tagOfText,
  textStyleOf,
} from '../internal/styles';

/**
 * 「叶子」组件：自身不引用其它组件，只由属性 + 数据模型决定渲染结果。
 * 类型与属性定义见 specification/v0_8/json/standard_catalog_definition.json。
 */

/** Text：usageHint 决定标签与字号，内容来自 `text.literalString` 或 `text.path`。 */
export const renderText: ComponentRenderer<VueNode> = (props, context) => {
  const tag = tagOfText(props.usageHint);
  return h(tag, { style: textStyleOf(props.usageHint) }, readString(props.text, context.read));
};

/** Image：usageHint 决定尺寸（icon/avatar/smallFeature/…），fit 直接映射 object-fit。 */
export const renderImage: ComponentRenderer<VueNode> = (props, context) =>
  h('img', {
    src: readString(props.url, context.read),
    alt: '',
    loading: 'lazy',
    style: imageStyleOf(props.usageHint, props.fit),
  });

/**
 * EP 图标组件的样式：根 `<svg>` 不自带尺寸（官方用法靠 `el-icon` 包裹才有 1em），
 * 这里显式补上。`1em` 相对 svg 自身的 font-size（继承 ICON_STYLE 的 1.25rem），
 * 所以改 ICON_STYLE.fontSize 就能整体缩放。
 */
const ICON_COMPONENT_STYLE: CSSProperties = {
  ...ICON_STYLE,
  width: '1em',
  height: '1em',
};

/** Icon：Element Plus 图标库组件优先（名字规范化匹配），内置 emoji 表兜底，最后占位符。 */
export const renderIcon: ComponentRenderer<VueNode> = (props, context) => {
  const name = readString(props.name, context.read);
  const content = iconContentOf(name);

  // 内置字符表：等宽 span（与旧行为一致）。
  if (typeof content === 'string') {
    return h(
      'span',
      { style: ICON_STYLE, title: name, role: 'img', 'aria-label': name },
      content,
    );
  }

  // Element Plus 组件：style / title / aria-label 作为 attrs 透传到根 svg
  // （组件 inheritAttrs 默认开启；fill:currentColor 让图标跟随文字颜色）。
  return h(content, {
    style: ICON_COMPONENT_STYLE,
    title: name,
    role: 'img',
    'aria-label': name,
  });
};

/** Video：原生 video 元素，浏览器自带控制条。 */
export const renderVideo: ComponentRenderer<VueNode> = (props, context) =>
  h('video', {
    src: readString(props.url, context.read),
    controls: true,
    preload: 'metadata',
    style: { display: 'block', maxWidth: '100%', borderRadius: '6px' },
  });

/** AudioPlayer：原生 audio 元素，description 作为标题显示在播放器上方。 */
export const renderAudioPlayer: ComponentRenderer<VueNode> = (props, context) => {
  const description = readString(props.description, context.read);

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
    description
      ? h('div', { style: { fontSize: '0.8rem', color: '#6b7280' } }, description)
      : null,
    h('audio', {
      src: readString(props.url, context.read),
      controls: true,
      style: { width: '100%' },
    }),
  ]);
};

/** Divider：axis 缺省为 horizontal。 */
export const renderDivider: ComponentRenderer<VueNode> = (props) => {
  if (String(props.axis) === 'vertical') {
    return h('div', {
      role: 'separator',
      'aria-orientation': 'vertical',
      style: { width: '1px', alignSelf: 'stretch', background: '#e5e7eb' },
    });
  }

  return h('hr', {
    style: { width: '100%', border: 'none', borderTop: '1px solid #e5e7eb', margin: '4px 0' },
  });
};
