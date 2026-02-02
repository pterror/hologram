<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ text: string }>()
const copied = ref(false)
let timeout: ReturnType<typeof setTimeout> | null = null

function copy() {
  navigator.clipboard.writeText(props.text).then(() => {
    copied.value = true
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => { copied.value = false }, 1500)
  })
}
</script>

<template>
  <button
    class="copy-btn"
    :class="{ 'copy-btn-copied': copied }"
    @click="copy"
  >
    {{ copied ? 'Copied!' : 'Copy' }}
  </button>
</template>
