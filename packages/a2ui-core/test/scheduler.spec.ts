import { strict as assert } from 'assert';

import { columnRowMixMessages } from '../mock/column-row-mix';
import { createJSONLStream, parseA2UI } from '../src/parser';
import { setRenderMap } from '../src/renderer';
import {
  getRefreshScheduler,
  setRefreshScheduler,
  type RefreshScheduler,
} from '../src/scheduler';
import { getTree, resetA2UIStore } from '../src/store';
import { setTreeRenderer } from '../src/tree-render';

const MIX_LINES = columnRowMixMessages;
const MIX_JSONL = `${MIX_LINES.join('\n')}\n`;
const MIX_SURFACE = 'column-row-mix';

const MARKER_RENDER_MAP = {
  Column: () => 'COLUMN',
  Row: () => 'ROW',
  Card: () => 'CARD',
  Divider: () => 'DIVIDER',
  Button: () => 'BUTTON',
  Text: () => 'TEXT',
};

/**
 * 手动帧调度器：把 flush 回调排队，由测试自己决定「下一帧什么时候到」。
 *
 * 用它替代真实的 `requestAnimationFrame` —— 真 rAF 在 Node 里不存在，而且「等一帧」
 * 会让断言变成异步；这里把时间轴握在手里，就能逐条验证合帧行为。
 */
const manualFrame = () => {
  const queue: Array<() => void> = [];
  return {
    scheduler: ((flush: () => void) => {
      queue.push(flush);
    }) as RefreshScheduler,
    /** 模拟「下一帧到了」：把排队的回调按序跑掉（真实 rAF 一轮只跑一次）。 */
    runFrame: () => {
      const pending = queue.splice(0);
      pending.forEach((flush) => flush());
    },
    /** 当前排了多少次待执行的刷新。 */
    get queued() {
      return queue.length;
    },
  };
};

/** 记录树渲染器被回调了几次 —— 这是「真正跑了一次全量刷新」最直接的证据。 */
const countRenders = () => {
  let renders = 0;
  setTreeRenderer(() => {
    renders += 1;
  });
  return () => renders;
};

describe('刷新调度（合帧）', () => {
  beforeEach(() => {
    resetA2UIStore();
    // renderMap / treeRenderer / scheduler 都是模块级配置，不随 store 重置。
    setRenderMap(MARKER_RENDER_MAP);
    setTreeRenderer(null);
    setRefreshScheduler(null);
  });

  afterEach(() => {
    // 注入的调度器是模块级状态，泄漏出去会污染后续 spec。
    setRefreshScheduler(null);
  });

  describe('默认调度器（按环境能力选）', () => {
    it('should be synchronous in an environment without requestAnimationFrame', () => {
      // 前提断言：整份测试套件里「推完即可同步断言」的写法，建立在「Node 没有 rAF，
      // 于是默认调度器退化为同步」这一条上。若哪天测试环境补上了 rAF（比如引入 jsdom），
      // 这里会先炸，而不是让其它 spec 莫名其妙地挂掉。
      assert.equal(
        typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame,
        'undefined',
        '本测试环境应没有 requestAnimationFrame',
      );

      const renders = countRenders();
      const stream = createJSONLStream();
      stream.push(MIX_JSONL);

      assert.ok(getTree(MIX_SURFACE), '无 rAF → 请求刷新立即执行，推完就有树');
      assert.equal(renders(), 1, '整段一次喂入只触发一次刷新');
    });

    it('should expose a scheduler that can be replaced and restored', () => {
      const fallback = getRefreshScheduler();
      const manual = manualFrame();

      setRefreshScheduler(manual.scheduler);
      assert.notEqual(getRefreshScheduler(), fallback, '注入后应换成注入的调度器');

      setRefreshScheduler(null);
      assert.equal(getRefreshScheduler(), fallback, '传 null 应恢复默认调度器');
    });
  });

  describe('合帧去重', () => {
    it('should defer the refresh until the frame arrives', () => {
      const manual = manualFrame();
      setRefreshScheduler(manual.scheduler);
      const renders = countRenders();

      const stream = createJSONLStream();
      stream.push(MIX_JSONL);

      assert.equal(getTree(MIX_SURFACE), undefined, '帧未到 → 还没建树');
      assert.equal(manual.queued, 1, '排了一次刷新');
      assert.equal(renders(), 0, '树渲染器还没被回调');

      manual.runFrame();

      assert.ok(getTree(MIX_SURFACE), '帧到了才真正刷新');
      assert.equal(renders(), 1);
    });

    it('should collapse many requests within one frame into a single refresh', () => {
      const manual = manualFrame();
      setRefreshScheduler(manual.scheduler);
      const renders = countRenders();

      const stream = createJSONLStream();
      for (const line of MIX_LINES) {
        stream.push(`${line}\n`);
      }

      assert.equal(manual.queued, 1, '28 条消息逐条推 → 同一帧内只排队一次');
      assert.equal(renders(), 0, '期间一次全量重算都没跑');

      manual.runFrame();

      assert.equal(renders(), 1, '整帧只跑一次全量刷新，而不是 28 次');
      assert.ok(getTree(MIX_SURFACE));
    });

    it('should refresh again on the next frame', () => {
      const manual = manualFrame();
      setRefreshScheduler(manual.scheduler);
      const renders = countRenders();

      const stream = createJSONLStream();
      stream.push(`${MIX_LINES[0]}\n`);
      manual.runFrame();

      assert.equal(renders(), 1, '第一帧结算了第一条');
      assert.equal(manual.queued, 0);

      stream.push(`${MIX_LINES[1]}\n`);
      assert.equal(manual.queued, 1, '下一帧应重新排队（去重只在同一帧内成立）');

      manual.runFrame();
      assert.equal(renders(), 2);
    });
  });

  describe('同步入口与合帧的关系', () => {
    it('should let parseA2UI return the final store synchronously, cancelling the pending refresh', () => {
      const manual = manualFrame();
      setRefreshScheduler(manual.scheduler);
      const renders = countRenders();

      const stream = createJSONLStream();
      stream.push(MIX_JSONL);
      assert.equal(manual.queued, 1, '流式路径挂起了一次刷新');
      assert.equal(getTree(MIX_SURFACE), undefined);

      // parseA2UI 的契约是「同步返回解析完的 store」，不能把刷新推给下一帧。
      parseA2UI(MIX_JSONL);

      assert.ok(getTree(MIX_SURFACE), 'parseA2UI 返回时树已经建好');
      assert.equal(renders(), 1, '同步刷新跑了一次');

      // 挂起项已被取消：帧到了也不该再拿同一份输入全量重算一遍。
      manual.runFrame();
      assert.equal(renders(), 1, '挂起的那次刷新应被 parseA2UI 取消，而不是再跑一遍');
    });

    it('should keep the store consistent when a deferred refresh lands after more input', () => {
      const manual = manualFrame();
      setRefreshScheduler(manual.scheduler);

      const stream = createJSONLStream();
      // 先推一半（还没有 beginRendering），再推完，期间不结算。
      const beginIndex = MIX_LINES.findIndex((line) => line.includes('"beginRendering"'));
      for (const line of MIX_LINES.slice(0, beginIndex)) {
        stream.push(`${line}\n`);
      }
      assert.equal(getTree(MIX_SURFACE), undefined, 'beginRendering 未到');

      for (const line of MIX_LINES.slice(beginIndex)) {
        stream.push(`${line}\n`);
      }
      manual.runFrame();

      // 刷新是「拿当前 store 全量重算」，所以只要最终输入齐了，一次结算就能得到终态。
      assert.ok(getTree(MIX_SURFACE), '结算一次即可得到终态树');
    });
  });
});
