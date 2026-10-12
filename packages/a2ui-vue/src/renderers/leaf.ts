import { h } from 'vue';
import { readString, type ComponentRenderer } from 'a2ui-core';

import { type VueNode } from '../internal/node';
import {
  FALLBACK_GLYPH,
  ICON_GLYPHS,
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

/** Icon：标准目录只规定图标名，这里按内置字符表渲染（见 internal/styles 的说明）。 */
export const renderIcon: ComponentRenderer<VueNode> = (props, context) => {
  const name = readString(props.name, context.read);
  return h(
    'span',
    { style: ICON_STYLE, title: name, role: 'img', 'aria-label': name },
    ICON_GLYPHS[name] ?? FALLBACK_GLYPH,
  );
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
