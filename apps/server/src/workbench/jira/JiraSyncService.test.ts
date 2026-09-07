import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  WorkbenchJiraOperationError,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueLink,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi } from "@t3tools/workbench/jira/JiraApi";
import * as JiraSyncService from "@t3tools/workbench/jira/JiraSyncService";
import {
  JiraTicketImporter,
  layer as jiraTicketImporterLayer,
} from "@t3tools/workbench/jira/JiraTicketImporter";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";

const bindingId = WorkbenchJiraBindingId.make("binding-1");
const existingTicketId = WorkbenchTicketId.make("ticket-1");
const unseenTicketId = WorkbenchTicketId.make("ticket-2");

const binding: WorkbenchJiraBinding = {
  id: bindingId,
  projectId: WorkbenchProjectId.make("workspace-1"),
  connectionId: WorkbenchJiraConnectionId.make("connection-1"),
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Workbench board",
  sprintId: 7,
  sprintName: "Sprint 7",
  defaultPrimaryT3ProjectId: ProjectId.make("project-1"),
  defaultRepositoryProjectIds: [ProjectId.make("project-1")],
  statusMappings: [{ jiraStatusId: "2", workbenchStatus: "in_progress" }],
  selectedSprints: [{ id: 7, name: "Sprint 7" }],
  followActiveSprint: false,
  observedActiveSprintIds: [],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const ImporterIntegrationLayer = jiraTicketImporterLayer.pipe(
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(SqlitePersistenceMemory),
);

const oldIssue = (issueId: string): WorkbenchJiraIssueLink => ({
  bindingId,
  ticketId: issueId === "10001" ? existingTicketId : unseenTicketId,
  issue: {
    issueId,
    key: `WB-${issueId}`,
    url: `https://example.atlassian.net/browse/WB-${issueId}`,
    summary: "Old summary",
    issueType: { id: "story", name: "Story" },
    status: { id: "2", name: "In Progress" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: null,
  },
  active: true,
  linkedAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
});

describe("JiraSyncService", () => {
  it.effect("imports and deduplicates the assigned issue union across selected sprints", () =>
    Effect.gen(function* () {
      const multiBinding = {
        ...binding,
        selectedSprints: [
          { id: 7, name: "MA Sprint" },
          { id: 17, name: "DATAP Sprint" },
        ],
      };
      let savedBinding: WorkbenchJiraBinding = multiBinding;
      let links: ReadonlyArray<WorkbenchJiraIssueLink> = [];
      const importedIssueIds: Array<string> = [];
      const requestedSprintIds: Array<number> = [];
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              selectedSprints: input.selectedSprints ?? savedBinding.selectedSprints,
              lastSyncedAt: input.syncedAt,
              lastSyncError: null,
              updatedAt: input.syncedAt,
            };
            return true;
          }),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed(links),
        replaceIssueLinks: (_id, next) =>
          Effect.sync(() => {
            links = next;
          }),
      } satisfies WorkbenchJiraRepositoryShape);
      const issueOne = oldIssue("10001").issue;
      const issueTwo = oldIssue("10002").issue;
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: (input) =>
          Effect.sync(() => {
            requestedSprintIds.push(input.sprintId);
            return input.sprintId === 7 ? [issueOne] : [issueOne, issueTwo];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ issue }) =>
          Effect.sync(() => {
            importedIssueIds.push(issue.issueId);
            return WorkbenchTicketId.make(`imported-${issue.issueId}`);
          }),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const result = yield* service.syncBinding({ bindingId });

      assert.deepStrictEqual(requestedSprintIds, [7, 17]);
      assert.deepStrictEqual(importedIssueIds, ["10001", "10002"]);
      assert.deepStrictEqual(
        result.links.filter((link) => link.active).map((link) => link.issue.issueId),
        ["10001", "10002"],
      );
      assert.deepStrictEqual(savedBinding.selectedSprints, multiBinding.selectedSprints);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("keeps the prior snapshot when one replacement sprint cannot be fetched", () =>
    Effect.gen(function* () {
      const followedBinding = {
        ...binding,
        selectedSprints: [
          { id: 7, name: "MA Sprint" },
          { id: 17, name: "DATAP Sprint" },
        ],
        followActiveSprint: true,
        observedActiveSprintIds: [7, 17],
      };
      let savedBinding: WorkbenchJiraBinding = followedBinding;
      const previousLink = oldIssue("10001");
      let links: ReadonlyArray<WorkbenchJiraIssueLink> = [previousLink];
      let attempt = 0;
      let replacementImportCount = 0;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              sprintId: input.sprintId ?? savedBinding.sprintId,
              sprintName: input.sprintName ?? savedBinding.sprintName,
              selectedSprints: input.selectedSprints ?? savedBinding.selectedSprints,
              observedActiveSprintIds:
                input.observedActiveSprintIds ?? savedBinding.observedActiveSprintIds,
              lastSyncedAt: input.syncedAt,
              lastSyncError: null,
              updatedAt: input.syncedAt,
            };
            return true;
          }),
        updateBindingSyncError: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              observedActiveSprintIds:
                input.observedActiveSprintIds ?? savedBinding.observedActiveSprintIds,
              lastSyncError: input.message,
              updatedAt: input.updatedAt,
            };
            return true;
          }),
        listIssueLinks: () => Effect.succeed(links),
        replaceIssueLinks: (_id, next) =>
          Effect.sync(() => {
            links = next;
          }),
      } satisfies WorkbenchJiraRepositoryShape);
      const activeSprint = (id: number, name: string) => ({
        id,
        name,
        state: "active" as const,
        goal: "",
        startDate: null,
        endDate: null,
        completeDate: null,
      });
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () =>
          Effect.succeed([
            activeSprint(7, "MA Sprint"),
            activeSprint(18, attempt === 2 ? "DATAP Sprint Renamed" : "DATAP Sprint 2"),
          ]),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: (input) => {
          if (input.sprintId === 18 && attempt === 0) {
            return Effect.fail(
              new WorkbenchJiraOperationError({
                code: "request_failed",
                message: "Sprint 18 could not be read.",
              }),
            );
          }
          return Effect.succeed([oldIssue(input.sprintId === 7 ? "10001" : "10002").issue]);
        },
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ issue }) =>
          Effect.sync(() => {
            if (issue.issueId === "10002") replacementImportCount += 1;
            return WorkbenchTicketId.make(`imported-${issue.issueId}`);
          }),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const firstError = yield* Effect.flip(service.syncBinding({ bindingId }));
      assert.strictEqual(firstError.code, "request_failed");
      assert.deepStrictEqual(savedBinding.selectedSprints, followedBinding.selectedSprints);
      assert.deepStrictEqual(links, [previousLink]);
      assert.strictEqual(replacementImportCount, 0);

      attempt = 1;
      const result = yield* service.syncBinding({ bindingId });
      assert.deepStrictEqual(savedBinding.selectedSprints, [
        { id: 7, name: "MA Sprint" },
        { id: 18, name: "DATAP Sprint 2" },
      ]);
      assert.strictEqual(savedBinding.sprintId, 7);
      assert.strictEqual(result.links.filter((link) => link.active).length, 2);
      assert.strictEqual(replacementImportCount, 1);

      attempt = 2;
      yield* service.syncBinding({ bindingId });
      assert.deepStrictEqual(savedBinding.selectedSprints, [
        { id: 7, name: "MA Sprint" },
        { id: 18, name: "DATAP Sprint Renamed" },
      ]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("preserves existing Ticket identity and deactivates issues no longer assigned", () =>
    Effect.gen(function* () {
      let links: ReadonlyArray<WorkbenchJiraIssueLink> = [oldIssue("10001"), oldIssue("10002")];
      let savedBinding: WorkbenchJiraBinding = binding;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(binding)),
        listBindings: () => Effect.succeed([binding]),
        upsertBinding: (next) =>
          Effect.sync(() => {
            savedBinding = next;
          }),
        updateBindingSyncMetadata: ({ syncedAt }) =>
          Effect.sync(() => {
            savedBinding = { ...savedBinding, lastSyncedAt: syncedAt, updatedAt: syncedAt };
            return true;
          }),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed(links),
        replaceIssueLinks: (_id, next) =>
          Effect.sync(() => {
            links = next;
          }),
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.succeed([
            {
              ...oldIssue("10001").issue,
              summary: "Updated from Jira",
            },
          ]),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ existingTicketId: id }) =>
          id === null ? Effect.die("expected existing Ticket link") : Effect.succeed(id),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const result = yield* service.syncBinding({ bindingId });

      assert.strictEqual(result.updated, 1);
      assert.strictEqual(result.deactivated, 1);
      assert.strictEqual(links[0]?.ticketId, existingTicketId);
      assert.strictEqual(links[0]?.issue.summary, "Updated from Jira");
      assert.isFalse(links[1]?.active ?? true);
      assert.isNotNull(savedBinding.lastSyncedAt);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("serializes concurrent synchronization for the same binding", () =>
    Effect.gen(function* () {
      const firstRequestStarted = yield* Deferred.make<void>();
      const releaseFirstRequest = yield* Deferred.make<void>();
      const apiCallCount = yield* Ref.make(0);
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(binding)),
        listBindings: () => Effect.succeed([binding]),
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
        listAssignedSprintIssues: () =>
          Effect.gen(function* () {
            const call = yield* Ref.updateAndGet(apiCallCount, (count) => count + 1);
            if (call === 1) {
              yield* Deferred.succeed(firstRequestStarted, undefined);
              yield* Deferred.await(releaseFirstRequest);
            }
            return [];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () => Effect.die("unexpected Ticket import"),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const first = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Deferred.await(firstRequestStarted);
      const second = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.strictEqual(yield* Ref.get(apiCallCount), 1);
      yield* Deferred.succeed(releaseFirstRequest, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(yield* Ref.get(apiCallCount), 2);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("holds binding updates until an in-flight synchronization completes", () =>
    Effect.gen(function* () {
      const requestStarted = yield* Deferred.make<void>();
      const releaseRequest = yield* Deferred.make<void>();
      const updateRan = yield* Ref.make(false);
      let savedBinding = binding;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: (next) =>
          Effect.sync(() => {
            savedBinding = next;
          }),
        updateBindingSyncMetadata: ({ syncedAt }) =>
          Effect.sync(() => {
            savedBinding = { ...savedBinding, lastSyncedAt: syncedAt, updatedAt: syncedAt };
            return true;
          }),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Deferred.succeed(requestStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseRequest)),
            Effect.as([]),
          ),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () => Effect.die("unexpected Ticket import"),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const syncFiber = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Deferred.await(requestStarted);
      const updateFiber = yield* service
        .withBindingPermit(bindingId, Ref.set(updateRan, true))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.isFalse(yield* Ref.get(updateRan));
      yield* Deferred.succeed(releaseRequest, undefined);
      yield* Fiber.join(syncFiber);
      yield* Fiber.join(updateFiber);
      assert.isTrue(yield* Ref.get(updateRan));
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("validates every Jira status before importing any projections", () =>
    Effect.gen(function* () {
      const importCount = yield* Ref.make(0);
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(binding)),
        listBindings: () => Effect.succeed([binding]),
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
        listAssignedSprintIssues: () =>
          Effect.succeed([
            oldIssue("10001").issue,
            {
              ...oldIssue("10002").issue,
              status: { id: "unmapped", name: "Waiting for product" },
            },
          ]),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () =>
          Ref.update(importCount, (count) => count + 1).pipe(Effect.as(existingTicketId)),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const error = yield* Effect.flip(service.syncBinding({ bindingId }));

      assert.strictEqual(error.code, "status_unmapped");
      assert.strictEqual(yield* Ref.get(importCount), 0);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rolls back projection writes when a later import fails", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const realImporter = yield* JiraTicketImporter;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${binding.defaultPrimaryT3ProjectId}, 'Primary Repository', '/repos/primary', '[]',
          ${binding.createdAt}, ${binding.createdAt}, NULL
        )
      `;
      yield* workbench.createProject({
        id: binding.projectId,
        title: "Jira Workspace",
        linkedProjectIds: [binding.defaultPrimaryT3ProjectId],
        createdAt: binding.createdAt,
      });
      let links: ReadonlyArray<WorkbenchJiraIssueLink> = [];
      let savedBinding = binding;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: (next) =>
          Effect.sync(() => {
            savedBinding = next;
          }),
        updateBindingSyncMetadata: ({ syncedAt }) =>
          Effect.sync(() => {
            savedBinding = { ...savedBinding, lastSyncedAt: syncedAt, updatedAt: syncedAt };
            return true;
          }),
        updateBindingSyncError: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed(links),
        replaceIssueLinks: (_id, next) =>
          Effect.sync(() => {
            links = next;
          }),
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.succeed([
            {
              ...oldIssue("10001").issue,
              epic: { id: "20001", key: "WB-EPIC", summary: "Imported Epic" },
            },
            oldIssue("10002").issue,
          ]),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ issue }) =>
          issue.issueId === "10002"
            ? Effect.fail(
                new WorkbenchJiraOperationError({
                  code: "persistence_failed",
                  message: "Second projection failed.",
                }),
              )
            : realImporter.upsertJiraProjection({
                binding,
                existingTicketId: null,
                issue,
                mappedStatus: "in_progress",
              }),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const error = yield* Effect.flip(service.syncBinding({ bindingId }));
      const snapshot = yield* workbench.getSnapshot;

      assert.strictEqual(error.code, "persistence_failed");
      assert.deepStrictEqual(snapshot.tickets, []);
      assert.deepStrictEqual(snapshot.epics, []);
      assert.deepStrictEqual(links, []);
      assert.isNull(savedBinding.lastSyncedAt);
    }).pipe(Effect.provide(ImporterIntegrationLayer)),
  );

  it.effect("moves a followed binding to a new active sprint and mirrors board mappings", () =>
    Effect.gen(function* () {
      const followedBinding: WorkbenchJiraBinding = {
        ...binding,
        followActiveSprint: true,
        observedActiveSprintIds: [6, 7],
        boardMode: "mirror_jira",
        lastSyncError: "A previous sync failed.",
        statusMappings: [{ jiraStatusId: "legacy", workbenchStatus: "done" }],
      };
      let savedBinding = followedBinding;
      let issueSprintId: number | null = null;
      let savedMappings = followedBinding.statusMappings;
      let savedColumns = followedBinding.boardColumns;
      const importedStatuses = yield* Ref.make<
        Array<WorkbenchJiraBinding["statusMappings"][number]["workbenchStatus"]>
      >([]);
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              sprintId: input.sprintId ?? savedBinding.sprintId,
              sprintName: input.sprintName ?? savedBinding.sprintName,
              statusMappings: input.statusMappings ?? savedBinding.statusMappings,
              boardColumns: input.boardColumns ?? savedBinding.boardColumns,
              observedActiveSprintIds:
                input.observedActiveSprintIds ?? savedBinding.observedActiveSprintIds,
              lastSyncedAt: input.syncedAt,
              lastSyncError: null,
              updatedAt: input.syncedAt,
            };
            savedMappings = savedBinding.statusMappings;
            savedColumns = savedBinding.boardColumns;
            return true;
          }),
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
              id: 6,
              name: "Other team sprint",
              state: "active" as const,
              goal: "",
              startDate: null,
              endDate: null,
              completeDate: null,
            },
            {
              id: 8,
              name: "Sprint 8",
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
            name: "Workbench board",
            type: "scrum" as const,
            columns: [
              { name: "Blocked", statusIds: ["9"], done: false },
              { name: "To Do", statusIds: ["1"], done: false },
              { name: "Working", statusIds: ["2"], done: false },
              { name: "Done", statusIds: ["3"], done: true },
            ],
            rankFieldId: null,
          }),
        listAssignedSprintIssues: (input) =>
          Effect.sync(() => {
            issueSprintId = input.sprintId;
            return [
              { ...oldIssue("10001").issue, status: { id: "1", name: "To Do" } },
              { ...oldIssue("10002").issue, status: { id: "3", name: "Done" } },
            ];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ mappedStatus }) =>
          Ref.update(importedStatuses, (statuses) => [...statuses, mappedStatus]).pipe(
            Effect.as(existingTicketId),
          ),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      yield* service.syncBinding({ bindingId });

      assert.strictEqual(issueSprintId, 8);
      assert.deepStrictEqual(yield* Ref.get(importedStatuses), ["todo", "done"]);
      assert.strictEqual(savedBinding.sprintId, 8);
      assert.strictEqual(savedBinding.sprintName, "Sprint 8");
      assert.deepStrictEqual(savedBinding.observedActiveSprintIds, [6, 8]);
      assert.isNull(savedBinding.lastSyncError);
      assert.deepStrictEqual(savedMappings, [
        { jiraStatusId: "9", workbenchStatus: "todo" },
        { jiraStatusId: "1", workbenchStatus: "todo" },
        { jiraStatusId: "2", workbenchStatus: "in_progress" },
        { jiraStatusId: "3", workbenchStatus: "done" },
      ]);
      assert.deepStrictEqual(savedColumns, [
        { name: "Blocked", statusIds: ["9"], done: false },
        { name: "To Do", statusIds: ["1"], done: false },
        { name: "Working", statusIds: ["2"], done: false },
        { name: "Done", statusIds: ["3"], done: true },
      ]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("remembers newly observed parallel sprints after a failed sync", () =>
    Effect.gen(function* () {
      const followedBinding = {
        ...binding,
        followActiveSprint: true,
        observedActiveSprintIds: [7, 8],
      };
      let savedBinding = followedBinding;
      let activeSprintIds: ReadonlyArray<number> = [7, 8, 9];
      let issueReadCount = 0;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.die("unexpected metadata update"),
        updateBindingSyncError: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              observedActiveSprintIds:
                input.observedActiveSprintIds === undefined
                  ? savedBinding.observedActiveSprintIds
                  : [...input.observedActiveSprintIds],
              lastSyncError: input.message,
              updatedAt: input.updatedAt,
            };
            return true;
          }),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.die("unexpected link replacement"),
      } satisfies WorkbenchJiraRepositoryShape);
      const activeSprint = (id: number) => ({
        id,
        name: `Sprint ${id}`,
        state: "active" as const,
        goal: "",
        startDate: null,
        endDate: null,
        completeDate: null,
      });
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.succeed(activeSprintIds.map(activeSprint)),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.sync(() => {
            issueReadCount += 1;
            return [oldIssue("10001").issue];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () =>
          Effect.fail(
            new WorkbenchJiraOperationError({
              code: "persistence_failed",
              message: "Projection import failed.",
            }),
          ),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const firstError = yield* Effect.flip(service.syncBinding({ bindingId }));
      assert.strictEqual(firstError.code, "persistence_failed");
      assert.deepStrictEqual(savedBinding.observedActiveSprintIds, [7, 8, 9]);

      activeSprintIds = [8, 9];
      const secondError = yield* Effect.flip(service.syncBinding({ bindingId }));

      assert.strictEqual(secondError.code, "invalid_binding");
      assert.isTrue(secondError.message.includes("no new active sprint"));
      assert.strictEqual(issueReadCount, 1);
      assert.deepStrictEqual(savedBinding.observedActiveSprintIds, [7, 8, 9]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("records an actionable waiting error without changing the snapshot", () =>
    Effect.gen(function* () {
      const followedBinding = {
        ...binding,
        followActiveSprint: true,
        observedActiveSprintIds: [6, 7],
      };
      let savedBinding = followedBinding;
      let issueRead = false;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.die("unexpected metadata update"),
        updateBindingSyncError: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              lastSyncError: input.message,
              updatedAt: input.updatedAt,
            };
            return true;
          }),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.die("unexpected link replacement"),
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.succeed([]),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.sync(() => {
            issueRead = true;
            return [];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () => Effect.die("unexpected Ticket import"),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const error = yield* Effect.flip(service.syncBinding({ bindingId }));

      assert.strictEqual(error.code, "invalid_binding");
      assert.isTrue(error.message.includes("no active sprint"));
      assert.isFalse(issueRead);
      assert.isTrue(savedBinding.lastSyncError?.includes("no active sprint") ?? false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("records an actionable error when multiple sprints are active", () =>
    Effect.gen(function* () {
      const followedBinding = { ...binding, followActiveSprint: true };
      let savedBinding = followedBinding;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(savedBinding)),
        listBindings: () => Effect.succeed([savedBinding]),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.die("unexpected metadata update"),
        updateBindingSyncError: (input) =>
          Effect.sync(() => {
            savedBinding = {
              ...savedBinding,
              lastSyncError: input.message,
              updatedAt: input.updatedAt,
            };
            return true;
          }),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.die("unexpected link replacement"),
      } satisfies WorkbenchJiraRepositoryShape);
      const activeSprint = (id: number) => ({
        id,
        name: `Sprint ${id}`,
        state: "active" as const,
        goal: "",
        startDate: null,
        endDate: null,
        completeDate: null,
      });
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.succeed([activeSprint(8), activeSprint(9)]),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () => Effect.die("unexpected Ticket import"),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const legacyError = yield* Effect.flip(service.syncBinding({ bindingId }));

      assert.strictEqual(legacyError.code, "invalid_binding");
      assert.isTrue(legacyError.message.includes("Choose the active sprint"));
      assert.isTrue(savedBinding.lastSyncError?.includes("Choose the active sprint") ?? false);

      savedBinding = {
        ...savedBinding,
        observedActiveSprintIds: [7],
        updatedAt: binding.updatedAt,
      };
      const ambiguousError = yield* Effect.flip(service.syncBinding({ bindingId }));

      assert.strictEqual(ambiguousError.code, "invalid_binding");
      assert.isTrue(ambiguousError.message.includes("Multiple new active Jira sprints"));
      assert.isTrue(savedBinding.lastSyncError?.includes("Multiple new active") ?? false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
