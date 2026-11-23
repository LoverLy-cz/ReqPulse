import { randomUUID } from 'node:crypto';
import type {
  RunConfig,
  RunEvent,
  ScheduledRunDetails,
  ScheduledRunView,
} from '../shared/types.js';
import { executeRun } from './run.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ScheduledTask {
  view: ScheduledRunView;
  config: RunConfig;
  events: RunEvent[];
  timer?: NodeJS.Timeout;
  controller?: AbortController;
}

export class RunScheduler {
  private readonly tasks = new Map<string, ScheduledTask>();

  create(config: RunConfig, executeAt: Date): ScheduledRunView {
    if (!Number.isFinite(executeAt.getTime()) || executeAt.getTime() <= Date.now()) {
      throw new Error('执行时间必须是有效的未来时间');
    }

    const view: ScheduledRunView = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      executeAt: executeAt.toISOString(),
      status: 'scheduled',
      request: {
        method: config.method,
        url: config.url,
        count: config.count,
        intervalMs: config.intervalMs,
      },
    };
    const task: ScheduledTask = { view, config, events: [] };
    this.tasks.set(view.id, task);
    this.arm(task);
    return cloneView(view);
  }

  list(): ScheduledRunView[] {
    return [...this.tasks.values()]
      .map((task) => cloneView(task.view))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(id: string): ScheduledRunDetails | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return { ...cloneView(task.view), events: structuredClone(task.events) };
  }

  cancel(id: string): ScheduledRunView | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (task.view.status !== 'scheduled' && task.view.status !== 'running') {
      return cloneView(task.view);
    }

    if (task.timer) clearTimeout(task.timer);
    task.controller?.abort();
    task.view.status = 'cancelled';
    return cloneView(task.view);
  }

  remove(id: string): 'deleted' | 'active' | 'not-found' {
    const task = this.tasks.get(id);
    if (!task) return 'not-found';
    if (task.view.status === 'scheduled' || task.view.status === 'running') return 'active';
    this.tasks.delete(id);
    return 'deleted';
  }

  clearFinished(): number {
    let deleted = 0;
    for (const [id, task] of this.tasks) {
      if (task.view.status === 'scheduled' || task.view.status === 'running') continue;
      this.tasks.delete(id);
      deleted += 1;
    }
    return deleted;
  }

  private arm(task: ScheduledTask): void {
    const remaining = new Date(task.view.executeAt).getTime() - Date.now();
    const delay = Math.min(Math.max(remaining, 0), MAX_TIMER_DELAY_MS);
    task.timer = setTimeout(() => {
      task.timer = undefined;
      if (remaining > MAX_TIMER_DELAY_MS) {
        this.arm(task);
      } else {
        void this.run(task);
      }
    }, delay);
    task.timer.unref?.();
  }

  private async run(task: ScheduledTask): Promise<void> {
    if (task.view.status !== 'scheduled') return;
    task.view.status = 'running';
    task.controller = new AbortController();

    try {
      await executeRun(task.config, task.controller.signal, (event) => {
        task.events.push(event);
        if (event.type === 'run_completed') task.view.summary = event.summary;
      });
      if (task.view.status === 'running') task.view.status = 'completed';
    } catch (error) {
      if (!task.controller.signal.aborted) {
        task.view.status = 'failed';
        task.view.error = error instanceof Error ? error.message : '定时任务执行失败';
      }
    } finally {
      task.controller = undefined;
    }
  }
}

function cloneView(view: ScheduledRunView): ScheduledRunView {
  return structuredClone(view);
}
