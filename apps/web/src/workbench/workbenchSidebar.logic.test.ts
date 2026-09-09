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

  it("ignores superseded assignments and archived tickets", () => {
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

    expect(groups.size).toBe(0);
  });
  it("keeps settled threads on the current ticket but hides inactive ticket groups", () => {
    const done = ticket("done");
    const settled = { ...thread("settled"), settledOverride: "settled" as const };
    const input = {
      environmentId,
      tickets: [done],
      assignments: [assignment("a", done.id, settled.id, "2026-01-01")],
      threads: [settled],
    };
    expect(getWorkbenchSidebarTicketGroups({ ...input, selectedTicketId: undefined }).size).toBe(0);
    expect(
      getWorkbenchSidebarTicketGroups({ ...input, selectedTicketId: done.id }).get(workspaceId),
    ).toEqual({ active: [{ ticket: done, threads: [settled] }], done: [] });
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
    ).toEqual({ workspaceId, ticketId: archivedTicketId, done: false, archived: false });
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId: otherWorkspaceId,
        ticketId: undefined,
        ticketIsDone: false,
      }),
    ).toEqual({ workspaceId: otherWorkspaceId, ticketId: null, done: false, archived: false });
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
    expect(closedTicket).toEqual({ workspaceId, ticketId: null, done: false, archived: false });
    const openArchived = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleArchived",
      workspaceId,
    });
    expect(openArchived).toEqual({ workspaceId, ticketId: null, done: false, archived: true });
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
    expect(doneTicket).toEqual({ workspaceId, ticketId: null, done: true, archived: false });
  });
});
