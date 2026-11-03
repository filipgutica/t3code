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

describe("archived Ticket content", () => {
  it("keeps legacy content, loads omitted fields on open, and isolates revisions and environments", async () => {
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
    try {
      await act(async () => {
        root = create(view(environmentId, ticket));
      });
      expect(content?.ticket?.markdown).toBe("Original markdown");
      const compact = { ...ticket, markdown: "", markdownOmitted: true };
      await act(async () => root?.update(view(environmentId, compact)));
      expect(content?.ticket).toBeNull();
      const key = JSON.stringify({
        environmentId,
        input: { ticketId: ticket.id, revision: ticket.revision },
      });
      await act(async () => registry.set(ticketQuery(key), AsyncResult.success(ticket)));
      expect(content?.ticket?.markdown).toBe("Original markdown");
      await act(async () => root?.update(view(environmentId, { ...compact, revision: 3 })));
      expect(content?.ticket).toMatchObject({ revision: 3, markdown: "Original markdown" });
      await act(async () => root?.update(view(EnvironmentId.make("other-host"), compact)));
      expect(content?.ticket).toBeNull();
      await act(async () => root?.update(view(environmentId, compact)));
      const activeSnapshot = {
        ...ticket,
        archivedAt: null,
        revision: 4,
        progressDone: 1,
        progressTotal: 2,
      };
      // Restoring keeps the archived content mounted until the new revision loads.
      await act(async () => root?.update(view(environmentId, activeSnapshot)));
      expect(content?.ticket).toMatchObject({ archivedAt: null, markdown: "Original markdown" });
      const activeKey = JSON.stringify({
        environmentId,
        input: { ticketId: ticket.id, revision: 4 },
      });
      await act(async () =>
        registry.set(
          ticketQuery(activeKey),
          AsyncResult.success({
            ...activeSnapshot,
            progress: "- [x] PR 1\n- [ ] PR 2",
          }),
        ),
      );
      expect(content?.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
      const failedSummary = {
        text: "Earlier summary",
        status: "error" as const,
        stale: false,
        error: "Summary generation failed",
      };
      await act(async () =>
        root?.update(view(environmentId, { ...activeSnapshot, generatedSummary: failedSummary })),
      );
      expect(content?.ticket?.generatedSummary).toEqual(failedSummary);
      expect(content?.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
      // An agent edit: the snapshot's revision and brief must stay paired while Progress loads.
      await act(async () =>
        root?.update(
          view(environmentId, {
            ...activeSnapshot,
            revision: 5,
            markdown: "Agent changed the brief",
          }),
        ),
      );
      expect(content?.ticket).toMatchObject({ revision: 5, markdown: "Agent changed the brief" });
      expect(content?.ticket?.progress).toBe("- [x] PR 1\n- [ ] PR 2");
      await act(async () => root?.update(view(EnvironmentId.make("other-host"), activeSnapshot)));
      expect(content?.ticket).toBeNull();
    } finally {
      await act(async () => root?.unmount());
      registry.dispose();
    }
  });
});

describe("Ticket review content", () => {
  it("loads the review base while a review is pending and drops it once the snapshot clears it", async () => {
    const registry = AtomRegistry.make();
    let content: ReturnType<typeof useWorkbenchTicketContent> | undefined;
    function Consumer({ record }: { record: WorkbenchTicket }) {
      const result = useWorkbenchTicketContent(environmentId, record);
      useEffect(() => {
        content = result;
      }, [result]);
      return null;
    }
    const view = (record: WorkbenchTicket) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Consumer, { record }),
      );
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
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(view(reviewed));
      });
      await act(async () =>
        registry.set(
          ticketQuery(
            JSON.stringify({ environmentId, input: { ticketId: ticket.id, revision: 6 } }),
          ),
          AsyncResult.success({ ...reviewed, reviewBase }),
        ),
      );
      expect(content?.ticket).toMatchObject({ markdown: "Agent changed the brief", reviewBase });
      // Accept bumps the revision; until it loads, the earlier base must not show as a review.
      await act(async () => root?.update(view({ ...reviewed, revision: 7, reviewPending: false })));
      expect(content?.ticket?.reviewBase ?? null).toBeNull();
    } finally {
      await act(async () => root?.unmount());
      registry.dispose();
    }
  });

  it("shows a review only from the read of the revision Accept and Undo will name", async () => {
    const registry = AtomRegistry.make();
    let content: ReturnType<typeof useWorkbenchTicketContent> | undefined;
    function Consumer({ record }: { record: WorkbenchTicket }) {
      const result = useWorkbenchTicketContent(environmentId, record);
      useEffect(() => {
        content = result;
      }, [result]);
      return null;
    }
    const view = (record: WorkbenchTicket) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Consumer, { record }),
      );
    const key = (revision: number) =>
      JSON.stringify({ environmentId, input: { ticketId: ticket.id, revision } });
    const first = {
      ...ticket,
      archivedAt: null,
      revision: 10,
      markdown: "First agent edit",
      reviewPending: true,
    };
    const firstBase = { title: ticket.title, markdown: "Before the first edit" };
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(view(first));
      });
      await act(async () =>
        registry.set(
          ticketQuery(key(10)),
          AsyncResult.success({ ...first, reviewBase: firstBase }),
        ),
      );
      expect(content?.ticket?.reviewBase).toEqual(firstBase);
      // Accept, then another agent edit: a new review whose base revision 12 has not loaded yet.
      const second = { ...first, revision: 12, markdown: "Second agent edit" };
      await act(async () => root?.update(view(second)));
      expect(content?.ticket).toMatchObject({ markdown: "Second agent edit", reviewBase: null });
      const secondBase = { title: ticket.title, markdown: "First agent edit" };
      await act(async () =>
        registry.set(
          ticketQuery(key(12)),
          AsyncResult.success({ ...second, reviewBase: secondBase }),
        ),
      );
      expect(content?.ticket?.reviewBase).toEqual(secondBase);
    } finally {
      await act(async () => root?.unmount());
      registry.dispose();
    }
  });

  it("keeps a Ticket shown while the first review's base loads", async () => {
    const registry = AtomRegistry.make();
    let content: ReturnType<typeof useWorkbenchTicketContent> | undefined;
    function Consumer({ record }: { record: WorkbenchTicket }) {
      const result = useWorkbenchTicketContent(environmentId, record);
      useEffect(() => {
        content = result;
      }, [result]);
      return null;
    }
    const view = (record: WorkbenchTicket) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Consumer, { record }),
      );
    const active = { ...ticket, archivedAt: null, revision: 8 };
    const edited = {
      ...active,
      revision: 9,
      markdown: "Agent changed the brief",
      reviewPending: true,
    };
    const reviewBase = { title: ticket.title, markdown: ticket.markdown };
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(view(active));
      });
      // An agent edit starts the first review; the page must not drop to a loading state.
      await act(async () => root?.update(view(edited)));
      expect(content?.ticket).toMatchObject({ markdown: "Agent changed the brief" });
      await act(async () =>
        registry.set(
          ticketQuery(
            JSON.stringify({ environmentId, input: { ticketId: ticket.id, revision: 9 } }),
          ),
          AsyncResult.success({ ...edited, reviewBase }),
        ),
      );
      expect(content?.ticket).toMatchObject({ markdown: "Agent changed the brief", reviewBase });
    } finally {
      await act(async () => root?.unmount());
      registry.dispose();
    }
  });
});
