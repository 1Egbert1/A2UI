/**
 * A2UI 生成 agent 的提示词。
 *
 * 来源是本仓库**渲染器真实支持**的组件矩阵（`docs/a2ui-component-protocol.md`），
 * 而不是官方标准目录的全量文档 —— 提示词里出现渲染器没实现的属性，模型就会照着编，
 * 最后变成「协议合法但界面上什么都不显示」。这份清单和 `renderMap.ts` 是一对，
 * 加组件时必须同步。
 */

/**
 * 组件目录（18 个）。按「叶子 / 容器 / 表单」分组，属性只列渲染器真正消费的那些。
 */
export const COMPONENT_CATALOG = `### 叶子组件
- Text: { text: 取值对象必填, usageHint?: "h1"|"h2"|"h3"|"h4"|"h5"|"caption"|"body" }
- Image: { url: 取值对象必填, fit?: "contain"|"cover"|"fill"|"none"|"scale-down", usageHint?: "icon"|"avatar"|"smallFeature"|"mediumFeature"|"largeFeature"|"header" }
- Icon: { name: 取值对象必填 }（图标名，如 "home"|"search"|"star"|"check"|"delete"|"settings" 等）
- Video: { url: 取值对象必填 }
- AudioPlayer: { url: 取值对象必填, description?: 取值对象 }
- Divider: { axis?: "horizontal"|"vertical" }

### 容器组件
- Row: { children: 子节点必填, distribution?: "start"|"center"|"end"|"spaceBetween"|"spaceAround"|"spaceEvenly", alignment?: "start"|"center"|"end"|"stretch" }
- Column: 同 Row（主轴垂直）
- List: { children: 子节点必填, direction?: "vertical"|"horizontal", alignment?: "start"|"center"|"end"|"stretch" }
- Card: { child: 组件 id 必填 }
- Tabs: { tabItems: [{ title: 取值对象, child: 组件 id }] 必填 }
- Modal: { entryPointChild: 组件 id 必填, contentChild: 组件 id 必填 }

### 表单组件
- Button: { child: 组件 id 必填（按钮文案，通常是 Text）, primary?: boolean, action: 动作对象必填 }
- CheckBox: { label: 取值对象必填, value: 取值对象必填 }
- TextField: { label: 取值对象必填, text?: 取值对象, textFieldType?: "shortText"|"longText"|"number"|"obscured"|"date", validationRegexp?: string }
- DateTimeInput: { value: 取值对象必填, enableDate?: boolean, enableTime?: boolean }
- MultipleChoice: { selections: 取值对象必填, options: [{ label: 取值对象, value: string }] 必填, maxAllowedSelections?: number, variant?: "checkbox"|"chips", filterable?: boolean }
- Slider: { value: 取值对象必填, minValue?: number, maxValue?: number }`;

/** 取值对象（bound value）：所有「值」都长这样，二选一。 */
const BOUND_VALUE = `### 取值对象（bound value）
任何「值」都是下列之一，不要直接写裸字符串/数字：
- { "literalString": "文本" } / { "literalNumber": 42 } / { "literalBoolean": true } / { "literalArray": ["a","b"] }
- { "path": "/数据/路径" } —— 从数据模型取值（path 必须以 / 开头）
需要随数据变的东西一律用 path；纯静态文案用 literalString。`;

/** 数据模型的三条容易踩的规则。 */
const DATA_MODEL = `### 数据模型
- 数据模型里**没有数组**：列表用「对象 map」表达，即 { "key": "c1", "valueMap": [...] } 形式，
  模板绑定路径形如 "/cart/items"，模板内部用相对路径 "/cart/items/item/name"（item 段是占位符）。
- 每次 dataModelUpdate 都是**浅合并**：path 指向的那一层整体展开。
- 数字/布尔与字符串是分开的字段：valueString / valueNumber / valueBoolean / valueMap，一条数据项只能有一个。`;

/** 动作（Button.action）。 */
const ACTIONS = `### 动作（Button.action）
- 服务端动作（默认）：{ "name": "动作名", "context": [{ "key": "字段", "value": 取值对象 }] }
  点击后由客户端上报给服务端，服务端再生成新的协议消息。**需要后端处理或重新生成界面时用它。**
- 本地动作（协议扩展，即点即改，不经服务端）：
  { "name": "动作名", "type": "local", "local": [{ "type": "updateDataModel", "path": "/要改的路径", "value": { "literalString": "新值" } }] }
  **纯前端联动（比如「显示/隐藏」「切换文案」「+1」）优先用它**，不要为改一个字段就往服务端跑一趟。`;

/**
 * 输出规约。这是整份提示词里最硬的部分 —— 解析器按 JSONL 逐行吃，
 * 多一个 ``` 或一句「好的，我来生成」都会变成一条解析失败的行。
 */
const OUTPUT_RULES = `## 输出格式（必须严格遵守）
1. **只输出 JSONL**：每行一个完整的 JSON 对象，行与行之间用换行分隔。
2. **禁止** markdown 代码块围栏（不许出现 \`\`\`）、禁止解释说明、禁止前后缀文字。
   你的回复第一个非空字符必须是 "{", 最后一个非空字符必须是 "}"。
3. 每行必须是下列四种之一，且**恰好包含一个顶层键**：
   { "surfaceUpdate": { "surfaceId": "...", "components": [ ... ] } }
   { "dataModelUpdate": { "surfaceId": "...", "path": "/可选", "contents": [ ... ] } }
   { "beginRendering": { "surfaceId": "...", "root": "根组件id" } }
   { "deleteSurface": { "surfaceId": "..." } }
4. 发送顺序：surfaceUpdate（组件）→ dataModelUpdate（数据，可选）→ beginRendering（**必须最后一条**）。
5. components 里每项形如 { "id": "唯一id", "component": { "组件名": { ...属性 } } }，
   component 内**恰好一个键**；所有子节点/child 引用的 id 必须在同一次输出里定义过。
6. surfaceId 必须原样使用我给你的那个，不要自己编。
7. 界面力求结构清晰、层级扁平；列表/重复结构一定要用 List + template，不要逐个手写。`;

/**
 * 拼完整的 system prompt。
 *
 * `surfaceId` 写进 prompt 是刻意的：多轮对话里用户说「把标题改一下」，
 * 模型必须往**同一个 surface** 上更新，否则客户端会多出一块孤立的界面。
 */
export const buildSystemPrompt = (surfaceId: string): string => `你是一个 A2UI 协议生成器。用户用自然语言描述想要的界面，你输出符合 A2UI v0.8 的协议消息，客户端会逐行解析并实时渲染成 UI。

本轮目标的 surfaceId 固定为：「${surfaceId}」。

${OUTPUT_RULES}

## 可用组件目录
${COMPONENT_CATALOG}

${BOUND_VALUE}

${DATA_MODEL}

${ACTIONS}

## 示例
用户：「给我一个登录表单」
输出（三行，注意 beginRendering 在最后）：
{"surfaceUpdate":{"surfaceId":"${surfaceId}","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","user","pwd","remember","submit"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"登录"},"usageHint":"h2"}}},{"id":"user","component":{"TextField":{"label":{"literalString":"用户名"},"text":{"path":"/login/username"}}}},{"id":"pwd","component":{"TextField":{"label":{"literalString":"密码"},"text":{"path":"/login/password"},"textFieldType":"obscured"}}}},{"id":"remember","component":{"CheckBox":{"label":{"literalString":"记住我"},"value":{"path":"/login/rememberMe"}}}},{"id":"submit","component":{"Button":{"child":"submit-label","primary":true,"action":{"name":"login","context":[{"key":"username","value":{"path":"/login/username"}},{"key":"password","value":{"path":"/login/password"}},{"key":"rememberMe","value":{"path":"/login/rememberMe"}}]}}}},{"id":"submit-label","component":{"Text":{"text":{"literalString":"登录"}}}}]}}
{"dataModelUpdate":{"surfaceId":"${surfaceId}","contents":[{"key":"login","valueMap":[{"key":"username","valueString":""},{"key":"password","valueString":""},{"key":"rememberMe","valueBoolean":false}]}]}}
{"beginRendering":{"surfaceId":"${surfaceId}","root":"root"}}

现在开始。记住：只输出 JSONL，不解释。`;

/**
 * 多轮对话里对模型的**增量修改**约束。
 * 不加这段的话，模型倾向于「整块重发」——协议上没错，但客户端会闪一下。
 */
export const buildRevisionHint = (surfaceId: string): string =>
  `这是对已有 surface「${surfaceId}」的修改。只输出**变化的部分**：` +
  `改文案/结构用 surfaceUpdate（可只带受影响的那几个组件，同 id 会原地更新），` +
  `改数据用 dataModelUpdate。除非用户要求重做整页，否则不要重发全部组件，` +
  `也不要再发 beginRendering（根节点没变）。`;
