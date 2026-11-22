// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { RunConfig } from '../../shared/types';
import { loadConfig, saveConfig, STORAGE_KEY } from './storage';

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
});
