import type { RunConfig, ScheduledRunDetails, ScheduledRunView } from '../../shared/types';

export async function createSchedule(executeAt: string, config: RunConfig): Promise<ScheduledRunView> {
  return request<ScheduledRunView>('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executeAt, config }),
  });
}

export async function listSchedules(): Promise<ScheduledRunView[]> {
  return request<ScheduledRunView[]>('/api/schedules');
}

export async function getSchedule(id: string): Promise<ScheduledRunDetails> {
  return request<ScheduledRunDetails>(`/api/schedules/${encodeURIComponent(id)}`);
}

export async function cancelSchedule(id: string): Promise<ScheduledRunView> {
  return request<ScheduledRunView>(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deleteScheduleRecord(id: string): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/schedules/${encodeURIComponent(id)}/record`, {
    method: 'DELETE',
  });
}

export async function clearScheduleRecords(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/schedules', { method: 'DELETE' });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return data as T;
}
