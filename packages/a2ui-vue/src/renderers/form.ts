import { defineComponent, h, ref, watch, type PropType } from 'vue';
import {
  ErrorType,
  readNumber,
  readString,
  readStringArray,
  recordError,
  resolveAction,
  type ComponentRenderer,
  type RenderContext,
} from 'a2ui-core';

import { childOf, type VueNode } from '../internal/node';

/**
 * 读布尔取值对象。
 *
 * 协议里 `value` 要么 `{ literalBoolean }` 要么 `{ path }`，core 的 readBoolean 已经覆盖，
 * 这里只是把「取不到时按未选中」这层默认值固定下来，免得每个表单控件各写一遍。
 */
const readBooleanValue = (value: unknown, read: (path: string) => unknown): boolean => {
  if (value !== null && typeof value === 'object') {
    const record = value as { literalBoolean?: unknown; path?: unknown };
    if (typeof record.literalBoolean === 'boolean') {
      return record.literalBoolean;
    }
    if (typeof record.path === 'string') {
      return read(record.path) === true;
    }
  }
  return false;
};

/**
 * 从取值对象里提取 `path`（仅当它是字符串时）。
 *
 * 表单控件的 `value` / `text` / `selections` 都是取值对象（`{ path }` 或 `{ literal* }`）。
 * 只有带 `path` 的才需要「写回」——纯字面量是静态值，写回没有意义（也没有目标）。
 */
const boundPath = (value: unknown): string | undefined => {
  if (value !== null && typeof value === 'object') {
    const record = value as { path?: unknown };
    return typeof record.path === 'string' ? record.path : undefined;
  }
  return undefined;
};

/** 表单类控件的共用样式。 */
const CONTROL_STYLE = {
  padding: '0.4rem 0.6rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#1f2937',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
} as const;

const FIELD_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '0.85rem',
} as const;

const LABEL_STYLE = { color: '#374151' } as const;

const BUTTON_BASE = {
  padding: '0.45rem 1rem',
  border: '1px solid transparent',
  borderRadius: '6px',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  cursor: 'pointer',
} as const;

const BUTTON_PRIMARY = { background: '#409eff', color: '#ffffff' } as const;
const BUTTON_DEFAULT = { background: '#ffffff', color: '#1f2937', borderColor: '#d1d5db' } as const;

/**
 * 处理 Button 点击：解析动作，按 `type` 分成两支走。
 *
 * - **`type: "local"`（协议扩展）**：把 `action.local` 里的操作**模拟成一次数据绑定写回** ——
 *   对每个 `updateDataModel` 操作调一次 `context.updateModel(path, value)`，与表单控件输入时
 *   走的是同一条链路（写 store → 触发全量重渲染），因此绑定了同一 path 的组件会立刻跟着变。
 *   这一支**不经过宿主、也不发给服务端**，这正是「本地动作」的意义。
 * - **其余（服务端分支）**：解析 `context` 后按 `client_to_server.json` 组装完整 `userAction`
 *   消息，通过 DOM 自定义事件 `a2ui-action`（`bubbles: true`）抛给宿主，由宿主自行发给服务端。
 *   core 不碰网络，宿主可以换成 fetch / SSE / WebSocket 任意传输。
 *
 * 两类动作都不做时（`action` 缺 `name`、不是对象）静默忽略，不抛错。
 */
const handleButtonClick = (event: MouseEvent, action: unknown, context: RenderContext): void => {
  const resolved = resolveAction(action, {
    surfaceId: context.surfaceId,
    componentId: context.componentId,
    read: context.read,
  });

  if (!resolved) {
    return;
  }

  if (resolved.kind === 'local') {
    for (const operation of resolved.operations) {
      context.updateModel(operation.path, operation.value);
    }
    return;
  }

  const target = event.currentTarget as HTMLElement | null;
  target?.dispatchEvent(
    new CustomEvent('a2ui-action', { detail: resolved.message, bubbles: true }),
  );
};

/** Button：child 指向按钮文案组件，primary 决定是否主按钮。 */
export const renderButton: ComponentRenderer<VueNode> = (props, context) =>
  h(
    'button',
    {
      type: 'button',
      style: { ...BUTTON_BASE, ...(props.primary === true ? BUTTON_PRIMARY : BUTTON_DEFAULT) },
      onClick: (event: MouseEvent) => handleButtonClick(event, props.action, context),
    },
    [childOf(context.resolve, String(props.child ?? ''))],
  );

/** CheckBox：label 与 value 都支持字面量或 path；value 带 path 时勾选会写回数据模型。 */
export const renderCheckBox: ComponentRenderer<VueNode> = (props, context) => {
  const path = boundPath(props.value);

  return h(
    'label',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.9rem',
        cursor: 'pointer',
      },
    },
    [
      h('input', {
        type: 'checkbox',
        checked: readBooleanValue(props.value, context.read),
        onChange: path
          ? (event: Event) => context.updateModel(path, (event.target as HTMLInputElement).checked)
          : undefined,
      }),
      h('span', null, readString(props.label, context.read)),
    ],
  );
};

/** TextField.textFieldType → 原生 input type；longText 单独走 textarea。 */
const TEXT_FIELD_INPUT_TYPES: Record<string, string> = {
  shortText: 'text',
  number: 'number',
  obscured: 'password',
  date: 'date',
};

/** TextField：label 必需，text 为初值，textFieldType 决定控件形态；text 带 path 时输入会写回。 */
export const renderTextField: ComponentRenderer<VueNode> = (props, context) => {
  const label = readString(props.label, context.read);
  const value = readString(props.text, context.read);
  const kind = String(props.textFieldType ?? 'shortText');
  const pattern = typeof props.validationRegexp === 'string' ? props.validationRegexp : undefined;
  const path = boundPath(props.text);
  const onInput = path
    ? (event: Event) => context.updateModel(path, (event.target as HTMLInputElement).value)
    : undefined;

  const control =
    kind === 'longText'
      ? h('textarea', { rows: 3, value, onInput, style: CONTROL_STYLE })
      : h('input', {
          type: TEXT_FIELD_INPUT_TYPES[kind] ?? 'text',
          value,
          pattern,
          onInput,
          style: CONTROL_STYLE,
        });

  return h('label', { style: FIELD_STYLE }, [
    h('span', { style: LABEL_STYLE }, label),
    control,
  ]);
};

/** DateTimeInput：enableDate / enableTime 组合出三种原生控件；value 带 path 时选择会写回。 */
export const renderDateTimeInput: ComponentRenderer<VueNode> = (props, context) => {
  const enableTime = props.enableTime === true;
  const enableDate = props.enableDate !== false;
  const path = boundPath(props.value);

  const type = enableDate && enableTime ? 'datetime-local' : enableTime ? 'time' : 'date';

  return h('input', {
    type,
    value: readString(props.value, context.read),
    onChange: path
      ? (event: Event) => context.updateModel(path, (event.target as HTMLInputElement).value)
      : undefined,
    style: CONTROL_STYLE,
  });
};

// ---- MultipleChoice ----

interface ChoiceOption {
  label: string;
  value: string;
}

const parseOptions = (options: unknown, read: (path: string) => unknown): ChoiceOption[] => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((option) => {
    const record = (option ?? {}) as Record<string, unknown>;
    return { label: readString(record.label, read), value: String(record.value ?? '') };
  });
};

const CHIP_STYLE = {
  padding: '0.3rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '999px',
  background: '#ffffff',
  color: '#374151',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  cursor: 'pointer',
} as const;

const CHIP_ACTIVE_STYLE = {
  borderColor: '#409eff',
  background: '#ecf5ff',
  color: '#409eff',
} as const;

/** MultipleChoice 需要维护勾选状态与筛选关键词，因此是有状态组件。 */
const A2UIMultipleChoice = defineComponent({
  name: 'A2UIMultipleChoice',
  props: {
    options: { type: Array as PropType<ChoiceOption[]>, required: true },
    selections: { type: Array as PropType<string[]>, required: true },
    variant: { type: String, default: 'checkbox' },
    filterable: { type: Boolean, default: false },
    maxAllowedSelections: { type: Number, default: 0 },
    /** selections 带 path 时，勾选变化会把新数组写回数据模型；纯字面量时为 undefined。 */
    onUpdate: { type: Function as PropType<(selections: string[]) => void>, default: undefined },
  },
  setup(props) {
    const selected = ref<string[]>([...props.selections]);
    const keyword = ref('');

    // 数据模型可能被外部（服务端 dataModelUpdate 或其它控件写回同一 path）更新，
    // 这里把外部变化同步回本地勾选状态，保证受控组件的值始终反映数据模型。
    watch(
      () => props.selections,
      (next) => {
        selected.value = [...next];
      },
    );

    const toggle = (value: string) => {
      let next: string[];
      if (selected.value.includes(value)) {
        next = selected.value.filter((item) => item !== value);
      } else if (props.maxAllowedSelections > 0 && selected.value.length >= props.maxAllowedSelections) {
        // maxAllowedSelections 为 0 / 负数表示不限。
        return;
      } else {
        next = [...selected.value, value];
      }
      selected.value = next;
      props.onUpdate?.(next);
    };

    return () => {
      const filter = keyword.value.trim().toLowerCase();
      const visible = filter
        ? props.options.filter((option) => option.label.toLowerCase().includes(filter))
        : props.options;
      const isChips = props.variant === 'chips';

      const items = visible.map((option) => {
        const isSelected = selected.value.includes(option.value);

        if (isChips) {
          return h(
            'button',
            {
              type: 'button',
              key: option.value,
              'aria-pressed': String(isSelected),
              onClick: () => toggle(option.value),
              style: { ...CHIP_STYLE, ...(isSelected ? CHIP_ACTIVE_STYLE : {}) },
            },
            option.label,
          );
        }

        return h(
          'label',
          {
            key: option.value,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.9rem',
              cursor: 'pointer',
            },
          },
          [
            h('input', {
              type: 'checkbox',
              checked: isSelected,
              onChange: () => toggle(option.value),
            }),
            h('span', null, option.label),
          ],
        );
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        props.filterable
          ? h('input', {
              type: 'search',
              value: keyword.value,
              placeholder: '筛选…',
              onInput: (event: Event) => {
                keyword.value = (event.target as HTMLInputElement).value;
              },
              style: CONTROL_STYLE,
            })
          : null,
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: isChips ? 'row' : 'column',
              flexWrap: isChips ? 'wrap' : 'nowrap',
              gap: '8px',
            },
          },
          items,
        ),
        props.maxAllowedSelections > 0
          ? h(
              'div',
              { style: { fontSize: '0.78rem', color: '#6b7280' } },
              `最多可选 ${props.maxAllowedSelections} 项`,
            )
          : null,
      ]);
    };
  },
});

/** MultipleChoice：variant 决定 checkbox 列表还是 chips，filterable 决定是否带筛选框。 */
export const renderMultipleChoice: ComponentRenderer<VueNode> = (props, context) => {
  if (!Array.isArray(props.options)) {
    recordError(
      ErrorType.PARSE_ERROR,
      `surface "${context.surfaceId}" 的 MultipleChoice 组件 "${context.componentId}" 缺少 options，渲染为空。`,
    );
    return null;
  }

  const path = boundPath(props.selections);

  return h(A2UIMultipleChoice, {
    options: parseOptions(props.options, context.read),
    selections: readStringArray(props.selections, context.read),
    variant: String(props.variant ?? 'checkbox'),
    filterable: props.filterable === true,
    maxAllowedSelections:
      typeof props.maxAllowedSelections === 'number' ? props.maxAllowedSelections : 0,
    onUpdate: path ? (selections: string[]) => context.updateModel(path, selections) : undefined,
  });
};

/** Slider：minValue / maxValue 是普通数字，value 是取值对象；value 带 path 时拖动会写回。 */
export const renderSlider: ComponentRenderer<VueNode> = (props, context) => {
  const min = typeof props.minValue === 'number' ? props.minValue : 0;
  const max = typeof props.maxValue === 'number' ? props.maxValue : 100;
  const path = boundPath(props.value);

  return h('input', {
    type: 'range',
    min,
    max,
    value: readNumber(props.value, context.read, min),
    onInput: path
      ? (event: Event) => context.updateModel(path, Number((event.target as HTMLInputElement).value))
      : undefined,
    style: { width: '100%' },
  });
};
