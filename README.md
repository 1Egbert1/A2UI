## 项目介绍
实现一个A2UI项目，用户通过web应用生成对应的UI界面。

## 项目架构
项目使用monorepo架构组织代码。
包含以下几个核心模块：

packages - a2ui sdk npm 包
  ├── a2ui-core:包含UI组件库和渲染引擎，包含以下模块：
    ├── parser:解析a2ui协议的模块
      ├── parseA2UI：一次性解析整段 JSONL
      ├── createJSONLStream：行框定的流式解析（信任换行是消息边界）
      ├── createA2UIBuffer：JSON 框定的缓冲流（括号配对取完整值；**不等整条 surfaceUpdate
      │     收完** —— 每有一个组件闭合就补全成「一个组件一条完整消息」，做到边到边渲染），
      │     配套 chunkText / simulateTextStream 模拟「每 50ms 吐 50 字符」的字符流
    ├── binding：数据绑定（取值对象 `{ literal* | path }` 的读、按 path 写回数据模型）
    ├── mock：自带示例协议（TS 模块，一行一条 JSONL 消息）。`data-binding` 是最小完整的数据
    │     绑定示例（TextField/CheckBox/Slider 写回 + Text 同 path 联动），配套两侧端到端测试
    ├── vnode：用来映射管理a2ui协议生成的组件
    ├── treebuilder:用来构建a2ui协议生成的组件树的模块
  ├── a2ui-vue:基于Vue3的a2ui渲染引擎，用于在Vue3中使用A2UI组件库
  ├── a2ui-ui-components

package主要职责：维护aiui的sdk，并支持生产对应的npm包。

web
-a2ui-playground:包含a2ui-playground的web应用，用户可以在其中尝试A2UI的使用
web主要职责及详细功能：
1. 可以通过对话的方式，让AI Agent生成对应的UI界面。
2. 可以预览对应的ai页面。
3. 可以支持多轮对话对生成对应的UI界面 ，用户可以根据需要进行调整。
4. 可以预览a2ui-vue定义的基础a2ui组件。
5. 可以支持协议调试




server
-a2ui-playground-server:包含a2ui-playground-server的web应用
server主要职责及详细功能：
1. 基于openAI，实现a2ui agent
2. 实现a2ui-server，支持a2ui 协议的生成及缓存
 
### 基础依赖
所有的项目需要支持typescript。
web:使用vite构建playground应用
server:
- 使用koa实现服务接口
- agent:基于openAI
- 使用tsnode运行

### 包管理
使用pnpm进行包管理。