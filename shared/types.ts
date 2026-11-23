export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface KeyValueItem {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
}

export type RequestBodyConfig =
  | { mode: 'json' | 'text'; value: string }
  | { mode: 'form-data'; fields: KeyValueItem[] };

export interface BrowserHeaderConfig {
  enabled: boolean;
  sourceUrl: string;
  userAgent: string;
  acceptLanguage: string;
}

export interface RunConfig {
  url: string;
  method: HttpMethod;
  count: number;
  intervalMs: number;
  query: KeyValueItem[];
  headers: KeyValueItem[];
  body?: RequestBodyConfig;
  browserHeaders?: BrowserHeaderConfig;
}

export interface RunSummary {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  averageDurationMs: number;
}

export type ScheduledRunStatus = 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface ScheduledRunView {
  id: string;
  createdAt: string;
  executeAt: string;
  status: ScheduledRunStatus;
  request: {
    method: HttpMethod;
    url: string;
    count: number;
    intervalMs: number;
  };
  summary?: RunSummary;
  error?: string;
}

export interface ScheduledRunDetails extends ScheduledRunView {
  events: RunEvent[];
}

export type ResponseBody =
  | { kind: 'json'; contentType: string; sizeBytes: number; content: unknown }
  | { kind: 'text'; contentType: string; sizeBytes: number; content: string }
  | { kind: 'binary'; contentType: string; sizeBytes: number };

export type RunEvent =
  | { type: 'run_started'; total: number; startedAt: string }
  | { type: 'request_started'; index: number; startedAt: string }
  | {
      type: 'request_completed';
      index: number;
      startedAt: string;
      finishedAt: string;
      status: number;
      statusText: string;
      ok: boolean;
      durationMs: number;
      headers: Record<string, string>;
      body: ResponseBody;
    }
  | {
      type: 'request_failed';
      index: number;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      error: string;
    }
  | { type: 'run_completed'; finishedAt: string; summary: RunSummary };
