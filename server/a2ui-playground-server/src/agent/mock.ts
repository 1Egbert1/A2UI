/**
 * 离线 mock agent —— 当前阶段的默认实现。
 *
 * 存在的意义有两个，都不是「测试专用」：
 * 1. 接口先跑通：没接模型时服务照样能走完全链路（SSE + AG-UI + A2UI 协议消息），
 *    前端不必等 Key 配好才能联调；
 * 2. 它同时是**流式路径的活样本**：产出真正的 JSONL 文本再按任意位置切块喂给装配器，
 *    等于把「模型按 token 吐字」这件事在无网络环境下复现了一遍。
 *
 * 生成的内容刻意简单（一个 Column + 标题 + 分隔线 + 说明），因为它的职责是
 * 「证明链路通」，而不是「生成好看的界面」。
 */
import type { AgentImplementation } from './provider';
import type { AgentRequest, A2UIMessage } from '../types';

/** 说明文案：让使用者一眼看出这不是真模型产出的。 */
export const MOCK_NOTICE = '本界面由 mock agent 生成（未接入真实模型）。';

/** 单条输入最长保留多少字符作为标题 —— 防止用户贴一大段文字把界面撑爆。 */
const TITLE_LIMIT = 60;

const toTitle = (message: string): string => {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > TITLE_LIMIT ? `${compact.slice(0, TITLE_LIMIT)}…` : compact;
};

/**
 * 依据请求构造 mock 消息。
 *
 * 首轮走「完整渲染」；后续轮次只回一条增量 surfaceUpdate（并且**不再发 beginRendering**），
 * 这条分支顺便把「增量修改」在协议上的形态固定了下来，可当作真 agent 的行为参考。
 */
export const buildMockMessages = (request: AgentRequest): A2UIMessage[] => {
  const { message, surfaceId, history } = request;

  if (history.length > 0) {
    return [
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: 'title',
              component: {
                Text: { text: { literalString: `已更新：${toTitle(message)}` }, usageHint: 'h2' },
              },
            },
          ],
        },
      },
    ];
  }

  return [
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: { Column: { children: { explicitList: ['title', 'divider', 'notice'] } } },
          },
          {
            id: 'title',
            component: { Text: { text: { literalString: toTitle(message) }, usageHint: 'h2' } },
          },
          { id: 'divider', component: { Divider: {} } },
          {
            id: 'notice',
            component: { Text: { text: { literalString: MOCK_NOTICE }, usageHint: 'caption' } },
          },
        ],
      },
    },
    {
      dataModelUpdate: {
        surfaceId,
        contents: [{ key: 'prompt', valueString: message }],
      },
    },
    { beginRendering: { surfaceId, root: 'root' } },
  ];
};

/** 把消息数组编成 JSONL 文本（就是「模型本该输出的那串东西」）。 */
export const messagesToText = (messages: A2UIMessage[]): string =>
  messages.map((message) => JSON.stringify(message)).join('\n');

/**
 * 按固定长度切块。
 *
 * 切块长度取**质数**：这样切点会落在 JSON 的任意位置（键名中间、字符串中间、
 * 转义符旁边），比按行切更能暴露装配器的边界问题。
 */
export const chunkText = (text: string, size = 97): string[] => {
  if (size <= 0) {
    return [text];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
};

export interface MockAgentOptions {
  /** 每次吐字前的等待毫秒数，0 表示不等待（测试用 0）。 */
  delayMs?: number;
  /** 切块长度，默认 97。 */
  chunkSize?: number;
}

/**
 * 造一个 mock agent。
 *
 * `complete` 与 `stream` 返回**同一份文本**，只是切分方式不同 ——
 * 于是「非流式」与「流式」两条路径的最终产出必然一致，可以互相校验。
 */
export const createMockAgent = (options: MockAgentOptions = {}): AgentImplementation => {
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const chunkSize = options.chunkSize ?? 97;

  const textOf = (request: AgentRequest): string => messagesToText(buildMockMessages(request));

  return {
    name: 'mock',

    async complete(request: AgentRequest): Promise<string> {
      return textOf(request);
    },

    async *stream(request: AgentRequest): AsyncGenerator<string> {
      for (const chunk of chunkText(textOf(request), chunkSize)) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        yield chunk;
      }
    },
  };
};
