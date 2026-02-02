<script setup lang="ts">
import { computed } from 'vue'
import CopyButton from './CopyButton.vue'

const props = defineProps<{
  messages: Array<{ role: string; content: string }>
}>()

const copyText = computed(() =>
  props.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n')
)
</script>

<template>
  <div class="playground-output">
    <div class="playground-output-header">
      <span>Output</span>
      <CopyButton v-if="messages.length > 0" :text="copyText" />
    </div>
    <div class="playground-output-body">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="output-message"
        :class="`output-message-${msg.role}`"
      >
        <span class="role-badge" :class="`role-badge-${msg.role}`">
          {{ msg.role }}
        </span>
        {{ msg.content }}
      </div>
    </div>
  </div>
</template>
