import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useComposerDraftStore } from "../composerDraftStore";
import { attachWorkbenchTicketContext } from "./attachWorkbenchTicketContext";

const environmentId = EnvironmentId.make("context-environment");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("existing-thread"));
const api = ProjectId.make("api");
const web = ProjectId.make("web");
const input = {
  environmentId,
  thread: { id: threadRef.threadId, projectId: api, worktreePath: "/remote/old-api-checkout" },
  ticket: {
    id: WorkbenchTicketId.make("ticket"),
    title: "Updated requirements",
    markdown: "Use the new API contract.",
    kind: "story",
    repositoryProjectIds: [web, api],
    primaryT3ProjectId: web,
  },
  projects: [
    { id: api, title: "API", workspaceRoot: "/remote/api" },
    { id: web, title: "Web", workspaceRoot: "/remote/web" },
  ],
  repositories: [
    { projectId: api, worktreePath: "/remote/prepared-api", status: "ready" },
    { projectId: web, worktreePath: "/remote/prepared-web", status: "ready" },
  ],
} satisfies Parameters<typeof attachWorkbenchTicketContext>[0];

describe("refreshing Ticket context in a native composer", () => {
  beforeEach(() => useComposerDraftStore.setState({ draftsByThreadKey: {} }));

  it("stages current saved scope and the existing Thread checkout without disturbing its draft", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "Keep my unsent request");
    attachWorkbenchTicketContext(input);
    const first = store.getComposerDraft(threadRef);
    if (!first) throw new Error("Composer draft was not created");
    expect(first.reviewComments).toHaveLength(1);
    const ticketComment = first.reviewComments[0];
    if (!ticketComment) throw new Error("Ticket context was not staged");
    expect(ticketComment.diff).toContain("Use the new API contract.");
    expect(ticketComment.diff).toContain("Web (primary) — /remote/prepared-web");
    expect(ticketComment.diff).toContain("API — /remote/old-api-checkout");
    expect(first.prompt).toContain("Keep my unsent request");
    const unrelated = {
      ...ticketComment,
      id: "other-context",
      sectionId: "other-context",
      diff: "Unrelated review",
    };
    store.addReviewComment(threadRef, unrelated);
    const beforeRefresh = store.getComposerDraft(threadRef);
    attachWorkbenchTicketContext({
      ...input,
      ticket: { ...input.ticket, markdown: "Revised acceptance criteria." },
    });
    const refreshed = store.getComposerDraft(threadRef);
    if (!refreshed) throw new Error("Composer draft was lost during refresh");
    expect(refreshed.prompt).toBe(beforeRefresh?.prompt);
    expect(refreshed.reviewComments).toHaveLength(2);
    expect(
      refreshed.reviewComments.find((comment) => comment.id === "workbench-ticket:ticket")?.diff,
    ).toContain("Revised acceptance criteria.");
    expect(refreshed.reviewComments.find((comment) => comment.id === "other-context")).toEqual(
      unrelated,
    );
  });

  it("labels unavailable scope and checkout paths rather than inventing a prepared directory", () => {
    attachWorkbenchTicketContext({
      ...input,
      thread: { ...input.thread, worktreePath: null },
      projects: [],
      repositories: [],
    });
    const context = useComposerDraftStore.getState().getComposerDraft(threadRef)
      ?.reviewComments[0]?.diff;
    expect(context).toContain("Repository unavailable");
    expect(context).toContain("Directory unavailable");
    expect(context).not.toContain("/remote/prepared");
  });
});
