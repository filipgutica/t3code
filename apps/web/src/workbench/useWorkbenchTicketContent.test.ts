import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchTicketContent } from "./useWorkbenchTicketContent";

vi.mock("./state", () => ({
  workbenchEnvironment: {
    ticket: (target: {
      environmentId: EnvironmentId;
      input: { ticketId: WorkbenchTicketId; revision: number };
    }) => ticketQuery(JSON.stringify(target)),
  },
}));
const ticketQuery = Atom.family((_key: string) =>
  Atom.make<AsyncResult.AsyncResult<WorkbenchTicket | null>>(AsyncResult.initial()),
);
const environmentId = EnvironmentId.make("archive-host");
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("archived-ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Archived content",
  markdown: "Original markdown",
  repositoryProjectIds: [],
  status: "done",
  blocked: false,
  revision: 2,
  archivedAt: "2026-10-17T10:00:00.000Z",
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:00:00.000Z",
};

/** Mounts the hook for `record`; `update` re-renders it, `deliver` answers a revision's read. */
async function mountTicketContent(record: WorkbenchTicket) {
  const registry = AtomRegistry.make();
  let content: ReturnType<typeof useWorkbenchTicketContent> | undefined;
  function Consumer({ host, record }: { host: EnvironmentId; record: WorkbenchTicket }) {
    const result = useWorkbenchTicketContent(host, record);
    useEffect(() => {
      content = result;
    }, [result]);
    return null;
  }
  const view = (host: EnvironmentId, record: WorkbenchTicket) =>
    createElement(
      RegistryContext.Provider,
      { value: registry },
      createElement(Consumer, { host, record }),
    );
  let root: ReturnType<typeof create> | undefined;
  await act(async () => {
    root = create(view(environmentId, record));
  });
  return {
    get ticket() {
      return content?.ticket;
    },
    update: (next: WorkbenchTicket, host = environmentId) =>
      act(async () => root?.update(view(host, next))),
    deliver: (revision: number, read: WorkbenchTicket) =>
      act(async () =>
        registry.set(
          ticketQuery(JSON.stringify({ environmentId, input: { ticketId: ticket.id, revision } })),
          AsyncResult.success(read),
        ),
      ),
    [Symbol.asyncDispose]: async () => {
      await act(async () => root?.unmount());
      registry.dispose();
    },
  };
}

describe("archived Ticket content", () => {
  it("keeps legacy content, loads omitted fields on open, and isolates revisions and environments", async () => {
    await using view = await mountTicketContent(ticket);
    expect(view.ticket?.markdown).toBe("Original markdown");
    const compact = { ...ticket, markdown: "", markdownOmitted: true };
    await view.update(compact);
    expect(view.ticket).toBeNull();
    await view.deliver(ticket.revision, ticket);
    expect(view.ticket?.markdown).toBe("Original markdown");
    await view.update({ ...compact, revision: 3 });
    expect(view.ticket).toMatchObject({ revision: 3, markdown: "Original markdown" });
    await view.update(compact, EnvironmentId.make("other-host"));
    expect(view.ticket).toBeNull();
    await view.update(compact);
    const activeSnapshot = {
      ...ticket,
      archivedAt: null,
      revision: 4,
      progressDone: 1,
      progressTotal: 2,
    };
    // Restoring keeps the archived content mounted until the new revision loads.
    await view.update(activeSnapshot);
    expect(view.ticket).toMatchObject({ archivedAt: null, markdown: "Original markdown" });
    await view.deliver(4, { ...activeSnapshot, progress: "- [x] PR 1\n- [ ] PR 2" });
    expect(view.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
    const failedSummary = {
      text: "Earlier summary",
      status: "error" as const,
      stale: false,
      error: "Summary generation failed",
    };
    await view.update({ ...activeSnapshot, generatedSummary: failedSummary });
    expect(view.ticket?.generatedSummary).toEqual(failedSummary);
    expect(view.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
    // An agent edit: the snapshot's revision and brief must stay paired while Progress loads.
    await view.update({ ...activeSnapshot, revision: 5, markdown: "Agent changed the brief" });
    expect(view.ticket).toMatchObject({ revision: 5, markdown: "Agent changed the brief" });
    expect(view.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
    await view.update(activeSnapshot, EnvironmentId.make("other-host"));
    expect(view.ticket).toBeNull();
  });
});

describe("Ticket review content", () => {
  it("loads the review base while a review is pending and drops it once the snapshot clears it", async () => {
    const reviewed = {
      ...ticket,
      archivedAt: null,
      markdown: "Agent changed the brief",
      revision: 6,
      reviewPending: true,
      // Progress is omitted too, so the query keeps running after the review ends.
      progressDone: 0,
      progressTotal: 1,
    };
    const reviewBase = { title: ticket.title, markdown: "Original markdown" };
    await using view = await mountTicketContent(reviewed);
    await view.deliver(6, { ...reviewed, reviewBase });
    expect(view.ticket).toMatchObject({ markdown: "Agent changed the brief", reviewBase });
    // Accept bumps the revision; until it loads, the earlier base must not show as a review.
    await view.update({ ...reviewed, revision: 7, reviewPending: false });
    expect(view.ticket?.reviewBase ?? null).toBeNull();
  });

  it("shows a review only from the read of the revision Accept and Undo will name", async () => {
    const first = {
      ...ticket,
      archivedAt: null,
      revision: 10,
      markdown: "First agent edit",
      reviewPending: true,
    };
    const firstBase = { title: ticket.title, markdown: "Before the first edit" };
    await using view = await mountTicketContent(first);
    await view.deliver(10, { ...first, reviewBase: firstBase });
    expect(view.ticket?.reviewBase).toEqual(firstBase);
    // Accept, then another agent edit: a new review whose base revision 12 has not loaded yet.
    const second = { ...first, revision: 12, markdown: "Second agent edit" };
    await view.update(second);
    expect(view.ticket).toMatchObject({ markdown: "Second agent edit", reviewBase: null });
    const secondBase = { title: ticket.title, markdown: "First agent edit" };
    await view.deliver(12, { ...second, reviewBase: secondBase });
    expect(view.ticket?.reviewBase).toEqual(secondBase);
  });

  it("keeps a Ticket shown while the first review's base loads", async () => {
    const active = { ...ticket, archivedAt: null, revision: 8 };
    const edited = {
      ...active,
      revision: 9,
      markdown: "Agent changed the brief",
      reviewPending: true,
    };
    const reviewBase = { title: ticket.title, markdown: ticket.markdown };
    await using view = await mountTicketContent(active);
    // An agent edit starts the first review; the page must not drop to a loading state.
    await view.update(edited);
    expect(view.ticket).toMatchObject({ markdown: "Agent changed the brief" });
    await view.deliver(9, { ...edited, reviewBase });
    expect(view.ticket).toMatchObject({ markdown: "Agent changed the brief", reviewBase });
  });
});
