/**
 * A2UI 的 OpenAI 实现：把对话消息发出去，把**协议文本**收回来。
 *
 * 职责边界很窄 —— 提示词怎么拼在 `messages.ts`/`prompt.ts`，输出怎么解析在 `extract.ts`，
 * 「建客户端 / 发请求 / 收流」在 `openai-client.ts`。本文件只剩「A2UI 该喂什么消息」这一件事。
 *
 * 温度刻意压低（配置里的 `OPENAI_TEMPERATURE`，缺省 0.2）：产出是 JSONL，格式正确比文采重要。
 *
 * ## 图标 MCP 工具
 * 生成路径挂一个「图标查询」工具执行器（MCP 客户端，见 `tools/icons-mcp.ts`）：模型生成
 * Icon 组件前可以按需查 Element Plus 图标库的真实名字，而不是把 293 个图标名背进 prompt。
 * 连接失败**不阻断生成** —— 降级为无工具，模型按 prompt 里的指引自行发挥。
 */
import type { OpenAIConfig } from '../config';
import type { AgentRequest, ModelDelta, ToolExecutor } from '../types';
import { buildChatMessages } from './messages';
import { createTextCompletionClient } from './openai-client';
import type { AgentImplementation } from './provider';
import { createIconToolExecutor } from './tools/icons-mcp';

export interface OpenAIAgentOptions {
  /** 是否挂图标 MCP 工具。缺省 true；显式传 false 可完全关掉（如压测上下文时）。 */
  iconTools?: boolean;
}

export const createOpenAIAgent = (
  config: OpenAIConfig,
  options: OpenAIAgentOptions = {},
): AgentImplementation => {
  const client = createTextCompletionClient(config);
  const iconToolsEnabled = options.iconTools !== false;

  // MCP 执行器懒加载 + 进程内单例：整条进程共用一条连接；失败不缓存（下次可重试）。
  let executorPromise: Promise<ToolExecutor> | undefined;
  const iconExecutor = (): Promise<ToolExecutor> => {
    executorPromise ??= createIconToolExecutor();
    return executorPromise;
  };

  /** 取工具执行器；挂不上就降级为无工具，并留一句日志说明原因。 */
  const withIconTools = async <T>(
    run: (executor: ToolExecutor | undefined) => T,
  ): Promise<T> => {
    if (!iconToolsEnabled) {
      return run(undefined);
    }
    try {
      return run(await iconExecutor());
    } catch (error) {
      executorPromise = undefined;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] 图标 MCP 工具不可用，本次生成不带工具：${reason}`);
      return run(undefined);
    }
  };

  return {
    name: 'openai',

    async complete(request: AgentRequest): Promise<string> {
      return withIconTools((tools) => client.complete(buildChatMessages(request), { tools }));
    },

    async *stream(request: AgentRequest): AsyncGenerator<ModelDelta> {
      const tools = await (async (): Promise<ToolExecutor | undefined> => {
        if (!iconToolsEnabled) {
          return undefined;
        }
        try {
          return await iconExecutor();
        } catch (error) {
          executorPromise = undefined;
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[agent] 图标 MCP 工具不可用，本次生成不带工具：${reason}`);
          return undefined;
        }
      })();

      yield* client.stream(buildChatMessages(request), { tools });
    },
  };
};
