import express from 'express';
import { ZodError } from 'zod';
import { streamRun, validateRunConfig } from './run.js';

export function createApp(clientDist?: string) {
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

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  return app;
}
