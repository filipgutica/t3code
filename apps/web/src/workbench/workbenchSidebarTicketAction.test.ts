import { describe, expect, it, vi } from "@effect/vitest";
import { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";

import {
  enqueueWorkbenchSidebarTicketAction,
  peekWorkbenchSidebarTicketAction,
  subscribeWorkbenchSidebarTicketActions,
  takeWorkbenchSidebarTicketAction,
} from "./workbenchSidebarTicketAction";

describe("sidebar Ticket action handoff", () => {
  it("delivers only the matching environment and Ticket action, once", () => {
    const onAction = vi.fn();
    const unsubscribe = subscribeWorkbenchSidebarTicketActions(onAction);
    const action = {
      kind: "status" as const,
      environmentId: EnvironmentId.make("env-sidebar-action"),
      ticketId: WorkbenchTicketId.make("ticket-sidebar-action"),
      status: "done" as const,
    };

    enqueueWorkbenchSidebarTicketAction(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(peekWorkbenchSidebarTicketAction(EnvironmentId.make("other-env"))).toBeNull();
    expect(
      takeWorkbenchSidebarTicketAction(
        action.environmentId,
        WorkbenchTicketId.make("other-ticket"),
      ),
    ).toBeNull();
    expect(peekWorkbenchSidebarTicketAction(action.environmentId)).toEqual(action);
    expect(takeWorkbenchSidebarTicketAction(action.environmentId, action.ticketId)).toEqual(action);
    expect(takeWorkbenchSidebarTicketAction(action.environmentId, action.ticketId)).toBeNull();

    unsubscribe();
    enqueueWorkbenchSidebarTicketAction({ ...action, kind: "new-thread" });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(takeWorkbenchSidebarTicketAction(action.environmentId, action.ticketId)).toMatchObject({
      kind: "new-thread",
    });
  });

  it("keeps the most recent action for an environment", () => {
    const environmentId = EnvironmentId.make("env-sidebar-replace");
    const previousTicketId = WorkbenchTicketId.make("ticket-sidebar-previous");
    const ticketId = WorkbenchTicketId.make("ticket-sidebar-latest");
    enqueueWorkbenchSidebarTicketAction({
      environmentId,
      ticketId: previousTicketId,
      kind: "new-thread",
    });
    enqueueWorkbenchSidebarTicketAction({
      environmentId,
      ticketId,
      kind: "archive",
      archived: true,
    });

    expect(takeWorkbenchSidebarTicketAction(environmentId, previousTicketId)).toBeNull();
    expect(takeWorkbenchSidebarTicketAction(environmentId, ticketId)).toMatchObject({
      kind: "archive",
      archived: true,
    });
  });

  it("does not replay a stale action when the Ticket is opened later", () => {
    const now = vi.spyOn(Date, "now");
    const environmentId = EnvironmentId.make("env-sidebar-expired");
    const ticketId = WorkbenchTicketId.make("ticket-sidebar-expired");
    try {
      now.mockReturnValue(1_000);
      enqueueWorkbenchSidebarTicketAction({ environmentId, ticketId, kind: "new-thread" });
      now.mockReturnValue(32_000);
      expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
      expect(takeWorkbenchSidebarTicketAction(environmentId, ticketId)).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});
