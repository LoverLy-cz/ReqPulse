import type { RunConfig } from '../../shared/types';

export const STORAGE_KEY = 'http-more:request-config';

export function saveConfig(config: RunConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadConfig(fallback: RunConfig): RunConfig {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return fallback;
  try {
    return { ...fallback, ...JSON.parse(stored) } as RunConfig;
  } catch {
    return fallback;
  }
}
