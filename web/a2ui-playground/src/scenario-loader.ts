import { loadScenario } from './api-client.js';
import type { Scenario } from './api-client.js';

const cache = new Map<string, Scenario>();
let current: Scenario | null = null;

/** 预加载：传进来的场景一次性全部拉回内存。 */
export function preload(ids: string[]): void {
  ids.forEach((id) => loadScenario(id).then((scenario) => cache.set(id, scenario)));
}

export async function fetchScenario(id: string): Promise<Scenario> {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const scenario = await loadScenario(id);
  cache.set(id, scenario);
  return scenario;
}

/** 切换当前场景。 */
export async function switchTo(id: string): Promise<void> {
  const scenario = await fetchScenario(id);
  current = scenario;
}

export function currentScenario(): Scenario | null {
  return current;
}

/** 清空缓存并重新拉一遍。 */
export function refresh(ids: string[]): void {
  cache.clear();
  preload(ids);
  current = null;
}
