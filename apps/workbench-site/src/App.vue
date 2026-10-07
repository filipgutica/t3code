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
                    Tickets, isolated worktrees, native T3 Threads, and pull requests together
                    across the repositories you work in.
                  </p>
                  <p class="provenance">
                    An independent fork, regularly synced with upstream
                    <a href="https://t3.codes">T3 Code</a>.
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
                <figcaption>
                  A demo Orbit Workspace, with Tickets spanning Orbit Web and Orbit API.
                </figcaption>
              </figure>
            </div>
          </section>

          <section class="section walkthrough-section" aria-labelledby="walkthrough-heading">
            <div class="section-body">
              <div class="review-heading">
                <h2 id="walkthrough-heading">From Ticket to review</h2>
                <p>
                  Explore Tickets, prepared workspaces, native Threads, pull requests, and
                  notifications. Jira is optional.
                </p>
                <p class="walkthrough-note">
                  Open screenshots to view them at full size. Captured in the Workbench demo; PR
                  feedback and outcomes are illustrative.
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
                <h2 id="scope-heading">Give every Ticket its own workspace</h2>
                <p>
                  Prepare one isolated Git worktree per repository. Then open a native T3 Thread
                  with the Ticket’s context and repository paths attached.
                </p>
              </div>
              <figure
                class="media-stage"
                :style="{
                  maxWidth: `${(images.workspace.crop?.width ?? images.workspace.width) / 2}px`,
                }"
              >
                <ProductImage :image="images.workspace" @open="openImage" />
                <figcaption>
                  One Ticket, with worktrees across all the repositories it touches.
                </figcaption>
              </figure>
              <div class="workspace-details">
                <div>
                  <h3>Prepare first, start when ready</h3>
                  <p>
                    Creating a Thread prepares the conversation. Send your first message to start an
                    agent turn.
                  </p>
                </div>
                <div>
                  <h3>Keep the work connected</h3>
                  <p>
                    The Ticket keeps its repository scope, prepared worktrees, and linked Threads
                    together.
                  </p>
                </div>
              </div>
              <a class="text-link" :href="`${guide}#start-agent-work`"
                >See how a Ticket becomes a Thread <span aria-hidden="true">↗</span></a
              >
            </div>
          </section>

          <section class="section review-section" aria-labelledby="review-heading">
            <div class="section-body">
              <div class="review-heading">
                <h2 id="review-heading">Review linked pull requests</h2>
                <p>
                  Open linked pull requests across repositories. Inspect checks and review feedback
                  without leaving the Ticket.
                </p>
              </div>
              <figure class="media-stage">
                <ProductImage :image="images.pullRequest" @open="openImage" />
                <figcaption>
                  The native pull request panel opens over the Ticket. Demo PR feedback and outcomes
                  are illustrative.
                </figcaption>
              </figure>
            </div>
          </section>

          <section class="section jira-section" aria-labelledby="jira-heading">
            <div class="section-body">
              <div class="section-copy">
                <h2 id="jira-heading">Connect Jira when you need it</h2>
                <p>
                  Bring your assigned sprint issues into Workbench and update their descriptions and
                  statuses. Local Tickets use the same workflow without a Jira account.
                </p>
                <a class="text-link" :href="`${guide}#connect-jira`"
                  >Explore the Jira workflow <span aria-hidden="true">↗</span></a
                >
              </div>
              <figure v-if="jiraImage" class="media-stage">
                <ProductImage :image="jiraImage" @open="openImage" />
                <figcaption>
                  Assigned Jira issues, alongside the same local Ticket workflow.
                </figcaption>
              </figure>
            </div>
          </section>

          <section class="closing section" aria-labelledby="closing-heading">
            <div class="section-body">
              <h2 id="closing-heading">Install Workbench alongside T3 Code</h2>
              <p>
                Workbench keeps its saved data separate from the official app. Choose a build from
                the releases page.
              </p>
              <div class="actions">
                <a class="button button--secondary" :href="downloads">Download Workbench</a>
                <a class="text-link" :href="guide"
                  >Read the guide <span aria-hidden="true">↗</span></a
                >
              </div>
              <p class="release-note">
                macOS builds are signed and notarized. Windows and Linux builds are unsigned. See
                the release notes for downloads and update details.
              </p>
            </div>
          </section>
        </main>
        <footer class="site-footer wrap">
          <a class="brand" :href="base">T3 Code <span>Workbench</span></a>
          <p>
            Built on <a href="https://github.com/pingdotgg/t3code">T3 Code</a>. An independent,
            open-source fork.
          </p>
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
