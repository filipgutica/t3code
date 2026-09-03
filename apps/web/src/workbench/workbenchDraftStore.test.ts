import { describe, expect, it } from "@effect/vitest";
import { WorkbenchTicketId } from "@t3tools/contracts";

import { useWorkbenchDraftStore } from "./workbenchDraftStore";

describe("Workbench Ticket drafts", () => {
  it("retains a draft until the user saves or discards it", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const draft = {
      title: " Updated title ",
      markdown: " Unsaved context ",
      mode: "editing" as const,
    };

    useWorkbenchDraftStore.getState().setDraft(ticketId, draft);
    expect(useWorkbenchDraftStore.getState().drafts.get(ticketId)).toEqual(draft);

    useWorkbenchDraftStore.getState().markDraftSaved(ticketId, {
      title: "Updated title",
      markdown: "Unsaved context",
    });
    expect(useWorkbenchDraftStore.getState().drafts.get(ticketId)).toEqual({
      title: "Updated title",
      markdown: "Unsaved context",
      mode: "saved",
    });

    useWorkbenchDraftStore.getState().clearDraft(ticketId);
    expect(useWorkbenchDraftStore.getState().drafts.has(ticketId)).toBe(false);
  });
});
