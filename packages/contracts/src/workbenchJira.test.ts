import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  WorkbenchJiraBinding,
  WorkbenchJiraCompleteAuthResult,
  WorkbenchJiraIssueLink,
} from "./workbenchJira.ts";

const decodeBinding = Schema.decodeUnknownEffect(WorkbenchJiraBinding);
const decodeIssueLink = Schema.decodeUnknownEffect(WorkbenchJiraIssueLink);
const decodeCompleteAuthResult = Schema.decodeUnknownEffect(WorkbenchJiraCompleteAuthResult);

describe("Workbench Jira contracts", () => {
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
        active: true,
        lastSyncedAt: null,
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
    }),
  );

  it.effect("does not allow an OAuth completion with no accessible Jira sites", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(decodeCompleteAuthResult({ connections: [] }));

      assert.strictEqual(result._tag, "Failure");
    }),
  );
});
