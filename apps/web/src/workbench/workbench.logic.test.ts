import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import {
  getActiveAssignmentsByTicket,
  getAssignmentsForTicket,
  getWorkbenchContextForThread,
  getWorkbenchThreadLookupState,
  getWorkbenchReachableThreads,
  getWorkbenchStartedThreadsById,
  getWorkbenchThreadsById,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  getWorkbenchTicketThreadSections,
  getWorkbenchThreadPresentation,
  getWorkbenchTicketStatusMoves,
  getVisibleWorkbenchAssignments,
  getWorkbenchOmittedThreadIds,
  getWorkbenchOmittedThreadsStatus,
  isWorkbenchThreadArchived,
  resolveWorkbenchTicketThreadTarget,
} from "./workbench.logic";

const hostEnvironmentId = EnvironmentId.make("host-environment");
const remoteEnvironmentId = EnvironmentId.make("remote-environment");

describe("Workbench ticket helpers", () => {
  it("uses stored generated summaries without falling back to descriptions", () => {
    expect(
      getWorkbenchTicketSummaryPresentation({
        text: "Keep the generated summary.",
        status: "error",
        stale: true,
        error: "generation failed",
      }),
    ).toEqual({
      text: "Keep the generated summary.",
      hasText: true,
      statusLabel: "Outdated summary",
      error: "generation failed",
    });
    expect(
      getWorkbenchTicketSummaryPresentation({
        text: "The previous generated summary.",
        status: "pending",
        stale: true,
        error: null,
      }),
    ).toEqual({
      text: "The previous generated summary.",
      hasText: true,
      statusLabel: "Generating summary…",
      error: null,
    });
    expect(
      getWorkbenchTicketSummaryPresentation({
        text: null,
        status: "pending",
        stale: false,
        error: null,
      }),
    ).toEqual({
      text: "Generating summary…",
      hasText: false,
      statusLabel: null,
      error: null,
    });
    expect(getWorkbenchTicketSummaryPresentation(undefined)).toEqual({
      text: "Summary unavailable",
      hasText: false,
      statusLabel: null,
      error: null,
    });
    expect(
      getWorkbenchTicketSummaryPresentation({
        text: null,
        status: "error",
        stale: false,
        error: "Select an available model.",
      }).error,
    ).toBe("Select an available model.");
    expect(
      getWorkbenchTicketSummaryPresentation({
        text: "Still current.",
        status: "error",
        stale: false,
        error: "Retry failed.",
      }).statusLabel,
    ).toBe("Summary generation failed");
    expect(
      getWorkbenchTicketSummaryActionLabel({
        text: "Existing summary",
        status: "ready",
        stale: false,
        error: null,
      }),
    ).toBe("Regenerate summary");
    expect(getWorkbenchTicketSummaryActionLabel(undefined)).toBe("Generate summary");
  });

  it("prefers a live Thread when live and archived snapshots transiently overlap", () => {
    const threadId = ThreadId.make("thread-one");

    expect(
      isWorkbenchThreadArchived(
        threadId,
        new Map([[threadId, { state: "live" }]]),
        new Map([[threadId, { state: "archived" }]]),
      ),
    ).toBe(false);
    expect(isWorkbenchThreadArchived(threadId, new Map(), new Map([[threadId, {}]]))).toBe(true);
  });

  it("offers every other Board column as a direct Ticket destination", () => {
    expect(getWorkbenchTicketStatusMoves("in_progress")).toEqual(["todo", "done"]);
  });

  it("presents the next action for each supported Thread state", () => {
    expect(getWorkbenchThreadPresentation(false, false)).toEqual({
      actionLabel: "Create Thread",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "No Thread",
      state: "unassigned",
    });
    expect(getWorkbenchThreadPresentation(true, true)).toEqual({
      actionLabel: "Open Thread",
      pendingActionLabel: "Opening Thread…",
      stateLabel: "Idle",
      state: "linked",
    });
    expect(getWorkbenchThreadPresentation(true, true, "Pending Approval")).toEqual({
      actionLabel: "Open Thread",
      pendingActionLabel: "Opening Thread…",
      stateLabel: "Pending Approval",
      state: "linked",
    });
    expect(getWorkbenchThreadPresentation(true, false, null, true)).toEqual({
      actionLabel: "Restore and open",
      pendingActionLabel: "Restoring Thread…",
      stateLabel: "Archived",
      state: "archived",
    });
    expect(getWorkbenchThreadPresentation(true, false)).toEqual({
      actionLabel: "Create replacement Thread",
      pendingActionLabel: "Creating replacement Thread…",
      stateLabel: "Thread deleted",
      state: "missing",
    });
    // A Thread on a machine this client cannot reach is not deleted.
    const offline = {
      actionLabel: "Check Thread",
      pendingActionLabel: "Checking Thread…",
      stateLabel: "Offline",
      state: "offline",
    };
    expect(getWorkbenchThreadPresentation(true, false, null, false, "offline")).toEqual(offline);
    // Nor still working or archived: a cached shell outlives the connection.
    expect(getWorkbenchThreadPresentation(true, true, "Working", false, "offline")).toEqual(
      offline,
    );
    expect(getWorkbenchThreadPresentation(true, false, null, true, "offline")).toEqual(offline);
    // A Thread on another machine that never launched there is not deleted either.
    expect(getWorkbenchThreadPresentation(true, false, null, false, "ready", true)).toEqual({
      actionLabel: "Retry",
      pendingActionLabel: "Retrying…",
      stateLabel: "Not started",
      state: "not-started",
    });
  });

  it("starts a replacement only once the Thread's own environment confirms it is gone", () => {
    const threadId = ThreadId.make("remote-thread");
    const remoteAssignment = { threadId, environmentId: remoteEnvironmentId };

    // The host lookup being ready says nothing about a Thread on another machine.
    expect(resolveWorkbenchTicketThreadTarget(remoteAssignment, new Set(), "offline")).toEqual({
      state: "thread-status-unavailable",
    });
    expect(resolveWorkbenchTicketThreadTarget(remoteAssignment, new Set(), "checking")).toEqual({
      state: "thread-status-unavailable",
    });
    // A ready machine without the Thread never ran its launch; Retry relaunches it there.
    expect(resolveWorkbenchTicketThreadTarget(remoteAssignment, new Set(), "ready")).toEqual({
      state: "not-started",
    });
    expect(
      resolveWorkbenchTicketThreadTarget(remoteAssignment, new Set([threadId]), "offline"),
    ).toEqual({ state: "open", threadId });
    expect(resolveWorkbenchTicketThreadTarget(undefined, new Set(), "offline")).toEqual({
      state: "start",
    });

    const lookupState = (
      assignment: { readonly environmentId?: EnvironmentId },
      threadLookupReady: boolean,
    ) =>
      getWorkbenchThreadLookupState({
        assignment,
        threadLookupReady,
        remoteEnvironmentStates: new Map([[remoteEnvironmentId, "ready" as const]]),
      });
    expect(lookupState({}, true)).toBe("ready");
    expect(lookupState({}, false)).toBe("checking");
    expect(lookupState({ environmentId: remoteEnvironmentId }, false)).toBe("ready");
    expect(lookupState({ environmentId: EnvironmentId.make("unsaved-machine") }, true)).toBe(
      "offline",
    );
  });

  it("reads each assigned Thread from its own environment", () => {
    const thread = (id: string, environmentId: EnvironmentId) => ({
      id: ThreadId.make(id),
      environmentId,
    });
    const host = thread("host-thread", hostEnvironmentId);
    const remote = thread("remote-thread", remoteEnvironmentId);
    const unassignedRemote = thread("unassigned-remote", remoteEnvironmentId);
    // A host Assignment names a host Thread; another machine's copy of that id is not it.
    const hostIdElsewhere = thread("host-assigned", remoteEnvironmentId);
    // And a host copy of a remote Assignment's id is not the remote Thread.
    const remoteIdOnHost = thread("remote-thread", hostEnvironmentId);

    expect([
      ...getWorkbenchThreadsById({
        hostEnvironmentId,
        assignments: [
          { threadId: remote.id, environmentId: remoteEnvironmentId },
          { threadId: hostIdElsewhere.id },
        ],
        threads: [host, remote, unassignedRemote, hostIdElsewhere, remoteIdOnHost],
      }).values(),
    ]).toEqual([host, remote]);

    // A remote launch can stop after creating its Thread; without a run it has not started.
    const withRun = <T extends object>(value: T, latestRun: { runId: string } | null) => ({
      ...value,
      latestRun,
    });
    const halfLaunched = withRun(remote, null);
    const launched = withRun(thread("launched", remoteEnvironmentId), { runId: "run-one" });
    const emptyHost = withRun(host, null);
    expect([
      ...getWorkbenchStartedThreadsById({
        hostEnvironmentId,
        assignments: [
          { threadId: halfLaunched.id, environmentId: remoteEnvironmentId },
          { threadId: launched.id, environmentId: remoteEnvironmentId },
          { threadId: emptyHost.id },
        ],
        threads: [halfLaunched, launched, emptyHost],
      }).values(),
    ]).toEqual([launched, emptyHost]);

    // A cached shell from a machine whose shells are not live would show a stale status.
    const offlineRemote = thread("offline-remote", EnvironmentId.make("offline-machine"));
    expect(
      getWorkbenchReachableThreads({
        hostEnvironmentId,
        liveEnvironmentIds: new Set([remoteEnvironmentId]),
        threads: [host, remote, offlineRemote],
      }),
    ).toEqual([host, remote]);
  });

  it("resolves the Workspace and Ticket that own a native Thread", () => {
    const workspaceId = WorkbenchProjectId.make("workspace-one");
    const repositoryId = ProjectId.make("repository-one");
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const threadId = ThreadId.make("thread-one");
    const workspace = {
      id: workspaceId,
      title: "Agent Workbench",
      linkedProjectIds: [repositoryId],
      archivedAt: null,
      revision: 0,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const ticket = {
      id: ticketId,
      projectId: workspaceId,
      title: "Keep Ticket context visible",
      markdown: "",
      repositoryProjectIds: [repositoryId],
      status: "in_progress",
      blocked: false,
      revision: 0,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const assignment = {
      id: WorkbenchAssignmentId.make("assignment-one"),
      ticketId,
      threadId,
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: "2026-09-03T01:00:00.000Z",
    } as const;

    expect(
      getWorkbenchContextForThread(
        {
          references: [],
          projects: [workspace],
          tickets: [ticket],
          threadRecaps: [],
          ticketWorkspaces: [],
          assignments: [assignment],
          reservedThreadIds: [],
        },
        hostEnvironmentId,
        { environmentId: hostEnvironmentId, threadId },
      ),
    ).toEqual({ assignment, ticket, workspace });
    // The same id on another machine is a different Thread.
    expect(
      getWorkbenchContextForThread(
        {
          references: [],
          projects: [workspace],
          tickets: [ticket],
          threadRecaps: [],
          ticketWorkspaces: [],
          assignments: [assignment],
          reservedThreadIds: [],
        },
        hostEnvironmentId,
        { environmentId: remoteEnvironmentId, threadId },
      ),
    ).toBeNull();
    const remoteAssignment = { ...assignment, environmentId: remoteEnvironmentId };
    expect(
      getWorkbenchContextForThread(
        {
          references: [],
          projects: [workspace],
          tickets: [ticket],
          threadRecaps: [],
          ticketWorkspaces: [],
          assignments: [remoteAssignment],
          reservedThreadIds: [],
        },
        hostEnvironmentId,
        { environmentId: remoteEnvironmentId, threadId },
      ),
    ).toEqual({ assignment: remoteAssignment, ticket, workspace });
    expect(
      getWorkbenchContextForThread(
        {
          references: [],
          projects: [workspace],
          tickets: [ticket],
          threadRecaps: [],
          ticketWorkspaces: [],
          assignments: [assignment],
          reservedThreadIds: [],
        },
        hostEnvironmentId,
        { environmentId: hostEnvironmentId, threadId: ThreadId.make("another-thread") },
      ),
    ).toBeNull();
  });

  it("separates the active Assignment from a Ticket's historical Assignments", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const historical = {
      id: WorkbenchAssignmentId.make("assignment-one"),
      ticketId,
      threadId: ThreadId.make("thread-one"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: "2026-09-03T01:00:00.000Z",
    } as const;
    const active = {
      id: WorkbenchAssignmentId.make("assignment-two"),
      ticketId,
      threadId: ThreadId.make("thread-two"),
      createdAt: "2026-09-03T01:00:00.000Z",
      supersededAt: null,
    } as const;

    expect(
      getActiveAssignmentsByTicket({ assignments: [historical, active] }).get(ticketId),
    ).toEqual(active);
    expect(getAssignmentsForTicket([historical, active], ticketId)).toEqual([active, historical]);
  });

  it("moves existing settled Threads into their own section", () => {
    const ticketId = WorkbenchTicketId.make("ticket-settled");
    const active = {
      id: WorkbenchAssignmentId.make("active"),
      ticketId,
      threadId: ThreadId.make("active-thread"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    } as const;
    const settled = {
      ...active,
      id: WorkbenchAssignmentId.make("settled"),
      threadId: ThreadId.make("settled-thread"),
    } as const;
    const historicalSettled = {
      ...active,
      id: WorkbenchAssignmentId.make("historical-settled"),
      threadId: ThreadId.make("historical-settled-thread"),
      supersededAt: "2026-09-04T00:00:00.000Z",
    } as const;
    const historicalMissing = {
      ...active,
      id: WorkbenchAssignmentId.make("historical-missing"),
      threadId: ThreadId.make("historical-missing-thread"),
      supersededAt: "2026-09-05T00:00:00.000Z",
    } as const;

    expect(
      getWorkbenchTicketThreadSections({
        assignments: [active, settled, historicalSettled, historicalMissing],
        threadsById: new Map([
          [active.threadId, { settledOverride: null }],
          [settled.threadId, { settledOverride: "settled" as const }],
          [historicalSettled.threadId, { settledOverride: "settled" as const }],
        ]),
        archivedThreadsById: new Map(),
      }),
    ).toEqual({
      active: [active],
      history: [historicalMissing],
      settled: [settled, historicalSettled],
    });
  });

  it("chooses the newest available active Thread independent of assignment order", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const older = {
      id: WorkbenchAssignmentId.make("older"),
      ticketId,
      threadId: ThreadId.make("existing"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    };
    const newer = {
      ...older,
      id: WorkbenchAssignmentId.make("newer"),
      threadId: ThreadId.make("deleted"),
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    expect(getActiveAssignmentsByTicket({ assignments: [newer, older] }).get(ticketId)).toEqual(
      newer,
    );
    expect(
      getActiveAssignmentsByTicket({
        assignments: [older, newer],
        liveThreadIds: new Set([older.threadId]),
      }).get(ticketId),
    ).toEqual(older);
  });

  it("prefers an older working Thread over a newer idle or review Thread", () => {
    const ticketId = WorkbenchTicketId.make("ticket-working");
    const working = {
      id: WorkbenchAssignmentId.make("working"),
      ticketId,
      threadId: ThreadId.make("working-thread"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    };
    const idle = {
      ...working,
      id: WorkbenchAssignmentId.make("idle"),
      threadId: ThreadId.make("idle-thread"),
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    for (const assignments of [
      [working, idle],
      [idle, working],
    ]) {
      expect(
        getActiveAssignmentsByTicket({
          assignments,
          liveThreadIds: new Set([working.threadId, idle.threadId]),
          workingThreadIds: new Set([working.threadId]),
        }).get(ticketId),
      ).toEqual(working);
    }
  });

  it("breaks working-thread ties by recency and excludes superseded or unavailable work", () => {
    const ticketId = WorkbenchTicketId.make("ticket-working");
    const older = {
      id: WorkbenchAssignmentId.make("older"),
      ticketId,
      threadId: ThreadId.make("older"),
      createdAt: "2026-09-01T00:00:00.000Z",
      supersededAt: null,
    };
    const newer = {
      ...older,
      id: WorkbenchAssignmentId.make("newer"),
      threadId: ThreadId.make("newer"),
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    const input = {
      assignments: [older, newer],
      liveThreadIds: new Set([older.threadId, newer.threadId]),
      workingThreadIds: new Set([older.threadId, newer.threadId]),
    };
    expect(getActiveAssignmentsByTicket(input).get(ticketId)).toEqual(newer);
    expect(
      getActiveAssignmentsByTicket({
        ...input,
        assignments: [older, { ...newer, supersededAt: "2026-09-03T00:00:00.000Z" }],
      }).get(ticketId),
    ).toEqual(older);
    expect(
      getActiveAssignmentsByTicket({
        ...input,
        liveThreadIds: new Set([older.threadId]),
        archivedThreadIds: new Set([newer.threadId]),
      }).get(ticketId),
    ).toEqual(older);
  });

  it("prefers live Threads over archived and missing active assignments", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const live = {
      id: WorkbenchAssignmentId.make("live-assignment"),
      ticketId,
      threadId: ThreadId.make("live-thread"),
      createdAt: "2026-09-03T00:00:00.000Z",
      supersededAt: null,
    } as const;
    const archived = {
      ...live,
      id: WorkbenchAssignmentId.make("archived-assignment"),
      threadId: ThreadId.make("archived-thread"),
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    const missing = {
      ...live,
      id: WorkbenchAssignmentId.make("missing-assignment"),
      threadId: ThreadId.make("missing-thread"),
      createdAt: "2026-09-05T00:00:00.000Z",
    };

    expect(
      getActiveAssignmentsByTicket({
        assignments: [missing, archived, live],
        liveThreadIds: new Set([live.threadId]),
        archivedThreadIds: new Set([archived.threadId]),
      }).get(ticketId),
    ).toEqual(live);
    expect(
      getActiveAssignmentsByTicket({
        assignments: [missing, archived, live],
        liveThreadIds: new Set(),
        archivedThreadIds: new Set([archived.threadId]),
      }).get(ticketId),
    ).toEqual(archived);
  });

  it("hides assignments whose native Threads are missing after lookup completes", () => {
    const ticketId = WorkbenchTicketId.make("ticket-one");
    const missing = {
      id: WorkbenchAssignmentId.make("missing-assignment"),
      ticketId,
      threadId: ThreadId.make("missing-thread"),
      createdAt: "2026-09-05T00:00:00.000Z",
      supersededAt: null,
    } as const;
    const archived = {
      ...missing,
      id: WorkbenchAssignmentId.make("archived-assignment"),
      threadId: ThreadId.make("archived-thread"),
      createdAt: "2026-09-04T00:00:00.000Z",
    } as const;
    const historicalMissing = {
      ...missing,
      id: WorkbenchAssignmentId.make("historical-missing-assignment"),
      supersededAt: "2026-09-06T00:00:00.000Z",
    } as const;

    expect(
      getVisibleWorkbenchAssignments(
        [missing, archived, historicalMissing],
        new Set(),
        new Set([archived.threadId]),
        true,
      ),
    ).toEqual([archived]);
    expect(getVisibleWorkbenchAssignments([missing], new Set(), new Set(), true)).toEqual([]);
    expect(getVisibleWorkbenchAssignments([missing], new Set(), new Set(), false)).toEqual([
      missing,
    ]);
    // A Thread on a machine this client cannot reach stays listed so it can be unassigned.
    const offlineRemote = { ...missing, environmentId: remoteEnvironmentId };
    expect(
      getVisibleWorkbenchAssignments([offlineRemote], new Set(), new Set(), true, new Map()),
    ).toEqual([offlineRemote]);
    // So does one its ready machine lacks, which shows Not started with Retry and Remove.
    expect(
      getVisibleWorkbenchAssignments(
        [offlineRemote],
        new Set(),
        new Set(),
        true,
        new Map([[remoteEnvironmentId, "ready"]]),
      ),
    ).toEqual([offlineRemote]);
  });

  it("reads assigned Threads only when the shell left them out as older settled", () => {
    const kept = ThreadId.make("thread-kept");
    const omitted = ThreadId.make("thread-omitted");
    const olderOmitted = ThreadId.make("thread-older-omitted");
    const threads = [{ id: kept }];
    const olderSettled = { before: "2026-10-01T00:00:00.000Z", asOfSequence: 1, counts: [] };

    expect(
      getWorkbenchOmittedThreadIds({
        threadIds: [omitted, kept, olderOmitted, omitted],
        shell: { threads, olderSettled },
      }),
    ).toEqual([olderOmitted, omitted]);
    expect(
      getWorkbenchOmittedThreadIds({ threadIds: [omitted, kept], shell: { threads } }),
    ).toEqual([]);
    expect(getWorkbenchOmittedThreadIds({ threadIds: [omitted], shell: null })).toEqual([]);
  });

  it("waits for omitted Threads to be read and merged before treating them as gone", () => {
    const merged = ThreadId.make("thread-merged");
    const cached = ThreadId.make("thread-cached");
    const deleted = ThreadId.make("thread-deleted");
    const removed = ThreadId.make("thread-removed");
    const failed = ThreadId.make("thread-failed");
    const family = (...threadIds: ReadonlyArray<ThreadId>) => ({
      snapshotSequence: 5,
      threads: threadIds.map((id) => ({ id })),
    });
    const input = {
      reads: new Map<ThreadId, ReturnType<typeof family> | "failed">([
        [merged, family(merged)],
        [cached, family(cached)],
        [deleted, family()],
        [removed, family(removed)],
        [failed, "failed"],
      ]),
      mergedThreadIds: new Set([merged]),
      removedAt: new Map([[removed, 6]]),
    };
    const status = (threadIds: ReadonlyArray<ThreadId>) =>
      getWorkbenchOmittedThreadsStatus({ ...input, threadIds });

    expect(status([merged, deleted, removed])).toBe("ready");
    // A cached read is settled before its rows merge back in.
    expect(status([merged, cached])).toBe("pending");
    expect(status([ThreadId.make("thread-pending")])).toBe("pending");
    expect(status([merged, cached, failed])).toBe("failed");
  });
});
