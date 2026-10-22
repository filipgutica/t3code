import { createElement, useEffect } from "react";
import { act, render } from "../../test/render";
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
      input: {
        ticketId: WorkbenchTicketId;
        revision: number;
      };
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
  it("keeps legacy content, loads compact content on open, and isolates revisions and environments", async () => {
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
    try {
      await using screen = await render(view(environmentId, ticket));
      expect(content?.ticket?.markdown).toBe("Original markdown");
      const compact = { ...ticket, markdown: "", markdownOmitted: true };
      await screen.rerender(view(environmentId, compact));
      expect(content?.ticket).toBeNull();
      const key = JSON.stringify({
        environmentId,
        input: { ticketId: ticket.id, revision: ticket.revision },
      });
      await act(async () => registry.set(ticketQuery(key), AsyncResult.success(ticket)));
      expect(content?.ticket?.markdown).toBe("Original markdown");
      await screen.rerender(view(environmentId, { ...compact, revision: 3 }));
      expect(content?.ticket).toBeNull();
      await screen.rerender(view(EnvironmentId.make("other-host"), compact));
      expect(content?.ticket).toBeNull();
    } finally {
      registry.dispose();
    }
  });
});
