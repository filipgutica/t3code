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
    | "ticket"
    | "agentEdit"
    | "reference"
    | "threadContext"
    | "terminal"
    | "pullRequests"
    | "recaps",
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
    <a class="fg-site-skip" href="#main">Skip to content</a>
    <UiSiteHeader
      project="workbench"
      :links="[
        { label: 'Guide', href: guide },
        { label: 'GitHub', href: repository },
        { label: 'Downloads', href: downloads },
      ]"
    />
    <SiteNavigation :sections="sections" :active-id="activeId" :enhanced="enhanced" />
    <main id="main" class="frame">
      <section class="step hero" aria-labelledby="hero-heading">
        <CommitGraph kind="root" />
        <div class="step-body">
          <h1 id="hero-heading">Your work, across repositories.</h1>
          <p class="lead">
            Plan connected work once, then split it into a Thread for each PR across your
            repositories. The Ticket keeps the plan, the requirements, the PRs, and what each agent
            did in one place.
          </p>
          <div class="actions">
            <a
              class="fg-button download-action"
              data-variant="primary"
              data-size="sm"
              :href="downloads"
              >Download Workbench</a
            >
            <a class="text-link" :href="guide">Read the guide</a>
          </div>
          <p class="provenance">
            An independent fork of <a href="https://t3.codes">T3 Code</a>, synced with upstream.
          </p>
          <figure class="shot hero-media">
            <ProductImage :image="images.ticket" @open="openImage" />
            <figcaption>
              Demo Orbit Ticket, with synthetic data: three planned PRs across Orbit API and Orbit
              Web, two linked so far. History, PR outcomes, and recaps are illustrative.
            </figcaption>
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="plan-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-split">
          <div class="copy">
            <h2 id="plan-heading">Plan the change in conversation</h2>
            <p>
              Choose New Ticket on the Board and describe the change. A planning Thread opens in the
              Board chat. You don't need a title or repositories to start.
            </p>
            <p>
              As you talk, the agent fills in the draft: title, brief, Progress, and repositories.
              It saves longer plans and requirements in the Ticket's artifacts folder and adds them
              as References.
            </p>
            <p>
              Planning can read your repositories. Its instructions tell it not to change them.
              Choose Create ticket when the plan is right.
            </p>
          </div>
          <figure id="walkthrough-planning" class="shot">
            <ProductImage :image="images.planning" @open="openImage" />
            <figcaption>
              The agent writes the brief, Progress, and requirements while you talk.
            </figcaption>
          </figure>
          <figure id="walkthrough-board" class="shot shot--secondary">
            <ProductImage :image="images.board" @open="openImage" />
          </figure>
          <div class="copy copy--aside">
            <h3>Start from the Board</h3>
            <p>
              Drafts wait on the Board until you return to them. Each Ticket card shows its Progress
              and what needs you.
            </p>
            <a class="text-link" :href="`${guide}#plan-a-ticket`">Planning guide</a>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="ticket-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="ticket-heading">A short brief, a checklist, and a requirements file</h2>
            <div class="copy">
              <p>
                The brief stays short: the goal, open questions, and decisions, with scope and
                acceptance in a requirements file. The agent keeps Progress as a checklist, usually
                one line per task or PR.
              </p>
              <p>
                Each Thread on the Ticket gets the brief, Progress, and References on its first
                turn. Later turns receive updates.
              </p>
            </div>
          </div>
          <div class="layout-detail">
            <figure id="walkthrough-agent-edit" class="shot">
              <ProductImage :image="images.agentEdit" @open="openImage" />
              <figcaption>
                When an agent edits the brief, review the change. Accept it or undo it.
              </figcaption>
            </figure>
            <dl class="facts">
              <div>
                <dt>Brief</dt>
                <dd>The goal, open questions, and decisions.</dd>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>A checklist the agent maintains. Here, one line for each PR.</dd>
              </div>
              <div>
                <dt>Requirements</dt>
                <dd>Scope and acceptance for each PR, in a file the Ticket references.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="step" aria-labelledby="references-heading">
        <CommitGraph kind="commit" />
        <div class="step-body layout-split">
          <div class="copy">
            <h2 id="references-heading">Keep specs and mockups beside the chat</h2>
            <p>
              Requirements, plans, designs, and issues are References. With a Thread open in the
              chat, a self-contained HTML mockup opens in that Thread's panel beside the
              conversation. You stay on the Ticket.
            </p>
            <p class="note">Delivery PRs link through their Threads, not as References.</p>
          </div>
          <figure id="walkthrough-reference" class="shot">
            <ProductImage :image="images.reference" @open="openImage" />
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="threads-heading">
        <CommitGraph kind="fork" />
        <div class="step-body layout-pair">
          <div class="head">
            <h2 id="threads-heading">A Thread for each PR, in the right repository</h2>
            <div class="copy">
              <p>
                Start work prepares a worktree for each repository on the Ticket. Create a Thread
                for each PR and choose its repository. Here, one Thread works in Orbit API and two
                in Orbit Web.
              </p>
              <p>
                Creating a Thread doesn't start the agent. Your first message does, and the Thread
                gets the Ticket's shared context with it.
              </p>
              <a class="text-link" :href="`${guide}#start-agent-work`">Work area guide</a>
            </div>
          </div>
          <figure id="walkthrough-thread-context" class="shot">
            <ProductImage :image="images.threadContext" @open="openImage" />
            <figcaption>
              <strong>See what every Thread receives.</strong> Shared context shows the brief,
              Progress, References, the prepared worktrees, and the other Threads with their recaps.
            </figcaption>
          </figure>
          <figure id="walkthrough-terminal" class="shot">
            <ProductImage :image="images.terminal" @open="openImage" />
            <figcaption>
              <strong>Run commands where the Thread works.</strong> Separate PRs need separate
              branches. PR 3 has its own Orbit Web checkout; the chat Thread's terminal opens there.
            </figcaption>
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="review-heading">
        <CommitGraph kind="branch" />
        <div class="step-body layout-wide">
          <div class="head">
            <h2 id="review-heading">Every PR and what needs you, in one place</h2>
            <div class="copy">
              <p>
                Pull requests collects PRs from the Ticket's Threads and branches. Needs attention
                lists failed checks, requested changes, unresolved review threads, and Threads with
                unread replies or requests.
              </p>
              <p>Open a PR beside the Ticket to read its summary, checks, and review threads.</p>
            </div>
          </div>
          <figure id="walkthrough-pull-requests" class="shot">
            <ProductImage :image="images.pullRequests" @open="openImage" />
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="recaps-heading">
        <CommitGraph kind="branch" />
        <div class="step-body layout-split">
          <div class="copy">
            <h2 id="recaps-heading">Catch up with recap previews</h2>
            <p>
              After a Thread finishes a run, Workbench writes a short recap of it. The chat's Thread
              list shows a one-line preview under each Thread that has one.
            </p>
            <p>
              Recaps also go into the shared context, so they help you and the other Threads catch
              up.
            </p>
            <a class="text-link" :href="`${guide}#chat-with-threads`">Chat guide</a>
          </div>
          <figure id="walkthrough-recaps" class="shot">
            <ProductImage :image="images.recaps" @open="openImage" />
          </figure>
        </div>
      </section>

      <section class="step" aria-labelledby="done-heading">
        <CommitGraph kind="merge" />
        <div class="step-body copy">
          <h2 id="done-heading">Done when you say so</h2>
          <p>
            Finishing a run or checking off Progress doesn't close the Ticket. Review the PRs, then
            set the Ticket to Done.
          </p>
          <p>
            Settle Threads you're finished with. They stay in the chat's Thread list if you need
            them again.
          </p>
        </div>
      </section>

      <section class="step step--end" aria-labelledby="install-heading">
        <CommitGraph kind="end" />
        <div class="step-body">
          <h2 id="install-heading">Install Workbench alongside T3 Code</h2>
          <p class="lead">T3 Code Workbench keeps its saved data separate from official T3 Code.</p>
          <div class="actions">
            <a
              class="fg-button download-action"
              data-variant="primary"
              data-size="sm"
              :href="downloads"
              >Download Workbench</a
            >
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
