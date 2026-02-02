---
title: Template Rendering Playground
---

# Template Rendering Playground

Write Nunjucks templates and see the rendered output with role annotations. The template engine runs in the browser with the same security patches and filters as the real bot.

See the [Custom Templates Reference](/reference/templates) for full documentation.

<script setup>
import { defineClientComponent } from 'vitepress'

const TemplatePlayground = defineClientComponent(() =>
  import('../.vitepress/playground/components/TemplatePlayground.vue')
)
</script>

<TemplatePlayground />
