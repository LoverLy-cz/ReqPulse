import express from 'express';
import { ZodError } from 'zod';
import { streamRun, validateRunConfig } from './run.js';
import { RunScheduler } from './scheduler.js';

export function createApp(clientDist?: string, scheduler = new RunScheduler()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: Number.POSITIVE_INFINITY }));

  app.post('/api/run', async (req, res) => {
    try {
      const config = validateRunConfig(req.body);
      await streamRun(req, res, config);
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      const message =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join('；')
          : error instanceof Error
            ? error.message
            : '请求配置无效';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/schedules', (req, res) => {
    try {
      const config = validateRunConfig(req.body?.config);
      const executeAt = new Date(req.body?.executeAt);
      res.status(201).json(scheduler.create(config, executeAt));
    } catch (error) {
      res.status(400).json({ error: validationMessage(error) });
    }
  });

  app.get('/api/schedules', (_req, res) => {
    res.json(scheduler.list());
  });

  app.get('/api/schedules/:id', (req, res) => {
    const task = scheduler.get(req.params.id);
    if (!task) return res.status(404).json({ error: '定时任务不存在' });
    return res.json(task);
  });

  app.delete('/api/schedules', (_req, res) => {
    res.json({ deleted: scheduler.clearFinished() });
  });

  app.delete('/api/schedules/:id/record', (req, res) => {
    const result = scheduler.remove(req.params.id);
    if (result === 'not-found') return res.status(404).json({ error: '定时任务不存在' });
    if (result === 'active') return res.status(409).json({ error: '请先取消正在等待或执行的任务' });
    return res.json({ deleted: 1 });
  });

  app.delete('/api/schedules/:id', (req, res) => {
    const task = scheduler.cancel(req.params.id);
    if (!task) return res.status(404).json({ error: '定时任务不存在' });
    return res.json(task);
  });

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  return app;
}

function validationMessage(error: unknown): string {
  return error instanceof ZodError
    ? error.issues.map((issue) => issue.message).join('；')
    : error instanceof Error
      ? error.message
      : '请求配置无效';
}
