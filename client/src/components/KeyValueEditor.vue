<script setup lang="ts">
import { useId } from 'vue';
import type { KeyValueItem } from '../../../shared/types';

interface Suggestion {
  value: string;
  label?: string;
}

defineProps<{
  title: string;
  items: KeyValueItem[];
  keyPlaceholder: string;
  keySuggestions?: Suggestion[];
  valueSuggestions?: Suggestion[];
}>();

const emit = defineEmits<{
  add: [];
  remove: [id: string];
}>();

const componentId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const keyListId = `kv-key-${componentId}`;
const valueListId = `kv-value-${componentId}`;
</script>

<template>
  <section class="kv-editor">
    <div class="section-heading compact">
      <h3>{{ title }}</h3>
      <button class="text-button" type="button" @click="emit('add')">＋ 添加</button>
    </div>
    <div v-if="items.length" class="kv-list">
      <div v-for="item in items" :key="item.id" class="kv-row" :class="{ disabled: !item.enabled }">
        <label class="check-control" title="启用此项">
          <input v-model="item.enabled" type="checkbox" />
          <span></span>
        </label>
        <input
          v-model="item.key"
          :list="keySuggestions?.length ? keyListId : undefined"
          :placeholder="keyPlaceholder"
          aria-label="参数名"
        />
        <input
          v-model="item.value"
          :list="valueSuggestions?.length ? valueListId : undefined"
          placeholder="值"
          aria-label="参数值"
        />
        <button class="icon-button" type="button" aria-label="删除" @click="emit('remove', item.id)">×</button>
      </div>
    </div>
    <button v-else class="empty-add" type="button" @click="emit('add')">添加第一项 {{ title }}</button>
    <datalist v-if="keySuggestions?.length" :id="keyListId">
      <option v-for="suggestion in keySuggestions" :key="suggestion.value" :value="suggestion.value">
        {{ suggestion.label }}
      </option>
    </datalist>
    <datalist v-if="valueSuggestions?.length" :id="valueListId">
      <option v-for="suggestion in valueSuggestions" :key="suggestion.value" :value="suggestion.value">
        {{ suggestion.label }}
      </option>
    </datalist>
  </section>
</template>
