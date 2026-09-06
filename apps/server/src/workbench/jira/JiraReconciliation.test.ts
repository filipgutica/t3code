import { assert, describe, it } from "@effect/vitest";

import type {
  WorkbenchJiraBindingId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraIssueSnapshot,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { reconcileJiraIssueLinks } from "./JiraReconciliation.ts";

const bindingId = "binding-1" as WorkbenchJiraBindingId;
const ticketId = "ticket-1" as WorkbenchTicketId;

const issue = (issueId: string, summary: string): WorkbenchJiraIssueSnapshot => ({
  issueId,
  key: `WB-${issueId}`,
  url: `https://example.atlassian.net/browse/WB-${issueId}`,
  summary,
  issueType: { id: "story", name: "Story" },
  status: { id: "todo", name: "To Do" },
  epic: null,
  flagged: false,
  rank: 0,
  remoteUpdatedAt: null,
});

describe("reconcileJiraIssueLinks", () => {
  it("updates Jira fields, preserves the durable Ticket link, and deactivates unseen issues", () => {
    const existing: ReadonlyArray<WorkbenchJiraIssueLink> = [
      {
        bindingId,
        ticketId,
        issue: issue("1", "Old summary"),
        active: true,
        linkedAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
      },
      {
        bindingId,
        ticketId: "ticket-2" as WorkbenchTicketId,
        issue: issue("2", "Leaves the sprint"),
        active: true,
        linkedAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    const result = reconcileJiraIssueLinks({
      bindingId,
      existing,
      incoming: [
        {
          ticketId: "newly-generated-id" as WorkbenchTicketId,
          issue: issue("1", "Remote summary changed"),
        },
      ],
      syncedAt: "2026-09-03T00:00:00.000Z",
    });

    assert.strictEqual(result.activated, 0);
    assert.strictEqual(result.updated, 1);
    assert.strictEqual(result.deactivated, 1);
    assert.strictEqual(result.links[0]?.ticketId, ticketId);
    assert.strictEqual(result.links[0]?.issue.summary, "Remote summary changed");
    assert.isFalse(result.links[1]?.active ?? true);
    assert.strictEqual(result.links[1]?.lastSeenAt, "2026-09-01T00:00:00.000Z");
  });
});
