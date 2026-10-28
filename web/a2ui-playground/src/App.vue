<template>
  <div class="playground">
    <header class="toolbar">
      <div class="titles">
        <h1>A2UI Playground</h1>
        <p>a2ui-server（SSE · AG-UI）→ parseA2UI → hydrate → buildTree → SDK 回调 renderTree</p>
      </div>
      <div class="actions">
        <el-select
          v-model="scenarioId"
          class="mock-select"
          size="default"
          popper-class="mock-select-popper"
          placeholder="选择示例场景"
          :disabled="sseActive || chatOnly"
        >
          <el-option
            v-for="scenario in scenarios"
            :key="scenario.id"
            :label="scenario.id"
            :value="scenario.id"
          >
            <div class="mock-option">
              <span class="mock-option__label">{{ scenario.id }}</span>
              <span class="mock-option__desc">
                {{ scenario.desc }}（{{ scenario.messageCount }} 条）
              </span>
            </div>
          </el-option>
        </el-select>
        <el-button type="danger" plain @click="errorDialogVisible = true">
          错误信息 ({{ errorList.length }})
        </el-button>
        <el-button
          type="primary"
          plain
          :disabled="!serverResult || serverResult.messages.length === 0"
          @click="openJsonl(serverResult?.messages ?? [])"
        >
          查看 JSONL
        </el-button>
        <el-button type="primary" @click="dialogVisible = true">查看 Store</el-button>
      </div>
    </header>

    <p v-if="scenarioError" class="server-error scenario-banner">
      场景列表拉取失败：{{ scenarioError }}。示例数据现在<strong>完全由服务端提供</strong>，
      请确认 a2ui-server 已启动（<code>pnpm --filter a2ui-playground-server dev</code>）。
    </p>

    <div class="workspace">
      <section class="panel stage-panel">
        <div class="panel-header">
          <div class="segmented">
            <button
              type="button"
              class="segmented__item"
              :class="{ 'segmented__item--active': picking }"
              :disabled="!treeRoot"
              :title="
                picking
                  ? '选取中：点击预览里的元素把它引用到输入框（Esc 退出）'
                  : '选择元素：点击预览里的组件，把它的 id 以 @id 加进对话输入框（也可按住 Alt 直接点击）'
              "
              @click="togglePicking"
            >
              {{ picking ? '选取中…' : '选择元素' }}
            </button>
            <label
              class="stream-switch"
              title="开：流式返回，界面逐块长出；关：整体返回，收完一次性出现"
            >
              <el-switch
                v-model="streamSimOn"
                size="small"
                inline-prompt
                active-text="流式"
                inactive-text="整体"
                :disabled="sseActive"
              />
              <span class="stream-switch__text">Stream 模拟</span>
            </label>
          </div>
          <span class="tag">{{ stageTag }}</span>
        </div>

        <div class="stage">
          <!--
            选取模式：开启后点击容器内任意位置，取最近的带 id 元素（withRootId 给每个
            组件根元素加了 `surfaceId-componentId`），把 componentId 以 @id 加进输入框。
            click 用 capture：选取模式下要**截获**点击，不让它触发组件自身的交互
            （按钮动作 / 输入框聚焦 / 页签切换），否则「选元素」会顺手改界面。
          -->
          <div
            ref="previewRef"
            class="preview"
            :class="{ 'preview--picking': picking }"
            @click.capture="onPreviewClick"
            @mouseover.capture="onPreviewHover"
          ></div>
          <p v-if="picking" class="hint hint--picking">
            点击预览里的元素，把它的 id（如 @city）加到对话输入框；Esc 退出选取。平时也可按住 Alt 直接点击。
          </p>
          <p v-else-if="!treeRoot" class="hint">
            暂无可渲染的组件树：需要 beginRendering 让 surface 诞生，且组件类型已注册渲染器。
          </p>

          <details v-if="activeDataModel !== null" class="fold" open>
            <summary>{{ bindingHintTitle }}</summary>
            <ol v-if="activeSurfaceId === 'data-binding'">
              <li>改「Name」输入框 → 下方标题（也绑定 <code>/user/name</code>）跟着变；</li>
              <li>勾选 Subscribe、拖动音量 → 值写回数据模型并触发重渲染；</li>
              <li>下面 JSON 是 <code>dataModelMap['data-binding']</code> 的实时内容，改动即时反映。</li>
            </ol>
            <p v-else class="binding-desc">{{ bindingHintDesc }}</p>
            <pre class="binding-model">{{ activeDataModelJson }}</pre>
          </details>

          <!--
            动作回执：证明「点了 → 发出去了 → 后端处理了 → 界面收到了」这条链是通的。
            没有这块面板时，服务端动作点了和没点完全一样 —— 事件在渲染层就断了。
          -->
          <details v-if="actionLog.length > 0" class="fold" open>
            <summary>动作回执 · a2ui-action → POST /api/a2ui/action</summary>
            <ol class="action-log">
              <li v-for="item in actionLog" :key="item.id">
                <code>{{ item.name }}</code>
                <span class="action-log__meta">
                  {{ item.handledBy || '—' }} · {{ item.messageCount }} 条 · {{ item.elapsedMs }}ms
                </span>
                <span v-if="item.detail" class="action-log__err">{{ item.detail }}</span>
              </li>
            </ol>
            <p class="action-log__hint">
              回执消息已经 ingest 回 store：上面那块数据模型 JSON、以及绑定了该 path 的组件会立刻变化。
            </p>
          </details>

          <details v-if="treeOutline" class="fold">
            <summary>组件树 treeMap["{{ activeSurfaceId }}"].root</summary>
            <pre class="outline">{{ treeOutline }}</pre>
          </details>
        </div>

        <!--
          消息流明细：调试用，默认折叠。正文里的「Stream 模拟」是顶部那个开关 ——
          它决定内容怎么回来（流式逐块 / 整体一次性），这里只是把过程摊开来看。
        -->
        <details class="fold stream-fold">
          <summary>Stream 模拟明细（消息流，仅调试）</summary>
          <div class="stage">
          <p v-if="streamMode === 'jsonl'" class="stream-desc">
            素材来自服务端的 fixture 接口，但<strong>节奏由客户端定</strong>：一次推一条完整消息给
            <code>createJSONLStream()</code>，每条抵达后立即刷新 store（hydrate + buildTree）。
            默认走 <strong>流式友好</strong> 顺序，预览区会随着消息逐条长大；切到
            <strong>协议顺序</strong> 可以对比 <strong>beginRendering 的位置</strong> 的影响 ——
            那时前面全推完页面仍然是空的，直到最后一条才一次性出现。
            <span class="stream-desc__note">
              本模式不经过 buffer：一条消息就是一条消息，不会被拆开。
            </span>
          </p>
          <p v-else class="stream-desc">
            这一条走 <code>GET /api/a2ui/scenarios/&lt;id&gt;/stream</code>：服务端把 fixture 的
            <strong>紧凑版</strong>拼成整段 JSON、按固定块长吐回来，每收到一片就喂给
            <code>createA2UIBuffer()</code>。切片必然落在 JSON 中间，buffer 靠括号配对捞值 ——
            关键是<strong>不等整条消息收完</strong>：每有一个组件（或数据条目）闭合，就立刻把它
            <strong>补全成一条独立、可解析的消息</strong>交给 parser，所以组件是一个个长出来的。
            <code>dataModelUpdate</code> 还会被<strong>递归拆到叶子条目</strong>（path 带上祖先 key）。
            <span class="stream-desc__note">
              切片与节奏都属于服务端（面板标签显示实际值），客户端不再自己切 —— 于是「切在 JSON
              任意位置」这件事由真实网络分片来考。切到「协议顺序」可以对比
              <code>beginRendering</code> 的位置：那时它排在最后，组件全到齐了树还是空的。
            </span>
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
            <!--
              逐条模式是「客户端步进」：数据先拿到手，一条条推，随时停下看 store 的变化。
              字符流模式是「服务端推送」：节奏由服务端定，这里只有开与停 —— 能单步就看不出
              真实网络分片的样子了，而那正是这个模式要演的东西。
            -->
            <template v-if="streamMode === 'jsonl'">
              <el-button type="primary" :disabled="streamFinished" @click="pushNext">
                推送下一条
              </el-button>
              <el-button :disabled="streamFinished" @click="toggleAuto">
                {{ streamAuto ? '暂停' : '自动推送' }}
              </el-button>
            </template>
            <el-button
              v-else
              :type="charActive ? 'warning' : 'primary'"
              @click="toggleCharStream"
            >
              {{ charActive ? '停止流式' : charDone ? '重新流式' : '开始流式（SSE）' }}
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
                已接收 <strong>{{ charCursor }}</strong> / {{ charTotalChunks }} 片 · 字符
                {{ charReceivedChars }} / {{ charTotalChars }}
              </template>
              <template v-else>
                已推送 <strong>{{ pushedUnits }}</strong> / {{ totalUnits }} 条
              </template>
            </span>
          </div>

          <p v-if="charError" class="server-error stream-error">
            字符流失败：{{ charError }}
          </p>

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
                <em v-if="entry.note" class="stream-log__note">{{ entry.note }}</em
                >{{ entry.detail }}
              </span>
              <span class="stream-log__stat">
                组件 {{ entry.components }} · 树 {{ entry.treeNodes }} · 错误 {{ entry.errors }}
              </span>
            </div>
          </div>
          <p v-else class="hint">
            {{
              streamMode === 'char'
                ? '还没有开始流式，点「开始流式（SSE）」让服务端把切片吐回来。'
                : '还没有推送任何消息，点「推送下一条」开始。'
            }}
          </p>
          </div>
        </details>
      </section>

      <aside class="panel chat-panel">
        <div class="chat-header">
          <div class="chat-header__top">
            <h2>想做什么界面？</h2>
          </div>
          <!--
            「只跟模型说话」的开关已移除：这个 demo 只用来生成界面，不测纯对话。
            chatOnly 固定为 false，下面的分支只是历史兼容，实际不会走到。
          -->
          <p>描述一句，我会在左边预览里实时生成。同一个 threadId 连续发送即多轮。</p>
        </div>

        <div ref="chatScrollRef" class="chat">
          <div v-if="chatMessages.length === 0" class="chat-empty">
            <p v-if="chatOnly">还没有对话。直接说一句话，模型的原话会显示在气泡里。</p>
            <p v-else>还没有对话。试着输入「做一个购物车」或者「列出三个水果」。</p>
            <p class="chat-empty__note">
              默认打本机 <code>{{ SERVER_BASE }}</code>。{{
                chatOnly
                  ? '这条路不产出任何 A2UI 协议消息。'
                  : '第二轮回来的是增量消息，只含改动的组件。'
              }}
            </p>
          </div>

          <template v-for="message in chatMessages" :key="message.id">
            <div v-if="message.role === 'user'" class="chat-row chat-row--user">
              <div class="bubble bubble--user">{{ message.text }}</div>
            </div>
            <div v-else class="chat-row chat-row--agent">
              <div class="answer" :class="{ 'answer--error': message.status === 'error' }">
                <!--
                  中间状态：只在流式期间显示，且是**阶段化**的。a2ui（生成界面）是
                  「连接 → 思考 → 模型返回 → 协议渲染中 → 完成」，纯对话是「连接 → 思考 → 回复」。
                  加上「已用时 N 秒」，等待期间界面才是活的（思考模式下首字要等 2~3 秒）。
                -->
                <p v-if="message.status === 'streaming'" class="answer__phase">
                  <span class="answer__pulse" aria-hidden="true"></span>
                  {{ describePhase(message) }}
                </p>

                <!-- 思考过程：单独一块，可折叠。它不属于回复，所以不并进下面的正文。 -->
                <details v-if="message.thinking !== ''" class="answer__raw">
                  <summary>查看思考过程（{{ message.thinking.length }} 字符）</summary>
                  <pre class="answer__thinking">{{ message.thinking }}</pre>
                </details>

                <!-- 折叠区只对生成界面那轮有意义：它的 raw 是模型吐的 JSONL 原文。
                     纯对话那轮的 raw 就是回复正文，已经显示在下面了，再折叠一次是重复。 -->
                <details v-if="message.mode === 'ui' && message.raw !== ''" class="answer__raw">
                  <summary>查看原始输出（{{ message.raw.length }} 字符）</summary>
                  <pre>{{ message.raw }}</pre>
                </details>

                <!-- 没能解析成协议消息的行。放在最显眼的位置：它解释「为什么预览是空的」。 -->
                <details
                  v-if="message.warnings.length > 0"
                  class="answer__raw answer__raw--warning"
                  open
                >
                  <summary>{{ message.warnings.length }} 条解析提示</summary>
                  <pre class="answer__warnings">{{ message.warnings.join('\n') }}</pre>
                </details>

                <!-- 纯对话：正文就是模型原话，边收边长。
                     生成界面那轮的 `raw` 是 JSONL 原文，不进正文（在折叠区里）。 -->
                <p v-if="message.mode === 'chat' && message.raw !== ''" class="answer__text">
                  {{ message.raw }}
                </p>

                <p
                  v-if="showsStatusLine(message)"
                  class="answer__text"
                  :class="{ 'answer__text--muted': message.mode === 'chat' && message.raw !== '' }"
                >
                  {{ describeChatMessage(message) }}
                </p>

                <button
                  v-if="message.raw !== ''"
                  type="button"
                  class="answer__copy"
                  :title="copiedId === message.id ? '已复制' : '复制文本'"
                  @click="copyRaw(message)"
                >
                  <svg
                    v-if="copiedId === message.id"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
                  </svg>
                </button>
              </div>
            </div>
          </template>
        </div>

        <p v-if="serverError" class="server-error">请求失败：{{ serverError }}</p>

        <div class="composer" @keydown.enter.exact.prevent="sendMessage" @paste="onComposerPaste">
          <button
            type="button"
            class="composer__ghost"
            title="新会话（清空对话并换一个 threadId）"
            :disabled="sseActive"
            @click="startNewServerSession"
          >
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>

          <el-input
            ref="composerRef"
            v-model="chatInput"
            class="composer__input"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 5 }"
            resize="none"
            placeholder="说点什么…（可粘贴或附上图片，让模型据此生成界面）"
            title="Enter 发送，Shift + Enter 换行"
            :disabled="sseActive"
          />

          <button
            type="button"
            class="composer__attach"
            title="附上图片（设计稿 / 截图 / 参考图），让模型据此生成界面"
            :disabled="sseActive"
            @click="pickImages"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>

          <button
            type="button"
            class="composer__send"
            :class="{ 'composer__send--stop': sseActive }"
            :disabled="!canSend"
            :title="sseActive ? '停止' : '发送'"
            @click="sendMessage"
          >
            <svg
              v-if="sseActive"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>

        <!-- 多模态：本轮附带的图片缩略图，随 /run 请求发出。点击缩略图可放大预览。 -->
        <div v-if="attachedImages.length > 0" class="composer__images">
          <div v-for="(image, index) in attachedImages" :key="image.id" class="composer__image">
            <el-image
              class="composer__image-thumb"
              :src="image.dataUrl"
              :alt="image.name"
              fit="cover"
              :preview-src-list="attachedImages.map((item) => item.dataUrl)"
              :initial-index="index"
              hide-on-click-modal
              preview-teleported
              :title="`点击预览 ${image.name}`"
            />
            <button
              type="button"
              class="composer__image-remove"
              :title="`移除 ${image.name}`"
              @click.stop="removeAttachedImage(image.id)"
            >
              ×
            </button>
          </div>
        </div>
        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          multiple
          hidden
          @change="onImageInputChange"
        />

        <div class="chat-footer">
          <!-- 对话模式下没有 surface / 协议消息条数可报，只报模型与耗时。 -->
          <span v-if="chatOnly" class="chat-meta">
            model <code>{{ chatModel || '等待 model.info…' }}</code>
            <template v-if="lastChatElapsed > 0">
              · 耗时 <strong>{{ lastChatElapsed }}</strong> ms
            </template>
            <span class="chat-footer__note">不经 A2UI 协议</span>
          </span>
          <template v-else>
            <el-button link size="small" :disabled="sseActive" @click="reloadScenario">
              重新载入场景
            </el-button>
            <span v-if="serverResult || sseActive" class="chat-meta">
              thread <code>{{ serverResult?.sessionId || serverThreadId }}</code>
              · surface <code>{{ serverResult?.surfaceId || '等待 a2ui.surface…' }}</code>
              · provider <code>{{ serverResult?.provider || '—' }}</code>
              · 消息 <strong>{{ serverResult?.messages.length ?? 0 }}</strong> 条
              <template v-if="!sseActive && serverElapsed > 0">
                · 耗时 <strong>{{ serverElapsed }}</strong> ms
              </template>
            </span>
          </template>
        </div>
      </aside>
    </div>

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

    <el-dialog
      v-model="jsonlVisible"
      title="返回的 JSONL"
      width="760px"
      align-center
      :close-on-click-modal="false"
    >
      <pre class="code">{{ jsonlText }}</pre>
      <template #footer>
        <el-button @click="jsonlVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  cloneVNode,
  computed,
  isVNode,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  render,
  watch,
  type VNode,
} from 'vue';
import {
  clearStore,
  createA2UIBuffer,
  createJSONLStream,
  getA2UIStore,
  init,
  normalizeToJSONL,
  parseA2UI,
} from 'a2ui-core';
import type { A2UIBuffer, A2UIStoreState, JSONLStream, TreeMap, TreeNode } from 'a2ui-core';
// 只留 `deriveStreamOrders` 这个纯函数：示例数据本身现在**全部从服务端取**（见 `loadScenarios`），
// 而「一份 JSONL 能派生出哪几种推送顺序」是解析层的通用工具，本就该由 SDK 提供。
import { deriveStreamOrders } from 'a2ui-core/mock';
import { renderMap } from 'a2ui-vue';

/**
 * 服务端登记的全部示例场景（`GET /api/a2ui/scenarios`）。
 *
 * 每份示例覆盖一条链路：
 * - simple-text：只有一个 Text，最小示例；
 * - product-card：官方示例 `catalogs/basic/examples/05_product-card.json` 的 JSONL 版，
 *   用 Card / Column / Row / Image / Text / Button，全部走 dataModel 的 path 绑定；
 * - column-texts：一个 Column 挂三个 Text，专门用来验证 treebuilder 的父子组装
 *   （树里 root 应有 3 个 children，且顺序与 explicitList 一致）；
 * - column-row-mix：多层 Column / Row 混排（最深 5 层）—— Row 横排三张 Card，
 *   Card 内再套 Column，底部 Row 里再嵌 Column + Row，用来压深层嵌套的组装与渲染。
 *
 * 这些数据此前是本文件直接 `import` core 的 mock 后渲染的 —— 等于把「服务端 → SSE → AG-UI」
 * 整条链路跳了过去，示例再丰富也压不到接口上。现在改成从接口取：**列表和内容都由服务端给**，
 * 于是每个示例都真的走一遍完整链路，顺带成为「核心接口 + AG-UI 传输层」最省事的回归样本。
 */
interface ScenarioSummary {
  id: string;
  desc: string;
  surfaceId: string;
  messageCount: number;
}

const scenarios = ref<ScenarioSummary[]>([]);
const scenarioError = ref('');
/** 当前选中的场景 id。下拉绑它，切换即触发一次服务端运行。 */
const scenarioId = ref('');
/**
 * 当前场景的**原始 fixture**（一行一条，`GET /api/a2ui/scenarios/:id`）。
 *
 * 只有 Stream 面板的**逐条模式**要它：那一步是「客户端步进」，数据得先拿到手，才能一条一条推。
 * 字符流模式不经过这里 —— 它走 `/scenarios/:id/stream`，切片由服务端吐、客户端只管消费。
 */
const scenarioLines = ref<string[]>([]);
/**
 * Stream 面板正在回放的那个 surface。
 *
 * 取值来自服务端：fixture 接口回一个，字符流的 `stream.started` 再回一个（权威值）。
 * 不拿「下拉选中项」顶上 —— 预览区是拿它去 treeMap 找树的，对不上就是一片空白。
 */
const streamSurfaceId = ref('');
const activeScenario = computed(
  () => scenarios.value.find((item) => item.id === scenarioId.value) ?? null,
);

const dialogVisible = ref(false);
const errorDialogVisible = ref(false);
const storeState = ref<A2UIStoreState | null>(null);
/** 交给 vue 的 render() 作为挂载容器的元素。 */
const previewRef = ref<HTMLElement | null>(null);
/** 输入框组件实例，选取元素后把焦点还回去，让用户接着打字。 */
const composerRef = ref<{ focus?: () => void } | null>(null);
let unsubscribe: (() => void) | undefined;

/**
 * 动作回执（`a2ui-action` → `POST /api/a2ui/action`）。
 *
 * 渲染层把服务端动作派发成冒泡的 DOM 事件，**但事件之后没人接** —— 点击就等同于没点。
 * 这里补上宿主这半段：转发给服务端、把回来的协议消息 ingest 回 store、并把过程记在
 * 这个列表里。记录本身也是调试手段：能一眼看出动作有没有发出去、谁处理的、回了几条消息。
 */
interface ActionReceipt {
  id: string;
  name: string;
  status: 'ok' | 'error';
  /** 服务端标注的处理方：注册的 handler 名，或 `fallback` / `error`。 */
  handledBy: string;
  messageCount: number;
  elapsedMs: number;
  detail: string;
}
const actionLog = ref<ActionReceipt[]>([]);
const ACTION_LOG_LIMIT = 6;

/**
 * 「选择元素」模式。
 *
 * 开启后点击预览里的组件，把它的 componentId 以 `@id` 加进对话输入框 ——
 * 用户指代界面元素的最短路径（「把 @city 的字号调大」），省得用语言描述位置。
 *
 * id 从哪来：`a2ui-vue` 的 `withRootId` 给每个组件根元素加了
 * `id = surfaceId-componentId`（模板实例再带 itemKey 后缀），所以点击取值
 * 不需要给渲染器加任何埋点。
 */
const picking = ref(false);
/** 当前悬停高亮的元素（class 由 JS 直接加，重渲染后自然失效，无需清理 store）。 */
let hoveredEl: HTMLElement | null = null;

const clearHover = (): void => {
  hoveredEl?.classList.remove('a2ui-pick-hover');
  hoveredEl = null;
};

const togglePicking = (): void => {
  picking.value = !picking.value;
  if (!picking.value) {
    clearHover();
  }
};

/**
 * DOM id → 协议里的 componentId；解析不出来返回 null。
 *
 * 两种形态：`surfaceId-componentId`（常规）与 `surfaceId-componentId-itemKey`
 * （List 模板的每个实例）。后者要逐级去掉末尾段，直到命中 hydrateNodeMap 的
 * 登记键 —— 引用模板组件（`itemCard`）比引用某个实例（`itemCard-h1`）更可操作：
 * 模型只能改模板定义，改不了「第 3 个实例」。
 *
 * 解析不到就**放弃**（返回 null），不要退化成「把 DOM id 原样当 componentId」——
 * 预览里若混进别处带 id 的元素（浏览器插件、调试节点），那样会往输入框塞一个模型
 * 根本不认识的假 id。
 */
const componentIdOf = (domId: string): string | null => {
  const prefix = `${activeSurfaceId.value}-`;
  const rest = domId.startsWith(prefix) ? domId.slice(prefix.length) : domId;
  const nodes = storeState.value?.hydrateNodeMap ?? {};

  if (rest in nodes) {
    return rest;
  }
  const segments = rest.split('-');
  while (segments.length > 1) {
    segments.pop();
    const candidate = segments.join('-');
    if (candidate in nodes) {
      return candidate;
    }
  }
  return null;
};

/** 悬停高亮：只加 class，不碰 Vue 管理的 DOM 结构。 */
const onPreviewHover = (event: MouseEvent): void => {
  if (!picking.value) {
    return;
  }
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[id]') ?? null;
  if (el === hoveredEl) {
    return;
  }
  clearHover();
  hoveredEl = el;
  el?.classList.add('a2ui-pick-hover');
};

/**
 * 选取：截获点击 → 取 componentId → 以 @id 追加进输入框 → 退出选取并回焦。
 *
 * **Alt/Option + 点击**是免开关的快捷路径：不用先点「选择元素」，按住 Alt 直接点
 * 预览里的组件即可 —— 「快速引用某个元素」时少一步心智负担。
 */
const onPreviewClick = (event: MouseEvent): void => {
  const accelerated = event.altKey;
  if (!picking.value && !accelerated) {
    return;
  }

  // 可选链会把 undefined 也传出来，这里用真值判断一并收掉（null 与 undefined 都代表没命中）。
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[id]');
  if (!el) {
    return;
  }

  const componentId = componentIdOf(el.id);
  if (componentId === null) {
    // 不是本 surface 的组件（或解析不出来）：不拦点击，保持原有交互。
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const token = `@${componentId}`;
  const current = chatInput.value;
  chatInput.value =
    current === '' || /\s$/.test(current) ? `${current}${token}` : `${current} ${token}`;

  picking.value = false;
  clearHover();
  composerRef.value?.focus?.();
};

// Esc 随时退出选取。监听器随选取状态挂/卸（句柄显式持有，不靠生命周期钩子兜底）。
let pickingKeydown: ((event: KeyboardEvent) => void) | undefined;

const detachPickingKeydown = (): void => {
  if (pickingKeydown !== undefined) {
    document.removeEventListener('keydown', pickingKeydown);
    pickingKeydown = undefined;
  }
};

watch(picking, (active) => {
  // 先摘旧的再挂新的：连续开「选取 → Esc → 再选取」不会叠监听器。
  detachPickingKeydown();
  if (!active) {
    return;
  }
  pickingKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      togglePicking();
    }
  };
  document.addEventListener('keydown', pickingKeydown);
});

/**
 * 「Stream 模拟」是**内容怎么回来**，不是一个页面：
 * - 开（默认）= 流式返回：协议消息逐条到达即 ingest，预览区逐块长出；
 * - 关 = 整体返回：先攒齐全部消息，最后一口气 ingest，预览一次性出现。
 *
 * 消息流明细（逐条/字符流、顺序、块长）收进预览底部的折叠块，那是调试用的。
 */
const streamSimOn = ref(true);

/** 整体返回时的消息暂存：攒齐后一次性 ingest（见 `handleRunEvent` 与 `settle`）。 */
let pendingIngest: string[] = [];

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

/**
 * 场景字符流的事件（`GET /api/a2ui/scenarios/:id/stream`）。
 *
 * 与 `AgUiSseEvent` 分开是刻意的：那条流不是「跑一轮 agent」，而是服务端把素材按块长吐回来。
 * 传输层一样（`text/event-stream` + `data: {...}`），所以两者共用同一个分帧函数。
 */
type ScenarioStreamEvent =
  | {
      type: 'stream.started';
      scenarioId: string;
      surfaceId: string;
      order: 'protocol' | 'stream';
      chunkSize: number;
      delayMs: number;
      totalChars: number;
      totalChunks: number;
    }
  | { type: 'stream.chunk'; index: number; text: string }
  | { type: 'stream.done'; chunks: number; chars: number };

/**
 * 生成一个新的 threadId：同一个 threadId 的后续请求，在服务端算「同一会话的下一轮」。
 *
 * 前缀用于区分用途 —— `pg` 是对话，`sc` 是示例场景（见 `runFromServer`）。
 */
function newServerThreadId(prefix = 'pg'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 预览区当前该看哪个 surface。
 *
 * 现在有两条路径往 store 里写：**接口运行**（自由输入或示例场景，surfaceId 由服务端在
 * `a2ui.surface` 事件里给出）与 **Stream 面板的本地回放**（推的是场景 fixture，surfaceId
 * 就是场景自己的）。两者不一定相同，所以必须记住最后一次是哪条写的。
 */
const previewSource = ref<'api' | 'stream'>('api');

/**
 * 服务端地址：可用 `VITE_A2UI_SERVER` 覆盖，缺省打本机 3000。
 *
 * 这里必须是 `??` 而不是 `||`：生产部署是**前后端同域**（nginx 把 `/api` 反代到 Node），
 * 需要把 `VITE_A2UI_SERVER` 显式设成**空串**让请求走相对路径（`/api/a2ui/run`）。
 * 用 `||` 的话空串是 falsy，会被顶回 `http://localhost:3000` —— 那就是在用户自己的
 * 机器上找 3000 端口，必然连不上。
 */
const SERVER_BASE = String(import.meta.env.VITE_A2UI_SERVER ?? 'http://localhost:3000');

/** 输入框内容。发送后立即清空。 */
const chatInput = ref('');

/** 本轮附带的图片（base64 dataURL），随 `/run` 请求发出，用于多模态生成。 */
const attachedImages = ref<Array<{ id: string; dataUrl: string; name: string }>>([]);
/** 隐藏的文件选择框句柄。 */
const imageInputRef = ref<HTMLInputElement | null>(null);

/** 点击附件按钮：唤起系统文件选择。 */
const pickImages = (): void => {
  imageInputRef.value?.click();
};

/** 把一批文件读成 dataURL 并追加到 attachedImages。 */
const handleImageFiles = (fileList: FileList | null): void => {
  if (!fileList || fileList.length === 0) {
    return;
  }
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith('image/')) {
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      attachedImages.value.push({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dataUrl: String(reader.result),
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  }
};

/** 文件选择框 change：读入后把框清空，便于重复选同一张。 */
const onImageInputChange = (event: Event): void => {
  const target = event.target as HTMLInputElement;
  handleImageFiles(target.files);
  target.value = '';
};

/** 移除一张已附图片。 */
const removeAttachedImage = (id: string): void => {
  attachedImages.value = attachedImages.value.filter((image) => image.id !== id);
};

/** 在输入框里粘贴图片：拦截并把图片当作附件，而非粘进文本。 */
const onComposerPaste = (event: ClipboardEvent): void => {
  const files = event.clipboardData?.files;
  if (files && files.length > 0) {
    event.preventDefault();
    handleImageFiles(files);
  }
};
const serverError = ref('');
const serverElapsed = ref(0);
const serverResult = ref<ServerRunResult | null>(null);
/** 同一个 threadId 连续请求 = 多轮对话，服务端只回增量；「新会话」会换一个。 */
const serverThreadId = ref(newServerThreadId());

/**
 * 一条对话记录。
 *
 * role 只有两种：`user` 是你输入的那句，`agent` 是**一轮生成的载体** —— 它承载状态
 * （streaming / done / error）、累积的原始文本、以及本轮最终落地的协议消息条数。
 * 之所以把 agent 侧做成「一条消息承载一轮」而不是「一个 token 一条」：界面长了什么样
 * 已经由预览区负责表达，对话区只需要说清「这轮在干什么、干完了没有」。
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  /** 用户侧是原文；agent 侧留空，文案由 `describeChatMessage` 按状态派生。 */
  text: string;
  status: 'streaming' | 'done' | 'error';
  /**
   * 这轮是怎么来的：`chat` = 发送框里的一句话，`scenario` = 下拉选中的示例场景。
   *
   * 场景运行**没有 user 气泡**（用户并没有"说"什么），所以只能靠这个字段区分措辞 ——
   * 否则场景载入完会显示成「已生成界面」，让人以为模型刚编了一个界面出来。
   */
  kind: 'chat' | 'scenario';
  /**
   * 这一轮走的是哪条路：`ui` = 生成 A2UI 界面，`chat` = 仅测模型对话。
   *
   * 它决定气泡里显示什么 —— 生成界面那轮显示的是「已生成 N 条协议消息」，纯对话那轮显示的
   * 就是模型原话。两者的 `raw` 含义也不同（前者是 JSONL，后者是回复正文）。
   */
  mode: 'ui' | 'chat';
  /** `kind === 'scenario'` 时的场景 id。 */
  scenarioId: string;
  /** agent 侧累积的 TEXT_MESSAGE_CONTENT 原文，折叠区里可取用。 */
  raw: string;
  /**
   * 累积的**思考过程**（`CUSTOM model.reasoning`）。
   *
   * 与 `raw` 分开存是刻意的：思考内容不是回复。混在一起，客户端就没法区分「模型在想」和
   * 「模型在答」，生成界面那轮还会把这段散文塞进 JSONL 流。分开之后中间状态是免费的 ——
   * 有思考、没正文，就是「正在思考」。
   */
  thinking: string;
  /**
   * 本轮没能解析成协议消息的行（`CUSTOM a2ui.warning`）。
   *
   * 流式路径刻意不为坏行中断（一次坏行不该毁掉整轮），但**必须让它可见**：真出过这事 ——
   * 模型把 `surfaceUpdate` 的括号多写一个，整棵组件树被丢掉，界面却显示「已生成界面 ·
   * 2 条协议消息」，预览一片空白，看起来像渲染坏了。
   */
  warnings: string[];
  /** 本轮落地了几条协议消息（0 表示这轮没产出可渲染的东西）。 */
  messageCount: number;
  elapsedMs: number;
  /** 失败原因，仅 error 状态有值。 */
  error: string;
}

const chatMessages = ref<ChatMessage[]>([]);

/**
 * 「仅测模型对话」开关。
 *
 * 打开后发送键改打 `POST /api/a2ui/chat`：那边没有协议提示词、不产出界面，只把模型原话流回来。
 * 存在的意义是**排掉变量** —— baseURL / Key / 模型名只要有一个不对，生成界面那条路会以各种
 * 形态失败（抽不到消息、502、空产出），很难一眼看出是配置问题；纯对话直接给原话，对了就是对了。
 */
const chatOnly = ref(false);
/** 最近一次对话用的模型名（来自 `model.info` 事件），底栏显示。 */
const chatModel = ref('');
/** 聊天区的滚动容器：新内容到达时自动贴底。 */
const chatScrollRef = ref<HTMLElement | null>(null);

/**
 * 正在接收的那条 agent 消息在 `chatMessages` 里的下标，-1 表示当前没有在途的轮次。
 *
 * **存下标而不是存对象引用**：`ref([])` 是深响应式，push 进去的是原始对象，只有通过
 * `chatMessages.value[i]` 取出来的才是响应式代理。若抓住 push 时的原始对象去改，视图不会更新。
 */
let activeAgentIndex = -1;

/** SSE 读取进行中。读取期间发送键兼作「停止」。 */
const sseActive = ref(false);
/** 唯一的在途读取句柄：abort 会让服务端把这轮连接销毁掉（它监听了 req close）。 */
let sseController: AbortController | undefined;

/**
 * 流式期间每秒递增一次，驱动气泡里的「已用时 N 秒」。
 *
 * 没有它，等待期间界面是**静止**的：思考模式下首字要等 2~3 秒（生成界面那条路 5 秒以上），
 * 一句不动的「正在回复…」看不出到底是在跑还是卡住了。
 */
const streamTick = ref(0);
let streamTickTimer: ReturnType<typeof setInterval> | undefined;

const startStreamTick = (): void => {
  stopStreamTick();
  streamTick.value = 0;
  streamTickTimer = setInterval(() => {
    streamTick.value += 1;
  }, 1000);
};

const stopStreamTick = (): void => {
  if (streamTickTimer !== undefined) {
    clearInterval(streamTickTimer);
    streamTickTimer = undefined;
  }
  streamTick.value = 0;
};

/**
 * 把一条思考增量累进当前在途的气泡。两条流（生成界面 / 纯对话）共用。
 *
 * 只写 `thinking`、**不写 `raw`**：思考内容不是模型产出，混进 `raw` 会让「查看原始输出」
 * 变成读不懂的散文，抽取器也白跑一趟。
 */
const appendThinking = (value: Record<string, unknown>): void => {
  const current = chatMessages.value[activeAgentIndex];
  if (current !== undefined) {
    current.thinking += String(value.delta ?? '');
  }
};

/** 给当前在途的 agent 消息打补丁（走响应式代理，保证视图跟着更新）。 */
const patchActiveAgent = (patch: Partial<ChatMessage>): void => {
  const current = chatMessages.value[activeAgentIndex];
  if (current !== undefined) {
    Object.assign(current, patch);
  }
};

/**
 * 流式期间那行「中间状态」。
 *
 * 三个阶段**从已有数据推出来**，不另存字段：什么都没到 = 还在连接；只有思考内容 = 模型在
 * 思考；有正文 = 在回复/生成。存成字段就得在两处同步，迟早与实际收到的帧脱节；
 * 推出来的永远不会。
 *
 * 生成界面与纯对话共用 —— 两者的等待形态是一样的（思考模式下都会先静默几秒）。
 */
const describePhase = (message: ChatMessage): string => {
  const tail = streamTick.value > 0 ? ` · 已用时 ${streamTick.value}s` : '';

  // 已有协议消息落地 = 正在渲染（生成界面与场景载入都适用）。
  if (message.messageCount > 0) {
    return `协议渲染中 · 已渲染 ${message.messageCount} 条${tail}`;
  }

  if (message.mode === 'chat') {
    // 纯对话没有「协议」这回事，维持「连接 → 思考 → 回复」。
    if (message.raw !== '') {
      return `正在回复 · 已接收 ${message.raw.length} 字符${tail}`;
    }
    if (message.thinking !== '') {
      return `模型正在思考 · 已思考 ${message.thinking.length} 字符${tail}`;
    }
    return `正在连接模型…${tail}`;
  }

  // 生成界面（a2ui）：连接 → 思考 → 模型返回 → 协议渲染中 →（收尾）完成。
  if (message.raw !== '') {
    return `模型返回中 · 已接收 ${message.raw.length} 字符${tail}`;
  }
  if (message.thinking !== '') {
    return `模型正在思考 · 已思考 ${message.thinking.length} 字符${tail}`;
  }
  return message.kind === 'scenario' ? `正在从服务端载入…${tail}` : `正在连接模型…${tail}`;
};

/**
 * 气泡里那行「收尾文案」要不要显示。
 *
 * - **流式期间不显示**：那时显示的是阶段行（`describePhase`），两者不该同时在；
 * - **生成界面那轮结束后显示**：「已生成界面 · N 条协议消息」是它唯一的结果陈述；
 * - **纯对话那轮只在失败时补一句**：成功时回复正文就是全部内容，再加一行是噪音。
 */
const showsStatusLine = (message: ChatMessage): boolean => {
  if (message.status === 'streaming') {
    return false;
  }
  return message.mode === 'ui' || message.status === 'error';
};

/**
 * agent 气泡里那行**收尾**文案（流式期间的中间状态走 `describePhase`）。
 *
 * 纯对话的回复正文由模板直接渲染（它就是要显示的原话），这里只在失败时给一句说明。
 * 流式状态下返回 `describePhase` 只是兜底 —— 模板不会在流式时调它。
 */
const describeChatMessage = (message: ChatMessage): string => {
  if (message.role === 'user') {
    return message.text;
  }

  if (message.mode === 'chat') {
    if (message.status === 'error') {
      return `对话失败：${message.error}`;
    }
    return message.status === 'streaming' ? describePhase(message) : '';
  }

  const isScenario = message.kind === 'scenario';

  if (message.status === 'error') {
    return `${isScenario ? '载入失败' : '生成失败'}：${message.error}`;
  }

  if (message.status === 'streaming') {
    return describePhase(message);
  }

  const parts = [
    message.messageCount > 0
      ? `${isScenario ? `已载入示例场景 ${message.scenarioId}` : '已生成界面'} · ${message.messageCount} 条协议消息`
      : '本轮没有产出可渲染的消息',
  ];
  // 有解析提示（坏行被丢弃 / 或某行被自动修复）就并列显示 —— 只有条数会误导人。
  if (message.warnings.length > 0) {
    parts.push(`${message.warnings.length} 条解析提示`);
  }
  if (message.elapsedMs > 0) {
    parts.push(`耗时 ${message.elapsedMs} ms`);
  }
  return parts.join(' · ');
};

/** 发送键是否可点：有文本、或附了图片，或者正在流式（此时它兼作「停止」）。 */
const canSend = computed(
  () => sseActive.value || chatInput.value.trim() !== '' || attachedImages.value.length > 0,
);

/** 最近一轮对话的耗时，显示在底栏（对话模式没有 surface / 消息条数可报）。 */
const lastChatElapsed = computed(() => {
  for (let index = chatMessages.value.length - 1; index >= 0; index -= 1) {
    const message = chatMessages.value[index] as ChatMessage;
    if (message.mode === 'chat' && message.role === 'agent' && message.elapsedMs > 0) {
      return message.elapsedMs;
    }
  }
  return 0;
});

/** 刚复制过的那条消息 id —— 用来把图标短暂换成对勾。 */
const copiedId = ref('');
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

/** 复制某条 agent 消息的原始输出：调试时最常要的就是这段文本。 */
const copyRaw = async (message: ChatMessage): Promise<void> => {
  if (message.raw === '') {
    return;
  }
  try {
    await navigator.clipboard.writeText(message.raw);
    copiedId.value = message.id;
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copiedId.value = '';
    }, 1500);
  } catch {
    // 剪贴板不可用（非安全上下文 / 权限被拒）时静默失败 —— 不该为一次复制打断对话。
  }
};

/** 「查看 JSONL」弹窗的可见性。 */
const jsonlVisible = ref(false);
/** 弹窗里展示的 JSONL 文本（每条协议消息一行）。 */
const jsonlText = ref('');

/** 打开 JSONL 弹窗：把解析出的协议消息序列化成 JSONL（排查「为什么预览是空的」就看它）。 */
const openJsonl = (messages: unknown[]): void => {
  jsonlText.value = messages.map((item) => JSON.stringify(item)).join('\n');
  jsonlVisible.value = true;
};

/**
 * 字符流模式的状态。
 *
 * 块长与节奏都由**服务端**决定（`GET /api/a2ui/scenarios/:id/stream`），并在 `stream.started`
 * 事件里回显 —— 面板的标签据此显示，不写死数字。客户端只做一件事：收到一片就 `buffer.push()`。
 */
const charChunkSize = ref(0);
const charDelayMs = ref(0);
const charTotalChars = ref(0);
const charTotalChunks = ref(0);
const charReceivedChars = ref(0);
/** 字符流在途（读取期间按钮兼作「停止」）。 */
const charActive = ref(false);
/**
 * 服务端确认流已结束。
 *
 * 不能用「已收片数 ≥ 总片数」代替：开流之前两者都是 0，那个判据会一上来就成立，
 * 按钮直接变成灰的。
 */
const charDone = ref(false);
/** 字符流的失败原因，与对话的 `serverError` 分开记。 */
const charError = ref('');
/** 唯一的在途句柄：abort 会让服务端把这条流销毁掉（它监听了 req close）。 */
let charController: AbortController | undefined;

/**
 * 流式面板的**逐条模式**数据源：当前场景从服务端取回的原始 fixture（`scenarioLines`）。
 *
 * 逐条模式天生是「客户端步进」的（要能一条一条推、停下看 store 的变化），所以素材得先拿到手 ——
 * 这一份是服务端给的，派生规则 `deriveStreamOrders()` 也来自 core，两边不会各算各的。
 *
 * 派生逻辑在 `a2ui-core/mock/stream` 的 `deriveStreamOrders` 里，任何一份 JSONL 都能套用。
 *
 * - 协议顺序：`beginRendering` 在最后。surface 只有在这一条才诞生，前面全推完树依然是空的；
 * - 流式友好：把 `beginRendering` 提到 root 之后。root 一到 surface 就成立，后续子组件每
 *   到达一条就挂上一批，预览区能真的「边到边长大」。
 *
 * 字符流模式只看它的 `compact`（用来算「一共会补全出多少条消息」）——切片本身由服务端给。
 */
const streamOrders = computed(() => deriveStreamOrders(scenarioLines.value));

/**
 * 默认停在「流式友好」—— 这是**观感**的关键：协议顺序下组件全推完预览区一直空白，
 * 最后一条瞬间全出，是「跳变」而不是「生长」。想看协议原样顺序可以手动切回去对比。
 */
const streamOrderIndex = ref(1);
const streamMessages = computed(() => streamOrders.value[streamOrderIndex.value].messages);

/**
 * 推送模式：
 * - `jsonl`：**客户端步进**。一次推一条完整消息（素材来自服务端的 fixture 接口），
 *   交给 `createJSONLStream()`（行框定）。推送单元 = 消息。
 * - `char`：**服务端推送**。服务端把紧凑版拼成整段 JSON、按固定块长吐回来，
 *   交给 `createA2UIBuffer()`（JSON 框定）。切片必然落在 JSON 中间，靠括号配对拼回完整消息，
 *   并把多组件的 surfaceUpdate 补全成 N 条。
 */
type StreamMode = 'jsonl' | 'char';
const STREAM_MODES = [
  { label: '逐条（JSONL）', desc: '一次推一条完整消息，手动/自动步进', value: 'jsonl' as StreamMode },
  {
    label: '字符流（服务端切片）',
    desc: '服务端按固定块长吐原始 JSON，缓冲拼行 + 协议补全',
    value: 'char' as StreamMode,
  },
] as const;
const streamMode = ref<StreamMode>('jsonl');

/** 当前正在用的流式解析会话（`createJSONLStream()` 的实例），非响应式。 */
let stream: JSONLStream = createJSONLStream();
const streamCursor = ref(0);

/** 字符流的缓冲流实例（`createA2UIBuffer()`），非响应式。 */
let buffer: A2UIBuffer = createA2UIBuffer();
/** 已接收的分片数（服务端吐一片加一）。 */
const charCursor = ref(0);

/** buffer 计数的响应式镜像（buffer 本身非响应式，抄进 ref 供模板展示）。 */
const bufferValues = ref(0);
const bufferMessages = ref(0);

/** 已记入日志的 emitted 行数，用来算出「本次 push 新补全出了哪些消息」。 */
let loggedLines = 0;
/** 字符流模式：已补全出的协议消息条数（日志里写「第 k/N 条」用）。 */
let charEmitted = 0;

const streamAuto = ref(false);
const streamLog = ref<StreamLogEntry[]>([]);
let streamTimer: ReturnType<typeof setInterval> | undefined;

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

/** 当前模式下「推送单元」的总数：逐条模式是消息条数，字符流模式是服务端报的总片数。 */
const totalUnits = computed(() =>
  streamMode.value === 'char' ? charTotalChunks.value : streamMessages.value.length,
);

/** 已推送的单元数（游标）。 */
const pushedUnits = computed(() =>
  streamMode.value === 'char' ? charCursor.value : streamCursor.value,
);

/**
 * 当前预览该看哪个 surface。
 *
 * 「接口运行」拿的是服务端在 `a2ui.surface` 事件里给出的 id（自由输入时是 `surface-xxxx`，
 * 场景时就是 fixture 自带那个），Stream 面板推的则是场景自己的 id。两者不保证相同，
 * 所以按 `previewSource` 分辨 —— 取错的结果是预览区去 treeMap 里找一个不存在的 key，渲染成空白。
 */
const activeSurfaceId = computed(() =>
  previewSource.value === 'stream'
    ? (streamSurfaceId.value || activeScenario.value?.surfaceId || '')
    : (serverResult.value?.surfaceId ?? ''),
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

/** 面板右上角那枚 tag：跟着当前 tab 换口径。 */
/** 面板右上角那枚 tag：组件树规模 + 当前的返回方式。 */
const stageTag = computed(() => {
  const mode = streamSimOn.value ? '流式返回' : '整体返回';
  return `${treeLabel.value} · ${mode}`;
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
/**
 * 预览区里发生的**服务端动作**：转发到后端，再把回执消息 ingest 回 store。
 *
 * 事件由 `a2ui-vue` 的 Button 渲染器派发（`bubbles: true`），所以监听挂在预览容器上
 * 就能覆盖所有按钮，不必逐个挂。本地动作（`type: "local"`）不走这里 —— 它在渲染层
 * 直接写回数据模型，本来就不需要服务端。
 */
const forwardPreviewAction = async (event: Event): Promise<void> => {
  const detail = (event as CustomEvent<{ userAction?: Record<string, unknown> }>).detail;
  const userAction = detail?.userAction;
  const name = typeof userAction?.name === 'string' ? userAction.name : '';
  if (!userAction || name === '') {
    return;
  }

  const startedAt = performance.now();
  const receipt: ActionReceipt = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    status: 'error',
    handledBy: '',
    messageCount: 0,
    elapsedMs: 0,
    detail: '',
  };

  // 用「产生当前界面的那个会话」，不是输入框那个：示例场景跑在 `sc-xxxx` 独立 thread 上，
  // 拿 `serverThreadId` 去查必然 404（这个坑真踩过）。
  const sessionId =
    previewSource.value === 'stream' ? '' : (serverResult.value?.sessionId ?? serverThreadId.value);

  if (sessionId === '') {
    receipt.detail = 'Stream 模拟的界面来自本地 fixture，没有服务端会话，动作不回传';
    receipt.elapsedMs = Math.round(performance.now() - startedAt);
    actionLog.value = [receipt, ...actionLog.value].slice(0, ACTION_LOG_LIMIT);
    return;
  }

  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: sessionId, userAction }),
    });
    const payload = (await response.json()) as {
      handledBy?: string;
      messageCount?: number;
      messages?: unknown[];
      error?: string;
    };

    if (!response.ok) {
      receipt.detail = payload.error ?? `HTTP ${response.status}`;
    } else {
      receipt.status = 'ok';
      receipt.handledBy = payload.handledBy ?? '';
      receipt.messageCount = payload.messageCount ?? 0;
      receipt.detail = payload.error ? `handler 报错：${payload.error}` : '';
      // 逐条 ingest：与流式路径共用同一套分发与派生逻辑，不另开注入通道。
      for (const message of payload.messages ?? []) {
        parseA2UI(JSON.stringify(message));
      }
    }
  } catch (error) {
    receipt.detail = error instanceof Error ? error.message : String(error);
  } finally {
    receipt.elapsedMs = Math.round(performance.now() - startedAt);
    actionLog.value = [receipt, ...actionLog.value].slice(0, ACTION_LOG_LIMIT);
  }
};

const renderTreeIntoPreview = (treeMap: TreeMap) => {
  const container = previewRef.value;
  // 容器还没挂载时直接跳过 —— 这不代表树有问题，只是暂时没地方画。
  if (!container) return;

  const vnode = treeMap[activeSurfaceId.value]?.root?.vnode;
  // cloneVNode 是必需的：store 里存的就是同一个 VNode 实例，
  // 反复渲染同一个实例会触发 Vue 的复用警告。渲染不出来时渲染 null 以清空容器。
  render(isVNode(vnode) ? cloneVNode(vnode) : null, container);
};

/**
 * 「这一轮推完了」。两条模式的判据不同：
 * - 逐条：游标走到末尾即可；
 * - 字符流：以服务端的 `stream.done` 为准 —— 开流之前总片数是 0，用「游标 ≥ 总数」会一上来
 *   就成立，按钮直接变灰。
 */
const streamFinished = computed(() =>
  streamMode.value === 'char' ? charDone.value : pushedUnits.value >= totalUnits.value,
);

const streamPercent = computed(() => {
  if (streamMode.value === 'char') {
    return charTotalChunks.value === 0
      ? 0
      : Math.round((charCursor.value / charTotalChunks.value) * 100);
  }
  return totalUnits.value === 0 ? 0 : Math.round((pushedUnits.value / totalUnits.value) * 100);
});

const stopAuto = () => {
  if (streamTimer !== undefined) {
    clearInterval(streamTimer);
    streamTimer = undefined;
  }
  streamAuto.value = false;
};

/**
 * 中断在途的字符流。
 *
 * 只 abort 本地读取即可 —— 服务端监听了连接关闭，会把那条流一并销毁，不必再发一个「取消」指令。
 * 主动停不算失败：已经渲染出来的部分保留。
 */
const abortCharStream = () => {
  charController?.abort();
  charController = undefined;
  charActive.value = false;
};

/**
 * 把 Stream 面板恢复到「一条都没推」的状态：两套流的缓冲、游标、日志一并归零。
 *
 * **刻意不动 store** —— 清 store 用 `clearStore()`。分开是为了让「开流之后才清场」那条规矩
 * 有地方落脚：入参不合法时服务端在开流之前就回了 4xx，先清场会白白抹掉已经渲染好的预览。
 */
const clearStreamState = () => {
  stream = createJSONLStream();
  streamCursor.value = 0;

  buffer = createA2UIBuffer();
  charCursor.value = 0;
  charReceivedChars.value = 0;
  charTotalChars.value = 0;
  charTotalChunks.value = 0;
  charDone.value = false;
  bufferValues.value = 0;
  bufferMessages.value = 0;
  loggedLines = 0;
  charEmitted = 0;

  streamLog.value = [];
};

/** 面板的「重置」：停掉在途的流 + 清 store + 归零。切换场景 / 顺序 / 模式时也走它。 */
const resetStream = () => {
  stopAuto();
  abortCharStream();
  clearStore();
  clearStreamState();
  charError.value = '';
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
 * 紧凑文本交给 buffer 后，**总共**会补全出多少条独立消息 —— 日志里写「第 k/N 条」用。
 *
 * 直接用 buffer 自己的 `normalizeToJSONL()` 逐行折算，所以这个数与实际产出**必然一致**。
 * 自己数会数少：`dataModelUpdate` 会被递归拆到叶子条目，一行进去可能出来十几条。
 *
 * 必须逐行摊平求和，不能只看第一条 —— 流式友好版被拆成「root 单独一条 + 其余压成一条」，
 * 只看 `compact[0]` 会数成 1。
 */
const plannedMessages = computed(() =>
  streamOrders.value[streamOrderIndex.value].compact.flatMap((line) => normalizeToJSONL(line))
    .length,
);

/**
 * 把 buffer 这一片**新补全**出来的消息记进日志。
 *
 * buffer 是「JSON 框定」的：一片几十字符通常闭不了整个值，所以多数 push 什么也不产出
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
  const total = plannedMessages.value;
  // 这批新消息在 buffer 里的序号区间是 [messageCount - lines.length + 1, messageCount]。
  const firstOrdinal = buffer.messageCount - lines.length + 1;

  streamLog.value = [
    ...streamLog.value,
    ...lines.map((line, offset) => {
      const { kind, detail } = describeMessage(line);

      // 序号按**每一条补全出来的消息**递增（含 dataModelUpdate 摊平出的叶子条目）：
      // 分子只有数全了，才配得上分母 `plannedMessages`（同样是全量折算）。
      // 逐条模式压根没走补全（一条进一条出），所以只有字符流模式标注。
      let note = '';
      if (streamMode.value === 'char' && total > 1) {
        charEmitted += 1;
        note = `协议补全 · 第 ${charEmitted}/${total} 条`;
      }

      return { index: firstOrdinal + offset, kind, detail, note, ...stats };
    }),
  ];
};

/**
 * 同步推送**下一条**消息（逐条模式专用）：走 `createJSONLStream`。
 *
 * 先缓冲、再 ingest、最后 `refreshDerivedState()`（hydrate + buildTree，**并在末尾回调
 * SDK 注册的 renderTree**），所以返回时 store 已是新的、预览也已经重画过了。
 *
 * 字符流模式没有这个函数 —— 那一步是**服务端推**的，客户端只能开与停（见 `runScenarioStream`）。
 */
const pushNext = () => {
  if (streamFinished.value) {
    stopAuto();
    return;
  }

  const line = streamMessages.value[streamCursor.value];
  if (line === undefined) {
    stopAuto();
    return;
  }

  // 游标必须**先**推进：下面 stream.push() 会同步回调 renderTreeIntoPreview，
  // 而渲染器要读 activeSurfaceId（依赖 streamCursor）来决定画哪个 surface。
  // 若放在 push 之后，第一条消息回调时 cursor 还是 0，渲染器会去画别的 surface → 空。
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
 * 自动逐条推送：定时器逐条调 `pushNext`，间隔取随机值，推到末尾自动停。
 *
 * 随机间隔 + 入场动画 300ms（a2ui-vue 的 `withEntranceAnimation`），让相邻两三条的动画互相叠着播，
 * 视觉上是连续的「生长」而不是一格一格的跳。
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
  streamTimer = setInterval(pushNext, 200 * Math.random());
};

/**
 * 拉场景**列表**并选中默认项。挂载时跑一次；失败就把原因留在 `scenarioError` 里给用户看 ——
 * 空下拉配一句「服务端是不是没起」比什么都不说要好查得多。这是「完全走服务端」的代价，认了。
 */
const loadScenarios = async (): Promise<void> => {
  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/scenarios`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { scenarios: ScenarioSummary[]; defaultId: string };
    scenarios.value = body.scenarios;
    scenarioError.value = '';
    scenarioId.value = body.scenarios.some((item) => item.id === body.defaultId)
      ? body.defaultId
      : (body.scenarios[0]?.id ?? '');
  } catch (error) {
    scenarios.value = [];
    scenarioError.value = error instanceof Error ? error.message : String(error);
  }
};

/**
 * 载入一个场景：**取 fixture** + **走 SSE 跑一遍**（给预览区）。
 *
 * 两个请求是两件事，别合并：
 * - `/scenarios/:id` 只把素材取回来（Stream 面板的逐条模式要用），服务端的抽取 / 装配 /
 *   AG-UI 映射一个都不跑；
 * - `/run { scenario }` 才是真链路 —— 服务端把这份 fixture 拼成 JSONL 文本、按固定块长切碎、
 *   经抽取器还原成协议消息、逐条包成 `CUSTOM a2ui.message` 事件下发。
 *   预览区渲染的就是它，所以示例数据与自由输入走的是**完全相同**的一条路。
 */
const loadScenario = async (id: string): Promise<void> => {
  if (id === '') {
    return;
  }

  // fixture 先拿（Stream 面板随时可能切过去用）。失败不阻断 —— 预览那条路才是主角。
  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/scenarios/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { lines: string[]; surfaceId: string };
    scenarioLines.value = body.lines;
    // 先按 fixture 接口报的 id 记下，字符流开流后会被 `stream.started` 的权威值覆盖。
    streamSurfaceId.value = body.surfaceId;
  } catch {
    scenarioLines.value = [];
    streamSurfaceId.value = '';
  }

  await runFromServer({ scenario: id });
};

watch(scenarioId, (id) => {
  void loadScenario(id);
});

/**
 * 换一个 threadId：下一次请求在服务端算「新会话」，会回完整骨架而不是增量。
 * 对话记录一并清空 —— 「新会话」在界面上本来就该是一段新对话。
 */
const startNewServerSession = () => {
  serverThreadId.value = newServerThreadId();
  serverResult.value = null;
  serverError.value = '';
  serverElapsed.value = 0;
  chatMessages.value = [];
  activeAgentIndex = -1;
};

/** 重新载入当前场景（选同一个场景不会再触发 `watch`，所以需要这个显式出口）。 */
const reloadScenario = () => {
  if (scenarioId.value !== '') {
    void loadScenario(scenarioId.value);
  }
};

/**
 * 把非 2xx 响应里的 `error` 文案取出来。服务端的 4xx 都是 `{ error: "..." }` 这个形状，
 * 直接显示状态码会把「为什么失败」丢掉。
 */
const readError = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

/** SSE 帧 → 事件对象。只认 `data:` 行（`event:` 名与注释行按规范忽略）。 */
const parseSseFrame = <T>(frame: string): T | null => {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (dataLine === undefined) {
    return null;
  }
  try {
    return JSON.parse(dataLine.slice('data:'.length).trim()) as T;
  } catch {
    // 分帧按 `\n\n` 切，正常不会出现半截 JSON；真遇到就跳过这一帧，不打断整条流。
    return null;
  }
};

/**
 * 读一条 SSE 响应，按 `\n\n` 分帧后逐帧回调。**两条流共用**：AG-UI 事件流（`/run`）与
 * 场景字符流（`/scenarios/:id/stream`）。
 *
 * 为什么不用 `EventSource`：它只能发 GET，而入参在请求体里 —— 只能 `fetch` +
 * `response.body.getReader()` 手动切帧。剥 `data:` 前缀、按空行分帧这套逻辑只写一遍，
 * 两条流的字节处理必然一致。
 *
 * 泛型只是为了让两个事件的形状各自保持类型：传输层不关心 `type` 是什么。
 */
const readSse = async <T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> => {
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
      const event = parseSseFrame<T>(frame);
      if (event !== null) {
        onEvent(event);
      }
      boundary = pending.indexOf('\n\n');
    }
  }
};

/**
 * 一条场景字符流事件 → 宿主侧动作。
 *
 * 全文**不在这里拼**：`buffer.push()` 只吃「刚到的这一片」，它自己用括号配对把消息补回去。
 * 若先攒够整段再喂，缓冲层的「边到边补全」就白费了 —— 那正是这条流存在的意义。
 */
const handleScenarioStreamEvent = (event: ScenarioStreamEvent): void => {
  if (event.type === 'stream.started') {
    charChunkSize.value = event.chunkSize;
    charDelayMs.value = event.delayMs;
    charTotalChars.value = event.totalChars;
    charTotalChunks.value = event.totalChunks;
    // 服务端报的 surfaceId 是权威值（它从 fixture 里读出来）——预览按它去 treeMap 取树。
    streamSurfaceId.value = event.surfaceId;
    return;
  }

  if (event.type === 'stream.done') {
    charDone.value = true;
    return;
  }

  charCursor.value += 1;
  charReceivedChars.value += event.text.length;
  buffer.push(event.text);
  drainBufferLog();
};

/**
 * 拉服务端的**原始字符流**并喂进缓冲流。
 *
 * 与逐条模式的根本差别：节奏与切片边界都属于服务端。客户端不再 `chunkText()` 自己切、
 * 也不用定时器自己造 —— 切片落在 JSON 中间这件事由真实网络分片来考，而不是自己喂自己。
 */
const runScenarioStream = async (): Promise<void> => {
  const id = scenarioId.value;
  if (id === '') {
    charError.value = '还没有选中示例场景';
    return;
  }

  charError.value = '';
  charActive.value = true;

  const controller = new AbortController();
  charController = controller;

  // 顺序（协议原样 / 流式友好）由下拉决定，服务端按它派生要吐的文本 ——
  // 与逐条模式用的是 core 的同一个 `deriveStreamOrders()`，所以两边看到的顺序一致。
  const order = streamOrderIndex.value === 0 ? 'protocol' : 'stream';

  try {
    const response = await fetch(
      `${SERVER_BASE}/api/a2ui/scenarios/${encodeURIComponent(id)}/stream?order=${order}`,
      { headers: { Accept: 'text/event-stream' }, signal: controller.signal },
    );

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const body = response.body;
    if (body === null) {
      throw new Error('响应没有可读的流');
    }

    // 只有真的开流了才清场：参数非法 / 场景不存在时服务端在开流**之前**就回了 4xx，
    // 先清场会白白抹掉已经渲染好的预览。
    clearStore();
    clearStreamState();
    previewSource.value = 'stream';

    await readSse<ScenarioStreamEvent>(body, handleScenarioStreamEvent);
  } catch (error) {
    if (controller.signal.aborted) {
      // 用户主动停：不是错误，已经渲染出来的部分保留。
      return;
    }
    charError.value = error instanceof Error ? error.message : String(error);
  } finally {
    charActive.value = false;
    charController = undefined;
  }
};

/**
 * 字符流按钮：未开始 → 开始；在途 → 停止；已流完 → 重新流。
 *
 * 「重新流」要先 `resetStream()`：buffer 里还留着上一轮的残片与计数，不清就接着喂会把
 * 两份数据接在一起（正是缓冲层最怕的输入）。
 */
const toggleCharStream = async (): Promise<void> => {
  if (charActive.value) {
    abortCharStream();
    return;
  }
  if (charDone.value) {
    resetStream();
  }
  await runScenarioStream();
};

/** 一条 AG-UI 事件 → 宿主侧的动作。
 * 一条 AG-UI 事件 → 宿主侧的动作。
 *
 * 关键约定：`CUSTOM a2ui.surface` **一定先于**任何 `a2ui.message` 到达（服务端保证），
 * 所以 surfaceId 就位之后才开始渲染，预览区不会出现「拿旧 surfaceId 找树」的空窗。
 */
const handleAgUiEvent = (event: AgUiSseEvent): void => {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    // 逐块累进当前 agent 气泡的原文 —— 折叠区里能看到模型此刻正在吐什么。
    const current = chatMessages.value[activeAgentIndex];
    if (current !== undefined) {
      current.raw += event.delta;
    }
    return;
  }

  if (event.type === 'RUN_ERROR') {
    serverError.value = `服务端 RUN_ERROR（${event.code}）：${event.message}`;
    patchActiveAgent({ status: 'error', error: `${event.code}：${event.message}` });
    return;
  }

  if (event.type !== 'CUSTOM') {
    return;
  }

  // 思考增量：只累进 `thinking`，不动 `raw`（见 `appendThinking`）。
  if (event.name === 'model.reasoning') {
    appendThinking(event.value);
    return;
  }

  if (event.name === 'a2ui.surface') {
    serverResult.value = {
      // 用事件里回显的 threadId，而不是本地那个变量：场景运行走的是 `sc-xxxx` 独立 thread，
      // 若这里填 `serverThreadId`，底部的状态条就会显示一个跟本轮无关的会话号。
      sessionId: String(event.value.threadId ?? serverThreadId.value),
      surfaceId: String(event.value.surfaceId ?? ''),
      provider: String(event.value.provider ?? ''),
      messages: [],
      warnings: [],
    };
    previewSource.value = 'api';
    return;
  }

  if (event.name === 'a2ui.message') {
    // 记账与渲染走同一条：先入列（状态条实时涨），再进 JSONL 流 ——
    // push 内部 ingest + 刷新派生状态（含 SDK 的 renderTree 回调），所以预览随即长出来。
    serverResult.value?.messages.push(event.value);
    // 流式期间实时把条数写进气泡，让「协议渲染中」阶段能显示已渲染 N 条
    //（收尾 settle 之前 messageCount 一直是初始的 0）。
    patchActiveAgent({ messageCount: serverResult.value?.messages.length ?? 0 });
    const line = `${JSON.stringify(event.value)}\n`;
    if (streamSimOn.value) {
      // 流式返回：逐条到达即渲染，预览逐块长出。
      stream.push(line);
    } else {
      // 整体返回：先攒着，settle 时一口气 ingest —— 预览一次性出现。
      pendingIngest.push(line);
    }
    return;
  }

  if (event.name === 'a2ui.warning') {
    // 坏行不中断这一轮，但要让用户看见：模型输出有语法错误时，整棵组件树可能就这么没了，
    // 而界面上只表现为「预览是空的」——不提示的话，看起来像渲染坏了。
    const current = chatMessages.value[activeAgentIndex];
    if (current !== undefined) {
      current.warnings.push(String(event.value.message ?? ''));
    }
  }
};

/**
 * 一条**对话**事件 → 气泡。
 *
 * 只认四件事：思考增量（中间状态）、文本增量（正文）、`model.info`（模型名）、
 * `RUN_ERROR`（失败）。**没有 `a2ui.message` 分支** —— 这条流压根不发协议消息。
 */
const handleChatEvent = (event: AgUiSseEvent): void => {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    const current = chatMessages.value[activeAgentIndex];
    if (current !== undefined) {
      current.raw += event.delta;
    }
    return;
  }

  if (event.type === 'RUN_ERROR') {
    serverError.value = `服务端 RUN_ERROR（${event.code}）：${event.message}`;
    patchActiveAgent({ status: 'error', error: `${event.code}：${event.message}` });
    return;
  }

  if (event.type !== 'CUSTOM') {
    return;
  }

  if (event.name === 'model.reasoning') {
    appendThinking(event.value);
    return;
  }

  if (event.name === 'model.info') {
    chatModel.value = String(event.value.model ?? '');
  }
};

/** 一次运行要发给服务端的载荷：一句话，或一个示例场景。 */
type RunPayload = { message: string } | { scenario: string };

/**
 * 跑一轮：POST `/api/a2ui/run` 走 **SSE**，边收边渲染。
 *
 * **自由输入与示例场景共用这一条**，差别只在请求体带 `message` 还是 `scenario` ——
 * 服务端两种都认（见 `inbound.ts`），回来的也都是同一串 AG-UI 事件。这正是把示例数据接上
 * 接口的意义：演示用例和真实用例走同一条路，不存在「本地渲染」的第二套。
 *
 * 为什么不用 `EventSource`：它只能发 GET，而入参在请求体里 —— 只能 `fetch` +
 * `response.body.getReader()` 手动切帧（`\n\n` 分帧、剥 `data:` 前缀）。
 *
 * 每条 `CUSTOM a2ui.message` 立刻 `stream.push()` 进与 Stream 面板同一个 JSONL 流，
 * 于是流式渲染、入场动画、数据模型绑定全部自动复用，没有第二套渲染路径。
 *
 * 在途时再调一次即中断本地读取，服务端监听了连接关闭会把这轮流销毁。主动停不算失败。
 */
/**
 * 上一轮 `/run` 用的 threadId。
 *
 * 同一个 thread 的后续轮次是**增量修改**：模型按提示词约束只发 `surfaceUpdate`（可只带受
 * 影响的组件）、不重发 `beginRendering`。这种轮次**不能清 store** —— 上一轮的组件树就
 * 存在那里，增量消息靠「同 id 原地更新」落到它上面；清了的话增量消息没有根，预览永远空白。
 */
let lastRunThreadId = '';

const runFromServer = async (payload: RunPayload): Promise<void> => {
  if (sseActive.value) {
    // 同一时刻只允许一轮：两轮流同时往 store 里写会互相抹掉对方的渲染结果。
    // 场景下拉在流式期间是禁用的，所以这里只是兜底。
    sseController?.abort();
    return;
  }

  const scenario = 'scenario' in payload ? payload.scenario : '';
  const prompt = 'message' in payload ? payload.message : '';

  /**
   * 场景用**独立的 thread**。
   *
   * 它不是对话的一轮：跟对话共用一个会话会把两件事缠在一起 —— 会话的「活跃 surface」会被
   * 场景顶掉，之后你再发一句话，服务端就画到示例的界面上去了。独立 thread 还顺带保证
   * 每次载入都是干净会话，surface 缓存不会累积重复消息。
   */
  const threadId = scenario === '' ? serverThreadId.value : newServerThreadId('sc');

  // 占位气泡要**先落进记录**再发请求：顺序反了的话，先到的 delta 找不到落点会被丢掉。
  // 场景运行不推 user 气泡 —— 用户并没有「说」什么，它只是一次载入。
  if (scenario === '') {
    chatMessages.value.push({
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt,
      status: 'done',
      kind: 'chat',
      mode: 'ui',
      scenarioId: '',
      raw: '',
      thinking: '',
      warnings: [],
      messageCount: 0,
      elapsedMs: 0,
      error: '',
    });
  }
  chatMessages.value.push({
    id: `a-${Date.now()}`,
    role: 'agent',
    text: '',
    status: 'streaming',
    kind: scenario === '' ? 'chat' : 'scenario',
    mode: 'ui',
    scenarioId: scenario,
    raw: '',
    thinking: '',
    warnings: [],
    messageCount: 0,
    elapsedMs: 0,
    error: '',
  });
  activeAgentIndex = chatMessages.value.length - 1;
  if (scenario === '') {
    chatInput.value = '';
  }
  // 图片随这一轮发出后立即清空（仅生成界面那条路）；场景载入不附带图片。
  const pendingImages =
    scenario === '' ? attachedImages.value.map((image) => ({ dataUrl: image.dataUrl })) : [];
  attachedImages.value = [];

  serverError.value = '';
  pendingIngest = [];
  sseActive.value = true;
  startStreamTick();

  const controller = new AbortController();
  sseController = controller;
  const startedAt = Date.now();

  /** 一轮结束时收尾：把状态、条数、耗时记到那个 agent 气泡上。 */
  const settle = (status: ChatMessage['status'], errorText = ''): void => {
    // 整体返回：到这里才把攒着的消息一口气 ingest。成功失败都补上 ——
    // 半截流也该让用户看见已经到的部分，而不是悄悄丢掉。
    if (pendingIngest.length > 0) {
      for (const line of pendingIngest) {
        stream.push(line);
      }
      pendingIngest = [];
    }

    const elapsedMs = Date.now() - startedAt;
    patchActiveAgent({
      status,
      error: errorText,
      messageCount: serverResult.value?.messages.length ?? 0,
      elapsedMs,
    });
    serverElapsed.value = elapsedMs;
  };

  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(
        scenario === ''
          ? {
              threadId,
              message: prompt,
              ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
            }
          : { threadId, scenario },
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const body = response.body;
    if (body === null) {
      throw new Error('响应没有可读的流');
    }

    // 只有真正开流了才清场：入参非法时服务端在开流**之前**就回了 400，
    // 那种情况下不该把已经渲染好的预览抹掉。
    // 清场分两档：**同 thread 的后续轮次是增量修改**，只归零流状态、保留 store
    // （增量 surfaceUpdate 靠「同 id 原地更新」落到上一轮的组件树上）；换 thread
    // （新会话 / 场景载入）才整体清场。
    if (threadId === lastRunThreadId) {
      clearStreamState();
    } else {
      resetStream();
    }
    lastRunThreadId = threadId;
    previewSource.value = 'api';
    serverResult.value = null;

    await readSse<AgUiSseEvent>(body, handleAgUiEvent);

    settle('done');
  } catch (error) {
    if (controller.signal.aborted) {
      // 用户主动停：不是错误，已经渲染出来的部分保留。
      settle('done');
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    serverError.value = text;
    settle('error', text);
  } finally {
    sseActive.value = false;
    stopStreamTick();
    sseController = undefined;
    activeAgentIndex = -1;
  }
};

/**
 * 把一轮**对话**（用户那句 + 一个 streaming 的占位气泡）落进记录。
 *
 * 占位气泡必须**先落**再发请求 —— 顺序反了的话，先到的 delta 找不到落点会被丢掉。
 */
const pushChatTurn = (prompt: string): void => {
  const base = {
    status: 'done' as const,
    kind: 'chat' as const,
    mode: 'chat' as const,
    scenarioId: '',
    messageCount: 0,
    elapsedMs: 0,
    error: '',
    thinking: '',
    warnings: [],
  };

  chatMessages.value.push({ ...base, id: `u-${Date.now()}`, role: 'user', text: prompt, raw: '' });
  chatMessages.value.push({
    ...base,
    id: `a-${Date.now()}`,
    role: 'agent',
    text: '',
    raw: '',
    status: 'streaming',
  });
  activeAgentIndex = chatMessages.value.length - 1;
};

/**
 * 拼出这一轮要发给对话接口的 `messages`（历史 + 本轮）。
 *
 * 接口是**无状态**的，多轮得自己带（见 `chat/index.ts`）。只收 `mode === 'chat'` 且已完成的
 * 轮次 —— 生成界面那几轮的 `raw` 是 JSONL 原文，混进上下文会把模型带偏。
 */
const chatHistory = (prompt: string): Array<{ role: 'user' | 'assistant'; content: string }> => {
  const history = chatMessages.value
    .filter((message) => message.mode === 'chat' && message.status === 'done')
    .map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.role === 'user' ? message.text : message.raw,
    }))
    .filter((message) => message.content.trim() !== '');

  history.push({ role: 'user', content: prompt });
  return history;
};

/**
 * 跑一轮**纯模型对话**：`POST /api/a2ui/chat`，只在气泡里显示模型原话。
 *
 * 与 `runFromServer` 的关键差别：**完全不碰 A2UI 那一侧** —— 不清 store、不动预览、
 * 不喂 JSONL 流、不写会话缓存。这是刻意的：这个模式的用途就是「只测模型链接」，
 * 掺进任何协议层的东西都会把变量带回来。
 */
const runChat = async (history: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> => {
  serverError.value = '';
  sseActive.value = true;
  startStreamTick();

  const controller = new AbortController();
  sseController = controller;
  const startedAt = Date.now();

  try {
    const response = await fetch(`${SERVER_BASE}/api/a2ui/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: history }),
      signal: controller.signal,
    });

    // 未配 Key 时服务端在开流之前就回了 503，文案直接拿来用（它写明了该改哪个文件）。
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const body = response.body;
    if (body === null) {
      throw new Error('响应没有可读的流');
    }

    await readSse<AgUiSseEvent>(body, handleChatEvent);
    patchActiveAgent({ status: 'done', elapsedMs: Date.now() - startedAt });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (controller.signal.aborted) {
      // 用户主动停：不算失败，已经收到的部分保留。
      patchActiveAgent({ status: 'done', elapsedMs });
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    serverError.value = text;
    patchActiveAgent({ status: 'error', error: text, elapsedMs });
  } finally {
    sseActive.value = false;
    stopStreamTick();
    sseController = undefined;
    activeAgentIndex = -1;
  }
};

/**
 * 发送框那一句。空输入不发送。
 *
 * 兼作「停止」：在途时再点一次 = 中断，所以这里先判 `sseActive` 而不判输入是否为空 ——
 * 流式期间输入框是禁用的，此时点按钮只可能是想停。
 *
 * 两条路在这里分流，之后互不相干：生成界面走 `runFromServer`，仅测对话走 `runChat`。
 */
const sendMessage = async (): Promise<void> => {
  if (sseActive.value) {
    sseController?.abort();
    return;
  }

  const prompt = chatInput.value.trim();
  if (prompt === '') {
    return;
  }

  if (chatOnly.value) {
    // 先取历史再落本轮气泡：`chatHistory` 读的就是这份记录，本轮的占位会污染它。
    const history = chatHistory(prompt);
    pushChatTurn(prompt);
    chatInput.value = '';
    await runChat(history);
    return;
  }

  await runFromServer({ message: prompt });
};

/**
 * 切换「仅测模型对话」就清空对话。
 *
 * 两种模式的记录含义不同（一边是「生成界面」的轮次、一边是纯聊天），混在一起既没法读，
 * 也会被 `chatHistory()` 过滤得七零八落。顺带把在途请求停掉 —— 它的回调正往旧气泡里写。
 */
watch(chatOnly, () => {
  sseController?.abort();
  chatMessages.value = [];
  activeAgentIndex = -1;
  serverError.value = '';
  chatInput.value = '';
});

/** 换消息顺序 / 推送模式都等于换数据源与游标语义：清空重来，否则会与新数据错位。 */
watch(streamOrderIndex, resetStream);
watch(streamMode, resetStream);

/**
 * 新内容到达就把对话区贴底。
 *
 * 必须 `deep`：流式期间变的是**某条气泡内部的 `raw`**，数组本身和元素引用都没换，
 * 浅层 watch 一次都不会触发。改为按 id 定位也行，但那要在每次 delta 上做一次查找 ——
 * 这里一轮只 push 两条，深度遍历的代价远小于每次 delta 的线性扫描。
 */
watch(
  chatMessages,
  () => {
    void nextTick(() => {
      const element = chatScrollRef.value;
      if (element !== null) {
        element.scrollTop = element.scrollHeight;
      }
    });
  },
  { deep: true },
);

onMounted(() => {
  // 第二个参数就是「渲染组件树的方法」：SDK 会在每次建树后、以及清空 store 后调用它。
  const store = init(renderMap, renderTreeIntoPreview);
  unsubscribe = store.subscribe((state) => {
    storeState.value = state;
  });
  // 场景列表到手后会自动选中默认项，`watch(scenarioId)` 随即载入它 —— 首屏的界面
  // 因此也是从服务端取回来的，与手动切换走的是同一条路。
  void loadScenarios();

  // 服务端动作的出口：渲染层只管派发，传输与回执由宿主决定（见 forwardPreviewAction）。
  previewRef.value?.addEventListener('a2ui-action', forwardPreviewAction);
});

onBeforeUnmount(() => {
  stopAuto();
  stopStreamTick();
  previewRef.value?.removeEventListener('a2ui-action', forwardPreviewAction);
  // 在途的 SSE 读取要主动中断：否则组件已卸载它还在读，回调会去碰已卸载的响应式状态。
  // 两条流各有一句 —— 字符流那条同样会一直往 buffer 里灌。
  abortCharStream();
  sseController?.abort();
  // 复制反馈的定时器同理，卸载后不该再碰 copiedId。
  clearTimeout(copyResetTimer);
  // 选取模式的 Esc 监听器（挂着才有）。
  detachPickingKeydown();
  unsubscribe?.();
  // render() 产生的 DOM 不归本组件管，卸载时要手动清掉。
  if (previewRef.value) {
    render(null, previewRef.value);
  }
});
</script>

<style scoped>
/* 整页不滚：滚动交给左右两栏各自的内部区域，这样聊天栏才能固定在右侧。
   `box-sizing: border-box` 不能省 —— 否则 100vh + padding 会溢出、凭空多出一条滚动条。 */
.playground {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-sizing: border-box;
  height: 100vh;
  padding: 1.25rem 1.5rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
}

.toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex: 0 0 auto;
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

/* `box-sizing: border-box` 必须显式写：默认的 `content-box` 下，右栏的
   `max-width: 380px` 只管内容盒，再叠上 1.25rem×2 的 padding 与 1px 边框，
   实际占位会变成 422px（实测）。 */
.panel {
  box-sizing: border-box;
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

/* 选取模式：容器内一律十字光标，暗示「这是在选择而不是在操作」。 */
.preview--picking {
  cursor: crosshair;
}

/*
 * 选取模式的悬停高亮。
 * class 由 JS 直接加在组件根元素上（a2ui-vue 的 withRootId 挂 id 的那个元素）——
 * 不走 Vue 绑定，是因为这些 DOM 归 render() 出的树管，绑 class 会在下次重渲染时被冲掉。
 */
.a2ui-pick-hover {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
  border-radius: 3px;
}

.hint {
  margin: 0.75rem 0 0;
  color: #9ca3af;
  font-size: 0.85rem;
}

/* 选取提示用主色，跟普通灰提示区分开 —— 它表示一个「进行中的模式」。 */
.hint--picking {
  color: #2563eb;
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

/* ── 折叠区里的 data-binding 提示 ── */

.binding-desc {
  margin: 0.4rem 0 0.5rem;
}

.fold code {
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #e6f0ff;
  color: #2b5fa8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
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

/* 动作回执列表：一行一条，名称等宽、附注次要色 */
.action-log {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: #1f2937;
}

.action-log code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #eef2f8;
  border-radius: 4px;
  padding: 0.05rem 0.3rem;
}

.action-log__meta {
  margin-left: 0.35rem;
  color: #6b7280;
}

.action-log__err {
  margin-left: 0.35rem;
  color: #b42318;
}

.action-log__hint {
  margin: 0.4rem 0 0;
  font-size: 0.74rem;
  color: #6b7280;
}

/* ── 工作区：左舞台 + 右聊天 ── */

.workspace {
  display: flex;
  align-items: stretch;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
}

/* `min-height: 0` 是关键：flex 子项默认 `min-height: auto`，不加这行内部滚动区撑不开，
   整页会被内容顶高、长出一个外层滚动条。 */
.stage-panel,
.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stage-panel {
  flex: 1 1 auto;
  min-width: 0;
}

/* `min-width: 0`：flex 子项的自动最小尺寸是 `min-content`，配合 `flex-shrink: 0`
   会让内容把宽度顶出 `flex-basis`；置 0 才能让 380px 成为硬约束，内容靠自身换行消化。 */
.chat-panel {
  flex: 0 0 380px;
  min-width: 0;
  max-width: 380px;
}

/* 面板内部的滚动舞台：自己滚，不带着整页一起滚。 */
.stage {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.stage-panel .panel-header {
  margin-bottom: 0.85rem;
}

/* 预览画布给个下限，别让它缩成一条 */
.stage-panel .preview {
  min-height: 340px;
}

/* 分段控件：两个 button 手写，不用 el-tabs —— 它的头部在窄面板里太占高度。 */
.segmented {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  background: #f1f5f9;
}

.segmented__item {
  padding: 0.25rem 0.7rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.segmented__item:hover:not(.segmented__item--active) {
  color: #1f2937;
}

.segmented__item--active {
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

/* 「Stream 模拟」开关：与「选择元素」并排，开关在右、标签在左，视觉上是一枚控件。 */
.stream-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.35rem 0 0.55rem;
  margin-left: 0.35rem;
  height: 1.85rem;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  color: #475569;
  font-size: 0.82rem;
  white-space: nowrap;
}

.stream-switch__text {
  line-height: 1;
}

/* 消息流明细：调试用，默认折叠，收在预览底部，不再占一个 tab。 */
.stream-fold {
  margin-top: 0.85rem;
}

.stream-fold > .stage {
  margin-top: 0.6rem;
  padding: 0;
  border: none;
  background: transparent;
}

/* 折叠区（数据模型 / 组件树）：默认收起，让预览区干净；要看细节点一下。 */
.fold {
  margin-top: 0.85rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fcfdff;
  font-size: 0.82rem;
  line-height: 1.6;
  color: #374151;
}

.fold > summary {
  cursor: pointer;
  user-select: none;
  color: #475569;
  font-weight: 500;
}

.fold ol {
  margin: 0.5rem 0 0.4rem;
  padding-left: 1.2rem;
}

.fold .binding-model {
  margin-top: 0.55rem;
}

/* ── 右侧聊天侧栏 ── */

.chat-header {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #eef1f5;
}

.chat-header h2 {
  margin: 0;
  font-size: 1rem;
}

.chat-header p {
  margin: 0.3rem 0 0;
  color: #6b7280;
  font-size: 0.78rem;
  line-height: 1.5;
}

/* 标题与开关同一行：开关决定「这一栏现在是哪种模式」，贴在标题右侧最省地方。 */
.chat-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

/* 标题会随模式变长（「想做什么界面？」↔「只跟模型说话」），窄栏下要能截断，
   否则会把开关挤出去。`min-width: 0` 不能省 —— flex 子项默认不收缩到内容宽度以下。 */
.chat-header__top h2 {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 底栏那行小注：明说这条路不产出 A2UI 协议，比藏进 tooltip 更容易被看到。 */
.chat-footer__note {
  margin-left: 0.35rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #f3f4f6;
  color: #6b7280;
}

.chat {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-height: 0;
  overflow-y: auto;
  padding: 0.85rem 0.15rem;
}

.chat-empty {
  margin: 0;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.6;
}

.chat-empty p {
  margin: 0;
}

/* 写成 `p.chat-empty__note` 是为了和上面的 `.chat-empty p` 同权重 —— 单写类名权重更低，
   会被 `margin: 0` 整个盖掉，0.4rem 的行距就不生效了。 */
.chat-empty p.chat-empty__note {
  margin-top: 0.4rem;
  color: #9ca3af;
}

.chat-empty code,
.chat-meta code {
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #eef2f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.74rem;
  color: #374151;
}

.chat-row {
  display: flex;
}

.chat-row--user {
  justify-content: flex-end;
}

.chat-row--agent {
  justify-content: flex-start;
}

/* 用户那条：浅灰药丸，和 agent 的「无气泡正文」拉开层次。 */
.bubble--user {
  max-width: 86%;
  padding: 0.5rem 0.85rem;
  border-radius: 16px;
  background: #f1f5f9;
  color: #1f2937;
  font-size: 0.85rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* agent 那条不加气泡 —— 侧栏本身就是它的容器，少一层边框更接近真实对话产品的观感。 */
.answer {
  max-width: 100%;
  font-size: 0.85rem;
  line-height: 1.65;
  color: #1f2937;
}

.answer--error {
  color: #b91c1c;
}

.answer__text {
  margin: 0;
}

/* 次要说明（纯对话失败时的那句「对话失败：…」，正文已经在上面了）。 */
.answer__text--muted {
  margin-top: 0.3rem;
  color: #b91c1c;
  font-size: 0.78rem;
}

/*
  流式期间的「中间状态」行。
  用等宽数字 + 固定不换行，避免「已用时 9s → 10s」时整行宽度跳动。
*/
.answer__phase {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.35rem;
  color: #6b7280;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

/*
  呼吸点：等待期间的「这东西还在动」信号。
  纯 CSS 动画，不占 JS —— 1 秒一跳的数字看不出「正在进行」，一个一直在闪的点能。
*/
.answer__pulse {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #409eff;
  animation: answer-pulse 1.1s ease-in-out infinite;
}

@keyframes answer-pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

/*
  思考过程：与「原始输出」同款折叠块，但用更淡的底色区分「这不是回复」。
  写成 `.answer__raw pre.answer__thinking` 是为了压过 `.answer__raw pre`（同元素、权重更高），
  单写类名权重不够，只能靠 `!important` —— 那不如把选择器写具体。
*/
.answer__raw pre.answer__thinking {
  background: #f8f7ff;
  color: #6b7280;
}

/* 坏行告警：用警示色，并且默认展开 —— 它解释「为什么预览是空的」，藏起来就失去意义了。 */
.answer__raw--warning summary {
  color: #b45309;
}

.answer__raw pre.answer__warnings {
  background: #fffbeb;
  color: #92400e;
}

.answer__raw {
  margin-bottom: 0.45rem;
  font-size: 0.76rem;
  color: #6b7280;
}

.answer__raw > summary {
  cursor: pointer;
  user-select: none;
}

.answer__raw pre {
  max-height: 12rem;
  margin: 0.5rem 0 0;
  overflow: auto;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  background: #f3f4f6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: #374151;
}

.answer__copy {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  margin-top: 0.35rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.answer__copy:hover {
  background: #f1f5f9;
  color: #475569;
}

/* ── 输入舱：一个整体药丸，里面是 圆钮 + 无边框 textarea + 圆形发送键 ── */

.composer {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
  margin-top: 0.75rem;
  padding: 0.3rem 0.3rem 0.3rem 0.35rem;
  border: 1px solid #e5e7eb;
  border-radius: 22px;
  background: #ffffff;
  transition: border-color 0.15s;
}

.composer:focus-within {
  border-color: #a9c9f5;
}

/* 把 Element Plus textarea 自带的边框 / 阴影抹掉，外观交给外层药丸。 */
.composer :deep(.el-textarea__inner) {
  padding: 0.35rem 0.25rem;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1f2937;
}

.composer :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}

.composer__input {
  flex: 1 1 auto;
  min-width: 0;
}

.composer__ghost,
.composer__send {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.composer__ghost {
  background: transparent;
  color: #94a3b8;
}

.composer__ghost:hover:not(:disabled) {
  background: #f1f5f9;
  color: #475569;
}

.composer__ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer__send {
  background: #2563eb;
  color: #ffffff;
}

.composer__send:hover:not(:disabled) {
  background: #1d4ed8;
}

.composer__send:disabled {
  background: #e5e7eb;
  color: #b6bdc9;
  cursor: not-allowed;
}

.composer__send--stop {
  background: #f56c6c;
}

.composer__send--stop:hover {
  background: #e04c4c;
}

/* 附件（图片）按钮：与发送键同尺寸，但用浅灰描边区分「附加」语义。 */
.composer__attach {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.composer__attach:hover:not(:disabled) {
  background: #f1f5f9;
  color: #475569;
}

.composer__attach:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 缩略图条：贴在输入舱下方，横向排开，超出横向滚动。 */
.composer__images {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
  /* 上下留出余量：删除按钮定位在缩略图右上角外侧（top/right 为负），
     不预留空间就会被这条滚动容器的裁剪边界切掉一半。 */
  padding: 0.4rem 0.4rem 0.2rem;
  overflow-x: auto;
}

.composer__image {
  position: relative;
  flex: 0 0 auto;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 8px;
  /* 不能 overflow: hidden —— 会把右上角外溢的删除按钮裁掉；
     圆角裁剪交给里面的 el-image 自己做。 */
  border: 1px solid #e5e7eb;
  background: #f3f4f6;
}

/* el-image 根元素：铺满缩略图格子并自己裁圆角 */
.composer__image .el-image.composer__image-thumb {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 7px;
  overflow: hidden;
  cursor: zoom-in;
}

.composer__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.composer__image-remove {
  position: absolute;
  top: -0.3rem;
  right: -0.3rem;
  display: grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
  border: none;
  border-radius: 50%;
  background: #ef4444;
  color: #ffffff;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.chat-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.6rem;
  margin-top: 0.45rem;
  color: #6b7280;
  font-size: 0.76rem;
}

.chat-footer :deep(.el-button) {
  height: auto;
  padding: 0;
  font-size: 0.76rem;
}

.server-error {
  margin: 0.75rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.8rem;
  word-break: break-all;
}

/* 顶部的场景列表失败横幅：它已经是 `.playground`（flex column + gap）的直接子项，
   自带 margin 会与 gap 叠加出过大间距。 */
.scenario-banner {
  margin: 0;
}

.scenario-banner code {
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #fde8e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

/* 窄窗口退回上下堆叠：右栏固定在 380px，窗口一窄就会把预览挤没。
   注意 `body` 的 `overflow: hidden` 也要在全局块里同步放开（见文件末尾），
   否则整页高度放开后内容会被裁掉。 */
@media (max-width: 900px) {
  .playground {
    height: auto;
    min-height: 100vh;
  }

  .workspace {
    flex-direction: column;
  }

  .chat-panel {
    flex: 0 0 auto;
    max-width: none;
  }

  .stage-panel .preview {
    min-height: 240px;
  }

  .chat {
    max-height: 60vh;
  }
}

/* ── Stream 模拟（左侧第二个 tab）── */

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

/* 字符流失败（参数非法 / 场景不存在 / 连接中断）。与对话的报错同款，只是位置在流面板里。 */
.stream-error {
  margin-bottom: 0.75rem;
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
/* 整页占满视口：`.playground` 用的是 `height: 100vh`，浏览器默认的 body margin 会把它
   顶下去、凭空多出一条滚动条。`overflow: hidden` 是为了兜住亚像素舍入 —— 真正的滚动
   都发生在左右两栏内部。 */
html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
}

/* 窄窗口下 `.playground` 会放开为 `height: auto`，这里必须同步放开，
   否则整页内容会被 `overflow: hidden` 裁掉。断点与 scoped 块里的那个保持一致。 */
@media (max-width: 900px) {
  body {
    overflow: auto;
  }
}

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
