<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useActiveSection } from "@filipgutica/ui";
import { UiSiteHeader } from "@filipgutica/ui/site";
import { sections } from "./sections";
import CommitGraph from "./components/CommitGraph.vue";
import SiteNavigation from "./components/SiteNavigation.vue";
import ProductImage from "./components/ProductImage.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
import type { ProductImageDescriptor } from "./images";

const { images, base, repository, guide, downloads } = defineProps<{
  images: Record<
    | "board"
    | "planning"
    | "boardChat"
    | "ticket"
    | "workspace"
    | "thread"
    | "ticketChat"
    | "pullRequest"
    | "notifications",
    ProductImageDescriptor
  >;
  base: string;
  repository: string;
  guide: string;
  downloads: string;
}>();
const activeId = useActiveSection({ targetIds: sections.map((section) => section.id) });
const enhanced = ref(false);
const viewer = ref(false);
const viewedImage = ref<ProductImageDescriptor>();
let opener: HTMLElement | undefined;
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
onMounted(() => {
  enhanced.value = true;
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
    <main id="main" class="frame">
      <section class="step hero" aria-labelledby="hero-heading">
        <CommitGraph kind="root" />
        <div class="step-body">
          <h1 id="hero-heading">Your work, across repositories.</h1>
          <p class="lead">
            Plan a Ticket in conversation, branch a worktree in each repository it touches, and
            carry the work through native T3 Threads to reviewed pull requests.
          </p>
          <div class="actions">
            <a class="button" :href="downloads">Download Workbench</a>
            <a class="text-link" :href="guide">Read the guide</a>
          </div>
          <p class="provenance">
            An independent fork of <a href="https://t3.codes">T3 Code</a>, regularly synced
            upstream.
          </p>
          <figure class="shot hero-media">
            <ProductImage :image="images.board" @open="openImage" />
            <figcaption>Demo workspace across two repositories.</figcaption>
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="plan-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-split">
          <div class="copy">
            <h2 id="plan-heading">Plan in a conversation</h2>
            <p>
              Describe the work in a native Thread. Review the proposal, apply it to the Ticket
              draft, and keep follow-ups in the same conversation.
            </p>
          </div>
          <figure id="walkthrough-planning" class="shot">
            <ProductImage :image="images.planning" @open="openImage" />
          </figure>
          <figure id="walkthrough-board-chat" class="shot shot--secondary">
            <ProductImage :image="images.boardChat" @open="openImage" />
          </figure>
          <div class="copy copy--aside">
            <h3>Or start from the Board</h3>
            <p>
              The Board's chat lists the Threads of the Workspace's Tickets and drafts. Start a
              ticket draft there, plan it, and create the Ticket without leaving the Board.
            </p>
            <a class="text-link" :href="`${guide}#chat-with-threads`">Chat guide</a>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="ticket-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="ticket-heading">Save it as a Ticket</h2>
            <div class="copy">
              <p>The Ticket keeps what you agreed on. The planning conversation stays attached.</p>
            </div>
          </div>
          <div class="layout-detail">
            <figure id="walkthrough-ticket" class="shot">
              <ProductImage :image="images.ticket" @open="openImage" />
            </figure>
            <dl class="facts">
              <div>
                <dt>Goal</dt>
                <dd>What the work should achieve.</dd>
              </div>
              <div>
                <dt>Acceptance criteria</dt>
                <dd>How you will know it is done.</dd>
              </div>
              <div>
                <dt>Repository scope</dt>
                <dd>Which repositories the work touches, and which one is primary.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="worktrees-heading">
        <CommitGraph kind="fork" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="worktrees-heading">Branch a worktree per repository</h2>
            <div class="copy">
              <p>
                Start work prepares an isolated worktree in each repository in the Ticket's scope.
              </p>
              <p>
                Preparing worktrees or creating a Thread does not start an agent. Send a message
                when ready.
              </p>
              <a class="text-link" :href="`${guide}#start-agent-work`">Work area guide</a>
            </div>
          </div>
          <figure id="walkthrough-workspace" class="shot">
            <ProductImage :image="images.workspace" @open="openImage" />
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="threads-heading">
        <CommitGraph kind="branch" />
        <div class="step-body layout-pair">
          <div class="head">
            <h2 id="threads-heading">Work in native Threads</h2>
            <div class="copy">
              <p>
                The planning conversation continues in the work area. Add more Threads to the Ticket
                as the work splits.
              </p>
              <p class="note">
                When other Threads wait for your approval or input, or their run failed, the chat
                shows how many. Select the count to open the menu on the first of them.
              </p>
            </div>
          </div>
          <figure id="walkthrough-thread" class="shot">
            <ProductImage :image="images.thread" @open="openImage" />
            <figcaption>
              <strong>Continue the same Thread.</strong> Start work adds the Ticket's context to the
              planning conversation. Send your next instruction when ready.
            </figcaption>
          </figure>
          <figure id="walkthrough-chat" class="shot">
            <ProductImage :image="images.ticketChat" @open="openImage" />
            <figcaption>
              <strong>Talk to the Ticket's Threads.</strong> Switch between them without leaving the
              Ticket. After a Thread finishes a run, its recap can tell the others what it did.
            </figcaption>
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="review-heading">
        <CommitGraph kind="merge" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="review-heading">Review the pull requests</h2>
            <div class="copy">
              <p>Check linked PR status and review feedback without leaving the Ticket.</p>
              <p class="note">A second demo Ticket. PR feedback and outcomes are illustrative.</p>
            </div>
          </div>
          <figure id="walkthrough-pull-request" class="shot">
            <ProductImage :image="images.pullRequest" @open="openImage" />
          </figure>
          <div class="layout-split layout-split--nested">
            <div class="copy">
              <h3>See what needs attention</h3>
              <p>Failed checks, requested changes, and open review threads on linked PRs.</p>
            </div>
            <figure id="walkthrough-notifications" class="shot">
              <ProductImage :image="images.notifications" @open="openImage" />
            </figure>
          </div>
        </div>
      </section>

      <section class="step step--end" aria-labelledby="install-heading">
        <CommitGraph kind="end" />
        <div class="step-body">
          <h2 id="install-heading">Install Workbench alongside T3 Code</h2>
          <p class="lead">Workbench stores its data separately from the official app.</p>
          <div class="actions">
            <a class="button" :href="downloads">Download Workbench</a>
            <a class="text-link" :href="guide">Read the guide</a>
          </div>
          <p class="note">
            macOS builds are signed and notarized. Windows and Linux builds are unsigned.
          </p>
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
