# 图源与重新生成

README 里的三张图不是手绘位图，是 **纯矢量 SVG**：所有文字都是 `<text>`，线条是路径，没有 `foreignObject`、没有内嵌位图、没有滤镜。任意倍率放大都按矢量重新栅格化，不会糊。

| SVG | 源文件 | 说明 |
| --- | --- | --- |
| `a2ui_overall_architecture.svg` | `src/overall_architecture.mmd` | 两条来路 → 一个出口 → 同一条渲染链路 |
| `a2ui_render_pipeline.svg` | `src/render_pipeline.mmd` | 一条协议消息到一棵组件树 |
| `a2ui_request_pipeline.svg` | `src/request_pipeline.mmd` | 单入口，分流只发生在最后一刻 |

## 改图流程

改 `src/*.mmd` → 用任意 mermaid 渲染器（`mmdc`、IDE 插件、mermaid.live）导出 SVG → 覆盖同名文件。

导出时请保持这两个设置，否则会重新引入「放大发虚」：

- **`htmlLabels: false`** —— 否则标签会变成 `<foreignObject>` 里的 HTML，很多预览器会把它当位图处理。
- **`look: 'classic'`** —— `neo` 外观带 `drop-shadow` 滤镜，滤镜会让部分渲染器把整个节点栅格化。

参考配置：

```js
mermaid.initialize({
  theme: 'base',
  htmlLabels: false,
  flowchart: { htmlLabels: false, look: 'classic', curve: 'linear', useMaxWidth: false },
});
```

## 配色

| 用途 | 值 |
| --- | --- |
| 节点底色 / 描边 | `#ffffff` / `#d7dfe9` |
| 分组底色 / 描边 | `#f7f9fc` / `#e4eaf2` |
| 主文字 / 次文字 | `#0f172a` / `#64748b` |
| 连线 / 箭头 | `#94a3b8` |
| 强调节点（`classDef accent`） | 底 `#eef2ff`、边 `#c7d2fe`、字 `#3730a3` |
