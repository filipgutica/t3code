<script setup lang="ts">
import type { sections as pageSections } from "../sections";
defineProps<{ sections: typeof pageSections; activeId?: string }>();
</script>

<template>
  <div class="section-navigation">
    <nav class="section-nav frame" aria-label="On this page">
      <a
        v-for="section in sections"
        :key="section.id"
        :href="`#${section.id}`"
        :aria-current="activeId === section.id ? 'location' : undefined"
        >{{ section.label }}</a
      >
    </nav>
  </div>
</template>
