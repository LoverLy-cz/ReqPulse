<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type {
  HttpMethod,
  KeyValueItem,
  RunConfig,
  RunEvent,
  RunSummary,
  ScheduledRunStatus,
  ScheduledRunView,
} from '../../shared/types';
import KeyValueEditor from './components/KeyValueEditor.vue';
import ParticleBackground, { type ParticleMode } from './components/ParticleBackground.vue';
import ResponseCard from './components/ResponseCard.vue';
import { parseCopyAsFetch, type ImportedFetchRequest } from './copyAsFetch';
import {
  loadConfig,
  loadParticleMode,
  loadTheme,
  migrateBrowserHeadersDefaultOff,
  saveConfig,
  saveParticleMode,
  saveTheme,
  type ThemeMode,
} from './storage';
import { runRequests } from './runStream';
import {
  cancelSchedule,
  clearScheduleRecords,
  createSchedule,
  deleteScheduleRecord,
  getSchedule,
  listSchedules,
} from './scheduleApi';

type ResultEvent = Extract<RunEvent, { type: 'request_completed' | 'request_failed' }>;

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const headerKeySuggestions = [
  { value: 'Accept', label: '期望的响应类型' },
  { value: 'Content-Type', label: '请求体类型' },
  { value: 'Authorization', label: '身份认证信息' },
  { value: 'User-Agent', label: '客户端标识' },
  { value: 'Cache-Control', label: '缓存策略' },
  { value: 'Accept-Language', label: '期望的响应语言' },
  { value: 'Accept-Encoding', label: '可接受的压缩格式' },
  { value: 'X-API-Key', label: 'API 密钥' },
  { value: 'X-Requested-With', label: '请求来源标识' },
  { value: 'Cookie', label: '手动 Cookie（优先于自动 Cookie）' },
];
const headerValueSuggestions = [
  { value: 'application/json', label: 'JSON 数据' },
  { value: 'text/plain; charset=utf-8', label: 'UTF-8 纯文本' },
  { value: 'application/x-www-form-urlencoded', label: '表单编码' },
  { value: '*/*', label: '接受任意响应类型' },
  { value: 'Bearer ', label: 'Bearer Token 认证' },
  { value: 'no-cache', label: '不使用缓存' },
  { value: 'gzip, deflate, br', label: '常用压缩格式' },
  { value: 'zh-CN,zh;q=0.9', label: '简体中文优先' },
];
const emptySummary = (): RunSummary => ({ total: 0, completed: 0, succeeded: 0, failed: 0, averageDurationMs: 0 });
const detectedUserAgent = navigator.userAgent;
const detectedAcceptLanguage = buildAcceptLanguage(navigator.languages);
const defaultConfig: RunConfig = {
  url: 'https://httpbin.org/get',
  method: 'GET',
  count: 3,
  intervalMs: 1000,
  query: [],
  headers: [],
  body: { mode: 'json', value: '{\n  "hello": "world"\n}' },
  browserHeaders: {
    enabled: false,
    sourceUrl: '',
    userAgent: detectedUserAgent,
    acceptLanguage: detectedAcceptLanguage,
  },
};

const loadedConfig = migrateBrowserHeadersDefaultOff(loadConfig(defaultConfig));
loadedConfig.browserHeaders = {
  ...defaultConfig.browserHeaders!,
  ...loadedConfig.browserHeaders,
  userAgent: detectedUserAgent,
  acceptLanguage: detectedAcceptLanguage,
};
const config = reactive<RunConfig>(loadedConfig);
let previousTextBody = config.body?.mode !== 'form-data' ? config.body?.value ?? '' : '';
let previousFormFields = config.body?.mode === 'form-data' ? config.body.fields : [];
const results = ref<ResultEvent[]>([]);
const summary = reactive<RunSummary>(emptySummary());
const running = ref(false);
const currentIndex = ref(0);
const errorMessage = ref('');
const stopped = ref(false);
const scheduledAt = ref('');
const schedules = ref<ScheduledRunView[]>([]);
const scheduling = ref(false);
const scheduleError = ref('');
const theme = ref<ThemeMode>(loadTheme());
const particleMode = ref<ParticleMode>(loadParticleMode());
const particleModes: { value: ParticleMode; label: string }[] = [
  { value: 'constellation', label: '星链' },
  { value: 'drift', label: '流场' },
  { value: 'pulse', label: '脉冲' },
];
const pendingFetchImport = ref<ImportedFetchRequest | null>(null);
const fetchImportMessage = ref('');
let controller: AbortController | null = null;
let scheduleRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let loadedScheduledTaskId: string | null = null;
let pendingScheduledResultId: string | null = null;

const supportsBody = computed(() => ['POST', 'PUT', 'PATCH'].includes(config.method));
const bodyText = computed({
  get: () => (config.body?.mode !== 'form-data' ? config.body?.value ?? '' : ''),
  set: (value: string) => {
    if (config.body && config.body.mode !== 'form-data') config.body.value = value;
  },
});
const formDataFields = computed(() => (config.body?.mode === 'form-data' ? config.body.fields : []));
const browserHeaders = computed(() => config.browserHeaders!);
const browserSourcePreview = computed(() => {
  try {
    const source = new URL(browserHeaders.value.sourceUrl.trim() || new URL(config.url).origin);
    return `${source.origin} · ${source.toString()}`;
  } catch {
    return '来源页面 URL 无效';
  }
});
const progress = computed(() => (summary.total ? Math.round((summary.completed / summary.total) * 100) : 0));
const hasFinishedSchedules = computed(() =>
  schedules.value.some((task) => task.status !== 'scheduled' && task.status !== 'running'),
);
const statusLabel = computed(() => {
  if (running.value) return `正在执行第 ${currentIndex.value || 1} 次请求`;
  if (stopped.value) return '已手动停止';
  if (summary.completed) return '执行完成';
  return '等待启动';
});

watch(
  config,
  (value) => saveConfig(JSON.parse(JSON.stringify(value)) as RunConfig),
  { deep: true },
);

watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value;
    saveTheme(value);
  },
  { immediate: true },
);

watch(particleMode, saveParticleMode);

onMounted(() => {
  void refreshSchedules();
  window.addEventListener('paste', handleFetchPaste);
});

onUnmounted(() => {
  if (scheduleRefreshTimer) clearTimeout(scheduleRefreshTimer);
  window.removeEventListener('paste', handleFetchPaste);
});

function makeItem(): KeyValueItem {
  return { id: crypto.randomUUID(), enabled: true, key: '', value: '' };
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

function buildAcceptLanguage(languages: readonly string[]): string {
  const unique = [...new Set(languages.filter(Boolean))];
  return unique
    .map((language, index) => {
      if (index === 0) return language;
      const quality = Math.max(0.1, 1 - index * 0.1).toFixed(1);
      return `${language};q=${quality}`;
    })
    .join(',');
}

function addItem(target: 'query' | 'headers') {
  config[target].push(makeItem());
}

function removeItem(target: 'query' | 'headers', id: string) {
  config[target] = config[target].filter((item) => item.id !== id);
}

function handleFetchPaste(event: ClipboardEvent) {
  const imported = parseCopyAsFetch(event.clipboardData?.getData('text/plain') ?? '');
  if (!imported) return;
  event.preventDefault();
  pendingFetchImport.value = imported;
  fetchImportMessage.value = '';
}

async function importFetchFromClipboard() {
  try {
    if (!navigator.clipboard?.readText) throw new Error('当前浏览器不支持读取剪贴板');
    const imported = parseCopyAsFetch(await navigator.clipboard.readText());
    if (!imported) throw new Error('剪贴板中没有可识别的 Copy as fetch 内容');
    applyFetchImport(imported);
  } catch (error) {
    fetchImportMessage.value = error instanceof Error ? error.message : '读取剪贴板失败';
  }
}

function applyFetchImport(imported = pendingFetchImport.value) {
  if (!imported) return;
  config.url = imported.url;
  config.method = imported.method;
  config.headers = imported.headers.map((header) => ({
    id: crypto.randomUUID(),
    enabled: true,
    ...header,
  }));
  if (config.browserHeaders && imported.referrer) config.browserHeaders.sourceUrl = imported.referrer;
  if (['POST', 'PUT', 'PATCH'].includes(imported.method) && imported.body !== null) {
    config.body = { mode: imported.bodyMode, value: imported.body };
    previousTextBody = imported.body;
  }
  pendingFetchImport.value = null;
  fetchImportMessage.value = `已导入 ${imported.method} 请求和 ${imported.headers.length} 个 Headers`;
  errorMessage.value = '';
}

function setBodyMode(mode: 'json' | 'text' | 'form-data') {
  if (config.body?.mode === 'form-data') previousFormFields = config.body.fields;
  else if (config.body) previousTextBody = config.body.value;

  config.body =
    mode === 'form-data'
      ? { mode, fields: previousFormFields }
      : { mode, value: previousTextBody };
}

function addFormField() {
  if (config.body?.mode === 'form-data') config.body.fields.push(makeItem());
}

function removeFormField(id: string) {
  if (config.body?.mode === 'form-data') {
    config.body.fields = config.body.fields.filter((field) => field.id !== id);
  }
}

function validate(): string | null {
  try {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol)) return 'URL 仅支持 http:// 或 https://';
    if (url.username || url.password) return 'URL 不允许包含用户名或密码';
  } catch {
    return '请输入有效的完整 URL';
  }
  if (!Number.isSafeInteger(config.count) || config.count < 1) return '请求次数必须是正整数';
  if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs < 0) return '请求间隔必须是非负整数';
  if (browserHeaders.value.enabled && browserHeaders.value.sourceUrl.trim()) {
    try {
      const sourceUrl = new URL(browserHeaders.value.sourceUrl);
      if (!['http:', 'https:'].includes(sourceUrl.protocol)) return '来源页面 URL 仅支持 http:// 或 https://';
      if (sourceUrl.username || sourceUrl.password) return '来源页面 URL 不允许包含用户名或密码';
    } catch {
      return '请输入有效的来源页面 URL';
    }
  }
  if (supportsBody.value && config.body?.mode === 'json') {
    try {
      JSON.parse(config.body.value);
    } catch {
      return 'JSON 请求体格式不正确';
    }
  }
  return null;
}

async function startRun() {
  const validationError = validate();
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }

  saveConfig(JSON.parse(JSON.stringify(config)) as RunConfig);
  clearResults();
  running.value = true;
  stopped.value = false;
  controller = new AbortController();

  try {
    await runRequests(buildPayload(), controller.signal, handleEvent);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    errorMessage.value = error instanceof Error ? error.message : '运行失败';
  } finally {
    running.value = false;
    controller = null;
    if (pendingScheduledResultId) {
      const taskId = pendingScheduledResultId;
      pendingScheduledResultId = null;
      await loadScheduledResults(taskId);
    }
  }
}

function stopRun() {
  if (!controller) return;
  stopped.value = true;
  controller.abort();
}

async function scheduleRun() {
  scheduleError.value = '';
  const validationError = validate();
  if (validationError) {
    scheduleError.value = validationError;
    return;
  }
  const executeAt = new Date(scheduledAt.value);
  if (!scheduledAt.value || !Number.isFinite(executeAt.getTime()) || executeAt.getTime() <= Date.now()) {
    scheduleError.value = '请选择未来的执行日期和时间';
    return;
  }

  scheduling.value = true;
  try {
    await createSchedule(executeAt.toISOString(), buildPayload());
    await refreshSchedules();
  } catch (error) {
    scheduleError.value = error instanceof Error ? error.message : '创建定时任务失败';
  } finally {
    scheduling.value = false;
  }
}

async function refreshSchedules(silent = false) {
  try {
    const previousStatuses = new Map(schedules.value.map((task) => [task.id, task.status]));
    const nextSchedules = await listSchedules();
    const newlyFinished = nextSchedules.find(
      (task) =>
        (task.status === 'completed' || task.status === 'failed') &&
        (previousStatuses.get(task.id) === 'scheduled' || previousStatuses.get(task.id) === 'running'),
    );
    const latestFinished =
      !loadedScheduledTaskId && !results.value.length && !summary.completed
        ? nextSchedules.find((task) => task.status === 'completed' || task.status === 'failed')
        : undefined;

    schedules.value = nextSchedules;
    armScheduleRefresh();
    if (!silent) scheduleError.value = '';

    const taskToLoad = newlyFinished ?? latestFinished;
    if (taskToLoad && taskToLoad.id !== loadedScheduledTaskId) {
      if (running.value) pendingScheduledResultId = taskToLoad.id;
      else await loadScheduledResults(taskToLoad.id);
    }
  } catch (error) {
    if (!silent) scheduleError.value = error instanceof Error ? error.message : '读取定时任务失败';
  }
}

function armScheduleRefresh() {
  if (scheduleRefreshTimer) clearTimeout(scheduleRefreshTimer);
  scheduleRefreshTimer = null;
  if (!schedules.value.some((task) => task.status === 'scheduled' || task.status === 'running')) return;
  scheduleRefreshTimer = setTimeout(() => {
    scheduleRefreshTimer = null;
    void refreshSchedules(true);
  }, 1000);
}

async function cancelScheduledRun(id: string) {
  try {
    await cancelSchedule(id);
    await refreshSchedules();
  } catch (error) {
    scheduleError.value = error instanceof Error ? error.message : '取消定时任务失败';
  }
}

async function deleteScheduledRun(id: string) {
  try {
    await deleteScheduleRecord(id);
    if (loadedScheduledTaskId === id) {
      loadedScheduledTaskId = null;
      clearResults();
    }
    await refreshSchedules();
  } catch (error) {
    scheduleError.value = error instanceof Error ? error.message : '删除定时任务记录失败';
  }
}

async function clearScheduledRuns() {
  try {
    await clearScheduleRecords();
    const showingScheduledResult = loadedScheduledTaskId !== null;
    loadedScheduledTaskId = null;
    pendingScheduledResultId = null;
    if (showingScheduledResult) clearResults();
    await refreshSchedules();
  } catch (error) {
    scheduleError.value = error instanceof Error ? error.message : '清空定时任务记录失败';
  }
}

async function loadScheduledResults(id: string) {
  try {
    const task = await getSchedule(id);
    clearResults();
    for (const event of task.events) handleEvent(event);
    if (task.status === 'cancelled') stopped.value = true;
    if (task.status === 'failed' && task.error) errorMessage.value = task.error;
    if (!task.events.length) scheduleError.value = '该任务尚无执行结果';
    loadedScheduledTaskId = id;
  } catch (error) {
    scheduleError.value = error instanceof Error ? error.message : '读取执行结果失败';
  }
}

function scheduleStatusLabel(status: ScheduledRunStatus): string {
  return {
    scheduled: '等待执行',
    running: '执行中',
    completed: '已完成',
    cancelled: '已取消',
    failed: '执行失败',
  }[status];
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function clearResults() {
  results.value = [];
  Object.assign(summary, emptySummary());
  currentIndex.value = 0;
  errorMessage.value = '';
  stopped.value = false;
}

function buildPayload(): RunConfig {
  const payload = JSON.parse(JSON.stringify(config)) as RunConfig;
  if (!supportsBody.value) delete payload.body;
  return payload;
}

function handleEvent(event: RunEvent) {
  if (event.type === 'run_started') summary.total = event.total;
  if (event.type === 'request_started') currentIndex.value = event.index;
  if (event.type === 'request_completed' || event.type === 'request_failed') {
    results.value.unshift(event);
    summary.completed += 1;
    const succeeded = event.type === 'request_completed' && event.ok;
    succeeded ? (summary.succeeded += 1) : (summary.failed += 1);
    summary.averageDurationMs =
      Math.round((results.value.reduce((total, item) => total + item.durationMs, 0) / summary.completed) * 100) / 100;
  }
  if (event.type === 'run_completed') Object.assign(summary, event.summary);
}
</script>

<template>
  <ParticleBackground :mode="particleMode" />
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <p class="eyebrow">REQUEST ORCHESTRATOR</p>
        <h1>REQ <em>PULSE</em></h1>
      </div>
      <div class="particle-switch" role="group" aria-label="粒子背景效果">
        <span>FX</span>
        <button
          v-for="mode in particleModes"
          :key="mode.value"
          type="button"
          :class="{ active: particleMode === mode.value }"
          :aria-pressed="particleMode === mode.value"
          @click="particleMode = mode.value"
        >{{ mode.label }}</button>
      </div>
      <button
        class="theme-toggle"
        :class="{ light: theme === 'light' }"
        type="button"
        :aria-label="theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'"
        :title="theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'"
        @click="toggleTheme"
      >
        <span aria-hidden="true">☀</span><i></i><span aria-hidden="true">☾</span>
      </button>
      <div class="connection"><i></i> LOCAL ENGINE</div>
    </header>

    <div class="workspace">
      <section class="request-panel panel">
        <div class="panel-title">
          <div><span>01</span><h2>请求配置</h2></div>
          <p>按顺序重复调用目标接口</p>
        </div>

        <div class="url-bar">
          <select v-model="config.method" aria-label="请求方法">
            <option v-for="method in methods" :key="method">{{ method }}</option>
          </select>
          <input v-model.trim="config.url" class="url-input" aria-label="请求 URL" placeholder="https://api.example.com/data" />
          <button class="run-button" type="button" :disabled="running" @click="startRun">
            <span>{{ running ? '运行中' : '开始运行' }}</span><b>→</b>
          </button>
        </div>

        <div class="fetch-import-row">
          <button type="button" aria-label="从剪贴板导入 Copy as fetch" @click="importFetchFromClipboard">
            ⇩ 粘贴 FETCH
          </button>
          <span>Chrome DevTools · Copy as fetch（Cookie 可能需手动填写）</span>
        </div>

        <section v-if="pendingFetchImport" class="fetch-import-prompt" role="status">
          <div>
            <strong>检测到 Copy as fetch</strong>
            <span>{{ pendingFetchImport.method }} · {{ pendingFetchImport.url }}</span>
          </div>
          <div>
            <button type="button" @click="pendingFetchImport = null">忽略</button>
            <button class="fetch-import-confirm" type="button" @click="applyFetchImport()">导入配置</button>
          </div>
        </section>
        <p v-if="fetchImportMessage" class="fetch-import-message" role="status">{{ fetchImportMessage }}</p>

        <div v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</div>

        <div class="schedule-grid">
          <label>
            <span>请求次数</span>
            <div class="number-field"><input v-model.number="config.count" type="number" min="1" step="1" /><small>次</small></div>
          </label>
          <label>
            <span>完成后间隔</span>
            <div class="number-field"><input v-model.number="config.intervalMs" type="number" min="0" step="1" /><small>ms</small></div>
          </label>
          <div class="warning-note">
            <b>∞ 无强制上限</b>
            <span>高次数或大响应可能占用较多内存</span>
          </div>
        </div>

        <section class="scheduled-runs">
          <div class="scheduled-runs-heading">
            <div>
              <h3>一次性定时执行</h3>
              <p>任务保存在后端；关闭页面后仍会按时执行</p>
            </div>
            <button v-if="hasFinishedSchedules" type="button" @click="clearScheduledRuns">清空已结束记录</button>
          </div>
          <div class="schedule-create">
            <label>
              <span>执行日期时间</span>
              <input v-model="scheduledAt" type="datetime-local" step="1" aria-label="执行日期时间" />
            </label>
            <button type="button" :disabled="scheduling" @click="scheduleRun">
              {{ scheduling ? '创建中…' : '预约执行' }}
            </button>
          </div>
          <div v-if="scheduleError" class="schedule-error" role="alert">{{ scheduleError }}</div>
          <div v-if="schedules.length" class="schedule-list">
            <article v-for="task in schedules" :key="task.id" class="schedule-item">
              <div>
                <strong>{{ scheduleStatusLabel(task.status) }}</strong>
                <span>{{ formatDateTime(task.executeAt) }} · {{ task.request.method }} · {{ task.request.count }} 次</span>
                <small :title="task.request.url">{{ task.request.url }}</small>
              </div>
              <div class="schedule-actions">
                <button
                  v-if="task.status === 'scheduled' || task.status === 'running'"
                  type="button"
                  @click="cancelScheduledRun(task.id)"
                >取消</button>
                <template v-else>
                  <button type="button" @click="loadScheduledResults(task.id)">查看结果</button>
                  <button class="danger" type="button" @click="deleteScheduledRun(task.id)">删除</button>
                </template>
              </div>
            </article>
          </div>
          <p v-else class="schedule-empty">暂无定时任务 · Node 服务重启后任务记录会清空</p>
        </section>

        <KeyValueEditor title="QUERY 参数" :items="config.query" key-placeholder="参数名" @add="addItem('query')" @remove="removeItem('query', $event)" />
        <KeyValueEditor
          title="HEADERS"
          :items="config.headers"
          key-placeholder="Header 名称（输入可查看常用项）"
          :key-suggestions="headerKeySuggestions"
          :value-suggestions="headerValueSuggestions"
          @add="addItem('headers')"
          @remove="removeItem('headers', $event)"
        />
        <section class="browser-headers" :class="{ disabled: !browserHeaders.enabled }">
          <div class="browser-headers-title">
            <label>
              <input v-model="browserHeaders.enabled" type="checkbox" aria-label="自动补全浏览器请求头" />
              <span>BROWSER HEADERS · {{ browserHeaders.enabled ? 'ON' : 'OFF' }}</span>
            </label>
            <small>手动 Header 优先</small>
          </div>
          <label class="source-url-field">
            <span>来源页面 URL</span>
            <input
              v-model.trim="browserHeaders.sourceUrl"
              type="url"
              aria-label="来源页面 URL"
              placeholder="留空时按目标地址同源推导"
              :disabled="!browserHeaders.enabled"
            />
          </label>
          <p>{{ browserSourcePreview }}</p>
          <div class="detected-headers">
            <span title="动态读取当前浏览器">UA · {{ browserHeaders.userAgent }}</span>
            <span>LANG · {{ browserHeaders.acceptLanguage || '未检测到' }}</span>
          </div>
        </section>
        <div class="cookie-note">
          <span>COOKIE JAR · ON</span>
          自动保存响应中的 Set-Cookie（包括 HttpOnly），并在本次任务的后续请求中携带
        </div>

        <section v-if="supportsBody" class="body-editor">
          <div class="section-heading compact">
            <h3>REQUEST BODY</h3>
            <div class="mode-switch" role="group" aria-label="请求体格式">
              <button type="button" :class="{ active: config.body?.mode === 'json' }" @click="setBodyMode('json')">JSON</button>
              <button type="button" :class="{ active: config.body?.mode === 'text' }" @click="setBodyMode('text')">TEXT</button>
              <button type="button" :class="{ active: config.body?.mode === 'form-data' }" @click="setBodyMode('form-data')">FORM DATA</button>
            </div>
          </div>
          <textarea v-if="config.body?.mode !== 'form-data'" v-model="bodyText" spellcheck="false" aria-label="请求体"></textarea>
          <div v-else class="form-data-editor">
            <KeyValueEditor
              title="FORM DATA 字段"
              :items="formDataFields"
              key-placeholder="字段名"
              @add="addFormField"
              @remove="removeFormField"
            />
            <p>Content-Type 和 multipart boundary 将自动生成</p>
          </div>
        </section>
      </section>

      <aside class="results-panel panel">
        <div class="panel-title">
          <div><span>02</span><h2>执行结果</h2></div>
          <button class="text-button" type="button" :disabled="running || !results.length" @click="clearResults">清空</button>
        </div>

        <section class="run-status" :class="{ active: running }">
          <div class="status-line">
            <div><i></i><strong>{{ statusLabel }}</strong></div>
            <b>{{ summary.completed }} / {{ summary.total || config.count }}</b>
          </div>
          <div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div>
          <button v-if="running" class="stop-button" type="button" @click="stopRun">■ 停止当前任务</button>
        </section>

        <div class="metrics">
          <div><span>成功</span><strong class="success">{{ summary.succeeded }}</strong></div>
          <div><span>失败</span><strong class="failure">{{ summary.failed }}</strong></div>
          <div><span>平均耗时</span><strong>{{ summary.averageDurationMs }}<small> ms</small></strong></div>
        </div>

        <div v-if="results.length" class="results-list">
          <ResponseCard v-for="result in results" :key="`${result.index}-${result.finishedAt}`" :result="result" />
        </div>
        <div v-else class="empty-state">
          <div class="radar"><span></span></div>
          <h3>尚无响应数据</h3>
          <p>配置请求后点击“开始运行”<br />每次响应会实时出现在这里</p>
        </div>
      </aside>
    </div>
  </main>
</template>
