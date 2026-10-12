import type { RenderMap } from 'a2ui-core';

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
 * 每个登记项都过一遍 `withRootId`：登记的是「带 id 的渲染函数」，
 * 而上面 re-export 出去的仍是**不带 id 的原始渲染器**（供单元测试单独驱动）。
 */
export const renderMap: RenderMap<VueNode> = {
  // leaf
  Text: withRootId(renderText),
  Image: withRootId(renderImage),
  Icon: withRootId(renderIcon),
  Video: withRootId(renderVideo),
  AudioPlayer: withRootId(renderAudioPlayer),
  Divider: withRootId(renderDivider),

  // container
  Row: withRootId(renderRow),
  Column: withRootId(renderColumn),
  List: withRootId(renderList),
  Card: withRootId(renderCard),
  Tabs: withRootId(renderTabs),
  Modal: withRootId(renderModal),

  // form
  Button: withRootId(renderButton),
  CheckBox: withRootId(renderCheckBox),
  TextField: withRootId(renderTextField),
  DateTimeInput: withRootId(renderDateTimeInput),
  MultipleChoice: withRootId(renderMultipleChoice),
  Slider: withRootId(renderSlider),
};
