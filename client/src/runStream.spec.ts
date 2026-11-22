// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunConfig, RunEvent } from '../../shared/types';
import { runRequests } from './runStream';

const config: RunConfig = {
  url: 'https://example.com',
  method: 'GET',
  count: 1,
  intervalMs: 0,
  query: [],
  headers: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('runRequests', () => {
  it('parses NDJSON events split across stream chunks', async () => {
    const events: RunEvent[] = [
      { type: 'run_started', total: 1, startedAt: 'now' },
      {
        type: 'run_completed',
        finishedAt: 'later',
        summary: { total: 1, completed: 1, succeeded: 1, failed: 0, averageDurationMs: 2 },
      },
    ];
    const payload = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 17)));
        controller.enqueue(new TextEncoder().encode(payload.slice(17)));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const received: RunEvent[] = [];

    await runRequests(config, new AbortController().signal, (event) => received.push(event));

    expect(received).toEqual(events);
  });

  it('reports backend validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'URL 无效' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(runRequests(config, new AbortController().signal, () => undefined)).rejects.toThrow('URL 无效');
  });
});
