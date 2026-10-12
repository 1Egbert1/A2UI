import { defineComponent, h, ref, type PropType } from 'vue';
import {
  ErrorType,
  readNumber,
  readString,
  readStringArray,
  recordError,
  type ComponentRenderer,
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
 * 把 `Button.action` 抛给宿主。
 *
 * core 还没有 client→server 的回传通道，本包也不该自己造事件总线，所以用 DOM 自定义事件
 * 作为出口：宿主只要在任意祖先节点上监听 `a2ui-action`，就能从 `event.detail` 拿到
 * 协议里原样的 `{ name, context }`。
 */
const dispatchAction = (event: MouseEvent, action: unknown): void => {
  if (!action || typeof action !== 'object') {
    return;
  }

  const target = event.currentTarget as HTMLElement | null;
  target?.dispatchEvent(new CustomEvent('a2ui-action', { detail: action, bubbles: true }));
};

/** Button：child 指向按钮文案组件，primary 决定是否主按钮。 */
export const renderButton: ComponentRenderer<VueNode> = (props, context) =>
  h(
    'button',
    {
      type: 'button',
      style: { ...BUTTON_BASE, ...(props.primary === true ? BUTTON_PRIMARY : BUTTON_DEFAULT) },
      onClick: (event: MouseEvent) => dispatchAction(event, props.action),
    },
    [childOf(context.resolve, String(props.child ?? ''))],
  );

/** CheckBox：label 与 value 都支持字面量或 path。 */
export const renderCheckBox: ComponentRenderer<VueNode> = (props, context) =>
  h(
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
      h('input', { type: 'checkbox', checked: readBooleanValue(props.value, context.read) }),
      h('span', null, readString(props.label, context.read)),
    ],
  );

/** TextField.textFieldType → 原生 input type；longText 单独走 textarea。 */
const TEXT_FIELD_INPUT_TYPES: Record<string, string> = {
  shortText: 'text',
  number: 'number',
  obscured: 'password',
  date: 'date',
};

/** TextField：label 必需，text 为初值，textFieldType 决定控件形态。 */
export const renderTextField: ComponentRenderer<VueNode> = (props, context) => {
  const label = readString(props.label, context.read);
  const value = readString(props.text, context.read);
  const kind = String(props.textFieldType ?? 'shortText');
  const pattern = typeof props.validationRegexp === 'string' ? props.validationRegexp : undefined;

  const control =
    kind === 'longText'
      ? h('textarea', { rows: 3, value, style: CONTROL_STYLE })
      : h('input', {
          type: TEXT_FIELD_INPUT_TYPES[kind] ?? 'text',
          value,
          pattern,
          style: CONTROL_STYLE,
        });

  return h('label', { style: FIELD_STYLE }, [
    h('span', { style: LABEL_STYLE }, label),
    control,
  ]);
};

/** DateTimeInput：enableDate / enableTime 组合出三种原生控件。 */
export const renderDateTimeInput: ComponentRenderer<VueNode> = (props, context) => {
  const enableTime = props.enableTime === true;
  const enableDate = props.enableDate !== false;

  const type = enableDate && enableTime ? 'datetime-local' : enableTime ? 'time' : 'date';

  return h('input', {
    type,
    value: readString(props.value, context.read),
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
  },
  setup(props) {
    const selected = ref<string[]>([...props.selections]);
    const keyword = ref('');

    const toggle = (value: string) => {
      if (selected.value.includes(value)) {
        selected.value = selected.value.filter((item) => item !== value);
        return;
      }
      // maxAllowedSelections 为 0 / 负数表示不限。
      if (props.maxAllowedSelections > 0 && selected.value.length >= props.maxAllowedSelections) {
        return;
      }
      selected.value = [...selected.value, value];
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

  return h(A2UIMultipleChoice, {
    options: parseOptions(props.options, context.read),
    selections: readStringArray(props.selections, context.read),
    variant: String(props.variant ?? 'checkbox'),
    filterable: props.filterable === true,
    maxAllowedSelections:
      typeof props.maxAllowedSelections === 'number' ? props.maxAllowedSelections : 0,
  });
};

/** Slider：minValue / maxValue 是普通数字，value 是取值对象。 */
export const renderSlider: ComponentRenderer<VueNode> = (props, context) => {
  const min = typeof props.minValue === 'number' ? props.minValue : 0;
  const max = typeof props.maxValue === 'number' ? props.maxValue : 100;

  return h('input', {
    type: 'range',
    min,
    max,
    value: readNumber(props.value, context.read, min),
    style: { width: '100%' },
  });
};
