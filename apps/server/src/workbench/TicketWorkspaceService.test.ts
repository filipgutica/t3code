import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  GitCommandError,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
  type VcsStatusLocalResult,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { BranchNameGenerationInput } from "../textGeneration/TextGeneration.ts";
import { ticketWorkspaceHostLayer } from "./TicketWorkspaceService.ts";
import {
  TicketWorkspaceService,
  ticketWorkspaceDirectoryName,
  ticketWorkspaceBranchName,
  TicketWorkspaceServiceLive,
} from "@t3tools/workbench/TicketWorkspaceService";
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

const seedJiraIssueLink = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO workbench_jira_connections (
      connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
      scopes_json, created_at, updated_at
    ) VALUES (
      'connection-1', 'cloud-1', 'credential-1', 'Jira', 'https://example.atlassian.net',
      NULL, '[]', ${createdAt}, ${createdAt}
    )
  `;
  yield* sql`
    INSERT INTO workbench_jira_bindings (
      binding_id, workbench_project_id, connection_id, jira_project_id, jira_project_key,
      jira_project_name, board_id, board_name, sprint_id, sprint_name,
      default_primary_t3_project_id, default_repository_project_ids_json,
      status_mappings_json, active, last_synced_at, created_at, updated_at
    ) VALUES (
      'binding-1', ${workspaceId}, 'connection-1', '10000', 'MA', 'Main',
      42, 'Board', 7, 'Sprint', ${primaryProjectId}, '["project-primary","project-secondary"]',
      '[]', 1, NULL, ${createdAt}, ${createdAt}
    )
  `;
  yield* sql`
    INSERT INTO workbench_jira_issue_links (
      binding_id, jira_issue_id, ticket_id, issue_json, active, linked_at, last_seen_at
    ) VALUES (
      'binding-1', '10001', ${ticketId}, '{"key":"MA-4037"}', 1,
      ${createdAt}, ${createdAt}
    )
  `;
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
  initialWorktreeBranches,
  missingWorktreePaths,
  existingPaths,
  existingPathPattern,
  unownedBranchNames,
  projectWorkspaceRoots,
  dirtyWorktreePaths,
  liveThreadIds,
  liveThreadWorktreePaths,
  onRemoveWorktree,
  removals,
  onListRefs,
  failRemoveOnceSourcePath,
  generateBranchName,
}: {
  events: Array<string>;
  failProjectId?: ProjectId;
  initialWorktrees?: ReadonlyArray<{ readonly sourcePath: string; readonly worktreePath: string }>;
  initialWorktreeBranches?: ReadonlyMap<string, string>;
  missingWorktreePaths?: ReadonlySet<string>;
  existingPaths?: ReadonlySet<string>;
  existingPathPattern?: RegExp;
  unownedBranchNames?: ReadonlySet<string>;
  projectWorkspaceRoots?: ReadonlyMap<ProjectId, string>;
  dirtyWorktreePaths?: ReadonlySet<string>;
  liveThreadIds?: ReadonlySet<ThreadId>;
  liveThreadWorktreePaths?: ReadonlyMap<ThreadId, string>;
  onRemoveWorktree?: () => Effect.Effect<void, WorkbenchOperationError>;
  removals?: Array<{ readonly cwd: string; readonly force: boolean | undefined }>;
  onListRefs?: () => Effect.Effect<void, WorkbenchOperationError>;
  failRemoveOnceSourcePath?: string;
  generateBranchName?: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<string, TextGenerationError>;
}) => {
  const worktrees = new Map(
    initialWorktrees?.map(({ sourcePath, worktreePath }) => [sourcePath, worktreePath]),
  );
  const branches = new Map(
    initialWorktrees?.map(({ sourcePath }) => [
      sourcePath,
      new Set([initialWorktreeBranches?.get(sourcePath) ?? ticketWorkspaceBranchName(ticketId)]),
    ]),
  );
  const missingPaths = new Set(missingWorktreePaths);
  const paths = new Set(existingPaths);
  const dirtyPaths = new Set(dirtyWorktreePaths);
  let shouldFailRemove = failRemoveOnceSourcePath !== undefined;
  let pendingListRefsHook = onListRefs;
  const branchNameGenerator =
    generateBranchName ?? (() => Effect.succeed("") as Effect.Effect<string, never>);
  const storeLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-ticket-workspace-test-",
  }).pipe(Layer.provide(NodeServices.layer));
  const projectionLayer = Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getProjectShellById: (projectId) => {
      events.push(`project:${projectId}`);
      if (projectId === primaryProjectId) {
        return Effect.succeed(
          Option.some(
            projectShell({
              id: projectId,
              workspaceRoot: projectWorkspaceRoots?.get(projectId) ?? "/repos/primary",
            }),
          ),
        );
      }
      if (projectId === secondaryProjectId) {
        return Effect.succeed(
          Option.some(
            projectShell({
              id: projectId,
              workspaceRoot: projectWorkspaceRoots?.get(projectId) ?? "/repos/secondary",
            }),
          ),
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
              worktreePath: liveThreadWorktreePaths?.get(threadId) ?? null,
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
    localStatus: ({ cwd }) =>
      Effect.succeed({
        isRepo: true,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: ticketWorkspaceBranchName(ticketId),
        hasWorkingTreeChanges:
          dirtyPaths.has(cwd) || [...dirtyPaths].some((path) => cwd.endsWith(path)),
        workingTree: { files: [], insertions: 0, deletions: 0 },
      } satisfies VcsStatusLocalResult),
    invalidateLocalStatus: (cwd) => {
      events.push(`invalidate:${cwd}`);
      return Effect.void;
    },
    listRefs: ({ cwd }) => {
      events.push(`validate:${cwd}`);
      const registeredWorktreePath = worktrees.get(cwd);
      const visibleWorktreePath =
        registeredWorktreePath !== undefined && !missingPaths.has(registeredWorktreePath)
          ? registeredWorktreePath
          : undefined;
      const repositoryBranches = branches.get(cwd) ?? new Set<string>();
      const result = {
        refs: [
          { name: "main", current: true, isDefault: true, worktreePath: cwd },
          ...[...repositoryBranches].map((name) => ({
            name,
            current: false,
            isDefault: false,
            worktreePath: visibleWorktreePath ?? null,
          })),
          ...(unownedBranchNames === undefined
            ? []
            : [...unownedBranchNames].map((name) => ({
                name,
                current: false,
                isDefault: false,
                worktreePath: null,
              }))),
        ],
        isRepo: true,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 1,
      };
      const hook = pendingListRefsHook;
      pendingListRefsHook = undefined;
      if (hook !== undefined) {
        return Effect.gen(function* () {
          yield* hook().pipe(Effect.orDie);
          return result;
        });
      }
      return Effect.succeed(result);
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
      const worktreePath = input.path ?? `/unexpected/${projectId}`;
      worktrees.set(input.cwd, worktreePath);
      const repositoryBranches = branches.get(input.cwd) ?? new Set<string>();
      repositoryBranches.add(input.newRefName ?? input.refName);
      branches.set(input.cwd, repositoryBranches);
      return Effect.succeed({
        worktree: {
          path: worktreePath,
          refName: input.newRefName ?? input.refName,
        },
      });
    },
    removeWorktree: (input) => {
      const { cwd } = input;
      events.push(`remove:${cwd}`);
      removals?.push({ cwd, force: input.force });
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
      if (onRemoveWorktree !== undefined) {
        return Effect.gen(function* () {
          yield* onRemoveWorktree().pipe(Effect.orDie);
          worktrees.delete(cwd);
        });
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
              (paths.has(candidate) ||
                existingPathPattern?.test(candidate) === true ||
                [...worktrees.values()].some((worktreePath) => worktreePath === candidate)),
          ),
      });
    }),
  ).pipe(Layer.provide(NodeServices.layer));
  const hostLayer = ticketWorkspaceHostLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        configLayer,
        gitLayer,
        projectionLayer,
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([]),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateBranchName: (input) =>
            branchNameGenerator(input).pipe(Effect.map((branch) => ({ branch }))),
        }),
      ),
    ),
  );
  return TicketWorkspaceServiceLive.pipe(
    Layer.provideMerge(Layer.mergeAll(storeLayer, hostLayer, NodeServices.layer, fileSystemLayer)),
  );
};

describe("TicketWorkspaceService", () => {
  it("sanitizes naming metadata before using it as a path segment", () => {
    expect(
      ticketWorkspaceDirectoryName({
        ticketId,
        jiraIssueKey: "../MA/4037",
      }),
    ).toBe("ma-4037-737ce60f");
    expect(
      ticketWorkspaceDirectoryName({
        ticketId,
        title: "Prepare / repositories",
      }),
    ).toMatch(/^prepare-repositories-[0-9a-f]{8}$/);
  });

  it("keeps readable Jira names unique across Tickets", () => {
    const first = ticketWorkspaceDirectoryName({ ticketId: "ticket-1", jiraIssueKey: "MA-123" });
    const second = ticketWorkspaceDirectoryName({ ticketId: "ticket-2", jiraIssueKey: "MA-123" });

    expect(first).toMatch(/^ma-123-[0-9a-f]{8}$/);
    expect(second).toMatch(/^ma-123-[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
    const firstBranch = ticketWorkspaceBranchName({
      ticketId: "ticket-1",
      jiraIssueKey: "MA-123",
      generatedBranchName: "MA-123-fix-validation",
    });
    const secondBranch = ticketWorkspaceBranchName({
      ticketId: "ticket-2",
      jiraIssueKey: "MA-123",
      generatedBranchName: "MA-123-fix-validation",
    });
    expect(firstBranch).toMatch(/^workbench\/ma-123-fix-validation-[0-9a-f]{8}$/);
    expect(firstBranch).not.toBe(secondBranch);
  });

  it("falls back to the ticket title when a generated branch fragment is empty or unsafe", () => {
    const fallback = "workbench/ma-123-prepare-repositories-";
    expect(
      ticketWorkspaceBranchName({
        ticketId: "ticket-1",
        jiraIssueKey: "MA-123",
        title: "Prepare repositories",
        generatedBranchName: "",
      }),
    ).toBe(`${fallback}737ce60f`);
    expect(
      ticketWorkspaceBranchName({
        ticketId: "ticket-1",
        jiraIssueKey: "MA-123",
        title: "Prepare repositories",
        generatedBranchName: "../../",
      }),
    ).toBe(`${fallback}737ce60f`);
  });

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
    const generationCalls: BranchNameGenerationInput[] = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.attemptId).toBe("ready-attempt");
      expect(generationCalls).toEqual([]);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          generateBranchName: (input) => {
            generationCalls.push(input);
            return Effect.succeed("unused");
          },
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("rejects a ready Workspace claim after scope changes during validation", () => {
    const events: Array<string> = [];
    let storeForValidation: WorkbenchStore["Service"] | undefined;
    const onListRefs = () => {
      const store = storeForValidation;
      if (store === undefined) return Effect.die("validation store was not initialized");
      return Effect.gen(function* () {
        yield* store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          primaryT3ProjectId: secondaryProjectId,
          repositoryProjectIds: [secondaryProjectId],
          updatedAt: "2026-09-03T12:00:01.000Z",
        });
        events.push("scope-updated");
      });
    };
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const store = yield* WorkbenchStore;
      storeForValidation = store;
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const ticket = (yield* store.getSnapshot).tickets.find(
        (candidate) => candidate.id === ticketId,
      );

      expect(error.code).toBe("ticket_workspace_preparation_changed");
      expect(events).toContain("scope-updated");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
      expect(ticket).toMatchObject({
        primaryT3ProjectId: secondaryProjectId,
        repositoryProjectIds: [secondaryProjectId],
        revision: 1,
      });
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          onListRefs,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("refuses a ready Workspace whose worktree is no longer registered", () => {
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

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(error.message).toContain("missing or no longer registered");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
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
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, "/worktrees/ready-primary"]]),
          initialWorktrees: [
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
        }),
      ),
    );
  });

  it.effect("extends a Workspace while retaining a live Thread in another repository", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        DELETE FROM workbench_ticket_workspace_repositories
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.status).toBe("ready");
      expect(workspace.attemptId).not.toBe("ready-attempt");
      expect(events.filter((event) => event.startsWith("create:")).sort()).toEqual([
        "create:/repos/secondary",
      ]);
      expect(workspace.repositories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: primaryProjectId,
            status: "ready",
            worktreePath: "/worktrees/ready-primary",
          }),
          expect.objectContaining({
            projectId: secondaryProjectId,
            status: "ready",
          }),
        ]),
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, "/worktrees/ready-primary"]]),
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
          ],
        }),
      ),
    );
  });

  it.effect("keeps extensions under the parent of a previously recorded worktree", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET worktree_path = '/worktrees/legacy/primary'
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${primaryProjectId}
      `;
      yield* sql`
        DELETE FROM workbench_ticket_workspace_repositories
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.repositories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: primaryProjectId,
            worktreePath: "/worktrees/legacy/primary",
          }),
          expect.objectContaining({
            projectId: secondaryProjectId,
            worktreePath: "/worktrees/legacy/secondary",
          }),
        ]),
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/legacy/primary" },
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

  it.effect("retries a reset after a transient worktree removal failure", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      yield* service.prepare({ ticketId, requestedAt: createdAt });
      const firstError = yield* Effect.flip(
        service.release({ ticketId, releasedAt: "2026-09-03T12:05:00.000Z" }),
      );
      expect(firstError.message).toContain("simulated transient cleanup failure");

      const released = yield* service.release({
        ticketId,
        releasedAt: "2026-09-03T12:06:00.000Z",
      });

      expect(released.status).toBe("released");
      expect(events.filter((event) => event === "remove:/repos/primary")).toHaveLength(1);
      expect(events.filter((event) => event === "remove:/repos/secondary")).toHaveLength(2);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          failRemoveOnceSourcePath: "/repos/secondary",
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
      expect(workspace.repositories[0]?.branchName).toBe(
        ticketWorkspaceBranchName({ ticketId, title: "Prepare repositories" }),
      );
      expect(workspace.repositories[0]?.worktreePath).toContain("workbench/prepare-repositories-");
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("reconciles the observed branch after a native branch switch", () => {
    const events: Array<string> = [];
    const currentBranch = "feature/native-branch";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.branchName).toBe(ticketWorkspaceBranchName(ticketId));
      expect(
        workspace.repositories.every((repository) => repository.branchName === currentBranch),
      ).toBe(true);
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
          initialWorktreeBranches: new Map([
            ["/repos/primary", currentBranch],
            ["/repos/secondary", currentBranch],
          ]),
        }),
      ),
    );
  });

  it.effect("uses the active Jira key and repository basenames for a new Workspace", () => {
    const events: Array<string> = [];
    const generationCalls: BranchNameGenerationInput[] = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedJiraIssueLink;
      const service = yield* TicketWorkspaceService;
      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.branchName).toBe("workbench/ma-4037-fix-validation-737ce60f");
      expect(workspace.repositories.map((repository) => repository.worktreePath)).toEqual([
        expect.stringMatching(/workbench\/ma-4037-737ce60f\/primary$/),
        expect.stringMatching(/workbench\/ma-4037-737ce60f\/secondary$/),
      ]);
      expect(generationCalls).toHaveLength(1);
      expect(generationCalls[0]).toMatchObject({
        cwd: "/repos/primary",
        message: "Prepare repositories\n\n",
      });
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          generateBranchName: (input) => {
            generationCalls.push(input);
            return Effect.succeed("MA-4037-fix-validation");
          },
        }),
      ),
    );
  });

  it.effect("falls back to the ticket title when branch generation fails", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.branchName).toBe("workbench/prepare-repositories-737ce60f");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          generateBranchName: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateBranchName",
                detail: "simulated generation failure",
              }),
            ),
        }),
      ),
    );
  });

  it.effect("rejects an existing unowned Workspace directory", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(error.message).toContain("already exists and is not recorded");
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          existingPathPattern: /\/workbench\/prepare-repositories-[0-9a-f]{8}$/,
        }),
      ),
    );
  });

  it.effect("rejects an unowned existing branch for a new repository", () => {
    const events: Array<string> = [];
    const branchName = ticketWorkspaceBranchName({ ticketId, title: "Prepare repositories" });
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(error.message).toContain(`branch ${branchName}`);
      expect(events.filter((event) => event.startsWith("create:"))).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer({ events, unownedBranchNames: new Set([branchName]) })));
  });

  it.effect("suffixes duplicate repository basenames without sharing a path", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.repositories.map((repository) => repository.worktreePath)).toEqual([
        expect.stringMatching(/workbench\/prepare-repositories-[0-9a-f]{8}\/shared$/),
        expect.stringMatching(/workbench\/prepare-repositories-[0-9a-f]{8}\/shared-[0-9a-f]{8}$/),
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          projectWorkspaceRoots: new Map([
            [primaryProjectId, "/repos/one/shared"],
            [secondaryProjectId, "/repos/two/shared"],
          ]),
        }),
      ),
    );
  });

  it.effect("rolls back persisted worktrees and keeps failure evidence", () => {
    const events: Array<string> = [];
    const mutationErrors: Array<string> = [];
    let storeForCleanup: WorkbenchStore["Service"] | undefined;
    const onRemoveWorktree = () => {
      const store = storeForCleanup;
      if (store === undefined) return Effect.die("cleanup store was not initialized");
      return Effect.gen(function* () {
        const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));
        expect(workspace.status).toBe("preparing");

        const scopeResult = yield* Effect.result(
          store.updateTicket({
            id: ticketId,
            expectedRevision: 0,
            primaryT3ProjectId: secondaryProjectId,
            repositoryProjectIds: [secondaryProjectId],
            updatedAt: createdAt,
          }),
        );
        expect(Result.isFailure(scopeResult)).toBe(true);
        if (Result.isFailure(scopeResult)) mutationErrors.push(scopeResult.failure.code);
      });
    };
    return Effect.gen(function* () {
      yield* seedTicket;
      const store = yield* WorkbenchStore;
      storeForCleanup = store;
      const service = yield* TicketWorkspaceService;
      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(mutationErrors).toEqual(["ticket_workspace_in_use"]);
      expect(events).toContain("remove:/repos/primary");
      expect(workspace.status).toBe("failed");
      expect(workspace.errorMessage).toContain("simulated worktree failure");
      expect(workspace.repositories).toEqual([
        expect.objectContaining({ projectId: primaryProjectId, status: "released" }),
        expect.objectContaining({ projectId: secondaryProjectId, status: "failed" }),
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({ events, failProjectId: secondaryProjectId, onRemoveWorktree }),
      ),
    );
  });

  it.effect("keeps retained worktrees when a Workspace extension fails", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        DELETE FROM workbench_ticket_workspace_repositories
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const store = yield* WorkbenchStore;
      const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(events).not.toContain("remove:/repos/primary");
      expect(workspace.status).toBe("failed");
      expect(workspace.repositories).toEqual([
        expect.objectContaining({ projectId: primaryProjectId, status: "ready" }),
        expect.objectContaining({
          projectId: secondaryProjectId,
          status: "failed",
          errorMessage: expect.stringContaining("simulated worktree failure"),
        }),
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          failProjectId: secondaryProjectId,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
          ],
        }),
      ),
    );
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
    const removals: Array<{ readonly cwd: string; readonly force: boolean | undefined }> = [];
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
      expect(removals.every(({ force }) => force !== true)).toBe(true);
    }).pipe(Effect.provide(makeTestLayer({ events, removals })));
  });

  it.effect("resets a Workspace after a native branch switch", () => {
    const events: Array<string> = [];
    const currentBranch = "feature/native-branch";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      const service = yield* TicketWorkspaceService;

      const released = yield* service.release({
        ticketId,
        releasedAt: "2026-09-03T12:05:00.000Z",
      });

      expect(released.status).toBe("released");
      expect(
        released.repositories.every((repository) => repository.branchName === currentBranch),
      ).toBe(true);
      expect(events.filter((event) => event.startsWith("remove:"))).toHaveLength(2);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: "/worktrees/ready-secondary" },
          ],
          initialWorktreeBranches: new Map([
            ["/repos/primary", currentBranch],
            ["/repos/secondary", currentBranch],
          ]),
        }),
      ),
    );
  });

  it.effect("recreates readable repository directories while preserving the owned branch", () => {
    const events: Array<string> = [];
    const generationCalls: BranchNameGenerationInput[] = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedJiraIssueLink;
      const service = yield* TicketWorkspaceService;
      const first = yield* service.prepare({ ticketId, requestedAt: createdAt });
      yield* service.release({ ticketId, releasedAt: "2026-09-03T12:05:00.000Z" });
      const second = yield* service.prepare({ ticketId, requestedAt: "2026-09-03T12:06:00.000Z" });

      expect(second.branchName).toBe(first.branchName);
      expect(generationCalls).toHaveLength(1);
      expect(second.repositories.map((repository) => repository.worktreePath)).toEqual(
        first.repositories.map((repository) => repository.worktreePath),
      );
      expect(events.filter((event) => event.startsWith("remove:"))).toHaveLength(2);
      expect(events.filter((event) => event.startsWith("create:"))).toHaveLength(4);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          generateBranchName: (input) => {
            generationCalls.push(input);
            return Effect.succeed("prepare-repositories");
          },
        }),
      ),
    );
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

  it.effect("refuses to reset when an archived superseded Thread remains linked", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      const service = yield* TicketWorkspaceService;
      yield* service.prepare({ ticketId, requestedAt: createdAt });
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE projection_threads
        SET archived_at = ${createdAt}
        WHERE thread_id = ${activeThreadId}
      `;
      yield* sql`
        UPDATE workbench_assignments
        SET superseded_at = ${createdAt}
        WHERE ticket_id = ${ticketId} AND thread_id = ${activeThreadId}
      `;

      const error = yield* Effect.flip(
        service.release({ ticketId, releasedAt: "2026-09-03T12:05:00.000Z" }),
      );

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer({ events })));
  });

  it.effect("preflights every repository and removes none when one has local changes", () => {
    const events: Array<string> = [];
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedJiraIssueLink;
      const service = yield* TicketWorkspaceService;
      yield* service.prepare({ ticketId, requestedAt: createdAt });

      const error = yield* Effect.flip(
        service.release({ ticketId, releasedAt: "2026-09-03T12:05:00.000Z" }),
      );

      expect(error.code).toBe("ticket_workspace_preparation_failed");
      expect(error.message).toContain("secondary at");
      expect(events.filter((event) => event.startsWith("invalidate:"))).toHaveLength(2);
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      const store = yield* WorkbenchStore;
      expect(Option.getOrThrow(yield* store.getTicketWorkspace(ticketId)).status).toBe("ready");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          dirtyWorktreePaths: new Set(["/worktrees/workbench/ma-4037-737ce60f/secondary"]),
        }),
      ),
    );
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

  it.effect("protects current-attempt worktrees during interrupted extension recovery", () => {
    const events: Array<string> = [];
    const attemptId = WorkbenchTicketWorkspaceAttemptId.make("interrupted-extension-attempt");
    const currentWorktreePath = "/worktrees/interrupted-secondary";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE workbench_ticket_workspaces
        SET attempt_id = ${attemptId}, status = 'preparing', updated_at = '2026-09-03T11:00:00.000Z'
        WHERE ticket_id = ${ticketId}
      `;
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET attempt_id = ${attemptId}, status = 'pending', worktree_path = ${currentWorktreePath}
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const store = yield* WorkbenchStore;
      const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(workspace.status).toBe("preparing");
      expect(workspace.repositories).toEqual([
        expect.objectContaining({ projectId: primaryProjectId, status: "ready" }),
        expect.objectContaining({ projectId: secondaryProjectId, status: "pending" }),
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, currentWorktreePath]]),
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: currentWorktreePath },
          ],
        }),
      ),
    );
  });

  it.effect("protects current-attempt worktrees during failed extension recovery", () => {
    const events: Array<string> = [];
    const attemptId = WorkbenchTicketWorkspaceAttemptId.make("failed-extension-attempt");
    const currentWorktreePath = "/worktrees/failed-secondary";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE workbench_ticket_workspaces
        SET attempt_id = ${attemptId}, status = 'failed', updated_at = '2026-09-03T11:00:00.000Z'
        WHERE ticket_id = ${ticketId}
      `;
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET attempt_id = ${attemptId}, status = 'failed', worktree_path = ${currentWorktreePath}
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const error = yield* Effect.flip(service.prepare({ ticketId, requestedAt: createdAt }));
      const store = yield* WorkbenchStore;
      const workspace = Option.getOrThrow(yield* store.getTicketWorkspace(ticketId));

      expect(error.code).toBe("ticket_workspace_in_use");
      expect(events.filter((event) => event.startsWith("remove:"))).toEqual([]);
      expect(workspace.status).toBe("failed");
      expect(workspace.repositories).toEqual([
        expect.objectContaining({ projectId: primaryProjectId, status: "ready" }),
        expect.objectContaining({ projectId: secondaryProjectId, status: "failed" }),
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, currentWorktreePath]]),
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: currentWorktreePath },
          ],
        }),
      ),
    );
  });

  it.effect("recovers an interrupted extension while retaining an active Thread elsewhere", () => {
    const events: Array<string> = [];
    const attemptId = WorkbenchTicketWorkspaceAttemptId.make("interrupted-extension-retry");
    const currentWorktreePath = "/worktrees/interrupted-secondary";
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE workbench_ticket_workspaces
        SET attempt_id = ${attemptId}, status = 'preparing', updated_at = '2026-09-03T11:00:00.000Z'
        WHERE ticket_id = ${ticketId}
      `;
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET attempt_id = ${attemptId}, status = 'pending', worktree_path = ${currentWorktreePath}
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(workspace.status).toBe("ready");
      expect(events.filter((event) => event.startsWith("remove:")).sort()).toEqual([
        "remove:/repos/secondary",
      ]);
      expect(events.filter((event) => event.startsWith("create:")).sort()).toEqual([
        "create:/repos/secondary",
      ]);
      expect(workspace.repositories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: primaryProjectId,
            status: "ready",
            worktreePath: "/worktrees/ready-primary",
          }),
          expect.objectContaining({ projectId: secondaryProjectId, status: "ready" }),
        ]),
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, "/worktrees/ready-primary"]]),
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: currentWorktreePath },
          ],
        }),
      ),
    );
  });

  it.effect("claims failed recovery before allowing cleanup-time Ticket mutations", () => {
    const events: Array<string> = [];
    const mutationErrors: Array<string> = [];
    const attemptId = WorkbenchTicketWorkspaceAttemptId.make("failed-recovery-race");
    const currentWorktreePath = "/worktrees/failed-recovery-secondary";
    let storeForCleanup: WorkbenchStore["Service"] | undefined;
    const onRemoveWorktree = () => {
      const store = storeForCleanup;
      if (store === undefined) return Effect.die("cleanup store was not initialized");
      return Effect.gen(function* () {
        const scopeResult = yield* Effect.result(
          store.updateTicket({
            id: ticketId,
            expectedRevision: 0,
            primaryT3ProjectId: secondaryProjectId,
            repositoryProjectIds: [secondaryProjectId],
            updatedAt: createdAt,
          }),
        );
        expect(Result.isFailure(scopeResult)).toBe(true);
        if (Result.isFailure(scopeResult)) mutationErrors.push(`scope:${scopeResult.failure.code}`);

        const assignmentResult = yield* Effect.result(
          store.createAssignment({
            id: WorkbenchAssignmentId.make("failed-recovery-race-assignment"),
            ticketId,
            threadId: ThreadId.make("failed-recovery-race-thread"),
            createdAt,
          }),
        );
        expect(Result.isFailure(assignmentResult)).toBe(true);
        if (Result.isFailure(assignmentResult)) {
          mutationErrors.push(`assignment:${assignmentResult.failure.code}`);
        }
      });
    };
    return Effect.gen(function* () {
      yield* seedTicket;
      yield* seedReadyTicketWorkspace;
      yield* seedActiveAssignment;
      const store = yield* WorkbenchStore;
      storeForCleanup = store;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          'failed-recovery-race-thread', ${primaryProjectId}, 'Recovery race', '{}',
          'full-access', 'default', 0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* sql`
        UPDATE workbench_ticket_workspaces
        SET attempt_id = ${attemptId}, status = 'failed', updated_at = ${createdAt}
        WHERE ticket_id = ${ticketId}
      `;
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET attempt_id = ${attemptId}, status = 'failed', worktree_path = ${currentWorktreePath}
        WHERE ticket_id = ${ticketId} AND t3_project_id = ${secondaryProjectId}
      `;
      const service = yield* TicketWorkspaceService;

      const workspace = yield* service.prepare({ ticketId, requestedAt: createdAt });

      expect(mutationErrors).toEqual([
        "scope:ticket_workspace_in_use",
        "assignment:ticket_workspace_in_use",
      ]);
      expect(workspace.status).toBe("ready");
      expect(events.filter((event) => event.startsWith("remove:")).sort()).toEqual([
        "remove:/repos/secondary",
      ]);
      expect(events.filter((event) => event.startsWith("create:")).sort()).toEqual([
        "create:/repos/secondary",
      ]);
      expect(workspace.repositories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: primaryProjectId,
            status: "ready",
            worktreePath: "/worktrees/ready-primary",
          }),
          expect.objectContaining({ projectId: secondaryProjectId, status: "ready" }),
        ]),
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          events,
          onRemoveWorktree,
          liveThreadIds: new Set([activeThreadId]),
          liveThreadWorktreePaths: new Map([[activeThreadId, "/worktrees/ready-primary"]]),
          initialWorktrees: [
            { sourcePath: "/repos/primary", worktreePath: "/worktrees/ready-primary" },
            { sourcePath: "/repos/secondary", worktreePath: currentWorktreePath },
          ],
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
          liveThreadWorktreePaths: new Map([
            [activeThreadId, primaryWorktreePath],
            [secondThreadId, primaryWorktreePath],
          ]),
          initialWorktrees: [{ sourcePath: "/repos/primary", worktreePath: primaryWorktreePath }],
        }),
      ),
    );
  });
});
