import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  WorkbenchJiraBinding,
  WorkbenchJiraCompleteAuthResult,
  WorkbenchJiraIssueLink,
  WorkbenchJiraUpdateTicketInput,
} from "./workbenchJira.ts";

const decodeBinding = Schema.decodeUnknownEffect(WorkbenchJiraBinding);
const decodeIssueLink = Schema.decodeUnknownEffect(WorkbenchJiraIssueLink);
const decodeCompleteAuthResult = Schema.decodeUnknownEffect(WorkbenchJiraCompleteAuthResult);

describe("Workbench Jira contracts", () => {
  it.effect("accepts legacy status writes and exact Jira transition writes", () =>
    Effect.gen(function* () {
      const decodeUpdate = Schema.decodeUnknownEffect(WorkbenchJiraUpdateTicketInput);
      const identity = {
        ticketId: "ticket-1",
        expectedRemoteUpdatedAt: "2026-09-08T06:00:00.000Z",
      };
      const legacy = yield* decodeUpdate({ ...identity, status: "in_progress" });
      const transition = yield* decodeUpdate({ ...identity, transitionId: "42" });
      assert.strictEqual(legacy.status, "in_progress");
      assert.strictEqual(transition.transitionId, "42");
      assert.isUndefined(transition.status);
      const invalid = yield* Effect.result(decodeUpdate({ ...identity, transitionId: "" }));
      assert.strictEqual(invalid._tag, "Failure");
    }),
  );

  it.effect("decodes legacy bindings with safe synchronization defaults", () =>
    Effect.gen(function* () {
      const binding = yield* decodeBinding({
        id: "binding-legacy",
        projectId: "workspace-1",
        connectionId: "connection-1",
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench sprint board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: "t3-project-1",
        defaultRepositoryProjectIds: ["t3-project-1"],
        statusMappings: [{ jiraStatusId: "3", workbenchStatus: "in_progress" }],
        active: true,
        lastSyncedAt: null,
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      });

      assert.isTrue(binding.followActiveSprint);
      assert.deepStrictEqual(binding.selectedSprints, []);
      assert.deepStrictEqual(binding.observedActiveSprintIds, []);
      assert.strictEqual(binding.boardMode, "mapped");
      assert.deepStrictEqual(binding.boardColumns, []);
      assert.isNull(binding.lastSyncError);
    }),
  );

  it.effect("decodes a Jira binding and synchronized issue link", () =>
    Effect.gen(function* () {
      const binding = yield* decodeBinding({
        id: "binding-1",
        projectId: "workspace-1",
        connectionId: "connection-1",
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench sprint board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: "t3-project-1",
        defaultRepositoryProjectIds: ["t3-project-1", "t3-project-2"],
        statusMappings: [{ jiraStatusId: "3", workbenchStatus: "in_progress" }],
        followActiveSprint: true,
        selectedSprints: [
          { id: 7, name: "Sprint 7" },
          { id: 17, name: "Sprint 17" },
        ],
        observedActiveSprintIds: [7],
        boardMode: "mapped",
        boardColumns: [],
        active: true,
        lastSyncedAt: null,
        lastSyncError: null,
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      });
      const link = yield* decodeIssueLink({
        bindingId: binding.id,
        ticketId: "ticket-1",
        issue: {
          issueId: "10001",
          key: "WB-1",
          url: "https://example.atlassian.net/browse/WB-1",
          summary: "Add Jira synchronization",
          issueType: { id: "10001", name: "Story" },
          status: { id: "3", name: "In Progress" },
          epic: null,
          flagged: false,
          rank: 0,
          remoteUpdatedAt: "2026-09-03T11:00:00.000Z",
        },
        active: true,
        linkedAt: "2026-09-03T12:00:00.000Z",
        lastSeenAt: "2026-09-03T12:00:00.000Z",
      });

      assert.strictEqual(link.issue.key, "WB-1");
      assert.strictEqual(binding.statusMappings[0]?.workbenchStatus, "in_progress");
      assert.deepStrictEqual(
        binding.selectedSprints.map((sprint) => sprint.id),
        [7, 17],
      );
    }),
  );

  it.effect("does not allow an OAuth completion with no accessible Jira sites", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(decodeCompleteAuthResult({ connections: [] }));

      assert.strictEqual(result._tag, "Failure");
    }),
  );
});
