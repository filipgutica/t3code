import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  GitCommandError,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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

const makeTestLayer = ({
  events,
  failProjectId,
  initialWorktrees,
}: {
  events: Array<string>;
  failProjectId?: ProjectId;
  initialWorktrees?: ReadonlyArray<{ readonly sourcePath: string; readonly worktreePath: string }>;
}) => {
  const worktrees = new Map(
    initialWorktrees?.map(({ sourcePath, worktreePath }) => [sourcePath, worktreePath]),
  );
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
  });
  const gitLayer = Layer.mock(GitWorkflowService.GitWorkflowService)({
    listRefs: ({ cwd }) => {
      events.push(`validate:${cwd}`);
      return Effect.succeed({
        refs: [
          { name: "main", current: true, isDefault: true, worktreePath: cwd },
          ...(worktrees.has(cwd)
            ? [
                {
                  name: ticketWorkspaceBranchName(ticketId),
                  current: false,
                  isDefault: false,
                  worktreePath: worktrees.get(cwd) ?? null,
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
      worktrees.delete(cwd);
      return Effect.void;
    },
  });
  return TicketWorkspaceServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(storeLayer, configLayer, projectionLayer, gitLayer, NodeServices.layer),
    ),
  );
};

describe("TicketWorkspaceService", () => {
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
});
