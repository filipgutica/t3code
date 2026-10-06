<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { UiButton, UiDialog } from "@filipgutica/ui";
import type { ProductImageDescriptor } from "../images";
const open = defineModel<boolean>("open", { required: true });
const { image } = defineProps<{ image?: ProductImageDescriptor }>();
const emit = defineEmits<{ (event: "close-auto-focus", value: Event): void }>();
const dpr = ref(1);
const sizeImage = () => {
  dpr.value = window.devicePixelRatio;
};
const width = computed(() => (image ? `${image.width / dpr.value}px` : undefined));
onMounted(() => {
  sizeImage();
  window.addEventListener("resize", sizeImage);
});
onUnmounted(() => window.removeEventListener("resize", sizeImage));
</script>
<template>
  <UiDialog
    v-model:open="open"
    :title="image?.alt ?? 'Product screenshot'"
    class="image-lightbox"
    :style="{ '--lightbox-image-width': width }"
    @close-auto-focus="emit('close-auto-focus', $event)"
  >
    <div class="lightbox-image-region">
      <img
        v-if="image"
        :src="image.original"
        :alt="image.alt"
        :style="{ width }"
        :width="image.width"
        :height="image.height"
      />
    </div>
    <template #footer
      ><UiButton variant="secondary" @click="open = false">Close screenshot</UiButton></template
    >
  </UiDialog>
</template>
