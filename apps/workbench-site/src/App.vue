<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import SiteNavigation from "./components/SiteNavigation.vue";
import NavigationLinks from "./components/NavigationLinks.vue";
import ProductImage from "./components/ProductImage.vue";
import ScreenshotWalkthrough from "./components/ScreenshotWalkthrough.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
import type { ProductImageDescriptor, WalkthroughStep } from "./images";

const { images, walkthrough, base, repository, guide, downloads } = defineProps<{
  images: {
    board: ProductImageDescriptor;
    workspace: ProductImageDescriptor;
    pullRequest: ProductImageDescriptor;
  };
  walkthrough: readonly WalkthroughStep[];
  base: string;
  repository: string;
  guide: string;
  downloads: string;
}>();
const jiraImage = walkthrough.find((step) => step.id === "jira")?.image;
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
    <div class="site-layout">
      <div class="site-content">
        <header class="site-header wrap">
          <a class="brand" :href="base" aria-label="T3 Code Workbench home"
            >T3 Code <span>Workbench</span></a
          >
          <nav aria-label="Main navigation">
            <a :href="guide">Guide</a>
            <a :href="repository">GitHub</a>
            <a :href="downloads">Downloads</a>
          </nav>
        </header>
        <SiteNavigation />
        <main id="main" class="wrap">
          <section class="hero" aria-labelledby="hero-heading">
            <div class="section-body">
              <div class="hero-copy">
                <div class="hero-summary">
                  <h1 id="hero-heading">Your work, across repositories.</h1>
                  <p class="lead">
                    Tickets, isolated worktrees, native T3 Threads, and pull requests in one place.
                  </p>
                  <p class="provenance">
                    An independent fork of <a href="https://t3.codes">T3 Code</a>, regularly synced
                    upstream.
                  </p>
                </div>
                <div class="actions">
                  <a class="button" :href="downloads">Download Workbench</a>
                  <a class="text-link" :href="guide"
                    >Read the guide <span aria-hidden="true">↗</span></a
                  >
                </div>
              </div>
              <figure class="hero-media">
                <ProductImage :image="images.board" @open="openImage" />
                <figcaption>Demo workspace across two repositories.</figcaption>
              </figure>
            </div>
          </section>

          <section class="section walkthrough-section" aria-labelledby="walkthrough-heading">
            <div class="section-body">
              <div class="review-heading">
                <h2 id="walkthrough-heading">From Ticket to review</h2>
                <p class="walkthrough-note">
                  Demo screenshots. PR feedback and outcomes are illustrative.
                </p>
              </div>
              <ScreenshotWalkthrough
                v-model:selected="selected"
                :steps="walkthrough"
                @open="openImage"
              />
            </div>
          </section>

          <section class="section workspace-section" aria-labelledby="scope-heading">
            <div class="section-body">
              <div class="section-copy">
                <h2 id="scope-heading">One Ticket. Isolated worktrees.</h2>
                <p>
                  Prepare a worktree per repository, then open a native Thread with the Ticket’s
                  context.
                </p>
              </div>
              <figure
                class="media-stage"
                :style="{
                  maxWidth: `${(images.workspace.crop?.width ?? images.workspace.width) / 2}px`,
                }"
              >
                <ProductImage :image="images.workspace" @open="openImage" />
              </figure>
              <div class="section-copy">
                <p>
                  Preparing worktrees or creating a Thread does not start an agent. Send a message
                  when ready.
                </p>
              </div>
              <a class="text-link" :href="`${guide}#start-agent-work`"
                >Workspace guide <span aria-hidden="true">↗</span></a
              >
            </div>
          </section>

          <section class="section review-section" aria-labelledby="review-heading">
            <div class="section-body">
              <div class="review-heading">
                <h2 id="review-heading">Review linked pull requests</h2>
                <p>Check PR status and review feedback without leaving the Ticket.</p>
              </div>
              <figure class="media-stage">
                <ProductImage :image="images.pullRequest" @open="openImage" />
                <figcaption>Illustrative PR feedback in the native review panel.</figcaption>
              </figure>
            </div>
          </section>

          <section class="section jira-section" aria-labelledby="jira-heading">
            <div class="section-body">
              <div class="section-copy">
                <h2 id="jira-heading">Jira, optional.</h2>
                <p>
                  Sync assigned sprint issues and update descriptions and statuses. Local Tickets
                  need no Jira account.
                </p>
                <a class="text-link" :href="`${guide}#connect-jira`"
                  >Jira guide <span aria-hidden="true">↗</span></a
                >
              </div>
              <figure v-if="jiraImage" class="media-stage">
                <ProductImage :image="jiraImage" @open="openImage" />
              </figure>
            </div>
          </section>

          <section class="closing section" aria-labelledby="closing-heading">
            <div class="section-body">
              <h2 id="closing-heading">Install Workbench alongside T3 Code</h2>
              <p>Workbench stores its data separately from the official app.</p>
              <div class="actions">
                <a class="button button--secondary" :href="downloads">Download Workbench</a>
                <a class="text-link" :href="guide"
                  >Read the guide <span aria-hidden="true">↗</span></a
                >
              </div>
              <p class="release-note">
                macOS builds are signed and notarized. Windows and Linux builds are unsigned.
              </p>
            </div>
          </section>
        </main>
        <footer class="site-footer wrap">
          <a class="brand" :href="base">T3 Code <span>Workbench</span></a>
          <p>Built on <a href="https://github.com/pingdotgg/t3code">T3 Code</a>.</p>
          <a :href="repository">Browse the source <span aria-hidden="true">↗</span></a>
          <NavigationLinks />
        </footer>
      </div>
    </div>
    <ImageLightbox
      v-model:open="viewer"
      :image="viewedImage"
      @close-auto-focus="restoreImageFocus"
    />
  </div>
</template>
