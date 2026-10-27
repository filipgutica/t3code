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
  getWorkbenchFloatingChatPickerSections,
  isWorkbenchFloatingChatGroupOpenByDefault,
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
  type WorkbenchFloatingChatTicket,
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
  recaps: new Map<ThreadId, string>(),
});
const titlesAndTickets = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) =>
  threads.map(({ threadId, title, ticket }) => ({ threadId, title, key: ticket?.key ?? null }));

describe("getWorkbenchBoardChatThreads", () => {
  it("includes every live Thread per ticket with its ticket and recap, drafts first, tickets in board order", () => {
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

describe("getWorkbenchFloatingChatPickerSections", () => {
  const ticketA = {
    id: WorkbenchTicketId.make("a"),
    key: "WB-1",
    title: "First",
    kind: "bug" as const,
  };
  const ticketB = {
    id: WorkbenchTicketId.make("b"),
    key: null,
    title: "Second",
    kind: "story" as const,
  };
  const ticketC = {
    id: WorkbenchTicketId.make("c"),
    key: null,
    title: "Thread c1",
    kind: "story" as const,
  };
  const shape = (sections: ReturnType<typeof getWorkbenchFloatingChatPickerSections>) =>
    sections.map((section) => ({
      type: section.type,
      id: section.id,
      rows: section.rows.map((row) => row.thread.threadId),
    }));
  const rowTitles = (sections: ReturnType<typeof getWorkbenchFloatingChatPickerSections>) =>
    sections.flatMap((section) => section.rows.map((row) => row.title));

  it("groups drafts first, then each ticket's Threads, including a ticket with one Thread", () => {
    const sections = getWorkbenchFloatingChatPickerSections([
      thread("b1", null, { ticket: ticketB }),
      thread("a1", null, { ticket: ticketA }),
      thread("draft"),
      thread("b2", null, { ticket: ticketB }),
      thread("c1", null, { ticket: ticketC }),
    ]);
    expect(shape(sections)).toEqual([
      { type: "group", id: "drafts", rows: ["draft"] },
      { type: "group", id: "b", rows: ["b1", "b2"] },
      { type: "group", id: "a", rows: ["a1"] },
      { type: "group", id: "c", rows: ["c1"] },
    ]);
  });

  it("lists one ticket's Threads, or Threads with no ticket, as plain rows", () => {
    expect(shape(getWorkbenchFloatingChatPickerSections([thread("x"), thread("y")]))).toEqual([
      { type: "rows", id: "drafts", rows: ["x", "y"] },
    ]);
    const oneTicket = getWorkbenchFloatingChatPickerSections([
      thread("main", null, { title: "Second", ticket: ticketB }),
      thread("api", null, { title: "Second — API contract review", ticket: ticketB }),
      thread("other", null, { title: "Review copy", ticket: ticketB }),
      thread("word", null, { title: "Secondary review", ticket: ticketB }),
    ]);
    expect(shape(oneTicket)).toEqual([
      { type: "rows", id: "b", rows: ["main", "api", "other", "word"] },
    ]);
    // Only a separator after the ticket title marks it as the title's prefix.
    expect(rowTitles(oneTicket)).toEqual([
      "Second",
      "API contract review",
      "Review copy",
      "Secondary review",
    ]);
  });
});

describe("isWorkbenchFloatingChatGroupOpenByDefault", () => {
  const group = (
    ticket: WorkbenchFloatingChatTicket | null,
    ...threads: WorkbenchFloatingChatThread[]
  ) => ({
    type: "group" as const,
    id: ticket?.id ?? "drafts",
    ticket,
    rows: threads.map((entry) => ({ thread: entry, title: entry.title })),
  });
  const shared = {
    id: WorkbenchTicketId.make("t"),
    key: null,
    title: "Shared",
    kind: "story" as const,
  };

  it("opens drafts, and a ticket's group that holds the showing Thread or one waiting on you", () => {
    expect(isWorkbenchFloatingChatGroupOpenByDefault(group(null, thread("d")), null)).toBe(true);
    const quiet = group(shared, thread("a"), thread("b", "working"));
    expect(isWorkbenchFloatingChatGroupOpenByDefault(quiet, null)).toBe(false);
    expect(isWorkbenchFloatingChatGroupOpenByDefault(quiet, ThreadId.make("a"))).toBe(true);
    expect(
      isWorkbenchFloatingChatGroupOpenByDefault(
        group(shared, thread("a"), thread("c", "approval")),
        null,
      ),
    ).toBe(true);
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
