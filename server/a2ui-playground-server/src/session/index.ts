/**
 * 会话与 surface 缓存（进程内存）。
 *
 * 两个用途，对应 README 里的「支持 a2ui 协议的生成及缓存」：
 * 1. **多轮上下文**：保存历史轮次，下一轮发给模型时原样回放；
 * 2. **生成缓存**：按 surface 累积历次生成的协议消息 —— 客户端刷新页面后
 *    可以整段取回重放（`parseA2UI` / `createA2UIBuffer` 直接吃），不必重新问模型。
 *
 * 为什么是内存而不是 Redis/DB：当前阶段是单进程 playground，引入外部依赖
 * 只会让「跑起来」这件事变重。接口按「可替换」设计（只有这几个方法），
 * 真要换持久化只动这一个文件。
 */
import type { AgentTurn, A2UIMessage } from '../types';

export interface SurfaceRecord {
  surfaceId: string;
  /** 该 surface 上依次生成过的协议消息（增量追加，本身就是可重放的 JSONL 序列）。 */
  messages: A2UIMessage[];
}

export interface SessionState {
  sessionId: string;
  /** 会话当前活跃的 surface（下一轮默认往它上面改）。 */
  surfaceId: string;
  history: AgentTurn[];
  surfaces: Map<string, SurfaceRecord>;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStoreOptions {
  /** 每会话保留的最大轮数（超出丢最早的）。 */
  historyLimit: number;
  /** 空转多久后回收，0 表示不回收。 */
  ttlMs?: number;
  /** 注入时钟，便于测试。 */
  now?: () => number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  private readonly historyLimit: number;

  private readonly ttlMs: number;

  private readonly now: () => number;

  constructor(options: SessionStoreOptions) {
    this.historyLimit = Math.max(1, options.historyLimit);
    this.ttlMs = Math.max(0, options.ttlMs ?? 0);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * 取会话，不存在则以给定 surfaceId 新建。
   *
   * `surfaceId` 只对**新建**的会话生效：已有会话有自己的活跃 surface，
   * 接口层传进来的 id 不应该把正在编辑的界面顶掉。
   */
  getOrCreate(sessionId: string, surfaceId: string): SessionState {
    this.sweep();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.updatedAt = this.now();
      return existing;
    }

    const created: SessionState = {
      sessionId,
      surfaceId,
      history: [],
      surfaces: new Map([[surfaceId, { surfaceId, messages: [] }]]),
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 追加一轮对话，并把超出上限的最早轮次丢掉。
   *
   * 按**轮**而不是按条裁剪：`user`/`assistant` 成对出现，裁掉半截会让模型看到
   * 一个没有输出内容的 user 消息，反而更容易跑偏。
   */
  appendTurn(session: SessionState, turn: AgentTurn): void {
    session.history.push(turn);
    const overflow = session.history.length - this.historyLimit * 2;
    if (overflow > 0) {
      session.history.splice(0, overflow);
    }
    session.updatedAt = this.now();
  }

  /**
   * 把本轮生成的消息追加进 surface 缓存。
   *
   * `options.activate` 默认 true —— 正常一轮生成会把该 surface 设为会话的活跃 surface，
   * 下一轮默认往它上面改。**示例场景要传 false**：它不是「在编辑某个界面」，只是把一份
   * 素材渲染出来。若也切换活跃 surface，之后再发一句话就会被画到示例的界面上。
   */
  recordSurface(
    session: SessionState,
    surfaceId: string,
    messages: A2UIMessage[],
    options: { activate?: boolean } = {},
  ): SurfaceRecord {
    const record = session.surfaces.get(surfaceId) ?? { surfaceId, messages: [] };
    record.messages.push(...messages);
    session.surfaces.set(surfaceId, record);
    if (options.activate ?? true) {
      session.surfaceId = surfaceId;
    }
    session.updatedAt = this.now();
    return record;
  }

  /** 会话快照（可 JSON 化，接口层直接回给客户端）。 */
  snapshot(session: SessionState): {
    sessionId: string;
    surfaceId: string;
    surfaces: SurfaceRecord[];
    history: AgentTurn[];
  } {
    return {
      sessionId: session.sessionId,
      surfaceId: session.surfaceId,
      surfaces: [...session.surfaces.values()],
      history: session.history,
    };
  }

  clear(): void {
    this.sessions.clear();
  }

  /** 回收空转过久的会话。次数很少（每次取会话时顺手跑一遍），无需定时器。 */
  private sweep(): void {
    if (this.ttlMs <= 0) {
      return;
    }
    const deadline = this.now() - this.ttlMs;
    for (const [sessionId, session] of this.sessions) {
      if (session.updatedAt < deadline) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
