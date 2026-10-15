/**
 * 数据绑定演示协议（最小完整示例）。
 *
 * 用来端到端验证整条「parser → 数据解析 → 数据绑定」链路：
 *
 * - **parser**：一条 surfaceUpdate 登记 5 个组件，beginRendering 建 surface；
 * - **数据解析**：dataModelUpdate 的 contents 覆盖 valueString / valueBoolean / valueNumber
 *   三种类型还原、valueMap 嵌套还原，以及带 `path` 的局部更新（浅合并、不丢兄弟键）；
 * - **数据绑定（读）**：4 个组件各绑定一个 path —— Text / TextField 读 `/user/name`，
 *   CheckBox 读 `/prefs/subscribe`，Slider 读 `/prefs/volume`；
 * - **数据绑定（写）**：TextField 的 `text`、CheckBox 的 `value`、Slider 的 `value` 带 path 时，
 *   用户交互会把新值写回同一 path，并触发重渲染（绑定同一 path 的 Text 跟着变）。
 *
 * 每个元素是**一行 A2UI JSONL 消息**（一条 server → client 消息），数组顺序即发送顺序。
 * 用「字符串数组」而不是整段字符串，是为了让流式模拟能逐条 `push()`。
 */

export const dataBindingMessages: string[] = [
  // #1 surfaceUpdate · root(Column) name-field(TextField) greeting(Text) subscribe(CheckBox) volume(Slider)
  `{"surfaceUpdate":{"surfaceId":"data-binding","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["name-field","greeting","subscribe","volume"]}}}},{"id":"name-field","component":{"TextField":{"label":{"literalString":"Name"},"text":{"path":"/user/name"}}}},{"id":"greeting","component":{"Text":{"text":{"path":"/user/name"},"usageHint":"h3"}}},{"id":"subscribe","component":{"CheckBox":{"label":{"literalString":"Subscribe"},"value":{"path":"/prefs/subscribe"}}}},{"id":"volume","component":{"Slider":{"value":{"path":"/prefs/volume"},"minValue":0,"maxValue":100}}}]}}`,
  // #2 dataModelUpdate · 初始数据：valueMap 嵌套还原 + 布尔 + 数字
  `{"dataModelUpdate":{"surfaceId":"data-binding","contents":[{"key":"user","valueMap":[{"key":"name","valueString":"Alice"}]},{"key":"prefs","valueMap":[{"key":"subscribe","valueBoolean":false},{"key":"volume","valueNumber":50}]}]}}`,
  // #3 dataModelUpdate · path 局部更新：只改 /prefs/volume，同层兄弟键 subscribe 必须保留
  `{"dataModelUpdate":{"surfaceId":"data-binding","path":"prefs","contents":[{"key":"volume","valueNumber":70}]}}`,
  // #4 beginRendering · root=root
  `{"beginRendering":{"surfaceId":"data-binding","root":"root"}}`,
];
