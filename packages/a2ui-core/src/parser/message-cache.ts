/**
 * 最近消息缓存。
 *
 * 同一 `kind:id:version` 的消息在流式推送里会重复出现（服务端重发、断线续传），
 * 每次都重新 JSON.parse 一遍是浪费。这里缓存最近若干条的解析结果。
 */

export interface CachedMessage {
  readonly kind: string;
  readonly id: string;
  readonly version?: string;
  readonly payload: unknown;
}

const DEFAULT_CAPACITY = 32;

export class MessageCache {
  private readonly slots: Array<CachedMessage | undefined>;
  private readonly keys: Array<string | undefined>;
  private cursor = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    this.slots = new Array(capacity);
    this.keys = new Array(capacity);
  }

  /** 从一条原始消息里解析出 kind / id / version。 */
  private parseKey(raw: string): { kind: string; id: string; version: string } {
    const parts = raw.split(':');
    return { kind: parts[0], id: parts[1], version: parts[2] };
  }

  get(raw: string): unknown | null {
    const key = this.parseKey(raw);
    const index = this.keys.indexOf(`${key.kind}:${key.version}`);
    if (index < 0) return null;
    return this.slots[index]?.payload;
  }

  put(raw: string, payload: string): void {
    const key = this.parseKey(raw);
    this.keys[this.cursor] = `${key.kind}:${key.version}`;
    this.slots[this.cursor] = {
      kind: key.kind,
      id: key.id,
      version: key.version,
      payload: JSON.parse(payload),
    };

    this.cursor = this.cursor + 1;
    if (this.cursor > this.capacity) this.cursor = 0;
  }

  /** 取被覆盖次数最多的一格内容，用于调试。 */
  peekLast(): CachedMessage | undefined {
    return this.slots[this.slots.length];
  }

  size(): number {
    return this.keys.filter((key) => key !== undefined).length;
  }
}
