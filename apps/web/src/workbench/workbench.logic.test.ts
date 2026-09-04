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
  getAssignmentsForTicket,
  getWorkbenchContextForThread,
  groupWorkbenchTicketsByEpic,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketTemplate,
  getWorkbenchThreadPresentation,
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
  it("groups Ticket swimlanes by Epic with unassigned Tickets last", () => {
    const firstEpic = { id: WorkbenchEpicId.make("epic-one"), title: "First Epic" };
    const secondEpic = { id: WorkbenchEpicId.make("epic-two"), title: "Second Epic" };
    const firstTicket = { id: "ticket-one", epicId: firstEpic.id };
    const secondTicket = { id: "ticket-two", epicId: secondEpic.id };
    const unassignedTicket = { id: "ticket-three", epicId: null };

    expect(
      groupWorkbenchTicketsByEpic(
        [unassignedTicket, secondTicket, firstTicket],
        [firstEpic, secondEpic],
      ),
    ).toEqual([
      { epic: firstEpic, tickets: [firstTicket] },
      { epic: secondEpic, tickets: [secondTicket] },
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
    expect(grouped.ready_for_review).toEqual([]);
    expect(grouped.done).toEqual([]);
  });

  it("uses the Board's product-language status labels", () => {
    expect(WORKBENCH_TICKET_STATUS_LABELS).toEqual({
      todo: "Todo",
      in_progress: "In Progress",
      ready_for_review: "Ready for Review",
      done: "Done",
    });
  });

  it("offers every other Board column as a direct Ticket destination", () => {
    expect(getWorkbenchTicketStatusMoves("in_progress")).toEqual([
      "todo",
      "ready_for_review",
      "done",
    ]);
  });

  it("recognizes only supported Board statuses", () => {
    expect(isWorkbenchTicketStatus("ready_for_review")).toBe(true);
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
      stateLabel: "Ready",
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
        },
        ThreadId.make("another-thread"),
      ),
    ).toBeNull();
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
