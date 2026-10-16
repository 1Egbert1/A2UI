/**
 * 场景字符流：把一份 fixture 的**原始 JSON 文本**按固定块长吐出去（SSE）。
 *
 * 与 `/api/a2ui/run?scenario=` 的分工是「服务端负责到哪一步」：
 * - `/run` 发的是**协议消息**（一条 `CUSTOM a2ui.message` = 一条 A2UI 消息）——服务端替客户端
 *   解析好了，客户端只管渲染；
 * - 本模块发的是**尚未成形的文本切片**（一条 `stream.chunk` = N 个字符）——服务端只负责吐字节，
 *   客户端自己用 `createA2UIBuffer()` 做括号配对与协议补全。
 *
 * 这条流存在的意义就是后者：切片必然落在 JSON 中间（键名里、字符串里、转义符旁），
 * 一行里还挤着多个组件，`beginRendering` 也不在行首 —— 缓冲层最难的几种情况一次压全。
 * 此前这套「字符流」是前端自己 `chunkText()` + 定时器造出来的，等于自己喂自己：网络分片、
 * 背压、连接中断一个都没经过。改成服务端推之后，「边到边补全」才算被真的检验过。
 *
 * 块长与节奏是**接口参数**（`?chunk=` / `?delay=`，缺省取配置），所以客户端不再自己切片 ——
 * 边界由服务端定义，客户端只消费，两边不可能对不齐。
 */
import type { ScenarioOrder, ScenarioStreamEvent } from './types';

export interface ScenarioStreamOptions {
  scenarioId: string;
  surfaceId: string;
  order: ScenarioOrder;
  /** 要吐的整段文本（来自 `getScenarioStreamPlan()`）。 */
  text: string;
  /** 每片字符数，必须 ≥ 1（路由层已校验）。 */
  chunkSize: number;
  /** 每片之间的间隔毫秒数，0 表示不限速。 */
  delayMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 生成一条场景字符流的事件序列：`started` → `chunk` × N → `done`。
 *
 * 事件里带了 `totalChars` / `totalChunks`，客户端不必先知道全文就能画进度条 ——
 * 它拿到的只是切片，算不出总量。
 *
 * 第一片**不等待**（延迟只在片与片之间）：等待一秒才开始吐第一片，看起来像是卡住了，
 * 而实际上一片都没少。
 */
export async function* buildScenarioStream(
  options: ScenarioStreamOptions,
): AsyncGenerator<ScenarioStreamEvent> {
  const { scenarioId, surfaceId, order, text, chunkSize, delayMs } = options;
  const totalChunks = Math.ceil(text.length / chunkSize);

  yield {
    type: 'stream.started',
    scenarioId,
    surfaceId,
    order,
    chunkSize,
    delayMs,
    totalChars: text.length,
    totalChunks,
  };

  for (let index = 0; index < totalChunks; index += 1) {
    if (index > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
    yield {
      type: 'stream.chunk',
      index,
      text: text.slice(index * chunkSize, (index + 1) * chunkSize),
    };
  }

  yield { type: 'stream.done', chunks: totalChunks, chars: text.length };
}
