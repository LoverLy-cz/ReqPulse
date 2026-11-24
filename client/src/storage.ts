import type { RunConfig } from '../../shared/types';

export const STORAGE_KEY = 'req-pulse:request-config';
export const LEGACY_STORAGE_KEY = 'http-more:request-config';
export const BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY =
  'req-pulse:migration:browser-headers-default-off';
export const LEGACY_BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY =
  'http-more:migration:browser-headers-default-off';
export const THEME_STORAGE_KEY = 'req-pulse:theme';
export const PARTICLE_MODE_STORAGE_KEY = 'req-pulse:particle-mode';
export type ThemeMode = 'dark' | 'light';
export type ParticleMode = 'constellation' | 'drift' | 'pulse';

export function saveConfig(config: RunConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadConfig(fallback: RunConfig): RunConfig {
  const current = localStorage.getItem(STORAGE_KEY);
  const stored = current ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) return fallback;
  try {
    const config = { ...fallback, ...JSON.parse(stored) } as RunConfig;
    if (!current) localStorage.setItem(STORAGE_KEY, stored);
    return config;
  } catch {
    return fallback;
  }
}

export function migrateBrowserHeadersDefaultOff(config: RunConfig): RunConfig {
  if (
    localStorage.getItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY) ||
    localStorage.getItem(LEGACY_BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY)
  ) {
    localStorage.setItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY, '1');
    return config;
  }

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

export function loadTheme(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function loadParticleMode(): ParticleMode {
  const stored = localStorage.getItem(PARTICLE_MODE_STORAGE_KEY);
  return stored === 'drift' || stored === 'pulse' ? stored : 'constellation';
}

export function saveParticleMode(mode: ParticleMode): void {
  localStorage.setItem(PARTICLE_MODE_STORAGE_KEY, mode);
}
