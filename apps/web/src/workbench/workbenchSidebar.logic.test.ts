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
      settled: [],
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
  it("separates active and settled threads for the same ticket", () => {
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
      active: [{ ticket: mixed, threads: [active] }],
      done: [],
      settled: [{ ticket: mixed, threads: [settled] }],
    });
  });

  it("shows settled-only tickets in the settled section", () => {
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
      active: [],
      done: [],
      settled: [{ ticket: settledTicket, threads: [settled] }],
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
      active: [],
      done: [],
      settled: [{ ticket: selectedTicket, threads: [settled] }],
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
      active: [],
      done: [],
      settled: [{ ticket: settledTicket, threads: [settled] }],
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
      settled: [],
    });
    expect(groups.get(otherWorkspaceId)).toEqual({
      active: [],
      done: [{ ticket: doneInOtherWorkspace, threads: [] }],
      settled: [],
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
      settled: [],
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
      settled: [],
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
    settled: false,
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
      settled: false,
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
      settled: false,
    });
    expect(
      getWorkbenchSidebarExpansionDefaults({
        workspaceId,
        ticketId,
        ticketIsDone: true,
      }),
    ).toEqual({ workspaceId, ticketId, done: true, archived: false, settled: false });
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
      settled: false,
    });
    expect(
      reduceWorkbenchSidebarExpansion(otherWorkspace, {
        type: "toggleTicket",
        workspaceId: otherWorkspaceId,
        ticketId: otherTicketId,
        done: false,
        settled: false,
      }),
    ).toEqual({
      workspaceId: otherWorkspaceId,
      ticketId: otherTicketId,
      done: false,
      archived: false,
      settled: false,
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
      settled: false,
    });
    const closedTicket = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleTicket",
      workspaceId,
      ticketId,
      done: false,
      settled: false,
    });
    expect(closedTicket).toEqual({
      workspaceId,
      ticketId: null,
      done: false,
      archived: false,
      settled: false,
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
      settled: false,
    });
    expect(
      reduceWorkbenchSidebarExpansion(openArchived, {
        type: "toggleArchived",
        workspaceId,
      }),
    ).toEqual({ workspaceId, ticketId: null, done: false, archived: false, settled: false });
    const doneTicket = reduceWorkbenchSidebarExpansion(
      { workspaceId, ticketId, done: true, archived: false, settled: false },
      { type: "toggleTicket", workspaceId, ticketId, done: true, settled: false },
    );
    expect(doneTicket).toEqual({
      workspaceId,
      ticketId: null,
      done: true,
      archived: false,
      settled: false,
    });
    const openSettled = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleSettled",
      workspaceId,
    });
    expect(openSettled).toEqual({
      workspaceId,
      ticketId: null,
      done: false,
      archived: false,
      settled: true,
    });
    expect(
      reduceWorkbenchSidebarExpansion(openSettled, {
        type: "toggleSettled",
        workspaceId,
      }),
    ).toEqual({ workspaceId, ticketId: null, done: false, archived: false, settled: false });
  });

  it("keeps active and settled ticket expansion independent", () => {
    const settledTicket = reduceWorkbenchSidebarExpansion(initial, {
      type: "toggleTicket",
      workspaceId,
      ticketId,
      done: false,
      settled: true,
    });
    expect(settledTicket).toEqual({
      workspaceId,
      ticketId,
      done: false,
      archived: false,
      settled: true,
    });
    expect(
      reduceWorkbenchSidebarExpansion(settledTicket, {
        type: "toggleTicket",
        workspaceId,
        ticketId,
        done: false,
        settled: false,
      }),
    ).toEqual(initial);
  });
});
