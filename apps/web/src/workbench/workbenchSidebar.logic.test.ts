import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import {
  getWorkbenchSidebarExpansionDefaults,
  getWorkbenchSidebarTicketGroups,
  reduceWorkbenchSidebarExpansion,
  revealWorkbenchSidebarSelection,
  type WorkbenchSidebarExpansion,
} from "./workbenchSidebar.logic";

const environmentId = EnvironmentId.make("environment-one");
const otherEnvironmentId = EnvironmentId.make("environment-two");
const workspaceId = WorkbenchProjectId.make("workspace-one");
const otherWorkspaceId = WorkbenchProjectId.make("workspace-two");

const ticket = (
  id: string,
  projectId = workspaceId,
  status: "todo" | "in_progress" | "done" = "in_progress",
) => ({
  id: WorkbenchTicketId.make(id),
  projectId,
  title: id,
  status,
  archivedAt: null,
});

const assignment = (
  id: string,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: string,
) => ({
  id: WorkbenchAssignmentId.make(id),
  ticketId,
  threadId,
  createdAt,
  supersededAt: null,
});

const thread = (
  id: string,
  title = id,
  threadEnvironmentId = environmentId,
  archivedAt: string | null = null,
) => ({
  id: ThreadId.make(id),
  environmentId: threadEnvironmentId,
  title,
  archivedAt,
  settledOverride: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  pinnedAt: null,
  pinOrderKey: null,
});

describe("Workbench sidebar ticket groups", () => {
  it("keeps live threads in their ticket group and retains the selected ticket", () => {
    const activeTicket = ticket("active-ticket");
    const selectedTicket = ticket("selected-ticket");
    const unrelatedTicket = ticket("unrelated-ticket", otherWorkspaceId);
    const activeThread = thread("active-thread", "Active Thread");
    const newerThread = thread("newer-thread", "Newer Thread");
    const archivedThread = thread(
      "archived-thread",
      "Archived Thread",
      environmentId,
      "2026-01-01",
    );
    const remoteThread = thread("remote-thread", "Remote Thread", otherEnvironmentId);

    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [activeTicket, selectedTicket, unrelatedTicket],
      assignments: [
        assignment("old", activeTicket.id, activeThread.id, "2026-01-01"),
        assignment("new", activeTicket.id, newerThread.id, "2026-02-01"),
        assignment("archived", activeTicket.id, archivedThread.id, "2026-03-01"),
        assignment("remote", activeTicket.id, remoteThread.id, "2026-04-01"),
      ],
      threads: [activeThread, newerThread, archivedThread, remoteThread],
      selectedTicketId: selectedTicket.id,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [
        {
          ticket: activeTicket,
          threads: [newerThread, activeThread],
        },
        {
          ticket: selectedTicket,
          threads: [],
        },
      ],
      done: [],
    });
    expect(groups.has(otherWorkspaceId)).toBe(false);
  });

  it("retains replaced thread history after un-settling but ignores archived tickets", () => {
    const supersededTicket = ticket("superseded-ticket");
    const archivedTicket = { ...ticket("archived-ticket"), archivedAt: "2026-01-01" };
    const historyTicket = ticket("history");
    const supersededThread = thread("superseded-thread");
    const archivedTicketThread = thread("archived-ticket-thread");
    const historicalThread = { ...thread("historical"), settledOverride: "active" as const };

    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [supersededTicket, archivedTicket, historyTicket],
      assignments: [
        {
          ...assignment("superseded", supersededTicket.id, supersededThread.id, "2026-01-01"),
          supersededAt: "2026-01-02",
        },
        assignment("archived-ticket", archivedTicket.id, archivedTicketThread.id, "2026-01-01"),
        {
          ...assignment("old", historyTicket.id, historicalThread.id, "2026-01-01"),
          supersededAt: "2026-01-02",
        },
      ],
      threads: [supersededThread, archivedTicketThread, historicalThread],
      selectedTicketId: historyTicket.id,
      selectedThreadId: historicalThread.id,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [
        { ticket: supersededTicket, threads: [supersededThread] },
        { ticket: historyTicket, threads: [historicalThread] },
      ],
      done: [],
    });
  });

  it("keeps active and settled threads under one ticket", () => {
    const mixed = ticket("mixed");
    const active = thread("active");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const input = {
      environmentId,
      tickets: [mixed],
      assignments: [
        assignment("active", mixed.id, active.id, "2026-01-01"),
        assignment("settled", mixed.id, settled.id, "2026-02-01"),
      ],
      threads: [active, settled],
    };
    expect(
      getWorkbenchSidebarTicketGroups({ ...input, selectedTicketId: undefined }).get(workspaceId),
    ).toEqual({
      active: [{ ticket: mixed, threads: [settled, active] }],
      done: [],
    });
  });

  it("lists pinned threads first in native pin order, then the rest newest-first", () => {
    const pinnedTicket = ticket("pinned");
    const oldest = thread("oldest");
    const middle = thread("middle");
    const newest = thread("newest");
    const pinnedFirst = { ...oldest, pinnedAt: "2026-03-01T00:00:00.000Z", pinOrderKey: "a" };
    const pinnedLater = { ...middle, pinnedAt: "2026-03-02T00:00:00.000Z", pinOrderKey: "b" };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [pinnedTicket],
      assignments: [
        assignment("oldest", pinnedTicket.id, oldest.id, "2026-01-01"),
        assignment("middle", pinnedTicket.id, middle.id, "2026-02-01"),
        assignment("newest", pinnedTicket.id, newest.id, "2026-03-01"),
      ],
      threads: [pinnedLater, pinnedFirst, newest],
      selectedTicketId: undefined,
    });

    expect(groups.get(workspaceId)?.active[0]?.threads.map((item) => item.id)).toEqual([
      oldest.id,
      middle.id,
      newest.id,
    ]);
  });

  it("keeps settled-only tickets in their ticket section", () => {
    const settledTicket = ticket("settled-only");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [settledTicket],
      assignments: [assignment("settled", settledTicket.id, settled.id, "2026-01-01")],
      threads: [settled],
      selectedTicketId: undefined,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: settledTicket, threads: [settled] }],
      done: [],
    });
  });

  it("omits a workspace containing only an unselected archived ticket", () => {
    const archivedTicket = { ...ticket("archived"), archivedAt: "2026-01-01" };
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [archivedTicket],
      assignments: [assignment("settled", archivedTicket.id, settled.id, "2026-01-01")],
      threads: [settled],
      selectedTicketId: undefined,
    });

    expect(groups.size).toBe(0);
  });

  it("keeps superseded settled threads visible once per ticket", () => {
    const settledTicket = ticket("settled-history");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [settledTicket],
      assignments: [
        {
          ...assignment("old", settledTicket.id, settled.id, "2026-01-01"),
          supersededAt: "2026-01-02",
        },
        assignment("new", settledTicket.id, settled.id, "2026-02-01"),
      ],
      threads: [settled],
      selectedTicketId: undefined,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: settledTicket, threads: [settled] }],
      done: [],
    });
  });

  it("groups every nonarchived done ticket, including tickets without threads", () => {
    const doneWithoutThread = ticket("done-without-thread", workspaceId, "done");
    const doneInOtherWorkspace = ticket("done-other-workspace", otherWorkspaceId, "done");
    const active = ticket("active", workspaceId, "in_progress");
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [doneWithoutThread, doneInOtherWorkspace, active],
      assignments: [],
      threads: [],
      selectedTicketId: undefined,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [],
      done: [{ ticket: doneWithoutThread, threads: [] }],
    });
    expect(groups.get(otherWorkspaceId)).toEqual({
      active: [],
      done: [{ ticket: doneInOtherWorkspace, threads: [] }],
    });
  });

  it.each([null, "settled"] as const)(
    "keeps done tickets with %s threads out of the active section",
    (settledOverride) => {
      const doneTicket = ticket("done", workspaceId, "done");
      const doneThread = { ...thread("done-thread"), settledOverride };
      const groups = getWorkbenchSidebarTicketGroups({
        environmentId,
        tickets: [doneTicket],
        assignments: [assignment("a", doneTicket.id, doneThread.id, "2026-01-01")],
        threads: [doneThread],
        selectedTicketId: doneTicket.id,
        selectedThreadId: settledOverride === "settled" ? doneThread.id : undefined,
      });

      expect(groups.get(workspaceId)).toEqual({
        active: [],
        done: [{ ticket: doneTicket, threads: [doneThread] }],
      });
    },
  );

  it("retains the current archived thread and its ticket", () => {
    const currentTicket = { ...ticket("current"), archivedAt: "2026-01-01" };
    const currentThread = thread("current-thread", "Archived Thread", environmentId, "2026-01-01");
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [currentTicket],
      assignments: [assignment("a", currentTicket.id, currentThread.id, "2026-01-01")],
      threads: [currentThread],
      selectedTicketId: currentTicket.id,
      selectedThreadId: currentThread.id,
    });
    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: currentTicket, threads: [currentThread] }],
      done: [],
    });
  });

  it("can include unassigned Tickets in search results", () => {
    const unassigned = ticket("unassigned");
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [unassigned],
      assignments: [],
      threads: [],
      selectedTicketId: undefined,
      includeUnassignedTickets: true,
    });
    expect(groups.get(workspaceId)?.active).toEqual([{ ticket: unassigned, threads: [] }]);
  });
});

describe("Workbench sidebar expansion", () => {
  const initial: WorkbenchSidebarExpansion = { workspaceId, done: false, archived: false };

  it("opens the selected workspace, and its Done list for a done Ticket", () => {
    expect(getWorkbenchSidebarExpansionDefaults({ workspaceId, ticketIsDone: false })).toEqual(
      initial,
    );
    expect(getWorkbenchSidebarExpansionDefaults({ workspaceId, ticketIsDone: true })).toEqual({
      workspaceId,
      done: true,
      archived: false,
    });
    expect(
      getWorkbenchSidebarExpansionDefaults({ workspaceId: undefined, ticketIsDone: false }),
    ).toEqual({ workspaceId: null, done: false, archived: false });
  });

  it("keeps one workspace open at a time and allows closing it", () => {
    const otherWorkspace = reduceWorkbenchSidebarExpansion(
      { ...initial, done: true },
      { type: "toggleWorkspace", workspaceId: otherWorkspaceId },
    );
    expect(otherWorkspace).toEqual({
      workspaceId: otherWorkspaceId,
      done: false,
      archived: false,
    });
    expect(
      reduceWorkbenchSidebarExpansion(otherWorkspace, {
        type: "toggleWorkspace",
        workspaceId: otherWorkspaceId,
      }),
    ).toEqual({ workspaceId: null, done: false, archived: false });
  });

  it("toggles the Done and Archived lists one at a time", () => {
    const openArchived = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleArchived",
      workspaceId,
    });
    expect(openArchived).toEqual({ workspaceId, done: false, archived: true });
    expect(
      reduceWorkbenchSidebarExpansion(openArchived, { type: "toggleArchived", workspaceId }),
    ).toEqual(initial);
    const openDone = reduceWorkbenchSidebarExpansion(openArchived, {
      type: "toggleDone",
      workspaceId,
    });
    expect(openDone).toEqual({ workspaceId, done: true, archived: false });
    expect(reduceWorkbenchSidebarExpansion(openDone, { type: "toggleDone", workspaceId })).toEqual(
      initial,
    );
  });

  it("opens Done for a newly selected done Ticket and leaves other disclosure state alone", () => {
    const archivedOpen = { ...initial, archived: true };
    expect(
      revealWorkbenchSidebarSelection(archivedOpen, { workspaceId, ticketIsDone: true }),
    ).toEqual({ workspaceId, done: true, archived: false });
    expect(
      revealWorkbenchSidebarSelection(archivedOpen, { workspaceId, ticketIsDone: false }),
    ).toBe(archivedOpen);
    expect(
      revealWorkbenchSidebarSelection(initial, { workspaceId: undefined, ticketIsDone: true }),
    ).toBe(initial);
    expect(
      revealWorkbenchSidebarSelection(initial, {
        workspaceId: otherWorkspaceId,
        ticketIsDone: true,
      }),
    ).toEqual({ workspaceId: otherWorkspaceId, done: true, archived: false });
  });
});
