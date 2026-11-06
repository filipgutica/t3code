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
            Plan a change across repositories in one Ticket. Keep its native T3 Threads, isolated
            worktrees, and pull requests together as you work.
          </p>
          <div class="actions">
            <a class="button" :href="downloads">Download Workbench</a>
            <a class="text-link" :href="guide">Read the guide</a>
          </div>
          <p class="provenance">
            An independent fork of <a href="https://t3.codes">T3 Code</a>, synced with upstream.
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
            <h2 id="plan-heading">Plan the change in conversation</h2>
            <p>
              New ticket on the Board opens a planning Thread. You can begin without a title or
              repository selection.
            </p>
            <p>
              As you talk, the agent fills in the draft's title, description, and repositories. Its
              edits apply at once.
            </p>
            <p>
              Planning can read the Workspace's repositories. Its instructions tell it not to change
              them or start implementation.
            </p>
          </div>
          <figure id="walkthrough-planning" class="shot">
            <ProductImage :image="images.planning" @open="openImage" />
          </figure>
          <figure id="walkthrough-board-chat" class="shot shot--secondary">
            <ProductImage :image="images.boardChat" @open="openImage" />
          </figure>
          <div class="copy copy--aside">
            <h3>Use the Board chat</h3>
            <p>
              Use New ticket draft in the board chat to plan a Ticket without leaving the Board.
              Create ticket then opens the new Ticket, where the same Thread continues.
            </p>
            <a class="text-link" :href="`${guide}#chat-with-threads`">Chat guide</a>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="ticket-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="ticket-heading">Create the Ticket</h2>
            <div class="copy">
              <p>
                The draft becomes a Ticket only when you choose Create ticket. Its planning Thread
                stays linked, ready to continue into implementation.
              </p>
              <p>Creating the Ticket alone prepares no worktrees.</p>
            </div>
          </div>
          <div class="layout-detail">
            <figure id="walkthrough-ticket" class="shot">
              <ProductImage :image="images.ticket" @open="openImage" />
            </figure>
            <dl class="facts">
              <div>
                <dt>Brief</dt>
                <dd>The goal, open questions, and decisions.</dd>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>The agent's checklist of planned work.</dd>
              </div>
              <div>
                <dt>Repositories</dt>
                <dd>The repositories included in this Ticket.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="worktrees-heading">
        <CommitGraph kind="fork" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="worktrees-heading">Prepare the work area</h2>
            <div class="copy">
              <p>
                Start work prepares one isolated worktree per Ticket repository. It continues the
                planning Thread in the first repository's worktree.
              </p>
              <p>Start work sends no message. No agent starts until you send one.</p>
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
            <h2 id="threads-heading">Add Threads as the work splits</h2>
            <div class="copy">
              <p>
                Each Thread works in one repository. Add another with Create Thread on the Ticket,
                or New Thread in the ticket chat. Creating a Thread does not start the agent.
              </p>
              <p class="note">
                When other Threads wait for your approval or input, or their run failed, the chat
                shows how many, such as “2 need you”. Select the count to open the Thread menu on
                the first of them.
              </p>
            </div>
          </div>
          <figure id="walkthrough-thread" class="shot">
            <ProductImage :image="images.thread" @open="openImage" />
            <figcaption>
              <strong>Your next message starts the work.</strong> The agent receives the Ticket's
              context with it.
            </figcaption>
          </figure>
          <figure id="walkthrough-chat" class="shot">
            <ProductImage :image="images.ticketChat" @open="openImage" />
            <figcaption>
              <strong>Keep the Threads in view.</strong> Switch between them in the Ticket's chat.
              After a run, a Thread's recap can tell the Ticket's other Threads what it did.
            </figcaption>
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="review-heading">
        <CommitGraph kind="merge" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="review-heading">Review the linked pull requests</h2>
            <div class="copy">
              <p>
                Open linked pull requests beside the Ticket to check their status and review
                feedback.
              </p>
              <p>
                A finished agent turn does not mark the Ticket Done. Set its status after you review
                and accept the work.
              </p>
              <p class="note">A second demo Ticket. PR feedback and outcomes are illustrative.</p>
            </div>
          </div>
          <figure id="walkthrough-pull-request" class="shot">
            <ProductImage :image="images.pullRequest" @open="openImage" />
          </figure>
          <div class="layout-split layout-split--nested">
            <div class="copy">
              <h3>Find PR feedback in Needs attention</h3>
              <p>
                For PRs linked to the Ticket's Threads, this list shows failed checks, requested
                changes, and unresolved review threads awaiting your reply.
              </p>
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
          <p class="lead">T3 Code Workbench keeps its saved data separate from official T3 Code.</p>
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
