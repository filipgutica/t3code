import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";

import type { WorkbenchSidebarTicket } from "./workbenchSidebar.logic";
import { getWorkbenchSidebarSearchResults } from "./workbenchSidebarSearch.logic";

const workspaceId = WorkbenchProjectId.make("analytics");
const otherWorkspaceId = WorkbenchProjectId.make("tools");
const ticket = {
  id: WorkbenchTicketId.make("query-ticket"),
  projectId: workspaceId,
  title: "Improve query performance",
  status: "in_progress",
  archivedAt: null,
} satisfies WorkbenchSidebarTicket;
const archivedTicket = {
  ...ticket,
  id: WorkbenchTicketId.make("archived-ticket"),
  title: "Previous query implementation",
  archivedAt: "2026-10-01T00:00:00Z",
};
const thread = {
  id: ThreadId.make("execution"),
  environmentId: EnvironmentId.make("remote-environment"),
  title: "Investigate slow plans",
  archivedAt: null,
  settledOverride: null,
  createdAt: "2026-10-01T00:00:00Z",
  pinnedAt: null,
  pinOrderKey: null,
};
const reference = (ticketId: WorkbenchTicketId, url: string, title: string | null = null) => ({
  ticketId,
  url,
  title,
  addedByThreadId: null,
  createdAt: "2026-10-01T00:00:00Z",
});
const draft = {
  id: WorkbenchTicketId.make("unsaved-ticket"),
  title: "Draft query optimization",
};
const inputs = {
  projects: [
    { id: workspaceId, title: "Analytics", archivedAt: null },
    { id: otherWorkspaceId, title: "Tools", archivedAt: null },
  ],
  ticketGroupsByWorkspace: new Map([
    [
      workspaceId,
      {
        active: [{ ticket, threads: [thread] }],
        // The selected archived Ticket can also be present in the visible groups.
        done: [{ ticket: archivedTicket, threads: [] }],
      },
    ],
  ]),
  archivedTicketsByWorkspace: new Map([[workspaceId, [archivedTicket]]]),
  referencesByTicket: new Map([
    [ticket.id, [reference(ticket.id, "https://acme.atlassian.net/browse/MA-5517")]],
    [draft.id, [reference(draft.id, "https://figma.com/file/abc", "Planner mockups")]],
  ]),
  draftsByWorkspace: new Map([[workspaceId, [draft]]]),
};

describe("Workbench sidebar search destinations", () => {
  it("returns no results for a blank query or data outside the supplied Workspaces", () => {
    expect(getWorkbenchSidebarSearchResults({ ...inputs, query: "  " })).toEqual([]);
    expect(getWorkbenchSidebarSearchResults({ ...inputs, projects: [], query: "query" })).toEqual(
      [],
    );
  });

  it("returns the matching Workspace without unrelated child destinations", () => {
    expect(getWorkbenchSidebarSearchResults({ ...inputs, query: "  ANALYTICS " })).toEqual([
      {
        kind: "workspace",
        key: "workspace:analytics",
        title: "Analytics",
        subtitle: "Workspace overview",
        workspaceId,
        workspaceTitle: "Analytics",
      },
    ]);
  });

  it("matches Reference labels case-insensitively and opens the owning Ticket", () => {
    expect(getWorkbenchSidebarSearchResults({ ...inputs, query: "ma-5517" })).toEqual([
      expect.objectContaining({
        kind: "ticket",
        title: ticket.title,
        ticketId: ticket.id,
        workspaceId,
        subtitle: "Analytics · MA-5517",
      }),
    ]);
  });

  it("matches a draft by its Reference title", () => {
    expect(getWorkbenchSidebarSearchResults({ ...inputs, query: "mockups" })).toEqual([
      expect.objectContaining({ kind: "draft", ticketId: draft.id, title: draft.title }),
    ]);
  });

  it("returns a matching Thread directly with its environment and parent Ticket", () => {
    expect(getWorkbenchSidebarSearchResults({ ...inputs, query: "slow plans" })).toEqual([
      expect.objectContaining({
        kind: "thread",
        title: thread.title,
        workspaceId,
        ticketId: ticket.id,
        thread,
        subtitle: "Analytics · MA-5517 · Improve query performance",
      }),
    ]);
  });

  it("includes archived Tickets once and keeps drafts as their own destinations", () => {
    const results = getWorkbenchSidebarSearchResults({ ...inputs, query: "query" });
    expect(results.map(({ kind, title }) => ({ kind, title }))).toEqual([
      { kind: "ticket", title: ticket.title },
      { kind: "ticket", title: archivedTicket.title },
      { kind: "draft", title: draft.title },
    ]);
    expect(results[1]).toEqual(
      expect.objectContaining({
        ticketId: archivedTicket.id,
        workspaceId,
        subtitle: "Analytics · Archived",
      }),
    );
    expect(results[2]).toEqual(
      expect.objectContaining({ ticketId: draft.id, workspaceId, subtitle: "Analytics" }),
    );
    expect(new Set(results.map(({ key }) => key)).size).toBe(results.length);
  });
});
