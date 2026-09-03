import { describe, expect, it } from "@effect/vitest";

import {
  buildTicketThreadPrompt,
  getWorkbenchThreadPresentation,
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

  it("presents the next action for each supported Thread state", () => {
    expect(getWorkbenchThreadPresentation(false, false)).toEqual({
      actionLabel: "Start work",
      stateLabel: "Unassigned",
      state: "unassigned",
    });
    expect(getWorkbenchThreadPresentation(true, true)).toEqual({
      actionLabel: "Open Thread",
      stateLabel: "Thread linked",
      state: "linked",
    });
    expect(getWorkbenchThreadPresentation(true, false)).toEqual({
      actionLabel: "Start replacement",
      stateLabel: "Thread unavailable",
      state: "missing",
    });
  });
});
