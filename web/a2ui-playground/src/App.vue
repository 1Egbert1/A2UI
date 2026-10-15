<template>
  <div class="playground">
    <header class="toolbar">
      <div class="titles">
        <h1>A2UI Playground</h1>
        <p>mock → init(renderMap, renderTree) → parseA2UI → hydrate → buildTree → SDK 回调 renderTree</p>
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

      <div v-if="activeDataModel !== null" class="binding-hint">
        <strong>{{ bindingHintTitle }}</strong>
        <ol v-if="activeSurfaceId === 'data-binding'">
          <li>改「Name」输入框 → 下方标题（也绑定 <code>/user/name</code>）跟着变；</li>
          <li>勾选 Subscribe、拖动音量 → 值写回数据模型并触发重渲染；</li>
          <li>下面 JSON 是 <code>dataModelMap['data-binding']</code> 的实时内容，改动即时反映。</li>
        </ol>
        <p v-else class="binding-desc">{{ bindingHintDesc }}</p>
        <pre class="binding-model">{{ activeDataModelJson }}</pre>
      </div>

      <div v-if="treeOutline" class="outline-block">
        <span class="outline-title">组件树 treeMap["{{ activeSurfaceId }}"].root</span>
        <pre class="outline">{{ treeOutline }}</pre>
      </div>
    </section>

    <section class="panel server-panel">
      <div class="panel-header">
        <h2>a2ui-server</h2>
        <span class="tag">POST /api/a2ui/run?stream=false</span>
      </div>

      <p class="server-desc">
        把输入发给本地 a2ui-server（默认 <code>http://localhost:3000</code>）。两种传输都在<strong>同一个入口</strong>上：
        <strong>非 SSE</strong> 加 <code>?stream=false</code>，一次拿回全部协议消息、拼成 JSONL 后解析；
        <strong>SSE 流式</strong>不加 query，收到一条 <code>CUSTOM a2ui.message</code> 就喂一条
        —— 与 Stream 面板的「逐条推送」是同一套机制，所以组件是一个个长出来的，不是攒完再闪现。
        <span class="server-desc__note">
          同一个会话（threadId）连点两次即多轮，第二次返回的是<strong>增量</strong>消息（只含改动的组件）。
        </span>
      </p>

      <div class="server-controls">
        <el-input
          v-model="serverPrompt"
          class="server-input"
          placeholder="例如：做一个购物车"
          @keyup.enter="requestFromServer"
        />
        <el-button
          type="primary"
          :loading="serverLoading"
          :disabled="sseActive"
          @click="requestFromServer"
        >
          生成（非 SSE）
        </el-button>
        <el-button
          :type="sseActive ? 'danger' : 'primary'"
          plain
          :disabled="serverLoading"
          @click="requestFromServerStream"
        >
          {{ sseActive ? '停止流式' : '生成（SSE 流式）' }}
        </el-button>
        <el-button plain :disabled="sseActive || serverLoading" @click="startNewServerSession">
          新会话
        </el-button>
        <el-button plain :disabled="sseActive || serverLoading" @click="backToMock">回到 mock</el-button>
      </div>

      <p v-if="serverError" class="server-error">请求失败：{{ serverError }}</p>

      <div v-if="serverResult || sseActive" class="server-meta">
        <span>thread <code>{{ serverThreadId }}</code></span>
        <span>surface <code>{{ serverResult?.surfaceId || '等待 a2ui.surface…' }}</code></span>
        <span>provider <code>{{ serverResult?.provider || '—' }}</code></span>
        <span>消息 <strong>{{ serverResult?.messages.length ?? 0 }}</strong> 条</span>
        <span v-if="sseActive">文本分片 <strong>{{ sseDeltaCount }}</strong> · 接收中…</span>
        <span v-else>耗时 <strong>{{ serverElapsed }}</strong> ms</span>
      </div>
    </section>

    <section class="panel stream-panel">
      <div class="panel-header">
        <h2>Stream 模拟</h2>
        <span class="tag">
          {{ activeMock.label }} · {{ streamMode === 'char' ? '字符流 50 字符 / 50ms' : '逐条推送' }}
        </span>
      </div>

      <p v-if="streamMode === 'jsonl'" class="stream-desc">
        把 mock 的消息一条条喂给 <code>createJSONLStream()</code>，每条抵达后立即刷新 store
        （hydrate + buildTree）。默认走 <strong>流式友好</strong> 顺序，预览区会随着消息逐条长大；
        切到 <strong>协议顺序</strong> 可以对比 <strong>beginRendering 的位置</strong> 的影响 ——
        那时前面全推完页面仍然是空的，直到最后一条才一次性出现。
        <span class="stream-desc__note">
          本模式不经过 buffer：一条 mock 消息就是一条消息，不会被拆开。
        </span>
      </p>
      <p v-else class="stream-desc">
        把 <strong>紧凑版</strong> 数据拼成整段 JSONL，按 <strong>每 50ms 吐 50 个字符</strong> 喂给
        <code>createA2UIBuffer()</code>。切片必然落在 JSON 中间，buffer 靠括号配对捞值 —— 关键是
        <strong>不等整条消息收完</strong>：每有一个组件（或数据条目）闭合，就立刻把它
        <strong>补全成一条独立、可解析的消息</strong> 交给 parser，所以组件是一个个长出来的。
        <code>dataModelUpdate</code> 还会被 <strong>递归拆到叶子条目</strong>（path 带上祖先 key），
        列表数据因此也是一条条落进数据模型、一张张渲染出来。
        切到 <strong>协议顺序</strong> 可以对比 <strong>beginRendering 的位置</strong>：
        那时它排在最后，组件全到齐了树还是空的。
      </p>

      <div class="stream-controls">
        <el-select
          v-model="streamMode"
          class="stream-mode"
          size="default"
          popper-class="mock-select-popper"
        >
          <el-option
            v-for="mode in STREAM_MODES"
            :key="mode.value"
            :label="mode.label"
            :value="mode.value"
          >
            <div class="mock-option">
              <span class="mock-option__label">{{ mode.label }}</span>
              <span class="mock-option__desc">{{ mode.desc }}</span>
            </div>
          </el-option>
        </el-select>
        <el-select
          v-model="streamOrderIndex"
          class="stream-order"
          size="default"
          popper-class="mock-select-popper"
        >
          <el-option
            v-for="(order, index) in streamOrders"
            :key="order.label"
            :label="order.label"
            :value="index"
          >
            <div class="mock-option">
              <span class="mock-option__label">{{ order.label }}</span>
              <span class="mock-option__desc">{{ order.desc }}</span>
            </div>
          </el-option>
        </el-select>
        <el-button type="primary" :disabled="streamFinished" @click="pushNext">
          {{ pushLabel }}
        </el-button>
        <el-button :disabled="streamFinished" @click="toggleAuto">
          {{ streamAuto ? '暂停' : streamMode === 'char' ? '自动字符流' : '自动推送' }}
        </el-button>
        <el-button plain @click="resetStream">重置</el-button>
      </div>

      <div class="stream-meta">
        <span v-if="streamMode === 'char'" class="stream-buffer">
          buffer：值 <strong>{{ bufferValues }}</strong> → 补全消息
          <strong>{{ bufferMessages }}</strong>
        </span>
        <span class="stream-counter">
          <template v-if="streamMode === 'char'">
            已推送 <strong>{{ pushedUnits }}</strong> / {{ totalUnits }} 片 · 字符 {{ charChars }} /
            {{ streamText.length }}
          </template>
          <template v-else>
            已推送 <strong>{{ pushedUnits }}</strong> / {{ totalUnits }} 条
          </template>
        </span>
      </div>

      <el-progress
        class="stream-progress"
        :percentage="streamPercent"
        :stroke-width="10"
        :show-text="false"
      />

      <div v-if="streamLog.length" class="stream-log">
        <div v-for="entry in streamLog" :key="entry.index" class="stream-log__row">
          <span class="stream-log__idx">#{{ String(entry.index).padStart(2, '0') }}</span>
          <span class="stream-log__kind" :class="`stream-log__kind--${entry.kind}`">
            {{ entry.kind }}
          </span>
          <span class="stream-log__detail">
            <em v-if="entry.note" class="stream-log__note">{{ entry.note }}</em>{{ entry.detail }}
          </span>
          <span class="stream-log__stat">
            组件 {{ entry.components }} · 树 {{ entry.treeNodes }} · 错误 {{ entry.errors }}
          </span>
        </div>
      </div>
      <p v-else class="hint">还没有推送任何消息，点「{{ pushLabel }}」开始。</p>
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
import {
  cloneVNode,
  computed,
  isVNode,
  onBeforeUnmount,
  onMounted,
  ref,
  render,
  watch,
  type VNode,
} from 'vue';
import {
  chunkText,
  clearStore,
  createA2UIBuffer,
  createJSONLStream,
  getA2UIStore,
  init,
  parseA2UI,
  simulateTextStream,
} from 'a2ui-core';
import type { A2UIBuffer, A2UIStoreState, JSONLStream, TreeMap, TreeNode } from 'a2ui-core';
import {
  columnRowMixMessages,
  columnTextsMessages,
  dataBindingMessages,
  deriveStreamOrders,
  listTemplateMessages,
  localActionMessages,
  productCardMessages,
  shoppingCartMessages,
  simpleTextMessages,
} from 'a2ui-core/mock';
import { renderMap } from 'a2ui-vue';

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
 *
 * 每个 mock 都以「一行一条消息」的字符串数组形式存在（`a2ui-core/mock`），
 * 批量解析时 `join('\n')` 回整段文本，流式面板则直接逐条推送。
 */
const MOCKS = [
  {
    label: 'simple-text',
    desc: '单个 Text，最小示例',
    surfaceId: 'simple-text',
    messages: simpleTextMessages,
  },
  {
    label: 'product-card',
    desc: '官方 05 示例，Card + Row + Column',
    surfaceId: 'gallery-product-card',
    messages: productCardMessages,
  },
  {
    label: 'column-texts',
    desc: '一父三子，验证父子组装',
    surfaceId: 'column-texts',
    messages: columnTextsMessages,
  },
  {
    label: 'column-row-mix',
    desc: 'Column / Row 混排，最深 5 层',
    surfaceId: 'column-row-mix',
    messages: columnRowMixMessages,
  },
  {
    label: 'data-binding',
    desc: '数据绑定：输入 / 勾选 / 拖动写回数据模型',
    surfaceId: 'data-binding',
    messages: dataBindingMessages,
  },
  {
    label: 'list-template',
    desc: 'List 动态渲染：按数据列表展开模板组件',
    surfaceId: 'list-template',
    messages: listTemplateMessages,
  },
  {
    label: 'shopping-cart',
    desc: '购物车列表：List 模板 + 图片 + 合计绑定',
    surfaceId: 'shopping-cart',
    messages: shoppingCartMessages,
  },
  {
    label: 'local-action',
    desc: '本地动作：按钮点击写回数据模型（不经过服务端）',
    surfaceId: 'local-action',
    messages: localActionMessages,
  },
] as const;

const dialogVisible = ref(false);
const errorDialogVisible = ref(false);
/** 默认停在 column-row-mix —— 多层 Column / Row 混排最能看出嵌套组装的效果。 */
const mockIndex = ref(3);
/** 下拉当前选中的 mock，批量渲染与 Stream 面板共用这一份数据源。 */
const activeMock = computed(() => MOCKS[mockIndex.value] ?? MOCKS[0]);
const storeState = ref<A2UIStoreState | null>(null);
/** 交给 vue 的 render() 作为挂载容器的元素。 */
const previewRef = ref<HTMLElement | null>(null);
let unsubscribe: (() => void) | undefined;

/** 服务端 `?stream=false` 的响应体（只声明本面板用到的字段）。 */
interface ServerRunResult {
  sessionId: string;
  surfaceId: string;
  messages: unknown[];
  provider: string;
  warnings: string[];
}

/** AG-UI 事件（只声明本面板会分支处理的几种，其余原样忽略）。 */
type AgUiSseEvent =
  | { type: 'RUN_STARTED'; threadId: string; runId: string }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'RUN_FINISHED'; threadId: string; runId: string }
  | { type: 'RUN_ERROR'; message: string; code: string }
  | { type: 'CUSTOM'; name: string; value: Record<string, unknown> };

/** 生成一个新的 threadId：同一个 threadId 的后续请求，在服务端算「同一会话的下一轮」。 */
function newServerThreadId(): string {
  return `pg-${Math.random().toString(36).slice(2, 10)}`;
}

/** 预览的数据来源：mock 下拉 vs 服务端生成。两者写同一份 store，但 surfaceId 归属不同。 */
const dataSource = ref<'mock' | 'server'>('mock');

/** 服务端地址：可用 `VITE_A2UI_SERVER` 覆盖，缺省打本机 3000。 */
const SERVER_BASE = String(import.meta.env.VITE_A2UI_SERVER || 'http://localhost:3000');

const serverPrompt = ref('做一个购物车');
const serverLoading = ref(false);
const serverError = ref('');
const serverElapsed = ref(0);
const serverResult = ref<ServerRunResult | null>(null);
/** 同一个 threadId 连续请求 = 多轮对话，服务端只回增量；「新会话」会换一个。 */
const serverThreadId = ref(newServerThreadId());

/** SSE 读取进行中。读取期间按钮兼作「停止」。 */
const sseActive = ref(false);
/** 已收到的 TEXT_MESSAGE_CONTENT 分片数（模型吐字的「块」），只用于展示。 */
const sseDeltaCount = ref(0);
/** 唯一的在途读取句柄：abort 会让服务端把这轮连接销毁掉（它监听了 req close）。 */
let sseController: AbortController | undefined;

/** 字符流模式的分片参数：每 50ms 吐 50 个字符，模拟模型按 token 逐字输出。 */
const CHAR_CHUNK = 50;
const CHAR_INTERVAL = 50;

/**
 * 流式面板的数据源**跟随下拉选中的 mock**：对 `activeMock.messages` 实时派生两种消息顺序
 * （协议顺序 / 流式友好），每种又带一份紧凑版（多条 surfaceUpdate 压成一条）。
 * 派生逻辑在 `a2ui-core/mock/stream` 的 `deriveStreamOrders` 里，任何 mock 都能直接套用。
 *
 * - 协议顺序：`beginRendering` 在最后。surface 只有在这一条才诞生，前面全推完树依然是空的；
 * - 流式友好：把 `beginRendering` 提到 root 之后。root 一到 surface 就成立，后续子组件每
 *   到达一条就挂上一批，预览区能真的「边到边长大」。
 *
 * 「字符流」模式走紧凑版 —— 这样 buffer 的「协议补全」（一条拆成 N 条）才看得见。
 */
const streamOrders = computed(() => deriveStreamOrders(activeMock.value.messages));

/**
 * 默认停在「流式友好」—— 这是**观感**的关键：协议顺序下组件全推完预览区一直空白，
 * 最后一条瞬间全出，是「跳变」而不是「生长」。想看协议原样顺序可以手动切回去对比。
 */
const streamOrderIndex = ref(1);
const streamMessages = computed(() => streamOrders.value[streamOrderIndex.value].messages);

/**
 * 推送模式：
 * - `jsonl`：一次推一条**完整消息**，交给 `createJSONLStream()`（行框定）。推送单元 = 消息。
 * - `char`：一次推**一片 50 字符**，交给 `createA2UIBuffer()`（JSON 框定）。切片必然落在
 *   JSON 中间，靠 buffer 的括号配对拼回完整消息，并把多组件的 surfaceUpdate 补全成 N 条。
 */
type StreamMode = 'jsonl' | 'char';
const STREAM_MODES = [
  { label: '逐条（JSONL）', desc: '一次推一条完整消息', value: 'jsonl' as StreamMode },
  {
    label: '字符流（50 字符 / 50ms）',
    desc: '一次推 50 字符，缓冲拼行 + 协议补全',
    value: 'char' as StreamMode,
  },
] as const;
const streamMode = ref<StreamMode>('jsonl');

/** 字符流模式的输入：紧凑版消息拼成整段 JSONL（结尾补换行）。 */
const streamText = computed(
  () => `${streamOrders.value[streamOrderIndex.value].compact.join('\n')}\n`,
);
/** 把整段文本按 50 字符切好，手动步进与总片数都用它。 */
const charChunks = computed(() => chunkText(streamText.value, CHAR_CHUNK));

/** 当前正在用的流式解析会话（`createJSONLStream()` 的实例），非响应式。 */
let stream: JSONLStream = createJSONLStream();
const streamCursor = ref(0);

/** 字符流的缓冲流实例（`createA2UIBuffer()`），非响应式。 */
let buffer: A2UIBuffer = createA2UIBuffer();
const charCursor = ref(0);

/** buffer 计数的响应式镜像（buffer 本身非响应式，抄进 ref 供模板展示）。 */
const bufferValues = ref(0);
const bufferMessages = ref(0);

/** 已记入日志的 emitted 行数，用来算出「本次 push 新补全出了哪些消息」。 */
let loggedLines = 0;
/** 字符流模式：已补全出的 surfaceUpdate 条数（日志里写「第 k/N 条」用）。 */
let charSurfaceSent = 0;

const streamAuto = ref(false);
const streamLog = ref<StreamLogEntry[]>([]);
let streamTimer: ReturnType<typeof setInterval> | undefined;
/** 字符流自动推送的停止句柄（`simulateTextStream` 的返回值）。 */
let autoStop: (() => void) | undefined;

/** 每推送一条记一行，直接摊开「这条消息让 store 变成了什么样」。 */
interface StreamLogEntry {
  index: number;
  kind: string;
  detail: string;
  /** 补全说明（如「由 1 条 surfaceUpdate 拆出第 3/26 条」）；逐条模式为空串。 */
  note: string;
  components: number;
  treeNodes: number;
  errors: number;
}

/** 当前模式下「推送单元」的总数：逐条模式是消息条数，字符流模式是分片数。 */
const totalUnits = computed(() =>
  streamMode.value === 'char' ? charChunks.value.length : streamMessages.value.length,
);

/** 已推送的单元数（游标）。 */
const pushedUnits = computed(() =>
  streamMode.value === 'char' ? charCursor.value : streamCursor.value,
);

/**
 * 预览区该看哪个 surface。
 *
 * 批量渲染与流式推送现在共用**同一份数据源**（下拉选中的 mock），写进同一个 store 的
 * 也是同一个 surfaceId，所以预览始终看 `activeMock.surfaceId`。下拉或模式一旦切换都会调用
 * `resetStream()` 把游标归零、清空 store，再重新解析当前 mock。
 */
/**
 * 当前预览的 surface。
 *
 * mock 与「服务端生成」写的是同一份 store，但 surfaceId 来源不同：服务端的 surfaceId 由服务端
 * 自己生成（`surface-xxxx`），必须跟着结果走 —— 否则预览区会去 treeMap 里找一个不存在的 key，
 * 渲染出来是空的。
 */
const activeSurfaceId = computed(() =>
  dataSource.value === 'server' ? (serverResult.value?.surfaceId ?? '') : activeMock.value.surfaceId,
);

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

/**
 * 预览用的组件树根节点。treeMap 由 `refreshDerivedState()` 写入——
 * 批量解析在整段 JSONL 末尾刷新一次，流式解析在每次 push 末尾刷新一次。
 */
const treeRoot = computed(
  () => storeState.value?.treeMap[activeSurfaceId.value]?.root ?? null,
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
 * 当前预览 surface 的数据模型，data-binding demo 用它实时展示「写回」的结果。
 * 其它 mock（如 product-card）也带 path 绑定，同样适用；取不到时返回 null。
 */
const activeDataModel = computed(() => storeState.value?.dataModelMap[activeSurfaceId.value] ?? null);

/** 数据模型的格式化 JSON，直接渲染进提示条。 */
const activeDataModelJson = computed(() =>
  activeDataModel.value === null ? '' : JSON.stringify(activeDataModel.value, null, 2),
);

/** 提示条标题：按当前 surface 区分「写回」与「只读绑定」。 */
const bindingHintTitle = computed(() => {
  if (activeSurfaceId.value === 'data-binding') return '数据绑定验证（写回）';
  if (activeSurfaceId.value === 'list-template') return '数据模型绑定（List 动态渲染）';
  if (activeSurfaceId.value === 'shopping-cart') return '购物车列表（List 模板 + 合计绑定）';
  if (activeSurfaceId.value === 'local-action') return '本地动作（点击写回数据模型）';
  return '数据模型绑定';
});

/**
 * 非 data-binding 的提示说明（data-binding 走上面的三步交互列表）。
 * list-template 讲清楚 List 的 template 绑定怎么驱动渲染；其余带数据模型的 mock（如
 * product-card、column-row-mix）给一句通用的 path 绑定说明。
 */
const bindingHintDesc = computed(() => {
  if (activeSurfaceId.value === 'list-template') {
    return (
      'List 的 children.template 绑定 /items，按 valueMap 的 3 个 item 各渲染一张卡片；' +
      '卡片内 Text 的相对路径 /items/item/name、/items/item/desc 解析到各 item 的值。'
    );
  }
  if (activeSurfaceId.value === 'shopping-cart') {
    return (
      'List 的 children.template 绑定 /cart/items，按 valueMap 的 3 个条目各渲染一张卡片；' +
      '卡片内 Image / Text 的相对路径 /cart/items/item/image、name、desc、price、qty 解析到各条目；' +
      '底部「合计」Text 绑定 /cart/total，与列表同源于一份数据模型。'
    );
  }
  if (activeSurfaceId.value === 'local-action') {
    return (
      '点「更新文案」按钮：action.type = "local" 表示本地动作，a2ui-vue 会把 action.local 里的' +
      ' updateDataModel 操作当成一次 updateModel 写回 —— 绑 /message 的 Text 随即更新。' +
      '整条链路不经过服务端，下面 JSON 里的 /message 会实时变成新文案。'
    );
  }
  return '下面 JSON 是当前 surface 的数据模型（dataModelMap 的实时内容），组件通过 path 绑定到它的字段。';
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

/**
 * 组件树渲染器 —— 在 `init` 时交给 SDK，**调用时机由 SDK 决定**
 * （每次 `buildTree` 之后、以及 `clearStore()` 之后），这里只回答「渲染成什么」。
 *
 * 改造前是一个 `watch(treeRoot, renderPreview)`：那等于把 SDK 的调度职责抄到了宿主侧，
 * 宿主还得自己猜「建树结果变没变」。现在宿主不盯建树了，谁来画、什么时候画都归 SDK。
 */
const renderTreeIntoPreview = (treeMap: TreeMap) => {
  const container = previewRef.value;
  // 容器还没挂载时直接跳过 —— 这不代表树有问题，只是暂时没地方画。
  if (!container) return;

  const vnode = treeMap[activeSurfaceId.value]?.root?.vnode;
  // cloneVNode 是必需的：store 里存的就是同一个 VNode 实例，
  // 反复渲染同一个实例会触发 Vue 的复用警告。渲染不出来时渲染 null 以清空容器。
  render(isVNode(vnode) ? cloneVNode(vnode) : null, container);
};

const streamFinished = computed(() => pushedUnits.value >= totalUnits.value);

const streamPercent = computed(() =>
  totalUnits.value === 0 ? 0 : Math.round((pushedUnits.value / totalUnits.value) * 100),
);

/** 「推送下一条」按钮的文案随模式变：逐条推消息，字符流推分片。 */
const pushLabel = computed(() => (streamMode.value === 'char' ? '推送下一片' : '推送下一条'));

/** 字符流模式下已推送的字符数（最后一片可能不满 50）。 */
const charChars = computed(() =>
  Math.min(charCursor.value * CHAR_CHUNK, streamText.value.length),
);

const stopAuto = () => {
  autoStop?.();
  autoStop = undefined;
  if (streamTimer !== undefined) {
    clearInterval(streamTimer);
    streamTimer = undefined;
  }
  streamAuto.value = false;
};

/**
 * 清空 store，并把 Stream 面板恢复到「一条都没推」的状态：两套流（JSONL 逐条 / 字符流）
 * 的缓冲、游标、日志一并归零。既用于面板的「重置」，也用于切换 mock / 顺序 / 模式时清场。
 */
const resetStream = () => {
  stopAuto();
  clearStore();

  stream = createJSONLStream();
  streamCursor.value = 0;

  buffer = createA2UIBuffer();
  charCursor.value = 0;
  bufferValues.value = 0;
  bufferMessages.value = 0;
  loggedLines = 0;
  charSurfaceSent = 0;

  streamLog.value = [];
};

/** 消息的协议形状（只声明本面板要用到的字段）。 */
interface StreamMessage {
  surfaceUpdate?: {
    surfaceId: string;
    components: Array<{ id: string; component: Record<string, unknown> }>;
  };
  dataModelUpdate?: { surfaceId: string; path?: string; contents: Array<{ key: string }> };
  beginRendering?: { surfaceId: string; root: string };
  deleteSurface?: { surfaceId: string };
}

/** 把一条消息压成一行摘要，供 Stream 日志展示。 */
const describeMessage = (line: string): { kind: string; detail: string } => {
  const message = JSON.parse(line) as StreamMessage;

  if (message.surfaceUpdate) {
    const { surfaceId, components } = message.surfaceUpdate;
    const list = components
      .map((item) => `${item.id}(${Object.keys(item.component)[0] ?? '?'})`)
      .join(', ');
    return { kind: 'surfaceUpdate', detail: `surface=${surfaceId} · ${list}` };
  }
  if (message.dataModelUpdate) {
    const { surfaceId, path, contents } = message.dataModelUpdate;
    // 带上 path：dataModelUpdate 会被补全成「一个叶子条目一条」，path 才是它落在数据模型的哪一层。
    const where = path ? ` · ${path}` : '';
    return {
      kind: 'dataModelUpdate',
      detail: `surface=${surfaceId}${where} · ${contents.map((item) => item.key).join(', ')}`,
    };
  }
  if (message.beginRendering) {
    const { surfaceId, root } = message.beginRendering;
    return { kind: 'beginRendering', detail: `surface=${surfaceId} · root=${root}` };
  }
  if (message.deleteSurface) {
    return { kind: 'deleteSurface', detail: `surface=${message.deleteSurface.surfaceId}` };
  }
  return { kind: 'unknown', detail: line.slice(0, 60) };
};

/** 此刻 store 的三个关键计数，两条推送路径共用。 */
const snapshotStats = () => {
  const state = getA2UIStore().getState();
  return {
    components: Object.keys(state.hydrateNodeMap).length,
    treeNodes: Object.values(state.treeMap).reduce(
      (sum, tree) => (tree ? sum + countNodes(tree.root) : sum),
      0,
    ),
    errors: Object.keys(state.errorMap).length,
  };
};

/**
 * 紧凑版里**总共**装了多少个组件 —— 也就是 buffer 会把它们补全成多少条独立消息。
 *
 * 必须遍历求和，不能只看第一条：流式友好版被拆成「root 单独一条 + 其余压成一条」，
 * 只看 `compact[0]` 会数成 1。它用来给日志写「协议补全 · 第 k/N 条」。
 */
const compactComponentCount = computed(() =>
  streamOrders.value[streamOrderIndex.value].compact.reduce((sum, line) => {
    const parsed = JSON.parse(line) as { surfaceUpdate?: { components: unknown[] } };
    return sum + (parsed.surfaceUpdate?.components.length ?? 0);
  }, 0),
);

/**
 * 把 buffer 这一片**新补全**出来的消息记进日志。
 *
 * buffer 是「JSON 框定」的：一片 50 字符通常闭不了整个值，所以多数 push 什么也不产出
 * （日志按兵不动）；直到某片把某个 `{...}` 补全，才一次性冒出一批消息 —— 紧凑版里
 * 那条装着 26 个组件的 surfaceUpdate 闭合时一次就是 26 行，正是「协议补全」的可视化。
 */
const drainBufferLog = () => {
  const lines = buffer.emitted.slice(loggedLines);
  loggedLines = buffer.emitted.length;
  bufferValues.value = buffer.valueCount;
  bufferMessages.value = buffer.messageCount;

  if (lines.length === 0) {
    return;
  }

  const stats = snapshotStats();
  const total = compactComponentCount.value;
  // 这批新消息在 buffer 里的序号区间是 [messageCount - lines.length + 1, messageCount]。
  const firstOrdinal = buffer.messageCount - lines.length + 1;

  streamLog.value = [
    ...streamLog.value,
    ...lines.map((line, offset) => {
      const { kind, detail } = describeMessage(line);

      let note = '';
      if (kind === 'surfaceUpdate') {
        charSurfaceSent += 1;
        // 逐条模式压根没走补全，只有字符流模式才标注「第几条」。
        if (total > 1 && streamMode.value === 'char') {
          note = `协议补全 · 第 ${charSurfaceSent}/${total} 条`;
        }
      }

      return { index: firstOrdinal + offset, kind, detail, note, ...stats };
    }),
  ];
};

/** 把一片字符喂进 buffer，并把新补全出来的消息记入日志。手动步进与自动流共用。 */
const feedChunk = (chunk: string) => {
  buffer.push(chunk);
  drainBufferLog();
};

/**
 * 同步推送「下一个单元」：逐条模式推一条完整消息（走 `createJSONLStream`），
 * 字符流模式推一片 50 字符（走 `createA2UIBuffer`）。两条路都是：先缓冲、再 ingest、
 * 最后 `refreshDerivedState()`（hydrate + buildTree，**并在末尾回调 SDK 注册的 renderTree**），
 * 所以返回时 store 已是新的、预览也已经重画过了。
 */
const pushNext = () => {
  if (streamFinished.value) {
    stopAuto();
    return;
  }

  if (streamMode.value === 'char') {
    const chunk = charChunks.value[charCursor.value];
    if (chunk === undefined) {
      stopAuto();
      return;
    }
    // 游标先推进：buffer.push() 会同步回调 renderTreeIntoPreview，渲染器要读 activeSurfaceId。
    charCursor.value += 1;
    feedChunk(chunk);
    if (streamFinished.value) {
      stopAuto();
    }
    return;
  }

  const line = streamMessages.value[streamCursor.value];
  if (line === undefined) {
    stopAuto();
    return;
  }

  // 游标必须**先**推进：下面 stream.push() 会同步回调 renderTreeIntoPreview，
  // 而渲染器要读 activeSurfaceId（依赖 streamCursor）来决定画哪个 surface。
  // 若放在 push 之后，第一条消息回调时 cursor 还是 0，渲染器会去画下拉选中的那个 mock → 空。
  streamCursor.value += 1;

  // 逐条推：每条都带换行，模拟服务端一条消息一个分片。
  stream.push(`${line}\n`);

  const { kind, detail } = describeMessage(line);
  streamLog.value = [
    ...streamLog.value,
    { index: streamCursor.value, kind, detail, note: '', ...snapshotStats() },
  ];

  if (streamFinished.value) {
    stopAuto();
  }
};

/**
 * 自动推送：
 * - 逐条模式：定时器逐条调 `pushNext`，间隔取随机值，推到末尾自动停；
 * - 字符流模式：交给 `simulateTextStream`，每 50ms 吐 50 字符 —— 正是「模拟完整 JSON stream 输出」。
 *
 * 逐条模式的随机间隔 + 入场动画 300ms（a2ui-vue 的 `withEntranceAnimation`），让相邻两三条的
 * 动画互相叠着播，视觉上是连续的「生长」而不是一格一格的跳。
 *
 * 字符流从**当前游标**续跑（`slice(offset)` 后重新切 50 字符，与整体切片对齐），
 * 所以「手动推几片 → 点自动」能无缝接上，不会从头重来。
 */
const toggleAuto = () => {
  if (streamAuto.value) {
    stopAuto();
    return;
  }
  if (streamFinished.value) {
    resetStream();
  }
  streamAuto.value = true;

  if (streamMode.value === 'char') {
    const offset = charCursor.value * CHAR_CHUNK;
    autoStop = simulateTextStream(streamText.value.slice(offset), {
      chunkSize: CHAR_CHUNK,
      intervalMs: CHAR_INTERVAL,
      onChunk: (chunk) => {
        // 与 pushNext 同样的顺序：先推进游标，再喂 buffer。
        charCursor.value += 1;
        feedChunk(chunk);
      },
      onEnd: () => {
        autoStop = undefined;
        streamAuto.value = false;
      },
    });
    return;
  }

  streamTimer = setInterval(pushNext, 200 * Math.random());
};

/**
 * 切换 mock 时先清空 store，避免上一个 mock 的 surface/节点残留在里面。
 *
 * 这里不需要手动触发渲染：`resetStream()` 里的 `clearStore()` 和随后的 `parseA2UI()`
 * 都会让 SDK 回调 `renderTreeIntoPreview` —— 清场时收到空 treeMap（预览被清空），
 * 解析完再收到新树（预览重画）。渲染时机全部由 SDK 给。
 */
const loadMock = () => {
  // 切回 mock 数据源：否则预览区还按服务端的 surfaceId 去 treeMap 里找树。
  dataSource.value = 'mock';
  resetStream();
  storeState.value = parseA2UI(activeMock.value.messages.join('\n'));
};

watch(mockIndex, loadMock);

/**
 * 调服务端的**非 SSE** 接口，把返回的协议消息灌进同一份 store。
 *
 * 之所以整条解析/渲染链路都能复用：接口返回的 `messages` 就是「按序的 A2UI 协议消息」，
 * 与本地 mock 形态一致（mock 是字符串数组，这里是对象数组，字符串化后拼成 JSONL 即可）。
 * 于是渲染、数据模型、错误收集、组件树面板一行都不用改。
 */
const requestFromServer = async () => {
  serverLoading.value = true;
  serverError.value = '';
  const startedAt = Date.now();

  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/run?stream=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: serverThreadId.value, message: serverPrompt.value }),
    });

    const body = (await response.json()) as ServerRunResult & { error?: string };
    if (!response.ok) {
      // 服务端的两类失败：400（入参非法）与 502（模型没产出任何协议消息）。
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }

    serverElapsed.value = Date.now() - startedAt;
    // 顺序有讲究：先清场，再切数据源与 surfaceId，最后装载 —— 装载会触发 SDK 回调渲染，
    // 那一刻 activeSurfaceId 必须已经指向服务端的 surface。
    resetStream();
    serverResult.value = body;
    dataSource.value = 'server';
    storeState.value = parseA2UI(body.messages.map((message) => JSON.stringify(message)).join('\n'));
  } catch (error) {
    serverResult.value = null;
    serverError.value = error instanceof Error ? error.message : String(error);
  } finally {
    serverLoading.value = false;
  }
};

/** 换一个 threadId：下一次请求在服务端算「新会话」，会回完整骨架而不是增量。 */
const startNewServerSession = () => {
  serverThreadId.value = newServerThreadId();
  serverResult.value = null;
  serverError.value = '';
};

/** 从服务端结果切回 mock（选同一个 mock 不会触发 watch，所以需要这个显式出口）。 */
const backToMock = () => {
  serverResult.value = null;
  serverError.value = '';
  loadMock();
};

/** SSE 帧 → 事件对象。只认 `data:` 行（`event:` 名与注释行按规范忽略）。 */
const parseSseFrame = (frame: string): AgUiSseEvent | null => {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (dataLine === undefined) {
    return null;
  }
  try {
    return JSON.parse(dataLine.slice('data:'.length).trim()) as AgUiSseEvent;
  } catch {
    // 分帧按 `\n\n` 切，正常不会出现半截 JSON；真遇到就跳过这一帧，不打断整条流。
    return null;
  }
};

/**
 * 一条 AG-UI 事件 → 宿主侧的动作。
 *
 * 关键约定：`CUSTOM a2ui.surface` **一定先于**任何 `a2ui.message` 到达（服务端保证），
 * 所以 surfaceId 就位之后才开始渲染，预览区不会出现「拿旧 surfaceId 找树」的空窗。
 */
const handleAgUiEvent = (event: AgUiSseEvent): void => {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    sseDeltaCount.value += 1;
    return;
  }

  if (event.type === 'RUN_ERROR') {
    serverError.value = `服务端 RUN_ERROR（${event.code}）：${event.message}`;
    return;
  }

  if (event.type !== 'CUSTOM') {
    return;
  }

  if (event.name === 'a2ui.surface') {
    serverResult.value = {
      sessionId: serverThreadId.value,
      surfaceId: String(event.value.surfaceId ?? ''),
      provider: String(event.value.provider ?? ''),
      messages: [],
      warnings: [],
    };
    dataSource.value = 'server';
    return;
  }

  if (event.name === 'a2ui.message') {
    // 记账与渲染走同一条：先入列（状态条实时涨），再 push 进 JSONL 流 ——
    // push 内部 ingest + 刷新派生状态（含 SDK 的 renderTree 回调），所以预览随即长出来。
    serverResult.value?.messages.push(event.value);
    stream.push(`${JSON.stringify(event.value)}\n`);
  }
};

/**
 * 调服务端的 **SSE** 接口，边收边渲染。
 *
 * 为什么不用 `EventSource`：它只能发 GET，而入参在请求体里 —— 只能 `fetch` +
 * `response.body.getReader()` 手动切帧（`\n\n` 分帧、剥 `data:` 前缀）。
 *
 * 每条 `CUSTOM a2ui.message` 立刻 `stream.push()` 进与 Stream 面板同一个 JSONL 流，
 * 于是流式渲染、入场动画、数据模型绑定全部自动复用，没有第二套渲染路径。
 */
const requestFromServerStream = async () => {
  if (sseActive.value) {
    // 按钮兼作「停止」：中断本地读取即可，服务端监听了连接关闭，会把这轮流销毁掉。
    sseController?.abort();
    return;
  }

  serverError.value = '';
  sseActive.value = true;
  sseDeltaCount.value = 0;

  const controller = new AbortController();
  sseController = controller;
  const startedAt = Date.now();

  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ threadId: serverThreadId.value, message: serverPrompt.value }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `HTTP ${response.status}`;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        // 不是 JSON 就用状态码兜底。
      }
      throw new Error(message);
    }

    const body = response.body;
    if (body === null) {
      throw new Error('响应没有可读的流');
    }

    // 只有真正开流了才清场：入参非法时服务端在开流**之前**就回了 400，
    // 那种情况下不该把已经渲染好的预览抹掉。
    resetStream();
    dataSource.value = 'server';
    serverResult.value = null;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });

      let boundary = pending.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const event = parseSseFrame(frame);
        if (event !== null) {
          handleAgUiEvent(event);
        }
        boundary = pending.indexOf('\n\n');
      }
    }

    serverElapsed.value = Date.now() - startedAt;
  } catch (error) {
    if (controller.signal.aborted) {
      // 用户主动停：不是错误，已经渲染出来的部分保留。
      return;
    }
    serverError.value = error instanceof Error ? error.message : String(error);
  } finally {
    sseActive.value = false;
    sseController = undefined;
  }
};

/** 换消息顺序 / 推送模式都等于换数据源与游标语义：清空重来，否则会与新数据错位。 */
watch(streamOrderIndex, resetStream);
watch(streamMode, resetStream);

onMounted(() => {
  // 第二个参数就是「渲染组件树的方法」：SDK 会在每次建树后、以及清空 store 后调用它。
  const store = init(renderMap, renderTreeIntoPreview);
  unsubscribe = store.subscribe((state) => {
    storeState.value = state;
  });
  loadMock();
});

onBeforeUnmount(() => {
  stopAuto();
  // 在途的 SSE 读取要主动中断：否则组件已卸载它还在读，回调会去碰已卸载的响应式状态。
  sseController?.abort();
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

/* ── data-binding 验证提示 ── */

.binding-hint {
  margin-top: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid #d6e8ff;
  border-radius: 8px;
  background: #f4f9ff;
  font-size: 0.85rem;
  line-height: 1.6;
  color: #374151;
}

.binding-hint strong {
  color: #1f2937;
}

.binding-hint ol {
  margin: 0.4rem 0 0.5rem;
  padding-left: 1.2rem;
}

.binding-desc {
  margin: 0.4rem 0 0.5rem;
}

.binding-hint code {
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #e6f0ff;
  color: #2b5fa8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.binding-model {
  margin: 0;
  padding: 0.6rem 0.75rem;
  overflow: auto;
  border-radius: 6px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  line-height: 1.55;
  color: #1f2937;
}

/* ── Stream 模拟面板 ── */

.server-panel {
  margin-top: 1.25rem;
}

.server-desc {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.6;
}

.server-desc__note {
  display: block;
  margin-top: 0.35rem;
  color: #9ca3af;
}

.server-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.server-input {
  flex: 1 1 260px;
  min-width: 200px;
}

.server-error {
  margin: 0.85rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.82rem;
  word-break: break-all;
}

.server-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px dashed #e5e7eb;
  color: #6b7280;
  font-size: 0.78rem;
}

.server-meta code {
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #f3f4f6;
  color: #374151;
}

.stream-panel {
  margin-top: 1.25rem;
}

.stream-desc {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.6;
}

.stream-desc code {
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #f1f5f9;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  color: #1f2937;
}

.stream-desc__note {
  display: block;
  margin-top: 0.35rem;
  color: #94a3b8;
}

.stream-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.stream-mode {
  width: 200px;
}

.stream-order {
  width: 170px;
}

/* 计数 / buffer 统计单独一行、右对齐，避免和控件挤在一起。 */
.stream-meta {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-bottom: 0.75rem;
}

.stream-buffer {
  color: #6b7280;
  font-size: 0.8rem;
}

.stream-buffer strong {
  color: #b88230;
  font-size: 0.9rem;
}

.stream-counter {
  color: #6b7280;
  font-size: 0.8rem;
}

.stream-counter strong {
  color: #409eff;
  font-size: 0.95rem;
}

.stream-progress {
  margin-bottom: 0.85rem;
}

.stream-log {
  max-height: 260px;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.stream-log__row {
  display: grid;
  grid-template-columns: 2.6rem 8.5rem 1fr auto;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.35rem 0.7rem;
  border-bottom: 1px solid #eef2f7;
  font-size: 0.75rem;
}

.stream-log__row:last-child {
  border-bottom: none;
}

.stream-log__idx {
  color: #9ca3af;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.stream-log__kind {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  font-weight: 600;
}

.stream-log__kind--surfaceUpdate {
  color: #409eff;
}

.stream-log__kind--dataModelUpdate {
  color: #b88230;
}

.stream-log__kind--beginRendering {
  color: #67c23a;
}

.stream-log__kind--deleteSurface {
  color: #f56c6c;
}

.stream-log__detail {
  overflow: hidden;
  color: #4b5563;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「协议补全 · 第 k/N 条」小标签：字符流模式下标注这条消息是补全出来的。 */
.stream-log__note {
  margin-right: 0.35rem;
  padding: 0 0.3rem;
  border-radius: 4px;
  background: #fdf6ec;
  color: #b88230;
  font-size: 0.68rem;
  font-style: normal;
  white-space: nowrap;
}

.stream-log__stat {
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
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

/* 入场动画不再由 playground 用 CSS 播：那是渲染引擎的职责。a2ui-vue 的
   `withEntranceAnimation` 会在组件首次渲染时（core 的 hydrateNode.hasMounted 为 false）
   用 Web Animations API 播 0.3s 淡入，播完回写标记 —— 这里不再需要任何动画样式。 */
</style>
