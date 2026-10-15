import { defineComponent, h, ref, type PropType, type VNodeChild } from 'vue';
import { readString, type ComponentRenderer, type RenderContext } from 'a2ui-core';

import { childOf, normalizeNode, withKey, type VueNode } from '../internal/node';
import { alignOf, flexContainer, GAP, justifyOf } from '../internal/styles';

/**
 * 「容器」组件：自己不下蛋，只是把别的组件按 componentId 放进布局里。
 *
 * 子节点一律通过 `childOf` 生成**延迟解析**的占位（见 internal/node.ts），
 * 而不是在这里立刻读取 —— hydrate 是单趟遍历，此刻兄弟节点可能还没渲染完。
 */

/** 取 children.explicitList 的 componentId 列表，非字符串元素直接丢弃。 */
const explicitChildren = (children: unknown): string[] => {
  const record = children as { explicitList?: unknown } | null;
  if (!record || !Array.isArray(record.explicitList)) {
    return [];
  }
  return record.explicitList.filter((id): id is string => typeof id === 'string');
};

/**
 * 解析 children 得到**子节点列表**。协议给了两种形态：
 *
 * - `explicitList`：固定的 componentId 数组 → 各自生成一个延迟解析的占位。这里**不加 key**：
 *   列表由协议写死，运行期顺序不会变，位置本身就是稳定的身份，加 key 只是噪音
 *   （同一 componentId 被 DAG 展开两次时反而会撞 key）。
 * - `template`：`{ componentId, dataBinding }` → 交给 `context.renderTemplate`，按数据列表
 *   逐个渲染模板组件，直接拿到一组已渲染节点。这里**要加 key**：集合是数据驱动的，中间插入
 *   或删除会让位置整体平移，没有稳定 key 就会把内容错位到别的 item 上（详见 `withKey`）。
 *
 * template 的展开在 core（`renderTemplate`）里做：它要读组件协议 + 递归调用渲染函数，
 * 容器这里只负责把返回的节点摆进布局。
 */
const resolveChildNodes = (children: unknown, context: RenderContext): VNodeChild[] => {
  const record = children as { explicitList?: unknown; template?: unknown } | null;
  if (!record) {
    return [];
  }

  if (record.template !== null && typeof record.template === 'object') {
    const template = record.template as { componentId?: unknown; dataBinding?: unknown };
    const componentId = typeof template.componentId === 'string' ? template.componentId : '';
    const dataBinding = typeof template.dataBinding === 'string' ? template.dataBinding : '';
    if (!componentId || !dataBinding) {
      return [];
    }
    return context
      .renderTemplate(componentId, dataBinding)
      .map((item) => withKey(normalizeNode(item.node), item.key));
  }

  return explicitChildren(children).map((id) => childOf(context.resolve, id));
};

/** Row：主轴水平，distribution → justify-content，alignment → align-items。 */
export const renderRow: ComponentRenderer<VueNode> = (props, context) =>
  h(
    'div',
    {
      style: {
        ...flexContainer('row'),
        justifyContent: justifyOf(props.distribution),
        alignItems: alignOf(props.alignment),
      },
    },
    resolveChildNodes(props.children, context),
  );

/** Column：主轴垂直。 */
export const renderColumn: ComponentRenderer<VueNode> = (props, context) =>
  h(
    'div',
    {
      style: {
        ...flexContainer('column'),
        justifyContent: justifyOf(props.distribution),
        alignItems: alignOf(props.alignment),
      },
    },
    resolveChildNodes(props.children, context),
  );

/** List：direction 决定排布方向，alignment 决定交叉轴对齐。 */
export const renderList: ComponentRenderer<VueNode> = (props, context) => {
  const direction = String(props.direction) === 'horizontal' ? 'row' : 'column';

  return h(
    'div',
    {
      style: {
        ...flexContainer(direction),
        alignItems: alignOf(props.alignment),
      },
    },
    resolveChildNodes(props.children, context),
  );
};

/** Card：给单个子组件套一个卡片容器。 */
export const renderCard: ComponentRenderer<VueNode> = (props, context) =>
  h(
    'div',
    {
      style: {
        display: 'block',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        background: '#ffffff',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
      },
    },
    [childOf(context.resolve, String(props.child ?? ''))],
  );

// ---- Tabs ----

const TAB_BUTTON = {
  padding: '0.35rem 0.75rem',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: '#6b7280',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

const TAB_BUTTON_ACTIVE = {
  color: '#409eff',
  borderBottomColor: '#409eff',
  fontWeight: 600,
} as const;

interface TabItem {
  title: string;
  child: string;
}

const parseTabItems = (tabItems: unknown, read: (path: string) => unknown): TabItem[] => {
  if (!Array.isArray(tabItems)) {
    return [];
  }

  return tabItems.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      title: readString(record.title, read),
      child: typeof record.child === 'string' ? record.child : '',
    };
  });
};

/** Tabs 需要记住「当前选中页」，所以是个有状态组件而不是纯函数。 */
const A2UITabs = defineComponent({
  name: 'A2UITabs',
  props: {
    items: { type: Array as PropType<TabItem[]>, required: true },
    resolve: { type: Function as PropType<(componentId: string) => unknown>, required: true },
  },
  setup(props) {
    const active = ref(0);

    return () => {
      if (props.items.length === 0) {
        return null;
      }

      // items 可能随 surfaceUpdate 变化，索引要夹紧，否则会取到 undefined。
      const index = Math.min(active.value, props.items.length - 1);
      const current = props.items[index];

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP } }, [
        h(
          'div',
          { style: { display: 'flex', gap: '4px', borderBottom: '1px solid #e5e7eb' } },
          props.items.map((item, itemIndex) =>
            h(
              'button',
              {
                type: 'button',
                key: `${item.child}-${itemIndex}`,
                onClick: () => {
                  active.value = itemIndex;
                },
                style: { ...TAB_BUTTON, ...(itemIndex === index ? TAB_BUTTON_ACTIVE : {}) },
              },
              item.title,
            ),
          ),
        ),
        h('div', null, [childOf(props.resolve, current.child)]),
      ]);
    };
  },
});

/** Tabs：tabItems 的 title 支持字面量或 path，child 指向面板内容组件。 */
export const renderTabs: ComponentRenderer<VueNode> = (props, context) =>
  h(A2UITabs, {
    items: parseTabItems(props.tabItems, context.read),
    resolve: context.resolve,
  });

// ---- Modal ----

/** Modal 需要记住「是否打开」，同样是有状态组件。 */
const A2UIModal = defineComponent({
  name: 'A2UIModal',
  props: {
    entryPointChild: { type: String, required: true },
    contentChild: { type: String, required: true },
    resolve: { type: Function as PropType<(componentId: string) => unknown>, required: true },
  },
  setup(props) {
    const open = ref(false);

    return () =>
      h('div', null, [
        h(
          'span',
          {
            style: { display: 'inline-flex' },
            onClick: () => {
              open.value = true;
            },
          },
          [childOf(props.resolve, props.entryPointChild)],
        ),
        open.value
          ? h(
              'div',
              {
                style: {
                  position: 'fixed',
                  inset: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(15, 23, 42, 0.45)',
                  zIndex: 2000,
                },
                onClick: () => {
                  open.value = false;
                },
              },
              [
                h(
                  'div',
                  {
                    style: {
                      minWidth: '320px',
                      maxWidth: '80vw',
                      maxHeight: '80vh',
                      overflow: 'auto',
                      padding: '1.25rem',
                      borderRadius: '12px',
                      background: '#ffffff',
                      boxShadow: '0 16px 40px rgba(15, 23, 42, 0.24)',
                    },
                    // 点内容区不应该关掉弹层。
                    onClick: (event: MouseEvent) => {
                      event.stopPropagation();
                    },
                  },
                  [childOf(props.resolve, props.contentChild)],
                ),
              ],
            )
          : null,
      ]);
  },
});

/** Modal：entryPointChild 是被点击的组件，contentChild 是弹层内容。 */
export const renderModal: ComponentRenderer<VueNode> = (props, context) =>
  h(A2UIModal, {
    entryPointChild: String(props.entryPointChild ?? ''),
    contentChild: String(props.contentChild ?? ''),
    resolve: context.resolve,
  });
