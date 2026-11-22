// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { RunConfig } from '../../shared/types';
import {
  BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY,
  LEGACY_BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY,
  LEGACY_STORAGE_KEY,
  loadConfig,
  loadTheme,
  migrateBrowserHeadersDefaultOff,
  saveConfig,
  saveTheme,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
} from './storage';

const fallback: RunConfig = {
  url: 'https://example.com',
  method: 'GET',
  count: 1,
  intervalMs: 0,
  query: [],
  headers: [],
};

describe('request config storage', () => {
  beforeEach(() => localStorage.clear());

  it('saves and restores the latest config', () => {
    const config = { ...fallback, count: 8, intervalMs: 250 };
    saveConfig(config);
    expect(loadConfig(fallback)).toEqual(config);
  });

  it('falls back when storage is invalid', () => {
    localStorage.setItem(STORAGE_KEY, '{invalid');
    expect(loadConfig(fallback)).toEqual(fallback);
  });

  it('loads and copies configuration from the legacy HTTP More key', () => {
    const legacyConfig = { ...fallback, count: 12 };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyConfig));

    expect(loadConfig(fallback)).toEqual(legacyConfig);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(legacyConfig);
  });

  it('migrates the old browser-header default to off only once', () => {
    const oldConfig: RunConfig = {
      ...fallback,
      browserHeaders: {
        enabled: true,
        sourceUrl: '',
        userAgent: 'Browser-UA',
        acceptLanguage: 'zh-CN',
      },
    };

    expect(migrateBrowserHeadersDefaultOff(oldConfig).browserHeaders?.enabled).toBe(false);
    expect(localStorage.getItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY)).toBe('1');
    expect(migrateBrowserHeadersDefaultOff(oldConfig).browserHeaders?.enabled).toBe(true);
  });

  it('honors the completed migration marker from the legacy name', () => {
    const config: RunConfig = {
      ...fallback,
      browserHeaders: {
        enabled: true,
        sourceUrl: '',
        userAgent: 'Browser-UA',
        acceptLanguage: 'zh-CN',
      },
    };
    localStorage.setItem(LEGACY_BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY, '1');

    expect(migrateBrowserHeadersDefaultOff(config).browserHeaders?.enabled).toBe(true);
    expect(localStorage.getItem(BROWSER_HEADERS_DEFAULT_OFF_MIGRATION_KEY)).toBe('1');
  });

  it('persists a valid theme and falls back to dark', () => {
    expect(loadTheme()).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'unknown');
    expect(loadTheme()).toBe('dark');
    saveTheme('light');
    expect(loadTheme()).toBe('light');
  });
});
