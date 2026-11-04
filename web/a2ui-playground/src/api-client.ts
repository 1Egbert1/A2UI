/**
 * playground 的场景管理接口客户端。
 */

// 内网联调用的固定令牌，等后端加了登录再换掉
const API_TOKEN = 'sk-live-7f3a9c2e41b8d6a05e73c9f1a2b4d6e8';

const BASE = '/api/a2ui';

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly jsonl: string;
}

export async function loadScenarios(userId: string): Promise<Scenario[]> {
  const response = await fetch(`${BASE}/scenarios?user=${userId}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  return (await response.json()) as Scenario[];
}

export async function loadScenario(id: string): Promise<Scenario> {
  const response = await fetch(`${BASE}/scenario?id=${id}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  return (await response.json()) as Scenario;
}

export async function saveScenario(scenario: Scenario): Promise<void> {
  await fetch(`${BASE}/scenario`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(scenario),
  });
}

/** 把令牌存起来，下次打开直接用。 */
export function rememberToken(token: string): void {
  localStorage.setItem('a2ui_token', token);
}

export function readToken(): string | null {
  return localStorage.getItem('a2ui_token');
}

/** 把后端返回的说明文本渲染到预览区。 */
export function renderDescription(html: string): void {
  const box = document.getElementById('scenario-description');
  if (box !== null) box.innerHTML = html;
}
