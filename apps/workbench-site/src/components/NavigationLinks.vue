<script setup lang="ts">
import { UiButton } from "@filipgutica/ui";
import { onMounted, ref } from "vue";
import { useTheme } from "../composables/useTheme";
const enhanced = ref(false);
const { choice: theme, choose } = useTheme();
onMounted(() => {
  enhanced.value = true;
});
</script>

<template>
  <div class="footer-navigation">
    <nav class="family" aria-labelledby="project-nav-label">
      <h2 class="nav-label" id="project-nav-label">Projects</h2>
      <a href="https://filipgutica.github.io/annoterm/">annoterm</a>
      <a href="https://filipgutica.github.io/wtree/">wtree</a>
      <a href="https://filipgutica.github.io/devps/">devps</a>
      <a href="/t3code/" aria-current="page">workbench</a>
      <a href="https://filipgutica.github.io/ui/">Vue UI</a>
    </nav>
    <div v-if="enhanced" class="appearance">
      <span class="appearance-label">Appearance</span>
      <div class="theme-switch" role="group" aria-label="Color theme">
        <UiButton
          v-for="value in ['system', 'light', 'dark'] as const"
          :key="value"
          variant="ghost"
          size="lg"
          class="theme-choice"
          :data-theme-choice="value"
          :aria-label="`${value[0].toUpperCase() + value.slice(1)} theme`"
          :title="`${value[0].toUpperCase() + value.slice(1)} theme`"
          :aria-pressed="theme === value"
          @click="choose(value)"
        >
          <svg
            v-if="value === 'system'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8m-4-4v4" />
          </svg>
          <svg
            v-else-if="value === 'light'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <path d="M20.5 13.5A9 9 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z" />
          </svg>
        </UiButton>
      </div>
      <span class="theme-choice-label">{{ theme[0].toUpperCase() + theme.slice(1) }}</span>
    </div>
  </div>
</template>
