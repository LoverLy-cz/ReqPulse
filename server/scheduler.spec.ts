import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunConfig, ScheduledRunDetails, ScheduledRunView } from '../shared/types.js';
import { createApp } from './app.js';

let target: Server;
let targetUrl = '';
let hits = 0;

const baseConfig = (): RunConfig => ({
  url: targetUrl,
  method: 'GET',
  count: 1,
  intervalMs: 0,
  query: [],
  headers: [],
});

beforeEach(async () => {
  hits = 0;
  target = createServer((req, res) => {
    hits += 1;
    if (req.url === '/slow') {
      setTimeout(() => {
        if (!res.destroyed) res.end('{"ok":true}');
      }, 500).unref();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const address = target.address();
  if (!address || typeof address === 'string') throw new Error('测试服务启动失败');
  targetUrl = `http://127.0.0.1:${address.port}/target`;
});

afterEach(async () => {
  target.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    target.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('one-time scheduler API', () => {
  it('executes a scheduled task once and exposes its result events', async () => {
    const app = createApp();
    const createResponse = await request(app)
      .post('/api/schedules')
      .send({ executeAt: new Date(Date.now() + 80).toISOString(), config: baseConfig() })
      .expect(201);
    const created = createResponse.body as ScheduledRunView;

    expect(created.status).toBe('scheduled');
    expect(created.request.url).toBe(targetUrl);
    expect(await request(app).get('/api/schedules').then((result) => result.body)).toHaveLength(1);

    const completed = await waitForTask(app, created.id, 'completed');
    expect(hits).toBe(1);
    expect(completed.summary).toMatchObject({ total: 1, completed: 1, succeeded: 1, failed: 0 });
    expect(completed.events.map((event) => event.type)).toEqual([
      'run_started',
      'request_started',
      'request_completed',
      'run_completed',
    ]);
  });

  it('cancels a waiting task so it is never sent', async () => {
    const app = createApp();
    const created = (
      await request(app)
        .post('/api/schedules')
        .send({ executeAt: new Date(Date.now() + 150).toISOString(), config: baseConfig() })
        .expect(201)
    ).body as ScheduledRunView;

    const cancelled = (
      await request(app).delete(`/api/schedules/${created.id}`).expect(200)
    ).body as ScheduledRunView;
    expect(cancelled.status).toBe('cancelled');

    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(hits).toBe(0);
    expect((await request(app).get(`/api/schedules/${created.id}`)).body.status).toBe('cancelled');
  });

  it('aborts the current request when a running task is cancelled', async () => {
    const app = createApp();
    const config = { ...baseConfig(), url: targetUrl.replace('/target', '/slow'), count: 2 };
    const created = (
      await request(app)
        .post('/api/schedules')
        .send({ executeAt: new Date(Date.now() + 40).toISOString(), config })
        .expect(201)
    ).body as ScheduledRunView;

    await waitForTask(app, created.id, 'running');
    const cancelled = (
      await request(app).delete(`/api/schedules/${created.id}`).expect(200)
    ).body as ScheduledRunView;
    expect(cancelled.status).toBe('cancelled');

    await new Promise((resolve) => setTimeout(resolve, 80));
    const details = (await request(app).get(`/api/schedules/${created.id}`)).body as ScheduledRunDetails;
    expect(details.status).toBe('cancelled');
    expect(hits).toBe(1);
    expect(details.events.some((event) => event.type === 'run_completed')).toBe(false);
  });

  it('rejects invalid or past execution times and unknown tasks', async () => {
    const app = createApp();
    await request(app)
      .post('/api/schedules')
      .send({ executeAt: new Date(Date.now() - 1000).toISOString(), config: baseConfig() })
      .expect(400, { error: '执行时间必须是有效的未来时间' });
    await request(app).post('/api/schedules').send({ executeAt: 'invalid', config: baseConfig() }).expect(400);
    await request(app).get('/api/schedules/missing').expect(404);
    await request(app).delete('/api/schedules/missing').expect(404);
  });

  it('deletes finished records individually or in bulk but protects active tasks', async () => {
    const app = createApp();
    const first = (
      await request(app)
        .post('/api/schedules')
        .send({ executeAt: new Date(Date.now() + 10_000).toISOString(), config: baseConfig() })
        .expect(201)
    ).body as ScheduledRunView;

    await request(app)
      .delete(`/api/schedules/${first.id}/record`)
      .expect(409, { error: '请先取消正在等待或执行的任务' });
    await request(app).delete(`/api/schedules/${first.id}`).expect(200);
    await request(app).delete(`/api/schedules/${first.id}/record`).expect(200, { deleted: 1 });
    expect((await request(app).get('/api/schedules')).body).toEqual([]);

    for (let index = 0; index < 2; index += 1) {
      const task = (
        await request(app)
          .post('/api/schedules')
          .send({ executeAt: new Date(Date.now() + 10_000).toISOString(), config: baseConfig() })
          .expect(201)
      ).body as ScheduledRunView;
      await request(app).delete(`/api/schedules/${task.id}`).expect(200);
    }
    await request(app).delete('/api/schedules').expect(200, { deleted: 2 });
    expect((await request(app).get('/api/schedules')).body).toEqual([]);
  });
});

async function waitForTask(
  app: ReturnType<typeof createApp>,
  id: string,
  status: ScheduledRunView['status'],
): Promise<ScheduledRunDetails> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    const task = (await request(app).get(`/api/schedules/${id}`).expect(200)).body as ScheduledRunDetails;
    if (task.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`任务未进入状态：${status}`);
}
