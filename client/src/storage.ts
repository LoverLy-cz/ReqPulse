import type { RunConfig } from '../../shared/types';

export const STORAGE_KEY = 'http-more:request-config';
export const BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY =
  'http-more:migration:browser-headers-default-off';

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

export function migrateBrowserHeadersDefaultOff(config: RunConfig): RunConfig {
  if (localStorage.getItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY)) return config;

  localStorage.setItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY, '1');
  if (!config.browserHeaders) return config;

  return {
    ...config,
    browserHeaders: {
      ...config.browserHeaders,
      enabled: false,
    },
  };
}
