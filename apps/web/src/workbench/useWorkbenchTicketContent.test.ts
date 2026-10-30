import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  EnvironmentId,
  ProjectId,
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
  epicId: null,
  title: "Archived content",
  kind: "story",
  markdown: "Original markdown",
  primaryT3ProjectId: ProjectId.make("native"),
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
