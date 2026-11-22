<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { HttpMethod, KeyValueItem, RunConfig, RunEvent, RunSummary } from '../../shared/types';
import KeyValueEditor from './components/KeyValueEditor.vue';
import ResponseCard from './components/ResponseCard.vue';
import {
  loadConfig,
  loadTheme,
  migrateBrowserHeadersDefaultOff,
  saveConfig,
  saveTheme,
  type ThemeMode,
} from './storage';
import { runRequests } from './runStream';

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
const theme = ref<ThemeMode>(loadTheme());
let controller: AbortController | null = null;

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
  }
}

function stopRun() {
  if (!controller) return;
  stopped.value = true;
  controller.abort();
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
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <p class="eyebrow">REQUEST ORCHESTRATOR</p>
        <h1>REQ <em>PULSE</em></h1>
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
