<script setup lang="ts">
const props = defineProps<{
  presets: Array<{ name: string }>
  modelValue: number
}>()

const emit = defineEmits<{
  'update:modelValue': [index: number]
}>()

function onChange(event: Event) {
  const idx = parseInt((event.target as HTMLSelectElement).value, 10)
  emit('update:modelValue', idx)
}
</script>

<template>
  <div class="playground-presets">
    <label>Preset:</label>
    <select :value="modelValue" @change="onChange">
      <option
        v-for="(preset, i) in presets"
        :key="i"
        :value="i"
      >
        {{ preset.name }}
      </option>
    </select>
  </div>
</template>
