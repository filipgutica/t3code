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
import { JiraApi } from "./JiraApi.ts";
import * as JiraSyncService from "./JiraSyncService.ts";
import { JiraTicketImporter, layer as jiraTicketImporterLayer } from "./JiraTicketImporter.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "./WorkbenchJiraRepository.ts";

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
  active: true,
  lastSyncedAt: null,
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
});
