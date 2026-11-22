<script setup lang="ts">
import { computed } from 'vue';
import type { RunEvent } from '../../../shared/types';

type ResultEvent = Extract<RunEvent, { type: 'request_completed' | 'request_failed' }>;

const props = defineProps<{ result: ResultEvent }>();

const isNetworkFailure = computed(() => props.result.type === 'request_failed');
const bodyText = computed(() => {
  if (props.result.type !== 'request_completed') return props.result.error;
  if (props.result.body.kind === 'binary') {
    return `二进制响应 · ${props.result.body.contentType} · ${formatBytes(props.result.body.sizeBytes)}`;
  }
  return props.result.body.kind === 'json'
    ? JSON.stringify(props.result.body.content, null, 2)
    : props.result.body.content;
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <article class="response-card" :class="{ failed: isNetworkFailure || ('ok' in result && !result.ok) }">
    <details>
      <summary>
        <span class="request-index">#{{ result.index }}</span>
        <span v-if="result.type === 'request_completed'" class="status-code" :class="{ good: result.ok }">
          {{ result.status }} {{ result.statusText }}
        </span>
        <span v-else class="status-code">网络错误</span>
        <span class="result-time">{{ result.durationMs }} ms</span>
        <span class="result-date">{{ new Date(result.finishedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
        <span class="chevron">⌄</span>
      </summary>
      <div class="response-content">
        <div v-if="result.type === 'request_completed'" class="response-block">
          <h4>响应头</h4>
          <pre>{{ JSON.stringify(result.headers, null, 2) }}</pre>
        </div>
        <div class="response-block grow">
          <h4>{{ result.type === 'request_completed' ? '响应体' : '错误信息' }}</h4>
          <pre>{{ bodyText || '（空响应）' }}</pre>
        </div>
      </div>
    </details>
  </article>
</template>
