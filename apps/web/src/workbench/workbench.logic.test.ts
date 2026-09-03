import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import {
  buildTicketThreadPrompt,
  getWorkbenchContextForThread,
  getWorkbenchThreadPresentation,
  getWorkbenchTicketStatusMoves,
  isWorkbenchTicketStatus,
  ticketsByStatus,
  WORKBENCH_TICKET_STATUS_LABELS,
} from "./workbench.logic";

describe("Workbench ticket helpers", () => {
  it("builds a stable handoff prompt with the ticket title and Markdown", () => {
    expect(
      buildTicketThreadPrompt({
        title: "Add project navigation",
        markdown: "## Goal\n\nLink a ticket to its T3 Thread.",
      }),
    ).toBe(
      [
        "Work on this Agent Workbench ticket.",
        "",
        "# Add project navigation",
        "",
        "## Goal",
        "",
        "Link a ticket to its T3 Thread.",
      ].join("\n"),
    );
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
      title: "Keep Ticket context visible",
      markdown: "",
      primaryT3ProjectId: repositoryId,
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
    } as const;

    expect(
      getWorkbenchContextForThread(
        { projects: [workspace], tickets: [ticket], assignments: [assignment] },
        threadId,
      ),
    ).toEqual({ assignment, ticket, workspace });
    expect(
      getWorkbenchContextForThread(
        { projects: [workspace], tickets: [ticket], assignments: [assignment] },
        ThreadId.make("another-thread"),
      ),
    ).toBeNull();
  });
});
