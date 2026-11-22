import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import type { RunConfig, RunEvent } from '../shared/types.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

function baseConfig(url: string, overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    url,
    method: 'GET',
    count: 1,
    intervalMs: 0,
    query: [],
    headers: [],
    ...overrides,
  };
}

async function targetServer(
  handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

function eventsFrom(response: request.Response): RunEvent[] {
  return response.text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}

describe('POST /api/run', () => {
  it('forwards method, query, headers and JSON body', async () => {
    const target = await targetServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            token: req.headers['x-token'],
            contentType: req.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    });

    const response = await request(createApp())
      .post('/api/run')
      .send(
        baseConfig(`${target.url}/echo?existing=1`, {
          method: 'POST',
          query: [{ id: '1', enabled: true, key: 'name', value: '张三' }],
          headers: [{ id: '2', enabled: true, key: 'X-Token', value: 'secret' }],
          body: { mode: 'json', value: '{"ok":true}' },
        }),
      )
      .expect(200);

    const completed = eventsFrom(response).find((event) => event.type === 'request_completed');
    expect(completed?.type).toBe('request_completed');
    if (completed?.type !== 'request_completed' || completed.body.kind !== 'json') return;
    expect(completed.body.content).toEqual({
      method: 'POST',
      url: '/echo?existing=1&name=%E5%BC%A0%E4%B8%89',
      token: 'secret',
      contentType: 'application/json',
      body: '{"ok":true}',
    });
  });

  it('adds dynamic browser headers and preserves explicit overrides', async () => {
    const target = await targetServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.headers));
    });
    const response = await request(createApp())
      .post('/api/run')
      .send(
        baseConfig(target.url, {
          headers: [
            { id: 'ua', enabled: true, key: 'User-Agent', value: 'Manual-UA' },
            { id: 'origin', enabled: true, key: 'Origin', value: 'https://manual.example' },
          ],
          browserHeaders: {
            enabled: true,
            sourceUrl: 'https://app.example.com/current/page',
            userAgent: 'Detected-Chrome-UA',
            acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        }),
      )
      .expect(200);
    const completed = eventsFrom(response).find((event) => event.type === 'request_completed');
    expect(completed?.type).toBe('request_completed');
    if (completed?.type !== 'request_completed' || completed.body.kind !== 'json') return;
    expect(completed.body.content).toMatchObject({
      accept: '*/*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      language: 'chinese',
      origin: 'https://manual.example',
      referer: 'https://app.example.com/current/page',
      'user-agent': 'Manual-UA',
    });
  });

  it('derives Origin and Referer from the target when source URL is empty', async () => {
    const target = await targetServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ origin: req.headers.origin, referer: req.headers.referer }));
    });
    const response = await request(createApp())
      .post('/api/run')
      .send(
        baseConfig(`${target.url}/api`, {
          browserHeaders: {
            enabled: true,
            sourceUrl: '',
            userAgent: 'Browser-UA',
            acceptLanguage: 'en-US',
          },
        }),
      )
      .expect(200);
    const completed = eventsFrom(response).find((event) => event.type === 'request_completed');
    if (completed?.type !== 'request_completed' || completed.body.kind !== 'json') {
      throw new Error('Expected JSON response');
    }
    expect(completed.body.content).toEqual({ origin: target.url, referer: `${target.url}/` });
  });

  it('builds multipart form-data fields and generates a valid boundary', async () => {
    const target = await targetServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            contentType: req.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    });
    const response = await request(createApp())
      .post('/api/run')
      .send(
        baseConfig(target.url, {
          method: 'POST',
          headers: [
            { id: 'content-type', enabled: true, key: 'Content-Type', value: 'multipart/form-data' },
          ],
          body: {
            mode: 'form-data',
            fields: [
              { id: '1', enabled: true, key: 'nickname', value: '测试34' },
              { id: '2', enabled: true, key: 'tag', value: 'first' },
              { id: '3', enabled: true, key: 'tag', value: 'second' },
              { id: '4', enabled: false, key: 'ignored', value: 'hidden' },
            ],
          },
        }),
      )
      .expect(200);
    const completed = eventsFrom(response).find((event) => event.type === 'request_completed');
    expect(completed?.type).toBe('request_completed');
    if (completed?.type !== 'request_completed' || completed.body.kind !== 'json') return;
    const content = completed.body.content as { contentType: string; body: string };
    expect(content.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(content.body).toContain('name="nickname"');
    expect(content.body).toContain('测试34');
    expect(content.body.match(/name="tag"/g)).toHaveLength(2);
    expect(content.body).not.toContain('ignored');
  });

  it('runs sequentially, waits after completion, and continues after HTTP failures', async () => {
    const targetStarts: number[] = [];
    let call = 0;
    const target = await targetServer((_req, res) => {
      targetStarts.push(performance.now());
      call += 1;
      setTimeout(() => {
        res.statusCode = call === 1 ? 500 : 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`response-${call}`);
      }, 25);
    });

    const response = await request(createApp())
      .post('/api/run')
      .send(baseConfig(target.url, { count: 2, intervalMs: 45 }))
      .expect(200);
    const events = eventsFrom(response);
    const completed = events.filter((event) => event.type === 'request_completed');
    const final = events.at(-1);

    expect(completed).toHaveLength(2);
    expect(targetStarts[1] - targetStarts[0]).toBeGreaterThanOrEqual(60);
    expect(final?.type).toBe('run_completed');
    if (final?.type === 'run_completed') {
      expect(final.summary).toMatchObject({ completed: 2, succeeded: 1, failed: 1 });
    }
  });

  it('records network failures and continues remaining attempts', async () => {
    const unavailable = await targetServer((_req, res) => res.end('unused'));
    const { port } = unavailable.server.address() as AddressInfo;
    await new Promise<void>((resolve) => unavailable.server.close(() => resolve()));
    servers.splice(servers.indexOf(unavailable.server), 1);

    const response = await request(createApp())
      .post('/api/run')
      .send(baseConfig(`http://127.0.0.1:${port}`, { count: 2 }))
      .expect(200);
    const events = eventsFrom(response);
    expect(events.filter((event) => event.type === 'request_failed')).toHaveLength(2);
    const final = events.at(-1);
    expect(final?.type).toBe('run_completed');
    if (final?.type === 'run_completed') expect(final.summary.failed).toBe(2);
  });

  it.each([
    ['invalid protocol', baseConfig('ftp://example.com'), '仅支持'],
    ['URL credentials', baseConfig('http://user:pass@example.com'), '用户名或密码'],
    ['zero count', baseConfig('http://example.com', { count: 0 }), 'Too small'],
    ['negative interval', baseConfig('http://example.com', { intervalMs: -1 }), 'Too small'],
    [
      'invalid JSON body',
      baseConfig('http://example.com', { method: 'POST', body: { mode: 'json', value: '{' } }),
      'JSON 请求体',
    ],
  ])('rejects %s', async (_name, config, expected) => {
    const response = await request(createApp()).post('/api/run').send(config).expect(400);
    expect(response.body.error).toContain(expected);
  });

  it('classifies JSON, text and binary response bodies', async () => {
    const target = await targetServer((req, res) => {
      if (req.url === '/json') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"value":1}');
      } else if (req.url === '/text') {
        res.setHeader('Content-Type', 'text/plain');
        res.end('hello');
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(Buffer.from([0, 1, 2, 3]));
      }
    });

    for (const [path, kind, size] of [
      ['/json', 'json', 11],
      ['/text', 'text', 5],
      ['/bin', 'binary', 4],
    ] as const) {
      const response = await request(createApp()).post('/api/run').send(baseConfig(target.url + path));
      const completed = eventsFrom(response).find((event) => event.type === 'request_completed');
      expect(completed?.type === 'request_completed' ? completed.body.kind : null).toBe(kind);
      expect(completed?.type === 'request_completed' ? completed.body.sizeBytes : null).toBe(size);
    }
  });

  it('stores HttpOnly cookies and sends them on later requests in the same run', async () => {
    let call = 0;
    const receivedCookies: Array<string | undefined> = [];
    const target = await targetServer((req, res) => {
      call += 1;
      receivedCookies.push(req.headers.cookie);
      if (call === 1) {
        res.setHeader('Set-Cookie', 'sessionId=server-session; HttpOnly; Path=/; SameSite=Lax');
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
    });

    const response = await request(createApp())
      .post('/api/run')
      .send(baseConfig(target.url, { count: 2 }))
      .expect(200);

    expect(receivedCookies).toEqual([undefined, 'sessionId=server-session']);
    expect(eventsFrom(response).filter((event) => event.type === 'request_completed')).toHaveLength(2);
  });

  it('carries cookies through redirects and lets manual Cookie values override stored ones', async () => {
    let finalCookie: string | undefined;
    const redirectTarget = await targetServer((req, res) => {
      if (req.url === '/start') {
        res.statusCode = 302;
        res.setHeader('Location', '/final');
        res.setHeader('Set-Cookie', 'redirectToken=redirect-value; HttpOnly; Path=/');
        res.end();
        return;
      }
      finalCookie = req.headers.cookie;
      res.end('done');
    });

    await request(createApp())
      .post('/api/run')
      .send(baseConfig(`${redirectTarget.url}/start`))
      .expect(200);
    expect(finalCookie).toContain('redirectToken=redirect-value');

    let call = 0;
    const manualTarget = await targetServer((req, res) => {
      call += 1;
      if (call === 1) res.setHeader('Set-Cookie', 'sessionId=server-value; HttpOnly; Path=/');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ cookie: req.headers.cookie }));
    });
    const response = await request(createApp())
      .post('/api/run')
      .send(
        baseConfig(manualTarget.url, {
          count: 2,
          headers: [{ id: 'cookie', enabled: true, key: 'Cookie', value: 'sessionId=manual-value' }],
        }),
      )
      .expect(200);
    const completed = eventsFrom(response).filter(
      (event): event is Extract<RunEvent, { type: 'request_completed' }> =>
        event.type === 'request_completed',
    );
    expect(completed).toHaveLength(2);
    expect(completed[1].body.kind).toBe('json');
    if (completed[1].body.kind === 'json') {
      expect(completed[1].body.content).toEqual({ cookie: 'sessionId=manual-value' });
    }
  });

  it('aborts the current request and skips the rest when the client disconnects', async () => {
    let targetCalls = 0;
    let targetClosed = false;
    const target = await targetServer((req, res) => {
      targetCalls += 1;
      req.on('close', () => {
        targetClosed = true;
      });
      setTimeout(() => res.end('late'), 500);
    });
    const toolServer = createApp().listen(0, '127.0.0.1');
    servers.push(toolServer);
    await new Promise<void>((resolve) => toolServer.once('listening', resolve));
    const { port } = toolServer.address() as AddressInfo;
    const controller = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(baseConfig(target.url, { count: 3, intervalMs: 10 })),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(targetCalls).toBe(1);
    expect(targetClosed).toBe(true);
  });
});
