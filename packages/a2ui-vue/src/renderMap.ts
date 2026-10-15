import type { ComponentRenderer, RenderMap } from 'a2ui-core';

import { withEntranceAnimation } from './internal/entrance';
import { withRootId, type VueNode } from './internal/node';
import {
  renderCard,
  renderColumn,
  renderList,
  renderModal,
  renderRow,
  renderTabs,
} from './renderers/container';
import {
  renderButton,
  renderCheckBox,
  renderDateTimeInput,
  renderMultipleChoice,
  renderSlider,
  renderTextField,
} from './renderers/form';
import {
  renderAudioPlayer,
  renderDivider,
  renderIcon,
  renderImage,
  renderText,
  renderVideo,
} from './renderers/leaf';

export * from './renderers/container';
export * from './renderers/form';
export * from './renderers/leaf';
export { A2UINode, withRootId } from './internal/node';
export type { VueNode } from './internal/node';
export { withEntranceAnimation, ENTRANCE_DURATION } from './internal/entrance';

/**
 * 每个组件都过一遍的两层包装，合成一个：
 * 1. `withRootId` —— 给根元素补 `id = surfaceId-componentId`（组件身份）；
 * 2. `withEntranceAnimation` —— 首次渲染的组件播一次入场动画，播完回写标记。
 *
 * 上面 re-export 出去的仍是**不带 id、不带动画的原始渲染器**（供单元测试单独驱动）。
 */
const enhance = (renderer: ComponentRenderer<VueNode>): ComponentRenderer<VueNode> =>
  withEntranceAnimation(withRootId(renderer));

/**
 * A2UI 组件类型名 → Vue 渲染函数。
 *
 * 覆盖 specification/v0_8/json/standard_catalog_definition.json 里 **components 下的全部 18 个
 * 组件**；协议里每新增一个组件，都要在这里登记，否则 core 会在 errorMap 里记一条
 * RENDERER_NOT_FOUND（组件仍会留在 store 里，只是渲染不出来）。
 *
 * 组件按角色分三组，实现分文件：
 * - leaf：不引用别的组件，只吃属性 + 数据模型；
 * - container：按 componentId 引用子组件，负责布局与其自身的交互状态；
 * - form：表单控件。
 *
 * 每个登记项都过一遍 `enhance`（= 加 id + 入场动画），保证所有组件行为一致。
 */
export const renderMap: RenderMap<VueNode> = {
  // leaf
  Text: enhance(renderText),
  Image: enhance(renderImage),
  Icon: enhance(renderIcon),
  Video: enhance(renderVideo),
  AudioPlayer: enhance(renderAudioPlayer),
  Divider: enhance(renderDivider),

  // container
  Row: enhance(renderRow),
  Column: enhance(renderColumn),
  List: enhance(renderList),
  Card: enhance(renderCard),
  Tabs: enhance(renderTabs),
  Modal: enhance(renderModal),

  // form
  Button: enhance(renderButton),
  CheckBox: enhance(renderCheckBox),
  TextField: enhance(renderTextField),
  DateTimeInput: enhance(renderDateTimeInput),
  MultipleChoice: enhance(renderMultipleChoice),
  Slider: enhance(renderSlider),
};
