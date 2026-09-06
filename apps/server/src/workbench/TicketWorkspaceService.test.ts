import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  GitCommandError,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  TicketWorkspaceService,
  TicketWorkspaceServiceLive,
  ticketWorkspaceBranchName,
} from "./TicketWorkspaceService.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const createdAt = "2026-09-03T12:00:00.000Z";
const primaryProjectId = ProjectId.make("project-primary");
const secondaryProjectId = ProjectId.make("project-secondary");
const workspaceId = WorkbenchProjectId.make("workspace-1");
const ticketId = WorkbenchTicketId.make("ticket-1");
const activeThreadId = ThreadId.make("thread-active");

const projectShell = ({ id, workspaceRoot }: { id: ProjectId; workspaceRoot: string }) => ({
  id,
  title: id,
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
});

const seedTicket = Effect.gen(function* () {
  yield* TestClock.setTime(Date.parse(createdAt));
  const sql = yield* SqlClient.SqlClient;
  const store = yield* WorkbenchStore;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
    ) VALUES
      (${primaryProjectId}, 'Primary', '/repos/primary', '[]', ${createdAt}, ${createdAt}, NULL),
      (${secondaryProjectId}, 'Secondary', '/repos/secondary', '[]', ${createdAt}, ${createdAt}, NULL)
  `;
  yield* store.createProject({
    id: workspaceId,
    title: "Workspace",
    linkedProjectIds: [primaryProjectId, secondaryProjectId],
    createdAt,
  });
  yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Prepare repositories",
    kind: "story",
    markdown: "",
    primaryT3ProjectId: primaryProjectId,
    repositoryProjectIds: [primaryProjectId, secondaryProjectId],
    createdAt,
  });
});

const seedReadyTicketWorkspace = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const attemptId = WorkbenchTicketWorkspaceAttemptId.make("ready-attempt");
  yield* store.claimTicketWorkspace({
    ticketId,
    attemptId,
    branchName: ticketWorkspaceBranchName(ticketId),
    repositories: [
      {
        projectId: primaryProjectId,
        isPrimary: true,
        sourcePath: "/repos/primary",
        worktreePath: "/worktrees/ready-primary",
      },
      {
        projectId: secondaryProjectId,
        isPrimary: false,
        sourcePath: "/repos/secondary",
        worktreePath: "/worktrees/ready-secondary",
      },
    ],
    claimedAt: createdAt,
  });
  yield* store.markTicketWorkspaceRepositoryReady({
    ticketId,
    attemptId,
    projectId: primaryProjectId,
    worktreePath: "/worktrees/ready-primary",
    branchName: ticketWorkspaceBranchName(ticketId),
    updatedAt: createdAt,
  });
  yield* store.markTicketWorkspaceRepositoryReady({
    ticketId,
    attemptId,
    projectId: secondaryProjectId,
    worktreePath: "/worktrees/ready-secondary",
    branchName: ticketWorkspaceBranchName(ticketId),
    updatedAt: createdAt,
  });
  yield* store.completeTicketWorkspace({ ticketId, attemptId, completedAt: createdAt });
});

const seedActiveAssignment = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode,
      interaction_mode, pending_approval_count, pending_user_input_count,
      has_actionable_proposed_plan, created_at, updated_at, deleted_at
    ) VALUES (
      ${activeThreadId}, ${primaryProjectId}, 'Active work',
      '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
      0, 0, 0, ${createdAt}, ${createdAt}, NULL
    )
  `;
  const store = yield* WorkbenchStore;
  yield* store.createAssignment({
    id: WorkbenchAssignmentId.make("assignment-active"),
    ticketId,
    threadId: activeThreadId,
    createdAt,
  });
});

const makeTestLayer = ({
  events,
  failProjectId,
  initialWorktrees,
  missingWorktreePaths,
  liveThreadIds,
  failRemoveOnceSourcePath,
}: {
  events: Array<string>;
  failProjectId?: ProjectId;
  initialWorktrees?: ReadonlyArray<{ readonly sourcePath: string; readonly worktreePath: string }>;
  missingWorktreePaths?: ReadonlySet<string>;
  liveThreadIds?: ReadonlySet<ThreadId>;
  failRemoveOnceSourcePath?: string;
}) => {
  const worktrees = new Map(
    initialWorktrees?.map(({ sourcePath, worktreePath }) => [sourcePath, worktreePath]),
  );
  const missingPaths = new Set(missingWorktreePaths);
  let shouldFailRemove = failRemoveOnceSourcePath !== undefined;
  const storeLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-ticket-workspace-test-",
  }).pipe(Layer.provide(NodeServices.layer));
  const projectionLayer = Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getProjectShellById: (projectId) => {
      events.push(`project:${projectId}`);
      if (projectId === primaryProjectId) {
        return Effect.succeed(
          Option.some(projectShell({ id: projectId, workspaceRoot: "/repos/primary" })),
        );
      }
      if (projectId === secondaryProjectId) {
        return Effect.succeed(
          Option.some(projectShell({ id: projectId, workspaceRoot: "/repos/secondary" })),
        );
      }
      return Effect.succeed(Option.none());
    },
    getThreadShellById: (threadId) =>
      Effect.succeed(
        liveThreadIds?.has(threadId)
          ? Option.some({
              id: threadId,
              projectId: primaryProjectId,
              title: "Active work",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              latestTurn: null,
              createdAt,
              updatedAt: createdAt,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              session: null,
              latestUserMessageAt: null,
              hasPendingApprovals: false,
              hasPendingUserInput: false,
              hasActionableProposedPlan: false,
            } satisfies OrchestrationThreadShell)
          : Option.none(),
      ),
  });
  const gitLayer = Layer.mock(GitWorkflowService.GitWorkflowService)({
    listRefs: ({ cwd }) => {
      events.push(`validate:${cwd}`);
      const registeredWorktreePath = worktrees.get(cwd);
      return Effect.succeed({
        refs: [
          { name: "main", current: true, isDefault: true, worktreePath: cwd },
          ...(registeredWorktreePath !== undefined && !missingPaths.has(registeredWorktreePath)
            ? [
                {
                  name: ticketWorkspaceBranchName(ticketId),
                  current: false,
                  isDefault: false,
                  worktreePath: registeredWorktreePath,
                },
              ]
            : []),
        ],
        isRepo: true,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 1,
      });
    },
    createWorktree: (input) => {
      events.push(`create:${input.cwd}`);
      const projectId = input.cwd === "/repos/primary" ? primaryProjectId : secondaryProjectId;
      if (projectId === failProjectId) {
        return Effect.fail(
          new GitCommandError({
            operation: "test.createWorktree",
            command: "git worktree add",
            cwd: input.cwd,
            detail: "simulated worktree failure",
          }),
        );
      }
      worktrees.set(input.cwd, input.path ?? `/unexpected/${projectId}`);
      return Effect.succeed({
        worktree: {
          path: input.path ?? `/unexpected/${projectId}`,
          refName: input.newRefName ?? input.refName,
        },
      });
    },
    removeWorktree: ({ cwd }) => {
      events.push(`remove:${cwd}`);
      if (shouldFailRemove && cwd === failRemoveOnceSourcePath) {
        shouldFailRemove = false;
        return Effect.fail(
          new GitCommandError({
            operation: "test.removeWorktree",
            command: "git worktree remove",
            cwd,
            detail: "simulated transient cleanup failure",
          }),
        );
      }
      worktrees.delete(cwd);
      return Effect.void;
    },
    pruneWorktrees: ({ cwd }) => {
      events.push(`prune:${cwd}`);
      const worktreePath = worktrees.get(cwd);
      if (worktreePath !== undefined && missingPaths.has(worktreePath)) {
        worktrees.delete(cwd);
      }
      return Effect.void;
    },
  });
  const fileSystemLayer = Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({
        ...fileSystem,
        exists: (candidate) =>
          Effect.succeed(
            !missingPaths.has(candidate) &&
              [...worktrees.values()].some((worktreePath) => worktreePath === candidate),
          ),
      });
    }),
  ).pipe(Layer.provide(NodeServices.layer));
  return TicketWorkspaceServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        storeLayer,
        configLayer,
        projectionLayer,
        gitLayer,
        NodeServices.layer,
        fileSystemLayer,
      ),
    ),
  );
};

describe("TicketWorkspaceService", () => {
  it.effect("rejects preparation for an archived Ticket before inspecting repositories", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const store = yield* WorkbenchStore;
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 0,
        archivedAt: "2026-09-03T12:01:00.000Z",
        updatedAt: "2026-09-03T12:01:00.000Z",
      });
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_archived");
      expect(events).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("reuses a ready Workspace while every recorded worktree still exists", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.attemptId).toBe("ready-attempt");
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("repairs a stale ready Workspace after its assigned Thread was deleted", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE projection_threads
        SET deleted_at = '2026-09-03T12:01:00.000Z'
        WHERE thread_id = ${activeThreadId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.status).toBe("ready");
      expect(workspace.attemptId).not.toBe("ready-attempt");
      expect(events.filter((event) => event.startsWith("remove:")).sort()).toEqual([
        "remove:/repos/primary",
        "remove:/repos/secondary",
      ]);
      expect(events.filter((event) => event.startsWith("create:")).sort()).toEqual([
        "create:/repos/primary",
        "create:/repos/secondary",
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
          missingWorktreePaths: new Set(["/worktrees/ready-primary"]),
        }),
      ),
    );
  });

  it.effect("does not repair a stale ready Workspace used by a live assigned Thread", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("resumes a partially releasing Workspace before preparing a new attempt", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const service = yield* TicketWorkspaceService;
      const releaseError = yield* Effect.flip(
        service.release({ ticketId, releasedAt: "2026-09-03T12:01:00.000Z" }),
      );

      expect(releaseError.message).toContain("simulated transient cleanup failure");
      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.status).toBe("ready");
      expect(workspace.attemptId).not.toBe("ready-attempt");
      expect(events.filter((event) => event === "remove:/repos/secondary")).toHaveLength(2);
      expect(events.filter((event) => event.startsWith("create:")).sort()).toEqual([
        "create:/repos/primary",
        "create:/repos/secondary",
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          failRemoveOnceSourcePath: "/repos/secondary",
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("validates every repository before creating deterministic worktrees", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(events.filter((event) => event.startsWith("validate:"))).toEqual([
        "validate:/repos/primary",
        "validate:/repos/secondary",
      ]);
      expect(events.findIndex((event) => event.startsWith("create:"))).toBeGreaterThan(
        events.lastIndexOf("validate:/repos/secondary"),
      );
      expect(workspace.status).toBe("ready");
      expect(workspace.repositories).toHaveLength(2);
      expect(workspace.repositories.every((repository) => repository.status === "ready")).toBe(
        true,
      );
      expect(workspace.repositories[0]?.branchName).toBe(ticketWorkspaceBranchName(ticketId));
      expect(workspace.repositories[0]?.worktreePath).toContain("workbench/ticket-1-");
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("rolls back persisted worktrees and keeps failure evidence", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const store = yield* WorkbenchStore;
      const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(events).toContain("remove:/repos/primary");
      expect(workspace.status).toBe("failed");
      expect(workspace.errorMessage).toContain("simulated worktree failure");
      expect(workspace.repositories).toEqual([
        expect.objectContaining({ projectId: primaryProjectId, status: "released" }),
        expect.objectContaining({ projectId: secondaryProjectId, status: "failed" }),
      ]);
    }).pipe(Effect.provide(makeTestLayer({ events, failProjectId: secondaryProjectId })));
  });

  it.effect("preserves an archived Ticket's ready worktrees on a stale release request", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const store = yield* WorkbenchStore;
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 0,
        archivedAt: createdAt,
        updatedAt: createdAt,
      });
      const service = yield* TicketWorkspaceService;
      const error = yield* Effect.flip(service.release({ ticketId, releasedAt: createdAt }));
      expect(error.code).toBe("ticket_archived");
      expect(events).toEqual([]);
      const workspace = yield* store.getTicketWorkspace(ticketId);
      expect(Option.getOrThrow(workspace).status).toBe("ready");
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("releases every prepared repository before marking the Workspace released", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      yield* service.prepare({ ticketId, requestedAt: createdAt });
      const released = yield* service.release({
        ticketId,
        releasedAt: "2026-09-03T12:05:00.000Z",
      });

      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([
        "remove:/repos/primary",
        "remove:/repos/secondary",
      ]);
      expect(released.status).toBe("released");
      expect(released.repositories.every((repository) => repository.status === "released")).toBe(
        true,
      );
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("refuses to release a Ticket Workspace used by an active Assignment", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      yield* service.prepare({ ticketId, requestedAt: createdAt });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-active', ${primaryProjectId}, 'Active work',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
          0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;
      const store = yield* WorkbenchStore;
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("assignment-active"),
        ticketId,
        threadId: ThreadId.make("thread-active"),
        createdAt,
      });

      const error = yield* Effect.flip(
        service.release({ ticketId, releasedAt: "2026-09-03T12:05:00.000Z" }),
      );

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("recovers an interrupted preparation before retrying", () => {
    const events: Array<string> = [];
    const primaryWorktreePath = "/worktrees/interrupted-primary";
    return Effect.gen(function* () {
      yield* seedTicket;
      const store = yield* WorkbenchStore;
      yield* seedActiveAssignment;
      yield* store.claimTicketWorkspace({
        ticketId,
        attemptId: WorkbenchTicketWorkspaceAttemptId.make("interrupted-attempt"),
        branchName: ticketWorkspaceBranchName(ticketId),
        repositories: [
          {
            projectId: primaryProjectId,
            isPrimary: true,
            sourcePath: "/repos/primary",
            worktreePath: primaryWorktreePath,
          },
          {
            projectId: secondaryProjectId,
            isPrimary: false,
            sourcePath: "/repos/secondary",
            worktreePath: "/worktrees/interrupted-secondary",
          },
        ],
        claimedAt: "2026-09-03T11:00:00.000Z",
      });
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(events).toContain("remove:/repos/primary");
      expect(workspace.status).toBe("ready");
      expect(workspace.attemptId).not.toBe("interrupted-attempt");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [{ sourcePath: "/repos/primary", worktreePath: primaryWorktreePath }],
        }),
      ),
    );
  });

  it.effect("recovers an interrupted preparation assigned to a deleted Thread", () => {
    const events: Array<string> = [];
    const primaryWorktreePath = "/worktrees/interrupted-primary";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedActiveAssignment;
      const store = yield* WorkbenchStore;
      yield* store.claimTicketWorkspace({
        ticketId,
        attemptId: WorkbenchTicketWorkspaceAttemptId.make("interrupted-attempt"),
        branchName: ticketWorkspaceBranchName(ticketId),
        repositories: [
          {
            projectId: primaryProjectId,
            isPrimary: true,
            sourcePath: "/repos/primary",
            worktreePath: primaryWorktreePath,
          },
          {
            projectId: secondaryProjectId,
            isPrimary: false,
            sourcePath: "/repos/secondary",
            worktreePath: "/worktrees/interrupted-secondary",
          },
        ],
        claimedAt: "2026-09-03T11:00:00.000Z",
      });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE projection_threads
        SET deleted_at = '2026-09-03T12:01:00.000Z'
        WHERE thread_id = ${activeThreadId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.status).toBe("ready");
      expect(workspace.attemptId).not.toBe("interrupted-attempt");
      expect(events).toContain("remove:/repos/primary");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [{ sourcePath: "/repos/primary", worktreePath: primaryWorktreePath }],
        }),
      ),
    );
  });

  it.effect("does not recover an interrupted preparation used by any live assigned Thread", () => {
    const events: Array<string> = [];
    const secondThreadId = ThreadId.make("thread-live-second");
    const primaryWorktreePath = "/worktrees/interrupted-primary";
    return Effect.gen(function* () {
      yield* seedTicket;
      const store = yield* WorkbenchStore;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          ${secondThreadId}, ${primaryProjectId}, 'Second active work',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
          0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("assignment-live-second"),
        ticketId,
        threadId: secondThreadId,
        createdAt,
      });
      yield* store.claimTicketWorkspace({
        ticketId,
        attemptId: WorkbenchTicketWorkspaceAttemptId.make("interrupted-attempt"),
        branchName: ticketWorkspaceBranchName(ticketId),
        repositories: [
          {
            projectId: primaryProjectId,
            isPrimary: true,
            sourcePath: "/repos/primary",
            worktreePath: primaryWorktreePath,
          },
          {
            projectId: secondaryProjectId,
            isPrimary: false,
            sourcePath: "/repos/secondary",
            worktreePath: "/worktrees/interrupted-secondary",
          },
        ],
        claimedAt: "2026-09-03T11:00:00.000Z",
      });
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("prune:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          liveThreadIds: new Set([secondThreadId]),
          initialWorktrees: [{ sourcePath: "/repos/primary", worktreePath: primaryWorktreePath }],
        }),
      ),
    );
  });
});
