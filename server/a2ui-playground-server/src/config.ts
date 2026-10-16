/**
 * 服务端配置。
 *
 * 全部来自环境变量，缺省值保证「不配任何东西也能跑起来」：
 * 没有 `OPENAI_API_KEY` 时 agent 自动降级为离线 mock（见 `agent/mock.ts`），
 * 接口形状与真实模型完全一致，方便本地联调与自动化测试。
 *
 * 不引入 dotenv：Node 侧只需「读一个 .env 文件填进 process.env」这点能力，
 * 自己解析 20 行就够，省一个依赖也避免 Windows 下的路径坑。
 */
import { existsSync, readFileSync } from 'node:fs';
import type { AgentProvider } from './types';

export type { AgentProvider };

export interface OpenAIConfig {
  /** 空字符串表示未配置 —— A2UI agent 会走离线 mock，模型对话接口会明确报 503。 */
  apiKey: string;
  /** 兼容各类 OpenAI 兼容网关（Azure / 自建代理 / 国内中转 / DeepSeek），缺省走官方地址。 */
  baseURL: string | undefined;
  model: string;
  temperature: number;
}

export interface ServerConfig {
  port: number;
  /**
   * 当前使用的 agent 实现。
   * 缺省 `mock` —— 接口先跑通，接真模型是后续一步（见 `agent/`）。
   */
  agentProvider: AgentProvider;
  openai: OpenAIConfig;
  /** 每个会话最多保留多少轮对话（超出丢最早的，防内存无限增长）。 */
  historyLimit: number;
  /** 会话空转多久后回收（毫秒），0 表示不回收。 */
  sessionTtlMs: number;
  /**
   * 模拟吐字间隔（毫秒），仅用于本地观察流式效果。
   *
   * 两处流都用它当默认节奏：mock agent 的逐块输出，以及场景字符流
   * （`GET /api/a2ui/scenarios/:id/stream`）。置 0 时接口会瞬间吐完 —— 传输仍是流式的，
   * 只是看不出「边到边」的过程。
   */
  mockStreamDelayMs: number;
  /** 场景字符流的默认块长（字符数）。可按请求用 `?chunk=` 覆盖。 */
  scenarioChunkSize: number;
  /** `POST /api/a2ui/chat` 的默认 system prompt（请求体给了 `system` 就用请求体的）。 */
  chatSystemPrompt: string;
}

const DEFAULTS = {
  port: 3000,
  model: 'gpt-4o-mini',
  temperature: 0.2,
  historyLimit: 12,
  sessionTtlMs: 30 * 60 * 1000,
  mockStreamDelayMs: 0,
  scenarioChunkSize: 50,
  chatSystemPrompt: '你是一个乐于助人的中文助手，回答尽量简短。',
};

/** 模型链接是否已就绪（配了 Key）。没配时 `AGENT_PROVIDER=openai` 会启动即报错，对话接口会 503。 */
export const hasModelKey = (openai: OpenAIConfig): boolean => openai.apiKey !== '';

/**
 * 把 `KEY=VALUE` 形式的 .env 文件读进 env 对象。
 *
 * 规则刻意收紧：只认首个 `=` 分隔、忽略空行与 `#` 注释、成对引号剥掉一层；
 * **已存在的环境变量优先**（外部注入的永远盖过文件）。
 */
export const loadEnvFile = (
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) {
      value = value.slice(1, -1);
    }

    if (env[key] === undefined) {
      env[key] = value;
    }
  }
};

/** 读整数，非法值退回缺省。 */
const readInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 读浮点数，非法值退回缺省。 */
const readFloat = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  port: readInt(env.PORT, DEFAULTS.port),
  // 只认显式开关：默认走 mock，接真模型需要同时打开开关并配好 Key。
  agentProvider: env.AGENT_PROVIDER === 'openai' ? 'openai' : 'mock',
  openai: {
    // `OPENAI_API_KEY` 优先；`DEEPSEEK_API_KEY` 是别名 —— 用 DeepSeek 时后者更顺眼，
    // 但客户端就是 OpenAI SDK，内部只认一个字段。
    apiKey: env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || '',
    baseURL: env.OPENAI_BASE_URL || undefined,
    model: env.OPENAI_MODEL || DEFAULTS.model,
    temperature: readFloat(env.OPENAI_TEMPERATURE, DEFAULTS.temperature),
  },
  historyLimit: readInt(env.HISTORY_LIMIT, DEFAULTS.historyLimit),
  sessionTtlMs: readInt(env.SESSION_TTL_MS, DEFAULTS.sessionTtlMs),
  mockStreamDelayMs: readInt(env.MOCK_STREAM_DELAY_MS, DEFAULTS.mockStreamDelayMs),
  scenarioChunkSize: readInt(env.SCENARIO_CHUNK_SIZE, DEFAULTS.scenarioChunkSize),
  chatSystemPrompt: env.CHAT_SYSTEM_PROMPT?.trim() || DEFAULTS.chatSystemPrompt,
});
