<script setup lang="ts">
import { computed, ref } from "vue";
import { UiButton, UiDrawer } from "@filipgutica/ui";
import type { sections as pageSections } from "../sections";

const { sections, activeId } = defineProps<{
  sections: typeof pageSections;
  activeId?: string;
  enhanced: boolean;
}>();
const open = ref(false);
const list = ref<HTMLElement>();
const label = computed(() => {
  const current = sections.find((section) => section.id === activeId)?.label;
  return current ? `On this page: ${current}` : "On this page";
});
let openedByKeyboard = false;
let destination: HTMLElement | null = null;
// A keyboard click has no pointer presses, so its detail is 0.
const noteOpener = (event: MouseEvent) => {
  openedByKeyboard = event.detail === 0;
};

// A keyboard open focuses the current row; a tap focuses the drawer, so no ring shows.
const focusCurrentRow = (event: Event) => {
  event.preventDefault();
  const row =
    list.value?.querySelector<HTMLElement>("[aria-current]") ?? list.value?.querySelector("a");
  const body = list.value?.parentElement;
  if (row && body) {
    const offset = row.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += offset - (body.clientHeight - row.offsetHeight) / 2;
  }
  const target = openedByKeyboard ? row : list.value?.closest<HTMLElement>(".fg-drawer__content");
  target?.focus({ preventScroll: true });
};
const follow = (id: string, event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  destination = document.getElementById(id);
  open.value = false;
};
const focusDestination = (event: Event) => {
  if (!destination) return;
  event.preventDefault();
  destination.tabIndex = -1;
  destination.focus({ preventScroll: true });
  destination = null;
};
</script>

<template>
  <div class="section-navigation">
    <div class="frame">
      <UiDrawer
        v-if="enhanced"
        v-model:open="open"
        title="On this page"
        @open-auto-focus="focusCurrentRow"
        @close-auto-focus="focusDestination"
      >
        <template #trigger>
          <UiButton class="contents-trigger" variant="secondary" size="lg" @click="noteOpener">{{
            label
          }}</UiButton>
        </template>
        <nav ref="list" class="fg-site-nav contents-list" aria-label="On this page">
          <a
            v-for="section in sections"
            :key="section.id"
            :href="`#${section.id}`"
            :aria-current="activeId === section.id ? 'location' : undefined"
            @click="follow(section.id, $event)"
            >{{ section.label }}</a
          >
        </nav>
      </UiDrawer>
      <details v-else class="contents-menu">
        <summary class="fg-button contents-summary" data-variant="secondary" data-size="lg">
          On this page
        </summary>
        <nav class="fg-site-nav contents-list" aria-label="On this page">
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{
            section.label
          }}</a>
        </nav>
      </details>
    </div>
  </div>
</template>
