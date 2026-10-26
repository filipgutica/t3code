import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";

import { makeThreadFixture } from "../test-fixtures";
import {
  getWorkbenchBoardChatThreads,
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

const thread = (
  id: string,
  kind: WorkbenchThreadExecutionStatus["kind"] | null = null,
): WorkbenchFloatingChatThread => ({
  threadId: ThreadId.make(id),
  title: `Thread ${id}`,
  status:
    kind === null
      ? null
      : {
          kind,
          presentation: resolveWorkbenchThreadExecutionStatusPresentation({ kind }),
          startedAt: null,
        },
});

const projectId = WorkbenchProjectId.make("workspace");
const repositoryId = ProjectId.make("repository");
const createdAt = "2026-10-25T00:00:00.000Z";
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId,
  epicId: null,
  title: "Fix board chat",
  markdown: "",
  kind: "story",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [repositoryId],
  status: "todo",
  blocked: false,
  archivedAt: null,
  jiraIssue: { key: "WB-42", url: "https://example.atlassian.net/browse/WB-42" },
  revision: 0,
  createdAt,
  updatedAt: createdAt,
};
const draft: WorkbenchTicketDraft = {
  id: WorkbenchTicketId.make("draft"),
  projectId,
  threadId: ThreadId.make("draft-thread"),
  anchorProjectId: repositoryId,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  revision: 0,
  phase: "draft",
  fields: {
    title: "Plan board chat",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
  },
  createdAt,
  updatedAt: createdAt,
};
const assignmentFor = (threadId: string, ticketId = ticket.id): WorkbenchAssignment => ({
  id: WorkbenchAssignmentId.make(`assignment-${threadId}`),
  ticketId,
  threadId: ThreadId.make(threadId),
  supersededAt: null,
  createdAt,
});
const liveThread = (id: string) =>
  makeThreadFixture({
    id: ThreadId.make(id),
    projectId: repositoryId,
    environmentId: EnvironmentId.make("local"),
    title: `Thread ${id}`,
  });
const boardInput = () => ({
  projectId,
  tickets: [ticket],
  assignments: [assignmentFor("first"), assignmentFor("second")],
  drafts: [],
  threadsById: new Map([liveThread("first"), liveThread("second")].map((t) => [t.id, t])),
  archivedThreadsById: new Map<ThreadId, ReturnType<typeof liveThread>>(),
});

describe("getWorkbenchBoardChatThreads", () => {
  it("includes every live Thread per ticket, with drafts first and tickets in board order", () => {
    const secondTicket = {
      ...ticket,
      id: WorkbenchTicketId.make("second-ticket"),
      title: "Next",
      jiraIssue: null,
    };
    const input = boardInput();
    const result = getWorkbenchBoardChatThreads({
      ...input,
      tickets: [secondTicket, ticket],
      assignments: [...input.assignments, assignmentFor("third", secondTicket.id)],
      drafts: [draft],
      threadsById: new Map(
        [...input.threadsById.values(), liveThread("third"), liveThread(draft.threadId)].map(
          (t) => [t.id, t],
        ),
      ),
    });
    expect(result.active.map(({ threadId, title }) => ({ threadId, title }))).toEqual([
      { threadId: draft.threadId, title: "Plan board chat" },
      { threadId: "third", title: "Next · Thread third" },
      { threadId: "first", title: "WB-42 · Thread first" },
      { threadId: "second", title: "WB-42 · Thread second" },
    ]);
  });

  it("separates settled and archived Threads and excludes missing and historical Threads", () => {
    const input = boardInput();
    const result = getWorkbenchBoardChatThreads({
      ...input,
      assignments: [
        ...input.assignments,
        assignmentFor("settled"),
        assignmentFor("archived"),
        assignmentFor("missing"),
        { ...assignmentFor("history"), supersededAt: createdAt },
      ],
      threadsById: new Map(
        [
          ...input.threadsById.values(),
          { ...liveThread("settled"), settledOverride: "settled" as const },
          liveThread("history"),
        ].map((t) => [t.id, t]),
      ),
      archivedThreadsById: new Map([
        [ThreadId.make("archived"), { ...liveThread("archived"), archivedAt: createdAt }],
      ]),
    });
    expect(ids(result.active)).toEqual(["first", "second"]);
    expect(ids(result.settled)).toEqual(["settled"]);
    expect(ids(result.archived)).toEqual(["archived"]);
  });

  it("keeps a promoted draft before its Assignment arrives and deduplicates it afterwards", () => {
    const input = {
      ...boardInput(),
      drafts: [{ ...draft, id: ticket.id, phase: "promoting" as const }],
      threadsById: new Map([[draft.threadId, liveThread(draft.threadId)]]),
    };
    const expected = [{ threadId: draft.threadId, title: "WB-42 · Thread draft-thread" }];
    expect(
      getWorkbenchBoardChatThreads(input).active.map(({ threadId, title }) => ({
        threadId,
        title,
      })),
    ).toEqual(expected);
    expect(
      getWorkbenchBoardChatThreads({
        ...input,
        assignments: [assignmentFor(draft.threadId)],
      }).active.map(({ threadId, title }) => ({ threadId, title })),
    ).toEqual(expected);
  });

  it.each(["creating", "draft", "promoting", "planning", "starting", "discarding"] as const)(
    "keeps a draft tab during %s and uses the conversation title fallback",
    (phase) => {
      const result = getWorkbenchBoardChatThreads({
        ...boardInput(),
        drafts: [{ ...draft, phase, fields: { ...draft.fields, title: "" } }],
        threadsById: new Map([
          [draft.threadId, { ...liveThread(draft.threadId), title: "Research the board" }],
        ]),
      });
      expect(result.active.map(({ threadId, title }) => ({ threadId, title }))).toEqual([
        { threadId: draft.threadId, title: "Research the board" },
      ]);
    },
  );

  it("excludes other Workspaces' tickets and drafts and working drafts without Assignments", () => {
    const input = boardInput();
    const otherProjectId = WorkbenchProjectId.make("other-workspace");
    const otherTicket = {
      ...ticket,
      id: WorkbenchTicketId.make("other"),
      projectId: otherProjectId,
    };
    const result = getWorkbenchBoardChatThreads({
      ...input,
      tickets: [...input.tickets, otherTicket],
      assignments: [...input.assignments, assignmentFor("other", otherTicket.id)],
      drafts: [
        { ...draft, projectId: otherProjectId },
        {
          ...draft,
          id: WorkbenchTicketId.make("working"),
          threadId: ThreadId.make("working"),
          phase: "working",
        },
      ],
      threadsById: new Map(
        [
          ...input.threadsById.values(),
          liveThread("other"),
          liveThread(draft.threadId),
          liveThread("working"),
        ].map((t) => [t.id, t]),
      ),
    });
    expect(ids(result.active)).toEqual(["first", "second"]);
    expect(result.settled).toEqual([]);
    expect(result.archived).toEqual([]);
  });
});

const ids = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) =>
  threads.map((entry) => entry.threadId);

describe("resolveWorkbenchFloatingChat", () => {
  it("selects the primary Thread until the user picks a tab, then keeps that pick", () => {
    const active = [thread("a"), thread("b", "working")];
    const base = { active, archived: [], settled: [], primaryThreadId: ThreadId.make("b") };

    expect(resolveWorkbenchFloatingChat({ ...base, explicitThreadId: null }).selectedThreadId).toBe(
      "b",
    );
    // Another Thread becoming primary must not pull the user off the tab they chose.
    expect(
      resolveWorkbenchFloatingChat({ ...base, explicitThreadId: ThreadId.make("a") })
        .selectedThreadId,
    ).toBe("a");
  });

  it("falls back to the primary, then the first tab, when the picked Thread disappears", () => {
    const active = [thread("a"), thread("b")];
    const gone = ThreadId.make("removed");

    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: ThreadId.make("b"),
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBe("b");
    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBe("a");
    expect(
      resolveWorkbenchFloatingChat({
        active: [],
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBeNull();
  });

  it("shows a picked settled Thread as a trailing tab and removes it from the settled menu", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [thread("a")],
      archived: [],
      settled: [thread("s1"), thread("s2")],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("s2"),
    });

    expect(result.selectedThreadId).toBe("s2");
    expect(ids(result.tabs)).toEqual(["a", "s2"]);
    expect(ids(result.settled)).toEqual(["s1"]);
  });

  it("gives every active Thread a tab and keeps the explicit selection", () => {
    const active = [thread("a"), thread("b"), thread("c"), thread("d"), thread("e")];
    const result = resolveWorkbenchFloatingChat({
      active,
      archived: [],
      settled: [],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("e"),
    });
    expect(ids(result.tabs)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.selectedThreadId).toBe("e");
  });

  it("never selects an archived Thread and counts only Threads waiting on the user", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [
        thread("working", "working"),
        thread("approval", "approval"),
        thread("input", "input"),
        thread("failed", "failed"),
      ],
      archived: [thread("old")],
      settled: [],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("old"),
    });

    expect(result.selectedThreadId).toBe("working");
    expect(ids(result.archived)).toEqual(["old"]);
    expect(result.attentionCount).toBe(3);
  });
});
