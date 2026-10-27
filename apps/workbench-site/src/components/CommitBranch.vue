<script setup lang="ts">
type Lane = "main" | "fork" | "parallel" | "merge";

interface Props {
  lane: Lane;
  terminal?: boolean;
}

const { lane, terminal = false } = defineProps<Props>();
// The rail sits left of the content: the main lane is at x=16, the branch lane at x=48,
// and each node reaches right to the content edge at x=64.
const paths: Record<Lane, string> = {
  main: "M16 48 H64",
  fork: "M16 0 V12 C16 34 48 22 48 48 H64",
  parallel: "M48 48 H64",
  merge: "M48 48 H64 M48 48 C48 74 16 62 16 96",
};
const nodeX = lane === "main" ? 16 : 48;
</script>
<template>
  <div :class="`commit-branch commit-branch--${lane}`" aria-hidden="true">
    <svg class="commit-junction" viewBox="0 0 64 96" focusable="false">
      <path :d="paths[lane]" />
      <rect class="commit-reach" :x="nodeX" y="47.25" :width="64 - nodeX" height="1.5" />
      <circle class="commit-node" :cx="nodeX" cy="48" r="5" />
      <circle v-if="lane === 'parallel'" class="commit-neutral-node" cx="16" cy="48" r="3" />
    </svg>
    <svg v-if="terminal" class="commit-terminal" viewBox="0 0 64 16" focusable="false">
      <circle cx="16" cy="8" r="4" />
    </svg>
  </div>
</template>
