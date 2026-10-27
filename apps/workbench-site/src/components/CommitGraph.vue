<script setup lang="ts">
// One section's slice of the page's commit graph. Lane 0 is main; lanes 1 and 2 are the
// per-repository branches between the fork (worktrees) and the merge (review).
type Kind = "root" | "commit" | "fork" | "branch" | "merge" | "end";
type Span = "above" | "below" | "full" | "after-fork" | "before-merge";
type Segment = { lane: 0 | 1 | 2; span: Span; idle?: boolean };

const { kind } = defineProps<{ kind: Kind }>();
const layouts: Record<Kind, Segment[]> = {
  root: [{ lane: 0, span: "below" }],
  commit: [
    { lane: 0, span: "above" },
    { lane: 0, span: "below" },
  ],
  fork: [
    { lane: 0, span: "full", idle: true },
    { lane: 1, span: "after-fork" },
    { lane: 2, span: "after-fork" },
    { lane: 1, span: "below" },
    { lane: 2, span: "below" },
  ],
  branch: [
    { lane: 0, span: "full", idle: true },
    { lane: 1, span: "above" },
    { lane: 2, span: "above" },
    { lane: 1, span: "below" },
    { lane: 2, span: "below" },
  ],
  merge: [
    { lane: 0, span: "above", idle: true },
    { lane: 1, span: "before-merge" },
    { lane: 2, span: "before-merge" },
    { lane: 0, span: "below" },
  ],
  end: [{ lane: 0, span: "above" }],
};
const curves = {
  fork: ["M16 0 C16 40 52 24 52 64", "M16 0 C16 40 88 24 88 64"],
  merge: ["M52 0 C52 40 16 24 16 64", "M88 0 C88 40 16 24 16 64"],
};
const segments = layouts[kind];
const curve = kind === "fork" || kind === "merge" ? curves[kind] : undefined;
const onBranches = kind === "fork" || kind === "branch";
</script>
<template>
  <div :class="['commit-graph', `commit-graph--${kind}`]" aria-hidden="true">
    <span
      v-for="segment in segments"
      :key="`${segment.lane}-${segment.span}`"
      :class="[
        'graph-segment',
        `graph-lane-${segment.lane}`,
        `graph-segment--${segment.span}`,
        { 'graph-segment--idle': segment.idle },
      ]"
      ><i
    /></span>
    <svg v-if="curve" :class="['graph-curve', `graph-curve--${kind}`]" viewBox="0 0 120 64">
      <path v-for="d in curve" :key="`track-${d}`" class="graph-curve-track" :d="d" />
      <path v-for="d in curve" :key="`fill-${d}`" class="graph-curve-fill" pathLength="1" :d="d" />
    </svg>
    <template v-if="onBranches">
      <span class="graph-node graph-lane-1"><i /></span>
      <span class="graph-node graph-lane-2"><i /></span>
      <span class="graph-node graph-lane-0 graph-node--single-lane"><i /></span>
    </template>
    <span v-else :class="['graph-node', 'graph-lane-0', { 'graph-node--merged': kind === 'end' }]"
      ><i
        ><svg v-if="kind === 'end'" viewBox="0 0 16 16"><path d="M4 8.5 7 11.5 12 5" /></svg></i
    ></span>
  </div>
</template>
