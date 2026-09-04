import {
  ProjectId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  orderWorkbenchTicketLanesByJiraRank,
  resolveWorkbenchJiraOAuthCallback,
  reconcileWorkbenchJiraStatusMappings,
  resolveWorkbenchTicketUpdateFields,
  suggestWorkbenchJiraStatusMappings,
} from "./workbenchJira.logic";

describe("Workbench Jira helpers", () => {
  it("classifies denied and incomplete OAuth callbacks before code exchange", () => {
    expect(resolveWorkbenchJiraOAuthCallback({})).toBeNull();
    expect(resolveWorkbenchJiraOAuthCallback({ error: "access_denied", state: "request" })).toEqual(
      {
        error:
          "Jira authorization was cancelled or denied. Connect again when you are ready to grant access.",
      },
    );
    expect(resolveWorkbenchJiraOAuthCallback({ code: "code" })).toEqual({
      error: "Jira returned an incomplete authorization response. Try connecting again.",
    });
    expect(
      resolveWorkbenchJiraOAuthCallback({ error: "server_error", code: "code", state: "request" }),
    ).toEqual({
      error: "Atlassian could not authorize Jira. Try connecting again.",
    });
    expect(resolveWorkbenchJiraOAuthCallback({ code: "code", state: "request" })).toEqual({
      code: "code",
      state: "request",
    });
  });
  it("suggests four-column mappings while preserving every Jira status id", () => {
    expect(
      suggestWorkbenchJiraStatusMappings({
        boardId: 42,
        name: "Delivery",
        type: "scrum",
        rankFieldId: null,
        columns: [
          { name: "Backlog", statusIds: ["1"], done: false },
          { name: "Building", statusIds: ["2", "3"], done: false },
          { name: "Review", statusIds: ["4"], done: false },
          { name: "Complete", statusIds: ["5"], done: true },
        ],
      }),
    ).toEqual([
      { jiraStatusId: "1", workbenchStatus: "todo" },
      { jiraStatusId: "2", workbenchStatus: "in_progress" },
      { jiraStatusId: "3", workbenchStatus: "in_progress" },
      { jiraStatusId: "4", workbenchStatus: "ready_for_review" },
      { jiraStatusId: "5", workbenchStatus: "done" },
    ]);
  });

  it("reconciles saved mappings when a Jira Board changes statuses", () => {
    expect(
      reconcileWorkbenchJiraStatusMappings({
        configuration: {
          boardId: 42,
          name: "Delivery Board",
          type: "scrum",
          rankFieldId: "customfield_10019",
          columns: [
            { name: "To Do", statusIds: ["todo"], done: false },
            { name: "In Progress", statusIds: ["doing"], done: false },
            { name: "Review", statusIds: ["review"], done: false },
            { name: "Done", statusIds: ["done"], done: true },
          ],
        },
        existingMappings: [
          { jiraStatusId: "todo", workbenchStatus: "todo" },
          { jiraStatusId: "doing", workbenchStatus: "in_progress" },
          { jiraStatusId: "removed", workbenchStatus: "done" },
        ],
      }),
    ).toEqual([
      { jiraStatusId: "todo", workbenchStatus: "todo" },
      { jiraStatusId: "doing", workbenchStatus: "in_progress" },
      { jiraStatusId: "review", workbenchStatus: "ready_for_review" },
      { jiraStatusId: "done", workbenchStatus: "done" },
    ]);
  });

  it("orders Jira tickets by rank within lanes without moving local ticket slots", () => {
    const jiraLater = { id: WorkbenchTicketId.make("jira-later") };
    const localFirst = { id: WorkbenchTicketId.make("local-first") };
    const jiraEarlier = { id: WorkbenchTicketId.make("jira-earlier") };
    const localSecond = { id: WorkbenchTicketId.make("local-second") };
    const jiraDone = { id: WorkbenchTicketId.make("jira-done") };

    const result = orderWorkbenchTicketLanesByJiraRank(
      {
        todo: [jiraLater, localFirst, jiraEarlier, localSecond],
        in_progress: [],
        ready_for_review: [],
        done: [jiraDone],
      },
      new Map([
        [jiraLater.id, { issue: { rank: 20 } }],
        [jiraEarlier.id, { issue: { rank: 10 } }],
        [jiraDone.id, { issue: { rank: 1 } }],
      ]),
      new Set([jiraLater.id, jiraEarlier.id, jiraDone.id]),
    );

    expect(result).toEqual({
      todo: [jiraEarlier, localFirst, jiraLater, localSecond],
      in_progress: [],
      ready_for_review: [],
      done: [jiraDone],
    });
  });

  it("preserves Jira-owned fields while applying local instructions and repository changes", () => {
    const originalRepositoryId = ProjectId.make("original-repository");
    const nextRepositoryId = ProjectId.make("next-repository");
    const ticket = {
      id: WorkbenchTicketId.make("ticket-one"),
      projectId: WorkbenchProjectId.make("workspace-one"),
      epicId: WorkbenchEpicId.make("epic-one"),
      title: "Jira summary",
      kind: "story" as const,
      markdown: "Original instructions",
      primaryT3ProjectId: originalRepositoryId,
      repositoryProjectIds: [originalRepositoryId],
      status: "todo" as const,
      blocked: false,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    };

    expect(
      resolveWorkbenchTicketUpdateFields({
        ticket,
        jiraFieldsManaged: true,
        patch: {
          title: "Local summary",
          kind: "bug",
          epicId: null,
          markdown: "Updated agent instructions",
          primaryT3ProjectId: nextRepositoryId,
          repositoryProjectIds: [nextRepositoryId],
          status: "done",
          blocked: true,
        },
      }),
    ).toEqual({
      title: "Jira summary",
      kind: "story",
      epicId: WorkbenchEpicId.make("epic-one"),
      markdown: "Updated agent instructions",
      primaryT3ProjectId: nextRepositoryId,
      repositoryProjectIds: [nextRepositoryId],
      status: "todo",
      blocked: false,
    });
  });
});
