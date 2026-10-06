<script setup lang="ts">
import { computed } from "vue";
import type { ProductImageDescriptor } from "../images";
const { image } = defineProps<{ image: ProductImageDescriptor }>();
const emit = defineEmits<{
  (event: "open", image: ProductImageDescriptor, trigger: HTMLElement): void;
}>();
const cropStyle = computed(() =>
  image.crop
    ? {
        aspectRatio: `${image.crop.width}/${image.crop.height}`,
        "--image-width": `${(image.width / image.crop.width) * 100}%`,
        "--image-left": `${(-image.crop.x / image.crop.width) * 100}%`,
        "--image-top": `${(-image.crop.y / image.crop.height) * 100}%`,
      }
    : undefined,
);
const open = (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  if (!(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  emit("open", image, event.currentTarget);
};
</script>
<template>
  <a
    class="product-image"
    :class="{ cropped: image.crop }"
    :style="cropStyle"
    :href="image.original"
    data-product-image
    :data-image-width="image.width"
    aria-haspopup="dialog"
    :aria-label="`${image.alt} — enlarge screenshot`"
    @click="open"
  >
    <img
      :src="image.src"
      :srcset="image.srcset"
      :alt="image.alt"
      :sizes="image.sizes"
      :width="image.width"
      :height="image.height"
      :loading="image.eager ? 'eager' : 'lazy'"
      :fetchpriority="image.eager ? 'high' : 'auto'"
      decoding="async"
    />
  </a>
</template>
<style scoped>
.product-image {
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
.cropped {
  position: relative;
}
.cropped img {
  position: absolute;
  width: var(--image-width);
  max-width: none;
  left: var(--image-left);
  top: var(--image-top);
}
.product-image:hover {
  border-color: var(--border);
}
</style>
