# 一次真实生成结果的评审：为什么它渲染不出来

> 素材：用户在 Playground 里生成的一份 WorkBuddy 落地页（6 条 `surfaceUpdate`，28 个组件）。
> 本文记录「哪里错、为什么错、怎么补」，补齐后的可运行版本是 `packages/a2ui-core/mock/workbuddy.ts`（场景 `workbuddy`）。

## 1. 结论

六条消息全部是 `surfaceUpdate`。按协议，**`surfaceUpdate` 只登记组件，不创建 surface** ——
没有 `beginRendering`，预览就是空白；而 `errorMap` 也是空的，所以界面不会报任何错。

三个必要条件缺一不可：

| # | 缺什么 | 后果 |
| --- | --- | --- |
| 1 | `beginRendering` | surface 从不诞生，整页空白 |
| 2 | 统一 root（`nav` / `hero` / `preview-body` 三个顶级容器并列，无人包裹） | 即使补上 `beginRendering`，`root` 也只能指一个，另外两块不渲染 |
| 3 | `dataModelUpdate`（但有 6 处 `path` 绑定） | 这 6 个 `Text` 渲染成空字符串 |

## 2. 悬空引用 15 个 / 孤儿 9 个

引用了但从未定义的 id：

```
nav         -> logo-row, nav-list, nav-right
nav-link-item -> nav-hot
hero        -> hero-cta
sidebar     -> win-dots, side-list
side-item   -> side-item-icon, side-item-trail
main        -> chip-row, skill-row, prompt-card
chip-item   -> chip-icon
skill-item  -> skill-icon
prompt-inner -> prompt-tools
```

其中 `nav-link-item` / `side-item` / `chip-item` / `skill-item` 是**列表项模板**（路径里带 `item`），
本该由 `List.template` 引用 —— 但全文没有任何 `List`，所以它们即使补齐也永远不会出现。

## 3. 三个样式键被静默丢弃

白名单 42 条里有 `border` / `borderWidth` / `borderStyle` / `borderColor`，但**没有方向性边框**，
也没有 `overflow`：

| 被丢的键 | 用在哪 | 看到的差别 |
| --- | --- | --- |
| `borderBottom` | `nav` | 导航条分隔线不见 |
| `borderRight` | `sidebar` | 侧栏分隔线不见 |
| `overflow` | `preview-body` | 卡片圆角切不住内部方角内容 |

变通写法：**单边分隔线用 `boxShadow: inset`** —— `inset 0 -1px 0 #f0f0f0`（下边）、
`inset -1px 0 0 #f2f2f2`（右边），效果一致且在白名单内。补齐版就是这么写的。

## 4. `lineHeight` 为什么不吃 px（以及裸数字的灾难）

`lineHeight` 在白名单里登记为 `number`，数字**原样透传**，不补 `px`。这是刻意的：

CSS 的 `line-height` 无单位数字表示**字号的倍数**。实测（字号 13px、单行容器）：

| 写法 | 实际高度 | 说明 |
| --- | --- | --- |
| `line-height: 20` | **260px** | 裸数字 = 20 倍 × 13px |
| `line-height: 20px` | 20px | 正确 |
| `line-height: 1.1` | 14.3px | 1.1 倍，正确 |
| `line-height: 1.1px` | 1.09px | 若一律补 px，倍数写法会塌成一条线 |

所以这是个**二选一**：同一个纯数字只能表达一种语义。

- 选 `length`（一律补 px）→ 最常用的 `1.4` 会变成 `1.4px`，行高塌陷，比 20 倍更糟
- 选 `number`（本项目）→ 倍数写法自然，但**像素行高必须写成字符串 `"20px"`**

原始输出里两写法同时出现：`hero-w` 用 `1.1`（对），`hero-sub` 用 `20`（会炸成 260px）。
说明只靠 prompt 约束不够，需要机器判据（见 §6）。

## 5. 补齐版做了什么

`packages/a2ui-core/mock/workbuddy.ts`，57 个组件、13 条消息：

1. 加 `root`：`Column` 包住 `nav` / `hero` / `preview-body` / `ui-hint`
2. 第二条就是 `beginRendering`（root 第一条、surface 立刻诞生）
3. 第三条 `dataModelUpdate`：导航项、标题、占位文案、胶囊、技能、侧栏四组
4. 补齐 15 个缺失组件，其中 4 个列表改用 `List` + `template` 正确表达
5. 三处被丢的样式改用 `boxShadow: inset` / 去掉 `overflow` 依赖
6. 两处硬编码宽度改成 `100% + maxWidth`（原来 `prompt-inner` 写死 470，窄画布会溢出）

校验结果：**悬空引用 0、孤儿 0、12 条 path 绑定全部能被数据模型解析**。

## 6. 两条可以机检的判据（建议加进生成侧）

| 判据 | 触发条件 | 提示 |
| --- | --- | --- |
| 无 surface | 本轮有 `surfaceUpdate`、但没有 `beginRendering` | 「收到了 N 个组件但从未创建 surface，预览不会显示」 |
| 行高可疑 | `lineHeight` 是数字且 ≥ 4 | 「`lineHeight: 20` 是 20 倍行高；像素值请写 `"20px"`」 |

两条都只需要遍历已落地的消息 / 组件，不必改解析器。第一条能把「静默空白」变成可解释的失败。
