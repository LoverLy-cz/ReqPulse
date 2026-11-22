import type { Request, Response } from 'express';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import type { ResponseBody, RunConfig, RunEvent, RunSummary } from '../shared/types.js';

const keyValueSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  key: z.string(),
  value: z.string(),
});

const runSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  count: z.number().int().positive().safe(),
  intervalMs: z.number().int().nonnegative().safe(),
  query: z.array(keyValueSchema),
  headers: z.array(keyValueSchema),
  browserHeaders: z
    .object({
      enabled: z.boolean(),
      sourceUrl: z.string(),
      userAgent: z.string(),
      acceptLanguage: z.string(),
    })
    .optional(),
  body: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('json'), value: z.string() }),
      z.object({ mode: z.literal('text'), value: z.string() }),
      z.object({ mode: z.literal('form-data'), fields: z.array(keyValueSchema) }),
    ])
    .optional(),
});

export function validateRunConfig(input: unknown): RunConfig {
  const config = runSchema.parse(input);
  const url = new URL(config.url);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http:// 或 https:// 地址');
  }
  if (url.username || url.password) {
    throw new Error('URL 不允许包含用户名或密码');
  }
  if (config.body?.mode === 'json') {
    try {
      JSON.parse(config.body.value);
    } catch {
      throw new Error('JSON 请求体格式不正确');
    }
  }
  if (config.browserHeaders?.enabled && config.browserHeaders.sourceUrl.trim()) {
    const sourceUrl = new URL(config.browserHeaders.sourceUrl);
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
      throw new Error('来源页面 URL 仅支持 http:// 或 https://');
    }
    if (sourceUrl.username || sourceUrl.password) {
      throw new Error('来源页面 URL 不允许包含用户名或密码');
    }
  }

  return config;
}

export async function streamRun(req: Request, res: Response, config: RunConfig): Promise<void> {
  const abortController = new AbortController();
  const cookieJar = new CookieJar(undefined, { allowSpecialUseDomain: true });
  const fetchWithCookies = makeFetchCookie(fetch, cookieJar);
  const onClose = () => {
    if (!res.writableEnded) abortController.abort();
  };
  res.on('close', onClose);

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const summary: RunSummary = {
    total: config.count,
    completed: 0,
    succeeded: 0,
    failed: 0,
    averageDurationMs: 0,
  };
  let totalDuration = 0;

  writeEvent(res, { type: 'run_started', total: config.count, startedAt: new Date().toISOString() });

  try {
    for (let index = 1; index <= config.count; index += 1) {
      if (abortController.signal.aborted) break;

      const startedAt = new Date();
      const startedTime = performance.now();
      writeEvent(res, { type: 'request_started', index, startedAt: startedAt.toISOString() });

      try {
        const requestUrl = buildUrl(config);
        await applyManualCookies(cookieJar, requestUrl, config);
        const response = await fetchWithCookies(requestUrl, {
          method: config.method,
          headers: buildHeaders(config),
          body: buildBody(config),
          redirect: 'follow',
          signal: abortController.signal,
        });
        const body = await readResponseBody(response);
        const durationMs = roundDuration(performance.now() - startedTime);
        const event: RunEvent = {
          type: 'request_completed',
          index,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          durationMs,
          headers: Object.fromEntries(response.headers.entries()),
          body,
        };
        writeEvent(res, event);
        summary.completed += 1;
        response.ok ? (summary.succeeded += 1) : (summary.failed += 1);
        totalDuration += durationMs;
      } catch (error) {
        if (abortController.signal.aborted) break;
        const durationMs = roundDuration(performance.now() - startedTime);
        writeEvent(res, {
          type: 'request_failed',
          index,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs,
          error: errorMessage(error),
        });
        summary.completed += 1;
        summary.failed += 1;
        totalDuration += durationMs;
      }

      if (index < config.count && !abortController.signal.aborted) {
        await abortableDelay(config.intervalMs, abortController.signal);
      }
    }

    if (!abortController.signal.aborted) {
      summary.averageDurationMs = summary.completed
        ? roundDuration(totalDuration / summary.completed)
        : 0;
      writeEvent(res, { type: 'run_completed', finishedAt: new Date().toISOString(), summary });
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
}

function buildUrl(config: RunConfig): string {
  const url = new URL(config.url);
  for (const item of config.query) {
    if (item.enabled && item.key.trim()) url.searchParams.append(item.key, item.value);
  }
  return url.toString();
}

function buildHeaders(config: RunConfig): Array<[string, string]> {
  const isFormData = config.body?.mode === 'form-data';
  const headers = config.headers
    .filter(
      (item) =>
        item.enabled &&
        item.key.trim() &&
        item.key.trim().toLowerCase() !== 'cookie' &&
        !(isFormData && item.key.trim().toLowerCase() === 'content-type'),
    )
    .map((item) => [item.key, item.value] as [string, string]);

  addBrowserHeaders(headers, config);

  if (config.body && config.body.mode !== 'form-data' && !['GET', 'DELETE'].includes(config.method)) {
    const hasContentType = headers.some(([key]) => key.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers.push([
        'Content-Type',
        config.body.mode === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      ]);
    }
  }
  return headers;
}

function addBrowserHeaders(headers: Array<[string, string]>, config: RunConfig): void {
  const profile = config.browserHeaders;
  if (!profile?.enabled) return;

  addHeaderIfMissing(headers, 'Accept', '*/*');
  addHeaderIfMissing(headers, 'User-Agent', profile.userAgent.trim());
  addHeaderIfMissing(headers, 'Accept-Language', profile.acceptLanguage.trim());
  if (profile.acceptLanguage.trim().toLowerCase().startsWith('zh')) {
    addHeaderIfMissing(headers, 'Language', 'chinese');
  }

  const source = new URL(profile.sourceUrl.trim() || new URL(config.url).origin);
  addHeaderIfMissing(headers, 'Origin', source.origin);
  addHeaderIfMissing(headers, 'Referer', source.toString());
}

function addHeaderIfMissing(
  headers: Array<[string, string]>,
  name: string,
  value: string,
): void {
  if (!value || headers.some(([key]) => key.trim().toLowerCase() === name.toLowerCase())) return;
  headers.push([name, value]);
}

async function applyManualCookies(
  cookieJar: CookieJar,
  requestUrl: string,
  config: RunConfig,
): Promise<void> {
  const cookieHeaders = config.headers.filter(
    (item) => item.enabled && item.key.trim().toLowerCase() === 'cookie',
  );

  for (const header of cookieHeaders) {
    for (const cookie of parseCookieHeader(header.value)) {
      await cookieJar.setCookie(`${cookie.name}=${cookie.value}`, requestUrl, { ignoreError: true });
    }
  }
}

function parseCookieHeader(value: string): Array<{ name: string; value: string }> {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      return [{ name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }];
    });
}

function buildBody(config: RunConfig): BodyInit | undefined {
  if (['GET', 'DELETE'].includes(config.method)) return undefined;
  if (!config.body) return undefined;
  if (config.body.mode !== 'form-data') return config.body.value;

  const body = new FormData();
  for (const field of config.body.fields) {
    if (field.enabled && field.key.trim()) body.append(field.key, field.value);
  }
  return body;
}

async function readResponseBody(response: globalThis.Response): Promise<ResponseBody> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const sizeBytes = bytes.byteLength;

  if (contentType.toLowerCase().includes('json')) {
    const text = new TextDecoder().decode(bytes);
    try {
      return { kind: 'json', contentType, sizeBytes, content: JSON.parse(text) };
    } catch {
      return { kind: 'text', contentType, sizeBytes, content: text };
    }
  }

  if (isTextContentType(contentType)) {
    return { kind: 'text', contentType, sizeBytes, content: new TextDecoder().decode(bytes) };
  }
  return { kind: 'binary', contentType, sizeBytes };
}

function isTextContentType(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.startsWith('text/') ||
    value.includes('xml') ||
    value.includes('javascript') ||
    value.includes('x-www-form-urlencoded') ||
    value.includes('svg')
  );
}

function writeEvent(res: Response, event: RunEvent): void {
  if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知网络错误';
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}
