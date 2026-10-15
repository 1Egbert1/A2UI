# A2UI 协议扩展：本地动作（client-side action）

> 依据：
> - 原生协议：[`specification/v0_8/json/client_to_server.json`](../specification/v0_8/json/client_to_server.json)、[`standard_catalog_definition.json`](../specification/v0_8/json/standard_catalog_definition.json)（`Button.action`）
> - 实现：`packages/a2ui-core/src/action/index.ts`、`packages/a2ui-vue/src/renderers/form.ts`
> - 最小示例：`packages/a2ui-core/mock/local-action.ts`

## 一、为什么需要扩展

A2UI 0.8 的客户端动作**只有一条路**：组件交互 → 客户端组装 `userAction` 消息 → 发给服务端 → 服务端回 `surfaceUpdate` / `dataModelUpdate` 改 UI。

这条链路对「需要服务端决策」的交互是对的，但对另一类交互是纯粹的浪费：

- 切换页签、展开/收起面板；
- 按一下换一句文案、按一下切换主题；
- 表单在提交前的本地校验提示。

这些动作**不需要服务端参与**，却因为协议里没有「本地动作」这个概念，只能硬塞进 `userAction` 绕一圈。本扩展补上这条路：在 `action` 上增加两个可选字段，让动作可以被标记为**本地执行**。

## 二、扩展字段

`Button.action` 在原协议字段（`name`、`context`）之外新增两个字段：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `"server"` \| `"local"` | — | 动作类型。**缺省 `"server"`**（即原生行为）。只有显式写 `"local"` 才走本地分支 |
| `local` | `LocalOperation[]` | — | `type: "local"` 时要执行的本地操作列表，按数组顺序执行 |

`LocalOperation` 目前只有一种操作：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `"updateDataModel"` | ✅ | 操作类型。未知类型会被**跳过**（留给未来扩展，老实现遇到新操作应忽略而不是报错） |
| `path` | string | ✅ | 数据模型路径，如 `/message`。空字符串无意义，会被跳过 |
| `value` | 取值对象 | ✅ | 写入的新值。`literalString` / `literalNumber` / `literalBoolean` / `literalArray` / `path` 五选一 |

```jsonc
"action": {
  "name": "refreshMessage",            // 原协议字段（必填）
  "context": [ /* 原协议字段（可选） */ ],
  "type": "local",                     // ★ 扩展
  "local": [                           // ★ 扩展
    {
      "type": "updateDataModel",
      "path": "/message",
      "value": { "literalString": "新文案" }
    }
  ]
}
```

## 三、语义

### 3.1 分流规则

**`type` 是唯一的分流开关**，且判定是精确匹配：

| `action.type` | 分支 | 行为 |
| --- | --- | --- |
| `"local"` | 本地 | 依次执行 `local[]` 的操作，**不发给服务端** |
| 缺省 / `"server"` / 其它任意值 | 服务端 | 组装 `userAction` 消息交给宿主 |

「其它任意值」也走服务端是**刻意的**：宁可多发一条消息，也不要在用户把字段拼错时**静默执行本地写操作**。换句话说，本地分支必须显式声明。

### 3.2 本地操作怎么执行

本地分支借用**已有的数据绑定写回链路** —— 每个 `updateDataModel` 操作被「模拟」成一次 `updateModel`：

```
点击 → resolveAction(action) 判定为 local
     → 对每个操作调 context.updateModel(op.path, op.value)   ← 与表单控件输入时完全同一条链路
     → 写 store.dataModelMap[surfaceId]
     → 触发派生状态刷新（hydrate + buildTree + renderTree）
     → 绑定了同一 path 的组件（如 Text）立刻显示新值
```

因此本地动作**不需要任何新的刷新机制**：它复用的正是 `updateModel` 那套「写回 → 重渲染」。这也意味着「本地动作」与「表单输入」在行为上完全一致，只是触发源从 `onInput` 换成了 `onClick`。

多个操作按数组顺序执行，逐个写回；`updateDataModelPath` 每次都基于最新 state 浅合并，所以同一批操作互不覆盖。

### 3.3 本地动作不外发

本地分支**不派发** `a2ui-action` 事件 —— 既然不需要服务端参与，宿主也就没必要收到通知。这也让「本地」的语义边界清晰：**同一时刻只会有一个出口**，要么写数据模型，要么交宿主。

如果将来需要「既本地执行、又上报服务端做埋点」，可以再加一个 `report: true` 之类的开关；当前实现不做。

### 3.4 容错

| 情况 | 行为 |
| --- | --- |
| `action` 不是对象，或 `name` 缺失/为空 | 整个动作**忽略**（不派发、不写回）。`name` 在标准目录里是必填字段 |
| `local` 不是数组 / 缺失 | 本地分支成立，但操作列表为**空** → 什么都不做 |
| 某个操作不是对象、`type` 不是 `updateDataModel`、`path` 缺失或为空 | **跳过这一项**，其余照常执行 |

逐项跳过而不是整体失败，是因为一个动作里的几个操作互不依赖，写坏一个不该把其余几个拖下水。

## 四、服务端分支（原生链路补全）

标准分支的行为保持「交给宿主」，但**消息形态补齐到了协议要求**。

原生 `Button.action.context` 是 `[{ key, value }]` 数组（见标准目录），而 `client_to_server.json` 要求 `userAction.context` 是**对象**，且里面是**求值后**的真实值。这一步转换原先没做，现在由 core 完成：

```jsonc
// 组件里（标准目录形态）
"action": {
  "name": "checkout",
  "context": [{ "key": "sku", "value": { "literalString": "A-1" } },
              { "key": "note", "value": { "path": "/user/name" } }]
}

// 发给宿主 / 服务端（client_to_server.json 形态）
{ "userAction": {
    "name": "checkout",
    "surfaceId": "cart",
    "sourceComponentId": "buy-button",
    "timestamp": "2026-10-15T12:00:00.000Z",
    "context": { "sku": "A-1", "note": "Alice" }   // 数组 → 对象，path → 真实值
} }
```

`a2ui-action` DOM 自定义事件（`bubbles: true`）仍是宿主接入点，`event.detail` 就是上面这条完整消息；**传输方式由宿主决定**（fetch / SSE / WebSocket 都行），core 不碰网络。

> ⚠️ 破坏性变更：`event.detail` 以前是原样的 `{ name, context }`（数组未解析），现在是 `{ userAction: { ... } }`。这是本次实现 client→server 回传通道的必然结果。

## 五、最小示例：按钮更新一行文案

完整数据见 `packages/a2ui-core/mock/local-action.ts`，核心就两个组件加一条数据：

```jsonc
// surfaceUpdate（截取）
{ "id": "message", "component": { "Text": { "text": { "path": "/message" }, "usageHint": "h3" } } },
{ "id": "refresh-button", "component": { "Button": {
    "child": "refresh-label",
    "primary": true,
    "action": {
      "name": "refreshMessage",
      "type": "local",
      "local": [{
        "type": "updateDataModel",
        "path": "/message",
        "value": { "literalString": "✅ 这行文案已由本地动作更新（没有经过服务端）" }
      }]
    }
} } }

// dataModelUpdate
{ "dataModelUpdate": { "surfaceId": "local-action",
    "contents": [{ "key": "message", "valueString": "点击下方按钮，用本地动作更新这行文案" }] } }
```

点击行为：`/message` 被写为新文案 → 绑同一 path 的 `Text` 重渲染 → 页面上那行字变了。整条链路没有 `userAction`、没有服务端往返。

在 playground 里选 `local-action` 即可交互验证（右侧数据模型 JSON 里的 `/message` 会实时变化）。

## 六、兼容性

- **对服务端无影响**：扩展字段只出现在 `server → client` 的组件定义里，`client → server` 的消息格式未变（仍是标准 `userAction`）。
- **对严格校验器有影响**：标准目录里 `Button.action` 是 `additionalProperties: false`，新增的 `type` / `local` 会被「按标准 schema 严格校验」的工具判为非法。本项目不跑这层校验；若要对外兼容，可以给扩展单独出一份 catalog 定义，或把两个字段挪到一个独立的 `x-local` 命名空间下。
- **对不认识该扩展的实现无影响**：它们会读到 `type` / `local` 两个陌生字段 —— 若按 `additionalProperties: false` 校验则报错，若不校验则忽略，并按缺省行为走服务端分支（「多发一条 userAction」是安全的降级方向）。

## 七、实现落点

| 环节 | 位置 |
| --- | --- |
| 协议语义：分流、取值对象求值、组装 `userAction` | `packages/a2ui-core/src/action/index.ts`（`resolveAction`） |
| 通用取值对象解析（`literal*` / `path`） | `packages/a2ui-core/src/binding/index.ts`（`readBoundValue`） |
| 执行本地操作（把操作模拟成 `updateModel`）、派发 DOM 事件 | `packages/a2ui-vue/src/renderers/form.ts`（`handleButtonClick`） |
| 测试 | `packages/a2ui-core/test/action.spec.ts`、`packages/a2ui-vue/test/components.spec.ts`（Button 段） |

**为什么这样切**：core 只管协议语义（解析 / 求值 / 组装），不执行操作、不发网络 —— 执行要改 store，得由渲染引擎拿着 `RenderContext.updateModel` 来做；网络是宿主的自由。这样换 React 渲染器时 `action` 模块一行不用改。

## 八、后续可扩展

- 更多本地操作类型：`toggleDataModel`（布尔取反）、`pushDataModel` / `removeDataModel`（列表增删）——结构上只需给 `LocalOperation` 加分支。
- 本地动作的「补报」：需要埋点时再考虑同时上报 `userAction`。
- 把 `type: "local"` 推广到 `Button` 之外的组件（目前只有 `Button` 有 `action` 字段）。
