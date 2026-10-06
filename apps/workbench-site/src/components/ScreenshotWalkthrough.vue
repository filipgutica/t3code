<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, useTemplateRef, watch } from "vue";
import { UiTabs } from "@filipgutica/ui";
import ProductImage from "./ProductImage.vue";
import type { ProductImageDescriptor, WalkthroughStep } from "../images";
const { steps } = defineProps<{ steps: readonly WalkthroughStep[] }>();
const selected = defineModel<string>("selected", { required: true });
const emit = defineEmits<{
  (event: "open", image: ProductImageDescriptor, trigger: HTMLElement): void;
}>();
const walkthrough = useTemplateRef<HTMLElement>("walkthrough");
const items = steps.map((step) => ({ value: step.id, label: step.tab }));
let reduced: MediaQueryList | undefined;
let ready = false;
const stopMotion = () => {
  walkthrough.value?.querySelectorAll<HTMLElement>("[data-walkthrough-frame]").forEach((frame) => {
    frame.classList.remove("is-switching");
    frame
      .querySelector("[data-product-image]")
      ?.getAnimations()
      .forEach((animation) => animation.cancel());
  });
};
watch(
  selected,
  async (value, previous) => {
    await nextTick();
    if (!ready) return;
    stopMotion();
    if (reduced?.matches) return;
    const frame = walkthrough.value?.querySelector<HTMLElement>(`#walkthrough-${value}`);
    if (!frame) return;
    frame.classList.add("is-switching");
    const direction =
      steps.findIndex((step) => step.id === value) > steps.findIndex((step) => step.id === previous)
        ? 1
        : -1;
    const tokens = getComputedStyle(frame);
    const durationToken = tokens.getPropertyValue("--duration-walkthrough").trim();
    const duration = parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
    frame.querySelector("[data-product-image]")?.animate(
      [
        {
          opacity: 0.6,
          transform: `translateX(${direction * parseFloat(tokens.getPropertyValue("--space-3")) * parseFloat(getComputedStyle(document.documentElement).fontSize)}px)`,
        },
        { opacity: 1, transform: "none" },
      ],
      { duration, easing: tokens.getPropertyValue("--ease-out").trim() },
    );
  },
  { flush: "post" },
);
onMounted(() => {
  reduced = matchMedia("(prefers-reduced-motion: reduce)");
  reduced.addEventListener("change", stopMotion);
  ready = true;
});
onBeforeUnmount(() => {
  reduced?.removeEventListener("change", stopMotion);
  stopMotion();
});
</script>
<template>
  <div ref="walkthrough" class="screenshot-walkthrough" data-screenshot-walkthrough>
    <UiTabs v-model="selected" :items="items" label="Ticket workflow screenshots">
      <template #panel="{ value }">
        <figure
          v-for="step in steps.filter((item) => item.id === value)"
          :key="step.id"
          class="walkthrough-frame"
          :style="{ maxWidth: `${step.image.width / 2}px` }"
          :id="`walkthrough-${step.id}`"
          data-walkthrough-frame
          :data-tab="step.tab"
          :data-motion="
            step.id === 'workspace'
              ? 'fork'
              : step.id === 'pull-request'
                ? 'merge'
                : step.id === 'notifications'
                  ? 'notify'
                  : 'handoff'
          "
        >
          <div class="walkthrough-heading">
            <h3>{{ step.title }}</h3>
            <svg
              class="walkthrough-signal"
              viewBox="0 0 96 32"
              aria-hidden="true"
              focusable="false"
            >
              <path
                :d="
                  step.id === 'workspace'
                    ? 'M8 16 H24 C36 16 36 8 48 8 H88 M24 16 C36 16 36 24 48 24 H88'
                    : step.id === 'pull-request'
                      ? 'M8 8 H24 C36 8 36 16 48 16 H88 M8 24 H24 C36 24 36 16 48 16'
                      : 'M8 16 H88'
                "
              />
              <circle class="signal-start" cx="8" :cy="step.id === 'pull-request' ? 8 : 16" r="3" />
              <circle class="signal-end" cx="88" :cy="step.id === 'workspace' ? 8 : 16" r="3" />
              <circle v-if="step.id === 'workspace'" cx="88" cy="24" r="3" />
              <circle v-if="step.id === 'pull-request'" cx="8" cy="24" r="3" />
              <circle class="signal-packet signal-packet--first" cx="0" cy="0" r="3" />
              <circle class="signal-packet signal-packet--second" cx="0" cy="0" r="3" />
              <circle class="signal-ring" cx="88" cy="16" r="5" />
            </svg>
          </div>
          <ProductImage
            :image="step.image"
            @open="(image, trigger) => emit('open', image, trigger)"
          />
          <figcaption>{{ step.caption }}</figcaption>
        </figure>
      </template>
    </UiTabs>
  </div>
</template>
