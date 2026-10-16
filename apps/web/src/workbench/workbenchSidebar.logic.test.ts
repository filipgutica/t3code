import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import {
  filterWorkbenchSidebarNavigation,
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

  it("retains replaced thread history but ignores archived tickets", () => {
    const supersededTicket = ticket("superseded-ticket");
    const archivedTicket = { ...ticket("archived-ticket"), archivedAt: "2026-01-01" };
    const supersededThread = thread("superseded-thread");
    const archivedTicketThread = thread("archived-ticket-thread");

    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [supersededTicket, archivedTicket],
      assignments: [
        {
          ...assignment("superseded", supersededTicket.id, supersededThread.id, "2026-01-01"),
          supersededAt: "2026-01-02",
        },
        assignment("archived-ticket", archivedTicket.id, archivedTicketThread.id, "2026-01-01"),
      ],
      threads: [supersededThread, archivedTicketThread],
      selectedTicketId: undefined,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: supersededTicket, threads: [supersededThread] }],
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

  it("keeps a selected settled thread in its ticket context", () => {
    const selectedTicket = ticket("selected");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [selectedTicket],
      assignments: [assignment("settled", selectedTicket.id, settled.id, "2026-01-01")],
      threads: [settled],
      selectedTicketId: selectedTicket.id,
      selectedThreadId: settled.id,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: selectedTicket, threads: [settled] }],
      done: [],
    });
  });

  it("hides settled threads from unselected archived tickets", () => {
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

  it("keeps a historical thread in its ticket after un-settling", () => {
    const historyTicket = ticket("history");
    const historicalThread = { ...thread("historical"), settledOverride: "active" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [historyTicket],
      assignments: [
        {
          ...assignment("old", historyTicket.id, historicalThread.id, "2026-01-01"),
          supersededAt: "2026-01-02",
        },
      ],
      threads: [historicalThread],
      selectedTicketId: historyTicket.id,
      selectedThreadId: historicalThread.id,
    });
    expect(groups.get(workspaceId)).toEqual({
      active: [{ ticket: historyTicket, threads: [historicalThread] }],
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

  it("keeps settled history inside a done ticket without duplicating it", () => {
    const doneTicket = ticket("done-history", workspaceId, "done");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [doneTicket],
      assignments: [assignment("settled", doneTicket.id, settled.id, "2026-01-01")],
      threads: [settled],
      selectedTicketId: doneTicket.id,
      selectedThreadId: settled.id,
    });
    expect(groups.get(workspaceId)).toEqual({
      active: [],
      done: [{ ticket: doneTicket, threads: [settled] }],
    });
  });

  it("keeps done tickets out of the active section", () => {
    const doneTicket = ticket("done", workspaceId, "done");
    const activeThread = thread("active");
    const groups = getWorkbenchSidebarTicketGroups({
      environmentId,
      tickets: [doneTicket],
      assignments: [assignment("a", doneTicket.id, activeThread.id, "2026-01-01")],
      threads: [activeThread],
      selectedTicketId: doneTicket.id,
    });

    expect(groups.get(workspaceId)).toEqual({
      active: [],
      done: [{ ticket: doneTicket, threads: [activeThread] }],
    });
  });

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
});

describe("Workbench sidebar expansion", () => {
  const ticketId = WorkbenchTicketId.make("ticket-one");
  const initial: WorkbenchSidebarExpansion = {
    workspaceId: workspaceId,
    ticketId,
    done: false,
    archived: false,
  };

  it("opens the active workspace and ticket by default", () => {
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId,
        ticketId,
        ticketIsDone: false,
      }),
    ).toEqual(initial);
  });

  it("keeps the active ticket expanded and resets after navigation", () => {
    const archivedTicketId = WorkbenchTicketId.make("archived-ticket");
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId,
        ticketId: archivedTicketId,
        ticketIsDone: false,
      }),
    ).toEqual({
      workspaceId,
      ticketId: archivedTicketId,
      done: false,
      archived: false,
    });
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId: otherWorkspaceId,
        ticketId: undefined,
        ticketIsDone: false,
      }),
    ).toEqual({
      workspaceId: otherWorkspaceId,
      ticketId: null,
      done: false,
      archived: false,
    });
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId,
        ticketId,
        ticketIsDone: true,
      }),
    ).toEqual({ workspaceId, ticketId, done: true, archived: false });
  });

  it("keeps one workspace and one ticket group open at a time", () => {
    const otherTicketId = WorkbenchTicketId.make("ticket-two");
    const otherWorkspace = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleWorkspace",
      workspaceId: otherWorkspaceId,
    });
    expect(otherWorkspace).toEqual({
      workspaceId: otherWorkspaceId,
      ticketId: null,
      done: false,
      archived: false,
    });
    expect(
      reduceWorkbenchSidebarExpansion(otherWorkspace, {
        type: "toggleTicket",
        workspaceId: otherWorkspaceId,
        ticketId: otherTicketId,
        done: false,
      }),
    ).toEqual({
      workspaceId: otherWorkspaceId,
      ticketId: otherTicketId,
      done: false,
      archived: false,
    });
  });

  it("allows closing the current workspace, ticket, or archived group", () => {
    const closedWorkspace = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleWorkspace",
      workspaceId,
    });
    expect(closedWorkspace).toEqual({
      workspaceId: null,
      ticketId: null,
      done: false,
      archived: false,
    });
    const closedTicket = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleTicket",
      workspaceId,
      ticketId,
      done: false,
    });
    expect(closedTicket).toEqual({
      workspaceId,
      ticketId: null,
      done: false,
      archived: false,
    });
    const openArchived = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleArchived",
      workspaceId,
    });
    expect(openArchived).toEqual({
      workspaceId,
      ticketId: null,
      done: false,
      archived: true,
    });
    expect(
      reduceWorkbenchSidebarExpansion(openArchived, {
        type: "toggleArchived",
        workspaceId,
      }),
    ).toEqual({ workspaceId, ticketId: null, done: false, archived: false });
    const doneTicket = reduceWorkbenchSidebarExpansion(
      { workspaceId, ticketId, done: true, archived: false },
      { type: "toggleTicket", workspaceId, ticketId, done: true },
    );
    expect(doneTicket).toEqual({
      workspaceId,
      ticketId: null,
      done: true,
      archived: false,
    });
  });

  it("reveals a newly selected Ticket and leaves workspace-only disclosure state alone", () => {
    const otherTicketId = WorkbenchTicketId.make("ticket-two");
    const manuallyClosed = { ...initial, ticketId: null };
    expect(
      revealWorkbenchSidebarSelection(manuallyClosed, {
        workspaceId,
        ticketId,
        ticketIsDone: false,
      }),
    ).toEqual(initial);
    expect(
      revealWorkbenchSidebarSelection(manuallyClosed, {
        workspaceId,
        ticketId: undefined,
        ticketIsDone: false,
      }),
    ).toBe(manuallyClosed);
    expect(
      revealWorkbenchSidebarSelection(initial, {
        workspaceId: otherWorkspaceId,
        ticketId: otherTicketId,
        ticketIsDone: true,
      }),
    ).toEqual({
      workspaceId: otherWorkspaceId,
      ticketId: otherTicketId,
      done: true,
      archived: false,
    });
  });
});

describe("Workbench sidebar search", () => {
  const roadmap = { id: workspaceId, title: "Roadmap" };
  const platform = { id: otherWorkspaceId, title: "Platform" };
  const activeTicket = { ...ticket("palette"), title: "Update chart palette" };
  const doneTicket = { ...ticket("finished", workspaceId, "done"), title: "Retire old colors" };
  const archivedTicket = {
    ...ticket("archived", otherWorkspaceId),
    title: "Migrate chart data",
    archivedAt: "2026-01-01",
  };
  const activeThread = thread("active", "Inspect chart tokens");
  const unrelatedThread = thread("unrelated", "Prepare release");
  const input = {
    projects: [roadmap, platform],
    ticketGroupsByWorkspace: new Map([
      [
        workspaceId,
        {
          active: [{ ticket: activeTicket, threads: [activeThread, unrelatedThread] }],
          done: [{ ticket: doneTicket, threads: [] }],
        },
      ],
    ]),
    archivedTicketsByWorkspace: new Map([[otherWorkspaceId, [archivedTicket]]]),
    jiraKeysByTicketId: new Map([[activeTicket.id, "MA-5517"]]),
  };

  it("keeps Workspace and Ticket ancestors for a matching Thread", () => {
    const result = filterWorkbenchSidebarNavigation({ ...input, query: "chart tokens" });
    expect(result.projects).toEqual([roadmap]);
    expect(result.ticketGroupsByWorkspace.get(workspaceId)).toEqual({
      active: [{ ticket: activeTicket, threads: [activeThread] }],
      done: [],
    });
    expect(result.resultCount).toBe(1);
  });

  it("counts and shows both a matching Ticket and its matching Thread", () => {
    const result = filterWorkbenchSidebarNavigation({ ...input, query: "chart" });
    expect(result.ticketGroupsByWorkspace.get(workspaceId)?.active).toEqual([
      { ticket: activeTicket, threads: [activeThread] },
    ]);
    expect(result.resultCount).toBe(3);
  });

  it("finds a Jira key, Workspace title, and archived Ticket without leaking unrelated rows", () => {
    const jira = filterWorkbenchSidebarNavigation({ ...input, query: "ma-5517" });
    expect(jira.projects).toEqual([roadmap]);
    expect(jira.ticketGroupsByWorkspace.get(workspaceId)?.active).toEqual([
      { ticket: activeTicket, threads: [] },
    ]);
    expect(jira.resultCount).toBe(1);

    const workspace = filterWorkbenchSidebarNavigation({ ...input, query: "platform" });
    expect(workspace.projects).toEqual([platform]);
    expect(workspace.ticketGroupsByWorkspace.get(otherWorkspaceId)).toEqual({
      active: [],
      done: [],
    });
    expect(workspace.resultCount).toBe(1);

    const archived = filterWorkbenchSidebarNavigation({ ...input, query: "migrate chart" });
    expect(archived.projects).toEqual([platform]);
    expect(archived.archivedTicketsByWorkspace.get(otherWorkspaceId)).toEqual([archivedTicket]);
    expect(archived.resultCount).toBe(1);
  });

  it("returns no ancestors for a query with no matches", () => {
    const result = filterWorkbenchSidebarNavigation({ ...input, query: "unmatched" });
    expect(result.projects).toEqual([]);
    expect(result.resultCount).toBe(0);
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
