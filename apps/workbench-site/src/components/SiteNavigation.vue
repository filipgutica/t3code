<script setup lang="ts">
import { useActiveSection } from "@filipgutica/ui";
const sections = [
  { id: "hero-heading", label: "Overview" },
  { id: "walkthrough-heading", label: "Walkthrough" },
  { id: "scope-heading", label: "Workspaces" },
  { id: "review-heading", label: "Review" },
  { id: "jira-heading", label: "Jira" },
] as const;
const activeId = useActiveSection({ targetIds: sections.map((section) => section.id) });
</script>

<template>
  <div class="section-navigation">
    <nav class="section-nav wrap" aria-label="On this page">
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
