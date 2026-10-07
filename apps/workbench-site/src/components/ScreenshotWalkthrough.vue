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
        >
          <div class="walkthrough-heading">
            <h3>{{ step.title }}</h3>
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
