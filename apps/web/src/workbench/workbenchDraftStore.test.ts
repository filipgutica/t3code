import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";

import { isWorkbenchDraftProjected, useWorkbenchDraftStore } from "./workbenchDraftStore";

describe("Workbench Ticket drafts", () => {
  const environmentId = EnvironmentId.make("environment-one");

  it("retains a draft until the user saves or discards it", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const draft = {
      title: " Updated title ",
      markdown: " Unsaved context ",
      mode: "editing" as const,
      revision: 3,
    };

    useWorkbenchDraftStore.getState().setDraft(environmentId, ticketId, draft);
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual(
      draft,
    );

    useWorkbenchDraftStore.getState().markDraftSaved(
      environmentId,
      ticketId,
      {
        title: "Updated title",
        markdown: "Unsaved context",
      },
      draft,
    );
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual({
      title: "Updated title",
      markdown: "Unsaved context",
      mode: "saved",
      revision: 3,
    });

    useWorkbenchDraftStore.getState().clearDraft(environmentId, ticketId);
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)).toBeUndefined();
  });

  it("keeps a newer edit when an earlier save resolves", () => {
    const ticketId = WorkbenchTicketId.make("ticket-save-race");
    useWorkbenchDraftStore.getState().setDraft(environmentId, ticketId, {
      title: "Submitted title",
      markdown: "Submitted context",
      mode: "editing",
    });

    useWorkbenchDraftStore.getState().setDraft(environmentId, ticketId, {
      title: "Newer title",
      markdown: "Newer context",
      mode: "editing",
    });
    useWorkbenchDraftStore.getState().markDraftSaved(
      environmentId,
      ticketId,
      {
        title: "Submitted title",
        markdown: "Submitted context",
      },
      {
        title: "Submitted title",
        markdown: "Submitted context",
      },
    );

    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual({
      title: "Newer title",
      markdown: "Newer context",
      mode: "editing",
    });

    useWorkbenchDraftStore.getState().clearDraft(environmentId, ticketId);
  });

  it("keeps drafts with the same Ticket ID isolated by environment", () => {
    const otherEnvironmentId = EnvironmentId.make("environment-two");
    const ticketId = WorkbenchTicketId.make("shared-ticket");
    const firstDraft = { title: "First", markdown: "One", mode: "editing" as const };
    const secondDraft = { title: "Second", markdown: "Two", mode: "editing" as const };

    useWorkbenchDraftStore.getState().setDraft(environmentId, ticketId, firstDraft);
    useWorkbenchDraftStore.getState().setDraft(otherEnvironmentId, ticketId, secondDraft);

    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual(
      firstDraft,
    );
    expect(useWorkbenchDraftStore.getState().drafts.get(otherEnvironmentId)?.get(ticketId)).toEqual(
      secondDraft,
    );

    useWorkbenchDraftStore.getState().clearDraft(environmentId, ticketId);
    useWorkbenchDraftStore.getState().clearDraft(otherEnvironmentId, ticketId);
  });

  it("advances the saved revision while retaining typing for the next save", () => {
    const ticketId = WorkbenchTicketId.make("ticket-save-again");
    const submitted = {
      title: "Ticket",
      markdown: "First save",
      mode: "editing" as const,
      revision: 3,
    };
    const store = useWorkbenchDraftStore.getState();
    store.setDraft(environmentId, ticketId, { ...submitted, markdown: "Typed during save" });
    store.markDraftSaved(environmentId, ticketId, { ...submitted, revision: 4 }, submitted);
    const next = useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId);
    expect(next).toEqual({ ...submitted, markdown: "Typed during save", revision: 4 });
    if (!next) throw new Error("Expected the pending draft to remain available");
    store.markDraftSaved(environmentId, ticketId, { ...next, revision: 5 }, next);
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual({
      ...next,
      revision: 5,
      mode: "saved",
      savedVersion: { revision: 5 },
    });
    store.clearDraft(environmentId, ticketId);
  });

  it("advances the Jira version without replacing text typed during a save", () => {
    const ticketId = WorkbenchTicketId.make("ticket-jira-save-again");
    const submitted = {
      title: "Jira Ticket",
      markdown: "Submitted",
      mode: "editing" as const,
      revision: 3,
      jiraRemoteUpdatedAt: "2026-09-05T01:00:00.000Z",
    };
    const store = useWorkbenchDraftStore.getState();
    store.setDraft(environmentId, ticketId, { ...submitted, markdown: "Newer typing" });
    store.markDraftSaved(
      environmentId,
      ticketId,
      { ...submitted, jiraRemoteUpdatedAt: "2026-09-05T01:01:00.000Z" },
      submitted,
    );
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual({
      ...submitted,
      markdown: "Newer typing",
      jiraRemoteUpdatedAt: "2026-09-05T01:01:00.000Z",
    });
    store.clearDraft(environmentId, ticketId);
  });

  it("does not acknowledge an old response against a draft with a different base revision", () => {
    const ticketId = WorkbenchTicketId.make("ticket-stale-save-response");
    const current = { title: "Ticket", markdown: "Current", mode: "editing" as const, revision: 6 };
    const store = useWorkbenchDraftStore.getState();
    store.setDraft(environmentId, ticketId, current);
    store.markDraftSaved(
      environmentId,
      ticketId,
      { ...current, revision: 4 },
      { ...current, revision: 3 },
    );
    expect(useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId)).toEqual(
      current,
    );
    store.clearDraft(environmentId, ticketId);
  });

  it("stops overlaying a saved draft when a newer projection arrives before its refresh", () => {
    const ticketId = WorkbenchTicketId.make("ticket-newer-projection");
    const submitted = { title: "Ticket", markdown: "B", mode: "editing" as const, revision: 3 };
    const store = useWorkbenchDraftStore.getState();
    store.setDraft(environmentId, ticketId, submitted);
    store.markDraftSaved(environmentId, ticketId, { ...submitted, revision: 4 }, submitted);
    const draft = useWorkbenchDraftStore.getState().drafts.get(environmentId)?.get(ticketId);
    expect(
      isWorkbenchDraftProjected({ draft, ticket: { title: "Ticket", markdown: "A", revision: 3 } }),
    ).toBe(false);
    expect(
      isWorkbenchDraftProjected({ draft, ticket: { title: "Ticket", markdown: "C", revision: 5 } }),
    ).toBe(true);
    // An unsaved draft keeps its original conflict-checking baseline.
    expect(
      isWorkbenchDraftProjected({
        draft: submitted,
        ticket: { title: "Ticket", markdown: "C", revision: 5 },
      }),
    ).toBe(false);
    store.clearDraft(environmentId, ticketId);
  });

  it("waits for the saved Jira version and accepts a newer Jira projection", () => {
    const draft = {
      title: "Ticket",
      markdown: "B",
      mode: "saved" as const,
      revision: 3,
      savedVersion: { jiraRemoteUpdatedAt: "2026-09-05T02:00:00.000Z" },
    };
    const ticket = { title: "Ticket", markdown: "C", revision: 5 };
    expect(
      isWorkbenchDraftProjected({ draft, ticket, jiraRemoteUpdatedAt: "2026-09-05T01:00:00.000Z" }),
    ).toBe(false);
    expect(
      isWorkbenchDraftProjected({ draft, ticket, jiraRemoteUpdatedAt: "2026-09-05T03:00:00.000Z" }),
    ).toBe(true);
  });
});
