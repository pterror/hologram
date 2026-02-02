---
title: Fact Evaluation Playground
---

# Fact Evaluation Playground

Write entity facts and see how they evaluate in real time. Conditional facts (`$if`) are evaluated against the context variables below, and directives (`$respond`, `$stream`, `$model`, etc.) are extracted separately.

See the [Directives Reference](/reference/directives) and [Triggers Reference](/reference/triggers) for full documentation.

<script setup>
import { defineClientComponent } from 'vitepress'

const FactPlayground = defineClientComponent(() =>
  import('../.vitepress/playground/components/FactPlayground.vue')
)
</script>

<FactPlayground />
