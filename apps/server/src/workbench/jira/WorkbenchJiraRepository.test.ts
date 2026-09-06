import {
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraConnection,
  type WorkbenchJiraIssueLink,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { layerSql, WorkbenchJiraRepository } from "@t3tools/workbench/jira/WorkbenchJiraRepository";

const TestLayer = Layer.merge(WorkbenchStoreLive, layerSql).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

describe("WorkbenchJiraRepository SQL", () => {
  it.effect("round-trips connections, bindings, credentials, and issue links", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const repository = yield* WorkbenchJiraRepository;
      const nativeProjectId = ProjectId.make("native-project-1");
      const projectId = WorkbenchProjectId.make("workspace-1");
      const ticketId = WorkbenchTicketId.make("ticket-1");
      const connectionId = WorkbenchJiraConnectionId.make("connection-1");
      const bindingId = WorkbenchJiraBindingId.make("binding-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${nativeProjectId}, 'T3 Code', '/repos/t3code', '[]',
          ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* workbench.createProject({
        id: projectId,
        title: "Jira Workspace",
        linkedProjectIds: [nativeProjectId],
        createdAt,
      });
      yield* workbench.createTicket({
        id: ticketId,
        projectId,
        title: "Imported issue",
        kind: "story",
        markdown: "Preserved instructions",
        primaryT3ProjectId: nativeProjectId,
        repositoryProjectIds: [nativeProjectId],
        createdAt,
      });

      const connection: WorkbenchJiraConnection = {
        id: connectionId,
        cloudId: "cloud-1",
        siteName: "Example Jira",
        siteUrl: "https://example.atlassian.net",
        avatarUrl: "https://example.atlassian.net/avatar.png",
        scopes: ["read:project:jira", "read:sprint:jira-software"],
        createdAt,
        updatedAt: createdAt,
      };
      const binding: WorkbenchJiraBinding = {
        id: bindingId,
        projectId,
        connectionId,
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench Board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: nativeProjectId,
        defaultRepositoryProjectIds: [nativeProjectId],
        statusMappings: [
          { jiraStatusId: "1", workbenchStatus: "todo" },
          { jiraStatusId: "2", workbenchStatus: "in_progress" },
        ],
        selectedSprints: [{ id: 7, name: "Sprint 7" }],
        followActiveSprint: true,
        observedActiveSprintIds: [7],
        boardMode: "mirror_jira",
        boardColumns: [
          { name: "To Do", statusIds: ["1"], done: false },
          { name: "Done", statusIds: ["2"], done: true },
        ],
        active: true,
        lastSyncedAt: null,
        lastSyncError: "A previous sync failed.",
        createdAt,
        updatedAt: createdAt,
      };
      const issueLink: WorkbenchJiraIssueLink = {
        bindingId,
        ticketId,
        issue: {
          issueId: "10001",
          key: "WB-1",
          url: "https://example.atlassian.net/browse/WB-1",
          summary: "Imported issue",
          issueType: { id: "10001", name: "Story" },
          status: { id: "2", name: "In Progress" },
          epic: null,
          flagged: false,
          rank: 0,
          remoteUpdatedAt: createdAt,
        },
        active: true,
        linkedAt: createdAt,
        lastSeenAt: createdAt,
      };

      yield* repository.upsertConnection(connection, "oauth-grant-1");
      yield* repository.upsertBinding(binding);
      yield* repository.replaceIssueLinks(bindingId, [issueLink]);

      expect(
        yield* repository.updateBindingSyncMetadata({
          id: bindingId,
          expectedUpdatedAt: "2026-09-03T11:59:59.000Z",
          syncedAt: "2026-09-03T13:00:00.000Z",
        }),
      ).toBe(false);
      expect(
        yield* repository.updateBindingSyncMetadata({
          id: bindingId,
          expectedUpdatedAt: createdAt,
          syncedAt: "2026-09-03T13:00:00.000Z",
          selectedSprints: [
            { id: 7, name: "Sprint 7" },
            { id: 17, name: "Sprint 17" },
          ],
        }),
      ).toBe(true);

      const syncedBinding = {
        ...binding,
        selectedSprints: [
          { id: 7, name: "Sprint 7" },
          { id: 17, name: "Sprint 17" },
        ],
        lastSyncedAt: "2026-09-03T13:00:00.000Z",
        lastSyncError: null,
        updatedAt: "2026-09-03T13:00:00.000Z",
      };

      expect(yield* repository.listConnections()).toEqual([connection]);
      expect(Option.getOrThrow(yield* repository.getConnection(connectionId))).toEqual(connection);
      expect(Option.getOrThrow(yield* repository.getCredentialId(connectionId))).toBe(
        "oauth-grant-1",
      );
      expect(yield* repository.listBindings()).toEqual([syncedBinding]);
      expect(Option.getOrThrow(yield* repository.getBinding(bindingId))).toEqual(syncedBinding);
      expect(yield* repository.listIssueLinks(bindingId)).toEqual([issueLink]);

      expect(
        yield* repository.updateBindingSyncError({
          id: bindingId,
          expectedUpdatedAt: syncedBinding.updatedAt,
          updatedAt: "2026-09-03T14:00:00.000Z",
          message: "The active Jira sprint is ambiguous.",
          observedActiveSprintIds: [7, 8, 9],
        }),
      ).toBe(true);
      expect(Option.getOrThrow(yield* repository.getBinding(bindingId))).toEqual({
        ...syncedBinding,
        observedActiveSprintIds: [7, 8, 9],
        lastSyncError: "The active Jira sprint is ambiguous.",
        updatedAt: "2026-09-03T14:00:00.000Z",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rolls back every connection when a batch upsert fails", () =>
    Effect.gen(function* () {
      const repository = yield* WorkbenchJiraRepository;
      const createdAt = "2026-09-03T12:00:00.000Z";
      const existing: WorkbenchJiraConnection = {
        id: WorkbenchJiraConnectionId.make("connection-existing"),
        cloudId: "cloud-existing",
        siteName: "Existing Jira",
        siteUrl: "https://existing.atlassian.net",
        avatarUrl: null,
        scopes: ["read:project:jira"],
        createdAt,
        updatedAt: createdAt,
      };
      const firstBatchConnection: WorkbenchJiraConnection = {
        ...existing,
        id: WorkbenchJiraConnectionId.make("connection-first-batch"),
        cloudId: "cloud-first-batch",
        siteName: "First batch site",
        siteUrl: "https://first-batch.atlassian.net",
      };
      const conflictingBatchConnection: WorkbenchJiraConnection = {
        ...existing,
        id: WorkbenchJiraConnectionId.make("connection-conflicting-batch"),
        siteName: "Conflicting batch site",
      };

      yield* repository.upsertConnection(existing, "credential-existing");
      const error = yield* Effect.flip(
        repository.upsertConnections(
          [firstBatchConnection, conflictingBatchConnection],
          "credential-new",
        ),
      );

      expect(error._tag).toBe("WorkbenchJiraRepositoryError");
      expect(yield* repository.listConnections()).toEqual([existing]);
      expect(yield* repository.getCredentialId(firstBatchConnection.id)).toEqual(Option.none());
      expect(Option.getOrThrow(yield* repository.getCredentialId(existing.id))).toBe(
        "credential-existing",
      );
    }).pipe(Effect.provide(TestLayer)),
  );
});
