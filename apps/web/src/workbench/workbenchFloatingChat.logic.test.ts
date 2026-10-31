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
  filterWorkbenchFloatingChatThreads,
  getWorkbenchFloatingChatThreadLabel,
  getWorkbenchBoardChatThreads,
  getWorkbenchFloatingChatPickerRow,
  getWorkbenchThreadStatusSections,
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
  type WorkbenchThreadStatusSection,
} from "./workbenchFloatingChat.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

const thread = (
  id: string,
  kind: WorkbenchThreadExecutionStatus["kind"] | null = null,
  extra: Partial<WorkbenchFloatingChatThread> = {},
): WorkbenchFloatingChatThread => ({
  threadId: ThreadId.make(id),
  title: `Thread ${id}`,
  ticket: null,
  recap: null,
  ...extra,
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
  recaps: new Map<ThreadId, string>(),
  referencesByTicket: new Map([
    [
      ticket.id,
      [
        {
          ticketId: ticket.id,
          url: "https://example.atlassian.net/browse/WB-42",
          title: null,
          addedByThreadId: null,
          createdAt,
        },
      ],
    ],
  ]),
});
const titlesAndTickets = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) =>
  threads.map(({ threadId, title, ticket }) => ({ threadId, title, key: ticket?.key ?? null }));

describe("getWorkbenchBoardChatThreads", () => {
  it("includes every live Thread per ticket with its ticket and recap, drafts first, tickets in board order", () => {
    const secondTicket = {
      ...ticket,
      id: WorkbenchTicketId.make("second-ticket"),
      title: "Next",
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
      recaps: new Map([[ThreadId.make("first"), "Added the board chat picker."]]),
    });
    expect(titlesAndTickets(result.active)).toEqual([
      { threadId: draft.threadId, title: "Plan board chat", key: null },
      { threadId: "third", title: "Thread third", key: null },
      { threadId: "first", title: "Thread first", key: "WB-42" },
      { threadId: "second", title: "Thread second", key: "WB-42" },
    ]);
    expect(result.active[1]?.ticket?.title).toBe("Next");
    expect(result.active.map((entry) => entry.recap)).toEqual([
      null,
      null,
      "Added the board chat picker.",
      null,
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
    const expected = [{ threadId: draft.threadId, title: "Thread draft-thread", key: "WB-42" }];
    expect(titlesAndTickets(getWorkbenchBoardChatThreads(input).active)).toEqual(expected);
    expect(
      titlesAndTickets(
        getWorkbenchBoardChatThreads({ ...input, assignments: [assignmentFor(draft.threadId)] })
          .active,
      ),
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
      expect(titlesAndTickets(result.active)).toEqual([
        { threadId: draft.threadId, title: "Research the board", key: null },
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
  it("selects the primary Thread until the user picks one, then keeps that pick", () => {
    const active = [thread("a"), thread("b", "working")];
    const base = { active, archived: [], settled: [], primaryThreadId: ThreadId.make("b") };

    expect(
      resolveWorkbenchFloatingChat({ ...base, explicitThreadId: null }).selected?.threadId,
    ).toBe("b");
    // Another Thread becoming primary must not pull the user off the tab they chose.
    expect(
      resolveWorkbenchFloatingChat({ ...base, explicitThreadId: ThreadId.make("a") }).selected
        ?.threadId,
    ).toBe("a");
  });

  it("falls back to the primary, then the first Thread, when the picked Thread disappears", () => {
    const active = [thread("a"), thread("b")];
    const gone = ThreadId.make("removed");

    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: ThreadId.make("b"),
        explicitThreadId: gone,
      }).selected?.threadId,
    ).toBe("b");
    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selected?.threadId,
    ).toBe("a");
    expect(
      resolveWorkbenchFloatingChat({
        active: [],
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selected,
    ).toBeNull();
  });

  it("selects a picked settled Thread and keeps it in the settled list", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [thread("a")],
      archived: [],
      settled: [thread("s1"), thread("s2")],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("s2"),
    });

    expect(result.selected?.threadId).toBe("s2");
    expect(ids(result.active)).toEqual(["a"]);
    expect(ids(result.settled)).toEqual(["s1", "s2"]);
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

    expect(result.selected?.threadId).toBe("working");
    expect(ids(result.archived)).toEqual(["old"]);
    expect(result.attentionCount).toBe(3);
  });

  it("lists waiting Threads other than the one showing, while the launcher counts all", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [
        thread("approval", "approval"),
        thread("working", "working"),
        thread("input", "input"),
      ],
      archived: [],
      settled: [],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("approval"),
    });

    expect(ids(result.waiting)).toEqual(["input"]);
    expect(result.attentionCount).toBe(2);
  });
});

describe("getWorkbenchThreadStatusSections", () => {
  const shape = (
    sections: ReadonlyArray<WorkbenchThreadStatusSection<WorkbenchFloatingChatThread>>,
  ) =>
    sections.map((section) => ({
      id: section.id,
      threads: ids(section.threads),
      workingCount: section.workingCount,
      openByDefault: section.openByDefault,
    }));

  it("puts Threads waiting on the user first, then idle and working, then settled", () => {
    const sections = getWorkbenchThreadStatusSections({
      active: [
        thread("idle"),
        thread("approval", "approval"),
        thread("working", "working"),
        thread("input", "input"),
        thread("limited", "limited"),
        thread("failed", "failed"),
      ],
      settled: [thread("done")],
      showingThreadId: null,
    });

    expect(shape(sections)).toEqual([
      {
        id: "attention",
        threads: ["approval", "input", "failed"],
        workingCount: 0,
        openByDefault: true,
      },
      {
        id: "idle",
        threads: ["idle", "working", "limited"],
        workingCount: 1,
        openByDefault: false,
      },
      { id: "settled", threads: ["done"], workingCount: 0, openByDefault: false },
    ]);
  });

  it("omits empty sections and opens the one holding the showing Thread", () => {
    const sections = getWorkbenchThreadStatusSections({
      active: [thread("a")],
      settled: [thread("s")],
      showingThreadId: ThreadId.make("s"),
    });

    expect(shape(sections)).toEqual([
      { id: "idle", threads: ["a"], workingCount: 0, openByDefault: false },
      { id: "settled", threads: ["s"], workingCount: 0, openByDefault: true },
    ]);
  });

  it("moves a Thread to Needs attention when it starts waiting on the user", () => {
    const sectionOf = (kind: WorkbenchThreadExecutionStatus["kind"] | null) =>
      getWorkbenchThreadStatusSections({
        active: [thread("a", kind), thread("b")],
        settled: [],
        showingThreadId: null,
      }).find((section) => section.threads.some((entry) => entry.threadId === "a"))?.id;

    expect(sectionOf("working")).toBe("idle");
    expect(sectionOf("approval")).toBe("attention");
    expect(sectionOf(null)).toBe("idle");
  });
});

describe("getWorkbenchFloatingChatPickerRow", () => {
  const keyed = {
    id: WorkbenchTicketId.make("a"),
    key: "WB-1",
    title: "First",
    kind: "bug" as const,
  };
  const unkeyed = {
    id: WorkbenchTicketId.make("b"),
    key: null,
    title: "Second",
    kind: "story" as const,
  };
  const row = (title: string, ticket: WorkbenchFloatingChatThread["ticket"], board: boolean) => {
    const { ticketLabel, title: rowTitle } = getWorkbenchFloatingChatPickerRow(
      thread("t", null, { title, ticket }),
      board,
    );
    return { ticketLabel, title: rowTitle };
  };

  it("drops a leading ticket title the ticket chat already shows", () => {
    expect(row("Second — API contract review", unkeyed, false)).toEqual({
      ticketLabel: null,
      title: "API contract review",
    });
    // Only a separator after the ticket title marks it as the title's prefix.
    expect(row("Secondary review", unkeyed, false).title).toBe("Secondary review");
    expect(row("Second", unkeyed, false).title).toBe("Second");
  });

  it("names each board row's ticket by key, else by the title it then drops", () => {
    expect(row("First: copy", keyed, true)).toEqual({ ticketLabel: "WB-1", title: "First: copy" });
    expect(row("Second · copy", unkeyed, true)).toEqual({ ticketLabel: "Second", title: "copy" });
    expect(row("Draft", null, true)).toEqual({ ticketLabel: null, title: "Draft" });
  });
});

describe("filterWorkbenchFloatingChatThreads", () => {
  const threads = [
    thread("a", null, {
      title: "Fix date-range parsing",
      ticket: {
        id: WorkbenchTicketId.make("t"),
        key: "MA-5360",
        title: "Validate filters",
        kind: "story",
      },
    }),
    thread("b", null, { title: "Update chart", recap: "Rendered the token usage series." }),
  ];

  it("matches the title, the ticket label, or the recap, ignoring case", () => {
    expect(ids(filterWorkbenchFloatingChatThreads(threads, "DATE-range"))).toEqual(["a"]);
    expect(ids(filterWorkbenchFloatingChatThreads(threads, "ma-5360"))).toEqual(["a"]);
    expect(ids(filterWorkbenchFloatingChatThreads(threads, "token usage"))).toEqual(["b"]);
    expect(ids(filterWorkbenchFloatingChatThreads(threads, "  "))).toEqual(["a", "b"]);
  });
});

describe("getWorkbenchFloatingChatThreadLabel", () => {
  it("tells same-named Threads on different tickets apart by key, else ticket title", () => {
    const ticket = (key: string | null, title: string) => ({
      id: WorkbenchTicketId.make(title),
      key,
      title,
      kind: "story" as const,
    });
    expect(
      getWorkbenchFloatingChatThreadLabel(
        thread("a", null, { title: "Review", ticket: ticket("PAY-1", "Refunds") }),
      ),
    ).toBe("PAY-1 · Review");
    expect(
      getWorkbenchFloatingChatThreadLabel(
        thread("b", null, { title: "Review", ticket: ticket(null, "Payouts") }),
      ),
    ).toBe("Payouts · Review");
    expect(getWorkbenchFloatingChatThreadLabel(thread("c", null, { title: "Review" }))).toBe(
      "Review",
    );
  });
});
