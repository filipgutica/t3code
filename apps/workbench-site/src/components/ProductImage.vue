<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSiteAppearance } from "@filipgutica/ui/site";
import type { ProductImageDescriptor } from "../images";
const { image } = defineProps<{ image: ProductImageDescriptor }>();
const { appearance } = useSiteAppearance({ applyToRoot: false });
const enhanced = ref(false);
onMounted(() => {
  enhanced.value = true;
});
const source = computed(() => (appearance.value === "light" ? image.light : image));
const darkMedia = computed(() =>
  enhanced.value
    ? appearance.value === "dark"
      ? "all"
      : "not all"
    : "(prefers-color-scheme: dark)",
);
const emit = defineEmits<{
  (event: "open", image: ProductImageDescriptor, trigger: HTMLElement): void;
}>();
const open = (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  if (!(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  emit("open", image, event.currentTarget);
};
</script>
<template>
  <div class="product-image" data-product-image-frame :data-image-enhanced="enhanced">
    <picture>
      <source :media="darkMedia" :srcset="image.srcset" :sizes="image.sizes" />
      <img
        :src="image.light.src"
        :srcset="image.light.srcset"
        :alt="image.alt"
        :sizes="image.sizes"
        :width="image.width"
        :height="image.height"
        :loading="image.eager ? 'eager' : 'lazy'"
        :fetchpriority="image.eager ? 'high' : 'auto'"
        decoding="async"
      />
    </picture>
    <a
      class="image-link enhanced-or-light-link"
      :href="source.original"
      data-product-image
      :data-image-width="image.width"
      :aria-haspopup="enhanced ? 'dialog' : undefined"
      :aria-label="`${image.alt} — enlarge screenshot`"
      @click="open"
    />
    <a
      v-if="!enhanced"
      class="image-link static-dark-link"
      :href="image.original"
      data-product-image
      :data-image-width="image.width"
      :aria-label="`${image.alt} — enlarge screenshot`"
    />
  </div>
</template>
<style scoped>
.product-image {
  position: relative;
  display: block;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
img {
  width: 100%;
  height: auto;
  display: block;
}
.image-link {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.image-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -3px;
}
.static-dark-link {
  display: none;
}
@media (prefers-color-scheme: dark) {
  .product-image:not([data-image-enhanced="true"]) .enhanced-or-light-link {
    display: none;
  }
  .static-dark-link {
    display: block;
  }
}
.product-image:hover {
  border-color: var(--border);
}
</style>
