import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import {
  buildTicketThreadPrompt,
  getActiveAssignmentsByTicket,
  getWorkbenchTicketAgentPresentation,
  getAssignmentsForTicket,
  getWorkbenchEpicProgress,
  getWorkbenchContextForThread,
  groupWorkbenchTicketsByEpic,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketTemplate,
  getWorkbenchThreadPresentation,
  getWorkbenchAgentPresentation,
  getWorkbenchTicketStatusMoves,
  isWorkbenchTicketKind,
  isWorkbenchTicketStatus,
  isWorkbenchThreadArchived,
  resolveWorkbenchRepositoryOpenCwd,
  resolveWorkbenchTicketThreadTarget,
  ticketsByStatus,
  WORKBENCH_TICKET_KIND_LABELS,
  WORKBENCH_TICKET_STATUS_LABELS,
} from "./workbench.logic";

describe("Workbench ticket helpers", () => {
  it("derives Epic progress from its child Tickets", () => {
    expect(
      getWorkbenchEpicProgress([
        { status: "done" },
        { status: "in_progress" },
        { status: "done" },
        { status: "todo" },
      ]),
    ).toEqual({ completed: 2, percent: 50, total: 4 });
    expect(getWorkbenchEpicProgress([])).toEqual({ completed: 0, percent: 0, total: 0 });
  });

  it("groups Ticket swimlanes by Epic with unassigned Tickets last", () => {
    const firstEpic = { id: WorkbenchEpicId.make("epic-one"), title: "First Epic" };
    const secondEpic = { id: WorkbenchEpicId.make("epic-two"), title: "Second Epic" };
    const emptyEpic = { id: WorkbenchEpicId.make("epic-empty"), title: "Empty Epic" };
    const firstTicket = { id: "ticket-one", epicId: firstEpic.id };
    const secondTicket = { id: "ticket-two", epicId: secondEpic.id };
    const unassignedTicket = { id: "ticket-three", epicId: null };

    expect(
      groupWorkbenchTicketsByEpic(
        [unassignedTicket, secondTicket, firstTicket],
        [firstEpic, secondEpic, emptyEpic],
      ),
    ).toEqual([
      { epic: firstEpic, tickets: [firstTicket] },
      { epic: secondEpic, tickets: [secondTicket] },
      { epic: emptyEpic, tickets: [] },
      { epic: null, tickets: [unassignedTicket] },
    ]);
  });

  it("opens only the primary repository at the active Thread worktree", () => {
    const primaryProjectId = ProjectId.make("repository-one");
    const secondaryProjectId = ProjectId.make("repository-two");

    expect(
      resolveWorkbenchRepositoryOpenCwd({
        repositoryId: primaryProjectId,
        primaryProjectId,
        repositoryWorkspaceRoot: "/repos/t3code",
        activeThreadWorktreePath: "/repos/t3code/.t3/worktrees/ticket-one",
      }),
    ).toBe("/repos/t3code/.t3/worktrees/ticket-one");
    expect(
      resolveWorkbenchRepositoryOpenCwd({
        repositoryId: secondaryProjectId,
        primaryProjectId,
        repositoryWorkspaceRoot: "/repos/agent-workbench",
        activeThreadWorktreePath: "/repos/t3code/.t3/worktrees/ticket-one",
      }),
    ).toBe("/repos/agent-workbench");
    expect(
      resolveWorkbenchRepositoryOpenCwd({
        repositoryId: primaryProjectId,
        primaryProjectId,
        repositoryWorkspaceRoot: "/repos/t3code",
        activeThreadWorktreePath: null,
      }),
    ).toBe("/repos/t3code");
  });

  it("builds a stable handoff prompt with the ticket title and Markdown", () => {
    expect(
      buildTicketThreadPrompt(
        {
          title: "Add project navigation",
          markdown: "## Goal\n\nLink a ticket to its T3 Thread.",
          kind: "story",
          primaryT3ProjectId: ProjectId.make("repository-one"),
          repositoryProjectIds: [
            ProjectId.make("repository-one"),
            ProjectId.make("repository-two"),
          ],
        },
        [
          {
            id: ProjectId.make("repository-one"),
            title: "T3 Code",
            workspaceRoot: "/repos/t3code",
          },
          {
            id: ProjectId.make("repository-two"),
            title: "Agent Workbench",
            workspaceRoot: "/repos/agent-workbench",
          },
        ],
      ),
    ).toBe(
      [
        "Work on this Agent Workbench Story ticket.",
        "",
        "# Add project navigation",
        "",
        "## Repository scope",
        "",
        "- T3 Code (primary) — /repos/t3code",
        "- Agent Workbench — /repos/agent-workbench",
        "",
        "## Goal",
        "",
        "Link a ticket to its T3 Thread.",
      ].join("\n"),
    );
  });

  it("falls back to the primary Repository for snapshots decoded without a scope", () => {
    const primaryT3ProjectId = ProjectId.make("repository-one");

    expect(
      getWorkbenchTicketRepositoryProjectIds({
        primaryT3ProjectId,
        repositoryProjectIds: [],
      }),
    ).toEqual([primaryT3ProjectId]);
  });

  it("prefers a live Thread when live and archived snapshots transiently overlap", () => {
    const threadId = ThreadId.make("thread-one");

    expect(
      isWorkbenchThreadArchived(
        threadId,
        new Map([[threadId, { state: "live" }]]),
        new Map([[threadId, { state: "archived" }]]),
      ),
    ).toBe(false);
    expect(isWorkbenchThreadArchived(threadId, new Map(), new Map([[threadId, {}]]))).toBe(true);
  });

  it("provides stable product-owned templates for each Ticket kind", () => {
    expect(WORKBENCH_TICKET_KIND_LABELS).toEqual({ story: "Story", bug: "Bug" });
    expect(getWorkbenchTicketTemplate("story")).toContain("## Goal");
    expect(getWorkbenchTicketTemplate("story")).toContain("## Work");
    expect(getWorkbenchTicketTemplate("story")).toContain("## Non-goals");
    expect(getWorkbenchTicketTemplate("story")).toContain("## Testing");
    expect(getWorkbenchTicketTemplate("bug")).toContain("## Observed behavior");
    expect(getWorkbenchTicketTemplate("bug")).toContain("## Environment");
    expect(getWorkbenchTicketTemplate("bug")).toContain("## Root-cause evidence");
    expect(getWorkbenchTicketTemplate("bug")).toContain("## Proposed fix");
    expect(getWorkbenchTicketTemplate("bug")).toContain("## Testing");
    expect(isWorkbenchTicketKind("story")).toBe(true);
    expect(isWorkbenchTicketKind("bug")).toBe(true);
    expect(isWorkbenchTicketKind("task")).toBe(false);
  });

  it("keeps blocked tickets in their workflow status", () => {
    const tickets = [
      { id: "one", status: "todo", blocked: true },
      { id: "two", status: "in_progress", blocked: false },
    ] as const;

    const grouped = ticketsByStatus(tickets);

    expect(grouped.todo).toEqual([tickets[0]]);
    expect(grouped.in_progress).toEqual([tickets[1]]);
    expect(grouped.done).toEqual([]);
  });

  it("uses the Board's product-language status labels", () => {
    expect(WORKBENCH_TICKET_STATUS_LABELS).toEqual({
      todo: "Todo",
      in_progress: "In Progress",
      done: "Done",
    });
  });

  it("offers every other Board column as a direct Ticket destination", () => {
    expect(getWorkbenchTicketStatusMoves("in_progress")).toEqual(["todo", "done"]);
  });

  it("recognizes only supported Board statuses", () => {
    expect(isWorkbenchTicketStatus("ready_for_review")).toBe(false);
    expect(isWorkbenchTicketStatus("blocked")).toBe(false);
    expect(isWorkbenchTicketStatus(null)).toBe(false);
  });

  it("presents the next action for each supported Thread state", () => {
    expect(getWorkbenchThreadPresentation(false, false)).toEqual({
      actionLabel: "Start work",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "Unassigned",
      state: "unassigned",
    });
    expect(getWorkbenchThreadPresentation(true, true)).toEqual({
      actionLabel: "Open Thread",
      pendingActionLabel: "Opening Thread…",
      stateLabel: "Idle",
      state: "linked",
    });
    expect(getWorkbenchThreadPresentation(true, true, "Pending Approval")).toEqual({
      actionLabel: "Open Thread",
      pendingActionLabel: "Opening Thread…",
      stateLabel: "Pending Approval",
      state: "linked",
    });
    expect(getWorkbenchThreadPresentation(true, false, null, true)).toEqual({
      actionLabel: "Restore Thread",
      pendingActionLabel: "Restoring Thread…",
      stateLabel: "Archived",
      state: "archived",
    });
    expect(getWorkbenchThreadPresentation(true, false)).toEqual({
      actionLabel: "Start replacement",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "Thread unavailable",
      state: "missing",
    });
  });

  it("resolves the Workspace and Ticket that own a native Thread", () => {
    const workspaceId = WorkbenchProjectId.make("workspace-one");
    const repositoryId = ProjectId.make("repository-one");
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const threadId = ThreadId.make("thread-one");
    const workspace = {
      id: workspaceId,
      title: "Agent Workbench",
      linkedProjectIds: [repositoryId],
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const ticket = {
      id: ticketId,
      projectId: workspaceId,
      epicId: null,
      title: "Keep Ticket context visible",
      markdown: "",
      kind: "story",
      primaryT3ProjectId: repositoryId,
      repositoryProjectIds: [repositoryId],
      status: "in_progress",
      blocked: false,
      revision: 0,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const assignment = {
      id: WorkbenchAssignmentId.make("assignment-one"),
      ticketId,
      threadId,
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: "2026-09-03T01:00:00.000Z",
    } as const;

    expect(
      getWorkbenchContextForThread(
        {
          projects: [workspace],
          epics: [],
          tickets: [ticket],
          ticketWorkspaces: [],
          assignments: [assignment],
          reservedThreadIds: [],
        },
        threadId,
      ),
    ).toEqual({ assignment, ticket, workspace });
    expect(
      getWorkbenchContextForThread(
        {
          projects: [workspace],
          epics: [],
          tickets: [ticket],
          ticketWorkspaces: [],
          assignments: [assignment],
          reservedThreadIds: [],
        },
        ThreadId.make("another-thread"),
      ),
    ).toBeNull();
  });

  it("surfaces a sibling Thread needing input before another Thread's activity", () => {
    const working = { nativeLabel: "Working", sessionStatus: "running", turnState: "running" };
    const blocked = {
      nativeLabel: "Awaiting Input",
      sessionStatus: "ready",
      turnState: "completed",
    };
    expect(getWorkbenchTicketAgentPresentation([working, blocked])?.label).toBe(
      "Blocked / needs input",
    );
    expect(getWorkbenchTicketAgentPresentation([blocked, working])?.label).toBe(
      "Blocked / needs input",
    );
    expect(getWorkbenchTicketAgentPresentation([working])?.label).toBe("Working");
  });

  it("separates the active Assignment from a Ticket's historical Assignments", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const historical = {
      id: WorkbenchAssignmentId.make("assignment-one"),
      ticketId,
      threadId: ThreadId.make("thread-one"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: "2026-09-03T01:00:00.000Z",
    } as const;
    const active = {
      id: WorkbenchAssignmentId.make("assignment-two"),
      ticketId,
      threadId: ThreadId.make("thread-two"),
      createdAt: "2026-09-03T01:00:00.000Z",
      supersededAt: null,
    } as const;

    expect(getActiveAssignmentsByTicket([historical, active]).get(ticketId)).toEqual(active);
    expect(getAssignmentsForTicket([historical, active], ticketId)).toEqual([active, historical]);
  });

  it("chooses the newest available active Thread independent of assignment order", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const older = {
      id: WorkbenchAssignmentId.make("older"),
      ticketId,
      threadId: ThreadId.make("existing"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    };
    const newer = {
      ...older,
      id: WorkbenchAssignmentId.make("newer"),
      threadId: ThreadId.make("deleted"),
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    expect(getActiveAssignmentsByTicket([newer, older]).get(ticketId)).toEqual(newer);
    expect(
      getActiveAssignmentsByTicket([older, newer], new Set([older.threadId])).get(ticketId),
    ).toEqual(older);
  });

  it("prefers live Threads over archived and missing active assignments", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const live = {
      id: WorkbenchAssignmentId.make("live-assignment"),
      ticketId,
      threadId: ThreadId.make("live-thread"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    } as const;
    const archived = {
      ...live,
      id: WorkbenchAssignmentId.make("archived-assignment"),
      threadId: ThreadId.make("archived-thread"),
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    const missing = {
      ...live,
      id: WorkbenchAssignmentId.make("missing-assignment"),
      threadId: ThreadId.make("missing-thread"),
      createdAt: "2026-09-05T00:00:00.000Z",
    };

    expect(
      getActiveAssignmentsByTicket(
        [missing, archived, live],
        new Set([live.threadId]),
        new Set([archived.threadId]),
      ).get(ticketId),
    ).toEqual(live);
    expect(
      getActiveAssignmentsByTicket(
        [missing, archived, live],
        new Set(),
        new Set([archived.threadId]),
      ).get(ticketId),
    ).toEqual(archived);
  });

  it("opens an existing active Thread even when its primary Repository is unavailable", () => {
    const threadId = ThreadId.make("thread-one");

    expect(
      resolveWorkbenchTicketThreadTarget(
        { primaryT3ProjectId: ProjectId.make("missing-repository") },
        [],
        { threadId },
        new Set([threadId]),
      ),
    ).toEqual({ state: "open", threadId });
  });
});

describe("Workbench agent activity", () => {
  const idle = { nativeLabel: null, sessionStatus: null, turnState: null };
  it("normalizes native activity independently of Ticket progress", () => {
    expect(getWorkbenchAgentPresentation(idle)).toBeNull();
    for (const nativeLabel of ["Working", "Connecting", "Monitoring"]) {
      expect(
        getWorkbenchAgentPresentation({ ...idle, nativeLabel, turnState: "completed" })?.label,
      ).toBe("Working");
    }
    for (const nativeLabel of ["Pending Approval", "Awaiting Input", "Plan Ready"]) {
      expect(
        getWorkbenchAgentPresentation({ ...idle, nativeLabel, sessionStatus: "running" })?.label,
      ).toBe("Blocked / needs input");
    }
    expect(getWorkbenchAgentPresentation({ ...idle, turnState: "completed" })?.label).toBe(
      "Ready for review",
    );
    expect(getWorkbenchAgentPresentation({ ...idle, turnState: "interrupted" })?.label).toBe(
      "Blocked / needs input",
    );
    expect(
      getWorkbenchAgentPresentation({ ...idle, sessionStatus: "error", turnState: "completed" })
        ?.label,
    ).toBe("Blocked / needs input");
  });
});
