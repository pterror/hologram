<script setup lang="ts">
import { ref } from 'vue'

export interface ContextValues {
  mentioned: boolean
  replied: boolean
  is_forward: boolean
  is_self: boolean
  is_hologram: boolean
  content: string
  author: string
  name: string
  chars: string
  response_ms: number
  idle_ms: number
  retry_ms: number
  unread_count: number
  channel_name: string
  channel_is_nsfw: boolean
  server_name: string
}

const props = defineProps<{
  modelValue: ContextValues
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ContextValues]
}>()

const collapsed = ref(false)

function update(field: keyof ContextValues, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}
</script>

<template>
  <div class="context-editor">
    <div class="context-editor-header" @click="collapsed = !collapsed">
      <span>Context Variables</span>
      <span class="context-editor-toggle">{{ collapsed ? '+ expand' : '- collapse' }}</span>
    </div>
    <div v-show="!collapsed" class="context-editor-body">
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.mentioned"
          @change="update('mentioned', ($event.target as HTMLInputElement).checked)"
        />
        <label>mentioned</label>
      </div>
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.replied"
          @change="update('replied', ($event.target as HTMLInputElement).checked)"
        />
        <label>replied</label>
      </div>
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.is_forward"
          @change="update('is_forward', ($event.target as HTMLInputElement).checked)"
        />
        <label>is_forward</label>
      </div>
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.is_self"
          @change="update('is_self', ($event.target as HTMLInputElement).checked)"
        />
        <label>is_self</label>
      </div>
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.is_hologram"
          @change="update('is_hologram', ($event.target as HTMLInputElement).checked)"
        />
        <label>is_hologram</label>
      </div>
      <div class="context-field">
        <label>content</label>
        <input
          type="text"
          :value="modelValue.content"
          @input="update('content', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="context-field">
        <label>author</label>
        <input
          type="text"
          :value="modelValue.author"
          @input="update('author', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="context-field">
        <label>name</label>
        <input
          type="text"
          :value="modelValue.name"
          @input="update('name', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="context-field">
        <label>chars</label>
        <input
          type="text"
          :value="modelValue.chars"
          placeholder="comma-separated"
          @input="update('chars', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="context-field">
        <label>response_ms</label>
        <input
          type="number"
          :value="modelValue.response_ms"
          @input="update('response_ms', parseInt(($event.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="context-field">
        <label>idle_ms</label>
        <input
          type="number"
          :value="modelValue.idle_ms"
          @input="update('idle_ms', parseInt(($event.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="context-field">
        <label>retry_ms</label>
        <input
          type="number"
          :value="modelValue.retry_ms"
          @input="update('retry_ms', parseInt(($event.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="context-field">
        <label>unread_count</label>
        <input
          type="number"
          :value="modelValue.unread_count"
          @input="update('unread_count', parseInt(($event.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="context-field">
        <label>channel.name</label>
        <input
          type="text"
          :value="modelValue.channel_name"
          @input="update('channel_name', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="context-field context-field-toggle">
        <input
          type="checkbox"
          :checked="modelValue.channel_is_nsfw"
          @change="update('channel_is_nsfw', ($event.target as HTMLInputElement).checked)"
        />
        <label>channel.is_nsfw</label>
      </div>
      <div class="context-field">
        <label>server.name</label>
        <input
          type="text"
          :value="modelValue.server_name"
          @input="update('server_name', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
  </div>
</template>
