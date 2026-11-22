// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { STORAGE_KEY, THEME_STORAGE_KEY } from './storage';

const runRequestsMock = vi.fn();
vi.mock('./runStream', () => ({
  runRequests: (...args: unknown[]) => runRequestsMock(...args),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    runRequestsMock.mockReset();
  });

  it('adds query rows and persists edited config', async () => {
    const wrapper = mount(App);
    await wrapper.get('.kv-editor .empty-add').trigger('click');
    const keyInput = wrapper.get('input[aria-label="参数名"]');
    await keyInput.setValue('page');
    await flushPromises();

    expect(wrapper.findAll('.kv-row')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').query[0].key).toBe('page');
  });

  it('switches between dark and light themes and persists the choice', async () => {
    const wrapper = mount(App);
    const toggle = wrapper.get('button[aria-label="切换为浅色主题"]');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await toggle.trigger('click');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(wrapper.get('button[aria-label="切换为深色主题"]')).toBeTruthy();
  });

  it('offers common header name and value suggestions while allowing free input', async () => {
    const wrapper = mount(App);
    await wrapper.findAll('.kv-editor .empty-add')[1].trigger('click');
    const headerEditor = wrapper.findAll('.kv-editor')[1];
    const inputs = headerEditor.findAll('input:not([type="checkbox"])');
    const keyListId = inputs[0].attributes('list');
    const valueListId = inputs[1].attributes('list');

    expect(keyListId).toBeTruthy();
    expect(valueListId).toBeTruthy();
    const keyOptions = headerEditor.get(`#${keyListId}`).findAll('option').map((option) => option.attributes('value'));
    const valueOptions = headerEditor.get(`#${valueListId}`).findAll('option').map((option) => option.attributes('value'));
    expect(keyOptions).toContain('Content-Type');
    expect(keyOptions).toContain('Authorization');
    expect(keyOptions).toContain('Cookie');
    expect(valueOptions).toContain('application/json');

    await inputs[0].setValue('X-Custom-Header');
    expect((inputs[0].element as HTMLInputElement).value).toBe('X-Custom-Header');
    expect(wrapper.text()).toContain('COOKIE JAR · ON');
  });

  it('detects browser headers and sends the configured source page', async () => {
    runRequestsMock.mockResolvedValue(undefined);
    const wrapper = mount(App);
    await wrapper.get('input[aria-label="自动补全浏览器请求头"]').setValue(true);
    const sourceInput = wrapper.get('input[aria-label="来源页面 URL"]');
    await sourceInput.setValue('https://cad.crowncad.com/cad/usersetting');
    await wrapper.get('.run-button').trigger('click');
    await flushPromises();

    const payload = runRequestsMock.mock.calls[0][0];
    expect(payload.browserHeaders).toEqual({
      enabled: true,
      sourceUrl: 'https://cad.crowncad.com/cad/usersetting',
      userAgent: navigator.userAgent,
      acceptLanguage: navigator.languages.join(',').includes(';q=')
        ? navigator.languages.join(',')
        : expect.any(String),
    });
    expect(payload.browserHeaders.acceptLanguage).toContain(navigator.languages[0]);
  });

  it('validates JSON before starting', async () => {
    const wrapper = mount(App);
    await wrapper.get('select[aria-label="请求方法"]').setValue('POST');
    await wrapper.get('textarea[aria-label="请求体"]').setValue('{');
    await wrapper.get('.run-button').trigger('click');

    expect(wrapper.get('[role="alert"]').text()).toContain('JSON 请求体格式不正确');
    expect(runRequestsMock).not.toHaveBeenCalled();
  });

  it('edits and persists multipart form-data text fields', async () => {
    const wrapper = mount(App);
    await wrapper.get('select[aria-label="请求方法"]').setValue('POST');
    const formDataButton = wrapper.findAll('.mode-switch button').find((button) => button.text() === 'FORM DATA');
    expect(formDataButton).toBeTruthy();
    await formDataButton!.trigger('click');
    await wrapper.get('.form-data-editor .empty-add').trigger('click');
    const inputs = wrapper.findAll('.form-data-editor input:not([type="checkbox"])');
    await inputs[0].setValue('nickname');
    await inputs[1].setValue('测试34');
    await flushPromises();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.body).toMatchObject({
      mode: 'form-data',
      fields: [{ enabled: true, key: 'nickname', value: '测试34' }],
    });
    expect(wrapper.text()).toContain('multipart boundary 将自动生成');
  });

  it('renders streamed results and clears them without deleting saved config', async () => {
    runRequestsMock.mockImplementation(async (_config, _signal, onEvent) => {
      onEvent({ type: 'run_started', total: 1, startedAt: '2026-11-22T00:00:00.000Z' });
      onEvent({ type: 'request_started', index: 1, startedAt: '2026-11-22T00:00:00.000Z' });
      onEvent({
        type: 'request_completed',
        index: 1,
        startedAt: '2026-11-22T00:00:00.000Z',
        finishedAt: '2026-11-22T00:00:00.010Z',
        status: 200,
        statusText: 'OK',
        ok: true,
        durationMs: 10,
        headers: {},
        body: { kind: 'json', contentType: 'application/json', sizeBytes: 11, content: { ok: true } },
      });
      onEvent({
        type: 'run_completed',
        finishedAt: '2026-11-22T00:00:00.010Z',
        summary: { total: 1, completed: 1, succeeded: 1, failed: 0, averageDurationMs: 10 },
      });
    });
    const wrapper = mount(App);
    await wrapper.get('.run-button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('200 OK');
    expect(wrapper.text()).toContain('执行完成');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    await wrapper.get('.panel-title .text-button').trigger('click');
    expect(wrapper.text()).not.toContain('200 OK');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('aborts an active run when stop is clicked', async () => {
    runRequestsMock.mockImplementation((_config, signal: AbortSignal) => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const wrapper = mount(App);
    await wrapper.get('.run-button').trigger('click');
    await flushPromises();
    await wrapper.get('.stop-button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('已手动停止');
  });
});
