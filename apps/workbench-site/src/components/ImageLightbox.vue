<script setup lang="ts">
import { computed } from "vue";
import { UiImageViewer } from "@filipgutica/ui";
import { useSiteAppearance } from "@filipgutica/ui/site";
import type { ProductImageDescriptor } from "../images";
const open = defineModel<boolean>("open", { required: true });
const { image } = defineProps<{ image?: ProductImageDescriptor }>();
const { appearance } = useSiteAppearance({ applyToRoot: false });
const source = computed(() => (appearance.value === "light" ? image?.light : image));
const emit = defineEmits<{ (event: "close-auto-focus", value: Event): void }>();
</script>
<template>
  <!-- The screenshots are 2x captures, so full size is half their pixel size. -->
  <UiImageViewer
    v-if="image && source"
    v-model:open="open"
    :title="image.title"
    :src="source.original"
    :alt="image.alt"
    :width="image.width / 2"
    :height="image.height / 2"
    @close-auto-focus="emit('close-auto-focus', $event)"
  />
</template>
