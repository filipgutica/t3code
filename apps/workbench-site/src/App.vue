<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useActiveSection } from "@filipgutica/ui";
import { sections } from "./sections";
import CommitBranch from "./components/CommitBranch.vue";
import { useTrace } from "./composables/useTrace";
import SiteNavigation from "./components/SiteNavigation.vue";
import { UiSiteHeader } from "@filipgutica/ui/site";
import ProductImage from "./components/ProductImage.vue";
import ScreenshotWalkthrough from "./components/ScreenshotWalkthrough.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
import type { ProductImageDescriptor, WalkthroughStep } from "./images";

const { images, walkthrough, base, repository, guide, downloads } = defineProps<{
  images: {
    board: ProductImageDescriptor;
    workspace: ProductImageDescriptor;
    boardChat: ProductImageDescriptor;
    pullRequest: ProductImageDescriptor;
  };
  walkthrough: readonly WalkthroughStep[];
  base: string;
  repository: string;
  guide: string;
  downloads: string;
}>();
const main = useTemplateRef<HTMLElement>("main");
const activeId = useActiveSection({ targetIds: sections.map((section) => section.id) });
useTrace({ main, activeId });
const selected = ref(walkthrough[0]?.id ?? "ticket");
const enhanced = ref(false);
const viewer = ref(false);
const viewedImage = ref<ProductImageDescriptor>();
let opener: HTMLElement | undefined;
let firstFrame = 0;
let secondFrame = 0;
const openImage = (image: ProductImageDescriptor, trigger: HTMLElement) => {
  viewedImage.value = image;
  opener = trigger;
  viewer.value = true;
};
const restoreImageFocus = (event: Event) => {
  event.preventDefault();
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  viewedImage.value = undefined;
};
const alignHash = async (initial = false) => {
  const id = location.hash.slice(1);
  const step = walkthrough.find((item) => `walkthrough-${item.id}` === id);
  const changed = step && selected.value !== step.id;
  if (step) selected.value = step.id;
  await nextTick();
  cancelAnimationFrame(firstFrame);
  cancelAnimationFrame(secondFrame);
  if (!initial && !changed) return;
  firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
    });
  });
};
const hashChange = () => {
  void alignHash();
};
onMounted(() => {
  enhanced.value = true;
  void alignHash(true);
  window.addEventListener("hashchange", hashChange);
  window.addEventListener("pageshow", hashChange);
});
onUnmounted(() => {
  window.removeEventListener("hashchange", hashChange);
  window.removeEventListener("pageshow", hashChange);
  cancelAnimationFrame(firstFrame);
  cancelAnimationFrame(secondFrame);
});
</script>
<template>
  <div :data-enhanced="enhanced">
    <a class="skip-link" href="#main">Skip to content</a>
    <UiSiteHeader
      project="workbench"
      :links="[
        { label: 'Guide', href: guide },
        { label: 'GitHub', href: repository },
        { label: 'Downloads', href: downloads },
      ]"
    />
    <SiteNavigation :sections="sections" :active-id="activeId" />
    <main id="main" ref="main" class="frame">
      <section class="hero" aria-labelledby="hero-heading" data-trace-section>
        <CommitBranch lane="fork" />
        <div class="section-head">
          <h1 id="hero-heading">Your work, across repositories.</h1>
          <div class="section-lede">
            <p class="lead">
              Tickets, isolated worktrees, native T3 Threads, and pull requests in one place.
            </p>
            <p class="provenance">
              An independent fork of <a href="https://t3.codes">T3 Code</a>, regularly synced
              upstream.
            </p>
            <div class="actions">
              <a class="button" :href="downloads">Download Workbench</a>
              <a class="text-link" :href="guide">Read the guide</a>
            </div>
          </div>
        </div>
        <figure class="hero-media">
          <ProductImage :image="images.board" @open="openImage" />
          <figcaption>Demo workspace across two repositories.</figcaption>
        </figure>
      </section>

      <section class="section" aria-labelledby="walkthrough-heading" data-trace-section>
        <CommitBranch lane="parallel" />
        <div class="section-head">
          <h2 id="walkthrough-heading">From idea to review</h2>
          <div class="section-lede">
            <p>
              Follow one Ticket from a planning conversation to its prepared worktrees and Threads,
              then a second Ticket's pull request and attention list.
            </p>
            <p class="note">Demo screenshots. PR feedback and outcomes are illustrative.</p>
          </div>
        </div>
        <ScreenshotWalkthrough v-model:selected="selected" :steps="walkthrough" @open="openImage" />
      </section>

      <section class="section" aria-labelledby="chat-heading" data-trace-section>
        <CommitBranch lane="parallel" />
        <div class="section-head">
          <h2 id="chat-heading">Chat with Ticket Threads from the Board</h2>
          <div class="section-lede">
            <p>
              The Board's chat lists the Threads of the Workspace's Tickets and drafts. Start a
              ticket draft there, plan it, and create the Ticket without leaving the Board.
            </p>
            <p>
              When other Threads wait for your approval or input, or their run failed, the chat
              shows how many. Select the count to open the menu on the first of them.
            </p>
            <a class="text-link" :href="`${guide}#chat-with-threads`">Chat guide</a>
          </div>
        </div>
        <figure class="media">
          <ProductImage :image="images.boardChat" @open="openImage" />
        </figure>
      </section>

      <section class="section" aria-labelledby="scope-heading" data-trace-section>
        <CommitBranch lane="merge" />
        <div class="section-head">
          <h2 id="scope-heading">One Ticket. Isolated worktrees.</h2>
          <div class="section-lede">
            <p>
              Plan the work in a conversation, then prepare a worktree per repository and continue
              the same native Thread.
            </p>
            <p>
              Preparing worktrees or creating a Thread does not start an agent. Send a message when
              ready.
            </p>
            <a class="text-link" :href="`${guide}#start-agent-work`">Work area guide</a>
          </div>
        </div>
        <figure class="media">
          <ProductImage :image="images.workspace" @open="openImage" />
        </figure>
      </section>

      <section class="section" aria-labelledby="review-heading" data-trace-section>
        <CommitBranch lane="main" />
        <div class="section-head">
          <h2 id="review-heading">Review linked pull requests</h2>
          <div class="section-lede">
            <p>Check PR status and review feedback without leaving the Ticket.</p>
          </div>
        </div>
        <figure class="media">
          <ProductImage :image="images.pullRequest" @open="openImage" />
          <figcaption>Illustrative PR feedback in the native review panel.</figcaption>
        </figure>
      </section>

      <section class="section closing" aria-labelledby="closing-heading" data-trace-section>
        <CommitBranch lane="main" terminal />
        <div class="section-head">
          <h2 id="closing-heading">Install Workbench alongside T3 Code</h2>
          <div class="section-lede">
            <p>Workbench stores its data separately from the official app.</p>
            <div class="actions">
              <a class="button button--secondary" :href="downloads">Download Workbench</a>
              <a class="text-link" :href="guide">Read the guide</a>
            </div>
            <p class="note">
              macOS builds are signed and notarized. Windows and Linux builds are unsigned.
            </p>
          </div>
        </div>
      </section>
    </main>
    <footer class="site-footer">
      <div class="frame">
        <a class="brand" :href="base">T3 Code <span>Workbench</span></a>
        <p>Built on <a href="https://github.com/pingdotgg/t3code">T3 Code</a>.</p>
        <a :href="repository">Browse the source</a>
      </div>
    </footer>
    <ImageLightbox
      v-model:open="viewer"
      :image="viewedImage"
      @close-auto-focus="restoreImageFocus"
    />
  </div>
</template>
