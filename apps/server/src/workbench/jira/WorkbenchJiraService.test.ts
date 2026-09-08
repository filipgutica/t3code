import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraConnection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Deferred from "effect/Deferred";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi } from "@t3tools/workbench/jira/JiraApi";
import { JiraAuthService } from "@t3tools/workbench/jira/JiraAuthService";
import { JiraSyncService } from "@t3tools/workbench/jira/JiraSyncService";
import { JiraTicketWriteService } from "@t3tools/workbench/jira/JiraTicketWriteService";
import {
  WorkbenchJiraRepository,
  WorkbenchJiraRepositoryError,
  type WorkbenchJiraRepositoryShape,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as WorkbenchJiraService from "@t3tools/workbench/jira/WorkbenchJiraService";

const TestLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const ticketWriter = JiraTicketWriteService.of({
  getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
  updateTicket: () => Effect.die("unexpected Jira Ticket write"),
  startTicketExecution: () => Effect.die("unexpected Jira execution"),
});

describe("WorkbenchJiraService", () => {
  it.effect("runs the five-minute scheduler for active bindings and skips paused bindings", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Array<WorkbenchJiraBindingId>>([]);
      const syncCompleted = yield* Deferred.make<void>();
      const activeBinding: WorkbenchJiraBinding = {
        id: WorkbenchJiraBindingId.make("binding-active"),
        projectId: WorkbenchProjectId.make("workspace-1"),
        connectionId: WorkbenchJiraConnectionId.make("connection-1"),
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench Board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: ProjectId.make("native-project-1"),
        defaultRepositoryProjectIds: [ProjectId.make("native-project-1")],
        statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
        selectedSprints: [{ id: 7, name: "Sprint 7" }],
        followActiveSprint: true,
        observedActiveSprintIds: [7],
        boardMode: "mapped",
        boardColumns: [],
        active: true,
        lastSyncedAt: null,
        lastSyncError: null,
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      };
      const pausedBinding = {
        ...activeBinding,
        id: WorkbenchJiraBindingId.make("binding-paused"),
        active: false,
      };
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.none()),
        listBindings: () => Effect.succeed([activeBinding, pausedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.succeed(true),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      });
      const auth = JiraAuthService.of({
        begin: () => Effect.die("unexpected auth start"),
        complete: () => Effect.die("unexpected auth completion"),
        getAccessToken: () => Effect.die("unexpected token read"),
      });
      const sync = JiraSyncService.of({
        withBindingPermit: (_bindingId, effect) => effect,
        syncBinding: ({ bindingId }) =>
          Ref.update(calls, (current) => [...current, bindingId]).pipe(
            Effect.tap(() => Deferred.succeed(syncCompleted, undefined)),
            Effect.as({
              bindingId,
              syncedAt: "2026-09-03T12:00:00.000Z",
              activated: 0,
              updated: 0,
              deactivated: 0,
              links: [],
            }),
          ),
      });
      const service = yield* WorkbenchJiraService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(JiraSyncService, sync),
        Effect.provideService(JiraTicketWriteService, ticketWriter),
      );

      yield* TestClock.adjust("5 minutes");
      yield* Deferred.await(syncCompleted);

      expect(service).toBeDefined();
      expect(yield* Ref.get(calls)).toEqual([activeBinding.id]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(TestLayer, TestClock.layer()))),
  );

  it.effect("applies defaults and caches the server-owned board configuration on create", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbenchProjectId = WorkbenchProjectId.make("workspace-1");
      const nativeProjectId = ProjectId.make("native-project-1");
      const connectionId = WorkbenchJiraConnectionId.make("connection-1");
      const bindingId = WorkbenchJiraBindingId.make("binding-1");
      const createdAt = "2026-09-03T12:00:00.000Z";
      const connection: WorkbenchJiraConnection = {
        id: connectionId,
        cloudId: "cloud-1",
        siteName: "Example Jira",
        siteUrl: "https://example.atlassian.net",
        avatarUrl: null,
        scopes: [],
        createdAt,
        updatedAt: createdAt,
      };
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${nativeProjectId}, 'T3 Code', '/repos/t3code', '[]',
          ${createdAt}, ${createdAt}, NULL
        )
      `;
      const workbench = yield* WorkbenchStore;
      yield* workbench.createProject({
        id: workbenchProjectId,
        title: "Jira Workspace",
        linkedProjectIds: [nativeProjectId],
        createdAt,
      });
      let savedBinding: WorkbenchJiraBinding | null = null;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.some(connection)),
        getConnection: () => Effect.succeed(Option.some(connection)),
        listConnections: () => Effect.succeed([connection]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.fromNullishOr(savedBinding)),
        listBindings: () => Effect.succeed(savedBinding === null ? [] : [savedBinding]),
        upsertBinding: (binding) =>
          Effect.sync(() => {
            savedBinding = binding;
          }),
        updateBindingSyncMetadata: () => Effect.succeed(true),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () =>
          Effect.succeed([
            {
              id: 7,
              name: "Sprint 7",
              state: "active" as const,
              goal: "",
              startDate: null,
              endDate: null,
              completeDate: null,
            },
            {
              id: 17,
              name: "Sprint 17",
              state: "active" as const,
              goal: "",
              startDate: null,
              endDate: null,
              completeDate: null,
            },
          ]),
        getBoardConfiguration: () =>
          Effect.succeed({
            boardId: 42,
            name: "Server board name",
            type: "scrum" as const,
            columns: [{ name: "To Do", statusIds: ["1"], done: false }],
            rankFieldId: null,
          }),
        listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      });
      const auth = JiraAuthService.of({
        begin: () => Effect.die("unexpected auth start"),
        complete: () => Effect.die("unexpected auth completion"),
        getAccessToken: () => Effect.die("unexpected token read"),
      });
      const sync = JiraSyncService.of({
        withBindingPermit: (_bindingId, effect) => effect,
        syncBinding: () => Effect.die("unexpected Jira synchronization"),
      });
      const service = yield* WorkbenchJiraService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(JiraSyncService, sync),
        Effect.provideService(JiraTicketWriteService, ticketWriter),
      );

      const binding = yield* service.createBinding({
        id: bindingId,
        projectId: workbenchProjectId,
        connectionId,
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Client board name",
        sprintId: 7,
        sprintName: "Sprint 7",
        selectedSprints: [{ id: 17, name: "Stale sprint name" }],
        defaultPrimaryT3ProjectId: nativeProjectId,
        defaultRepositoryProjectIds: [nativeProjectId],
        statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
        createdAt,
      });

      expect(binding.followActiveSprint).toBe(true);
      expect(binding.sprintId).toBe(17);
      expect(binding.sprintName).toBe("Sprint 17");
      expect(binding.selectedSprints).toEqual([{ id: 17, name: "Sprint 17" }]);
      expect(binding.observedActiveSprintIds).toEqual([7, 17]);
      expect(binding.boardMode).toBe("mapped");
      expect(binding.boardColumns).toEqual([{ name: "To Do", statusIds: ["1"], done: false }]);
      expect(binding.lastSyncError).toBeNull();
      expect(savedBinding).toEqual(binding);

      const paused = yield* service.updateBinding({
        id: binding.id,
        sprintId: binding.sprintId,
        sprintName: binding.sprintName,
        defaultPrimaryT3ProjectId: binding.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: binding.defaultRepositoryProjectIds,
        statusMappings: binding.statusMappings,
        active: false,
        updatedAt: "2026-09-03T13:00:00.000Z",
      });
      expect(paused.active).toBe(false);
      expect(paused.boardColumns).toEqual(binding.boardColumns);
      expect(paused.observedActiveSprintIds).toEqual([7, 17]);

      const legacyReselected = yield* service.updateBinding({
        id: paused.id,
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: paused.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: paused.defaultRepositoryProjectIds,
        statusMappings: paused.statusMappings,
        active: true,
        updatedAt: "2026-09-03T14:00:00.000Z",
      });
      expect(legacyReselected.sprintId).toBe(7);
      expect(legacyReselected.selectedSprints).toEqual([{ id: 7, name: "Sprint 7" }]);

      const renamedSelection = yield* service.updateBinding({
        id: legacyReselected.id,
        sprintId: 7,
        sprintName: "Stale representative name",
        selectedSprints: [{ id: 7, name: "Stale selected name" }],
        defaultPrimaryT3ProjectId: legacyReselected.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: legacyReselected.defaultRepositoryProjectIds,
        statusMappings: legacyReselected.statusMappings,
        active: true,
        updatedAt: "2026-09-03T14:30:00.000Z",
      });
      expect(renamedSelection.sprintName).toBe("Sprint 7");
      expect(renamedSelection.selectedSprints).toEqual([{ id: 7, name: "Sprint 7" }]);

      const invalidPinnedError = yield* Effect.flip(
        service.createBinding({
          id: WorkbenchJiraBindingId.make("binding-invalid-pinned"),
          projectId: workbenchProjectId,
          connectionId,
          jiraProjectId: "10000",
          jiraProjectKey: "WB",
          jiraProjectName: "Workbench",
          boardId: 42,
          boardName: "Client board name",
          sprintId: 999,
          sprintName: "Missing sprint",
          selectedSprints: [{ id: 999, name: "Missing sprint" }],
          defaultPrimaryT3ProjectId: nativeProjectId,
          defaultRepositoryProjectIds: [nativeProjectId],
          statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
          followActiveSprint: false,
          createdAt: "2026-09-03T15:00:00.000Z",
        }),
      );
      expect(invalidPinnedError.message).toContain("selected board");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("reads a Jira snapshot in one transaction", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE workbench_jira_snapshot_probe (id INTEGER PRIMARY KEY)`;
      const repositoryFailure = new WorkbenchJiraRepositoryError({
        cause: "binding read failed",
      });
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () =>
          sql`INSERT INTO workbench_jira_snapshot_probe (id) VALUES (1)`.pipe(
            Effect.mapError((cause) => new WorkbenchJiraRepositoryError({ cause })),
            Effect.as([]),
          ),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.none()),
        listBindings: () => Effect.fail(repositoryFailure),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.succeed(true),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      });
      const auth = JiraAuthService.of({
        begin: () => Effect.die("unexpected auth start"),
        complete: () => Effect.die("unexpected auth completion"),
        getAccessToken: () => Effect.die("unexpected token read"),
      });
      const sync = JiraSyncService.of({
        withBindingPermit: (_bindingId, effect) => effect,
        syncBinding: () => Effect.die("unexpected Jira synchronization"),
      });
      const service = yield* WorkbenchJiraService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(JiraSyncService, sync),
        Effect.provideService(JiraTicketWriteService, ticketWriter),
      );

      const error = yield* Effect.flip(service.getSnapshot);
      const probeRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM workbench_jira_snapshot_probe
      `;

      expect(error).toMatchObject({
        code: "persistence_failed",
        message: "Jira connection state could not be saved or loaded.",
      });
      expect(probeRows[0]?.count).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
