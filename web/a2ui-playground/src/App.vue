<template>
  <div class="playground">
    <header class="toolbar">
      <div class="titles">
        <h1>A2UI Playground</h1>
        <p>mock → init(renderMap) → parseA2UI → hydrate → buildTree → vue.render</p>
      </div>
      <div class="actions">
        <el-select
          v-model="mockIndex"
          class="mock-select"
          size="default"
          popper-class="mock-select-popper"
          placeholder="选择 mock 数据"
        >
          <el-option
            v-for="(mock, index) in MOCKS"
            :key="mock.surfaceId"
            :label="mock.label"
            :value="index"
          >
            <div class="mock-option">
              <span class="mock-option__label">{{ mock.label }}</span>
              <span class="mock-option__desc">{{ mock.desc }}</span>
            </div>
          </el-option>
        </el-select>
        <el-button type="danger" plain @click="errorDialogVisible = true">
          错误信息 ({{ errorList.length }})
        </el-button>
        <el-button type="primary" @click="dialogVisible = true">查看 Store</el-button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-header">
        <h2>渲染预览</h2>
        <span class="tag">{{ treeLabel }}</span>
      </div>

      <div ref="previewRef" class="preview"></div>
      <p v-if="!treeRoot" class="hint">
        暂无可渲染的组件树：需要 beginRendering 让 surface 诞生，且组件类型已注册渲染器。
      </p>

      <div v-if="treeOutline" class="outline-block">
        <span class="outline-title">组件树 treeMap["{{ activeMock.surfaceId }}"].root</span>
        <pre class="outline">{{ treeOutline }}</pre>
      </div>
    </section>

    <el-dialog
      v-model="errorDialogVisible"
      title="a2ui-core errorMap"
      width="760px"
      align-center
      :close-on-click-modal="false"
    >
      <div v-if="errorList.length" class="alert-list">
        <el-alert
          v-for="[errorId, error] in errorList"
          :key="errorId"
          :title="`${error.type} · ${errorId}`"
          :description="error.content"
          type="error"
          :closable="false"
          show-icon
        />
      </div>
      <el-empty v-else description="errorMap 为空，本次解析没有产生错误" :image-size="72" />

      <template #footer>
        <el-button @click="errorDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="dialogVisible"
      title="a2ui-core store"
      width="760px"
      align-center
      :close-on-click-modal="false"
    >
      <div class="stat-strip">
        <div class="stat stat--primary">
          <span class="stat__value">{{ storeStats.components }}</span>
          <span class="stat__label">当前渲染组件总数</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ storeStats.rendered }}</span>
          <span class="stat__label">已渲染出节点</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ storeStats.treeNodes }}</span>
          <span class="stat__label">组件树节点</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ storeStats.surfaces }}</span>
          <span class="stat__label">Surface</span>
        </div>
        <div class="stat" :class="{ 'stat--danger': storeStats.errors > 0 }">
          <span class="stat__value">{{ storeStats.errors }}</span>
          <span class="stat__label">错误</span>
        </div>
      </div>

      <pre class="code">{{ storeJson }}</pre>

      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { cloneVNode, isVNode, render, type VNode } from 'vue';
import { clearStore, init, parseA2UI } from 'a2ui-core';
import type { A2UIStoreState, TreeNode } from 'a2ui-core';
import { renderMap } from 'a2ui-vue';
import simpleTextRaw from 'a2ui-core/mock/simple-text.jsonl?raw';
import productCardRaw from 'a2ui-core/mock/product-card.jsonl?raw';
import columnTextsRaw from 'a2ui-core/mock/column-texts.jsonl?raw';
import columnRowMixRaw from 'a2ui-core/mock/column-row-mix.jsonl?raw';

/**
 * 可切换的 mock。
 *
 * - simple-text：只有一个 Text，最小示例；
 * - product-card：官方示例 `catalogs/basic/examples/05_product-card.json` 的 JSONL 版，
 *   用 Card / Column / Row / Image / Text / Button，全部走 dataModel 的 path 绑定；
 * - column-texts：一个 Column 挂三个 Text，专门用来验证 treebuilder 的父子组装
 *   （树里 root 应有 3 个 children，且顺序与 explicitList 一致）；
 * - column-row-mix：多层 Column / Row 混排（最深 5 层）—— Row 横排三张 Card，
 *   Card 内再套 Column，底部 Row 里再嵌 Column + Row，用来压深层嵌套的组装与渲染。
 */
const MOCKS = [
  { label: 'simple-text', desc: '单个 Text，最小示例', surfaceId: 'simple-text', raw: simpleTextRaw },
  {
    label: 'product-card',
    desc: '官方 05 示例，Card + Row + Column',
    surfaceId: 'gallery-product-card',
    raw: productCardRaw,
  },
  {
    label: 'column-texts',
    desc: '一父三子，验证父子组装',
    surfaceId: 'column-texts',
    raw: columnTextsRaw,
  },
  {
    label: 'column-row-mix',
    desc: 'Column / Row 混排，最深 5 层',
    surfaceId: 'column-row-mix',
    raw: columnRowMixRaw,
  },
] as const;

const dialogVisible = ref(false);
const errorDialogVisible = ref(false);
/** 默认停在 column-row-mix —— 多层 Column / Row 混排最能看出嵌套组装的效果。 */
const mockIndex = ref(3);
const storeState = ref<A2UIStoreState | null>(null);
/** 交给 vue 的 render() 作为挂载容器的元素。 */
const previewRef = ref<HTMLElement | null>(null);
let unsubscribe: (() => void) | undefined;

const activeMock = computed(() => MOCKS[mockIndex.value] ?? MOCKS[0]);

/** 把 VNode 压成一行摘要，避免 JSON.stringify 撞上 VNode 的循环引用。 */
const describeVNode = (vnode: VNode): string => {
  const tag = typeof vnode.type === 'string' ? vnode.type : 'Component';
  const text = typeof vnode.children === 'string' ? ` "${vnode.children}"` : '';
  return `<${tag}>${text}`;
};

const storeJson = computed(() =>
  JSON.stringify(
    storeState.value ?? {},
    (_key, value: unknown) => (isVNode(value) ? `${describeVNode(value)} (VNode)` : value),
    2,
  ),
);

/** parser 组装好的组件树根节点 —— treeMap 由 parseA2UI 在整段 JSONL 解析完后写入 store。 */
const treeRoot = computed(
  () => storeState.value?.treeMap[activeMock.value.surfaceId]?.root ?? null,
);

/** 子树节点总数（含自身），用来一眼看出嵌套是否组装成功。 */
const countNodes = (node: TreeNode): number =>
  1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);

const treeLabel = computed(() => {
  const root = treeRoot.value;
  if (!root) return '暂无组件树';
  return `${root.componentId} · 直接子 ${root.children.length} / 节点合计 ${countNodes(root)}`;
});

/**
 * 组件树的字符轮廓，直接把 treebuilder 的组装结果摊开给人看。
 * 节点少时比翻 store JSON 直观得多。用 └─/├─/│ 画是因为父子的**嵌套**才是重点。
 */
const treeOutline = computed(() => {
  const root = treeRoot.value;
  if (!root) return '';

  const lines: string[] = [];
  const walk = (node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    lines.push(isRoot ? node.componentId : `${prefix}${isLast ? '└─ ' : '├─ '}${node.componentId}`);
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((child, index) => {
      walk(child, childPrefix, index === node.children.length - 1, false);
    });
  };
  walk(root, '', true, true);

  return lines.join('\n');
});

/**
 * store.errorMap 的条目列表（[错误 id, 错误对象]），供「错误信息」弹窗逐条展示。
 * 组件类型未注册渲染器时会出现 RENDERER_NOT_FOUND。
 */
const errorList = computed(() => Object.entries(storeState.value?.errorMap ?? {}));

/**
 * Store 概览统计，展示在「查看 Store」弹窗顶部。
 *
 * - components：hydrateNodeMap 里的组件总数（= 协议登记过的组件节点），即「当前渲染的组件总数」；
 * - rendered：其中真正渲染出节点（`_vnode` 是 VNode）的数量，用来区分「登记了」与「渲染出来了」；
 * - treeNodes：treeMap 里所有 surface 的树节点合计（走 children 递归，含 DAG 展开的重复；
 *   Card.child 这类组件私有字段不参与建树，所以通常小于 components）；
 * - surfaces / errors：surfaceMap 与 errorMap 的条目数。
 */
const storeStats = computed(() => {
  const state = storeState.value;
  if (!state) {
    return { components: 0, rendered: 0, treeNodes: 0, surfaces: 0, errors: 0 };
  }

  const nodes = Object.values(state.hydrateNodeMap);
  const treeNodes = Object.values(state.treeMap).reduce(
    (sum, tree) => (tree ? sum + countNodes(tree.root) : sum),
    0,
  );

  return {
    components: nodes.length,
    rendered: nodes.filter((node) => isVNode(node._vnode)).length,
    treeNodes,
    surfaces: Object.keys(state.surfaceMap).length,
    errors: Object.keys(state.errorMap).length,
  };
});

/** 用 vue 的 render() 把树根节点的 vnode 挂到预览容器上。 */
const renderPreview = () => {
  const container = previewRef.value;
  if (!container) return;

  const vnode = treeRoot.value?.vnode;
  // cloneVNode 是必需的：store 里存的就是同一个 VNode 实例，
  // 反复渲染同一个实例会触发 Vue 的复用警告。渲染不出来时渲染 null 以清空容器。
  render(isVNode(vnode) ? cloneVNode(vnode) : null, container);
};

watch(treeRoot, renderPreview);

/** 切换 mock 时先清空 store，避免上一个 mock 的 surface/节点残留在里面。 */
const loadMock = () => {
  clearStore();
  storeState.value = parseA2UI(activeMock.value.raw);
  renderPreview();
};

watch(mockIndex, loadMock);

onMounted(() => {
  const store = init(renderMap);
  unsubscribe = store.subscribe((state) => {
    storeState.value = state;
  });
  loadMock();
});

onBeforeUnmount(() => {
  unsubscribe?.();
  // render() 产生的 DOM 不归本组件管，卸载时要手动清掉。
  if (previewRef.value) {
    render(null, previewRef.value);
  }
});
</script>

<style scoped>
.playground {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
}

.toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.mock-select {
  width: 230px;
}

.titles h1 {
  margin: 0;
  font-size: 1.4rem;
}

.titles p {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.82rem;
}

.panel {
  padding: 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.tag {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 0.75rem;
}

.alert-list {
  display: grid;
  gap: 0.5rem;
}

/* Store 弹窗顶部的统计条：一眼看清当前 store 里有多少组件 / 树节点 / 错误。 */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.65rem 0.4rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.stat--primary {
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.stat--danger {
  border-color: #fbc4c4;
  background: #fef0f0;
}

.stat__value {
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.1;
  color: #1f2937;
}

.stat--primary .stat__value {
  color: #409eff;
}

.stat--danger .stat__value {
  color: #f56c6c;
}

.stat__label {
  color: #6b7280;
  font-size: 0.72rem;
  text-align: center;
}

.preview {
  min-height: 72px;
  padding: 1.25rem;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fbfdff;
}

.hint {
  margin: 0.75rem 0 0;
  color: #9ca3af;
  font-size: 0.85rem;
}

.outline-block {
  margin-top: 1rem;
}

.outline-title {
  color: #6b7280;
  font-size: 0.78rem;
}

.outline {
  margin: 0.35rem 0 0;
  padding: 0.75rem 1rem;
  overflow: auto;
  border-radius: 8px;
  background: #f8fafc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  color: #1f2937;
}

.code {
  max-height: 60vh;
  margin: 0;
  padding: 1rem;
  overflow: auto;
  border-radius: 8px;
  background: #f8fafc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #1f2937;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

<style>
/* 预览区的节点由 vue 的 render() 独立挂载，不带本组件的 scoped 属性，
   所以这条归一化规则不能加 scoped。 */
.preview > :first-child {
  margin-top: 0;
}

.preview > :last-child {
  margin-bottom: 0;
}

/* el-select 的下拉是 teleport 到 body 的，scoped 样式够不着，
   所以选项内部布局放在全局块、用 popper-class 限定作用域。 */
.mock-select-popper .mock-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.mock-select-popper .mock-option__label {
  font-weight: 600;
}

.mock-select-popper .mock-option__desc {
  color: #909399;
  font-size: 0.75rem;
}

.mock-select-popper .el-select-dropdown__item {
  height: auto;
  line-height: 1.5;
  padding-top: 6px;
  padding-bottom: 6px;
}
</style>
