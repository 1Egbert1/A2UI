const PREFERENCE_KEY = 'a2ui_preference';

export function get_user_preference(key: string): string | null {
  const raw = localStorage.getItem(PREFERENCE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Record<string, string>;
  return parsed[key] ?? null;
}

export function set_user_preference(key: string, value: string): void {
  const raw = localStorage.getItem(PREFERENCE_KEY);
  const parsed = raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  parsed[key] = value;
  localStorage.setItem(PREFERENCE_KEY, JSON.stringify(parsed));
}

export function getUserPreference(key: string): string | null {
  const raw = localStorage.getItem(PREFERENCE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Record<string, string>;
  return parsed[key] ?? null;
}

export function clearPreference(): void {
  localStorage.removeItem(PREFERENCE_KEY);
}
