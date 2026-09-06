import { ProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  orderWorkbenchTicketLanesByJiraRank,
  getWorkbenchBoardColumns,
  getWorkbenchJiraBindingSprints,
  resolveWorkbenchJiraOAuthCallback,
  resolveWorkbenchJiraRedirectUri,
  resolveWorkbenchTicketContent,
  reconcileWorkbenchJiraStatusMappings,
  resolveWorkbenchTicketUpdateFields,
  suggestWorkbenchJiraStatusMappings,
} from "./workbenchJira.logic";

describe("Workbench Jira helpers", () => {
  it("sends a local status patch without adding stale content fields", () => {
    expect(
      resolveWorkbenchTicketUpdateFields({ patch: { status: "done" }, jiraFieldsManaged: false }),
    ).toEqual({ status: "done" });
  });
  it("uses Jira text from the versioned issue snapshot when the Ticket query is older", () => {
    expect(
      resolveWorkbenchTicketContent({
        ticket: { title: "Old title", markdown: "Old text" },
        jiraIssue: { summary: "Current title", description: "Current text" },
      }),
    ).toEqual({ title: "Current title", markdown: "Current text" });
    expect(
      resolveWorkbenchTicketContent({
        ticket: { title: "Local title", markdown: "Local text" },
        jiraIssue: undefined,
      }),
    ).toEqual({ title: "Local title", markdown: "Local text" });
  });
  it("retains all selected sprints while supporting existing single-sprint bindings", () => {
    const legacy = { sprintId: 136, sprintName: "Data Application Sprint 136" };
    expect(getWorkbenchJiraBindingSprints(legacy)).toEqual([{ id: 136, name: legacy.sprintName }]);
    expect(getWorkbenchJiraBindingSprints({ ...legacy, selectedSprints: [] })).toEqual([
      { id: 136, name: legacy.sprintName },
    ]);
    const selectedSprints = [
      { id: 136, name: legacy.sprintName },
      { id: 17, name: "Data Pipeline Sprint 17" },
    ];
    expect(getWorkbenchJiraBindingSprints({ ...legacy, selectedSprints })).toEqual(selectedSprints);
  });
  it("uses an HTTP server callback for desktop and retains the browser return route", () => {
    expect(
      resolveWorkbenchJiraRedirectUri({
        desktop: true,
        browserOrigin: "t3code-dev://app",
        serverHttpUrl: "http://127.0.0.1:13773/",
      }),
    ).toBe("http://127.0.0.1:13773/oauth/workbench/jira/callback");
    expect(
      resolveWorkbenchJiraRedirectUri({
        desktop: false,
        browserOrigin: "http://localhost:5733",
        serverHttpUrl: "http://127.0.0.1:13773/",
      }),
    ).toBe("http://localhost:5733/workbench");
    expect(
      resolveWorkbenchJiraRedirectUri({
        desktop: true,
        browserOrigin: "t3code://app",
        serverHttpUrl: "https://environment.example/",
      }),
    ).toBe("https://environment.example/oauth/workbench/jira/callback");
  });
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
  it("suggests three-state mappings while preserving every Jira status id", () => {
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
      { jiraStatusId: "4", workbenchStatus: "in_progress" },
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
      { jiraStatusId: "review", workbenchStatus: "in_progress" },
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
      done: [jiraDone],
    });
  });

  it("preserves Jira-owned fields while applying local instructions and repository changes", () => {
    const nextRepositoryId = ProjectId.make("next-repository");

    expect(
      resolveWorkbenchTicketUpdateFields({
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
      markdown: "Updated agent instructions",
      primaryT3ProjectId: nextRepositoryId,
      repositoryProjectIds: [nextRepositoryId],
    });
  });
});

describe("Mirrored Jira columns", () => {
  it("prefers the explicit To Do column for local tickets while keeping Jira placement exact", () => {
    const local = { id: WorkbenchTicketId.make("local"), status: "todo" as const };
    const linked = { id: WorkbenchTicketId.make("linked"), status: "todo" as const };
    const columns = getWorkbenchBoardColumns({
      tickets: [local, linked],
      mirrorColumns: [
        { name: "Backlog", statusIds: ["backlog"], done: false },
        { name: "To Do", statusIds: ["todo"], done: false },
      ],
      issueLinks: new Map([[linked.id, { issue: { status: { id: "backlog" } } }]]),
    });
    expect(columns.map((column) => column.tickets.map((ticket) => ticket.id))).toEqual([
      [linked.id],
      [local.id],
    ]);
  });

  it("recognizes a Todo column after an earlier Jira blocker column", () => {
    expect(
      suggestWorkbenchJiraStatusMappings({
        boardId: 42,
        name: "Parallel",
        type: "scrum",
        rankFieldId: null,
        columns: [
          { name: "blocked", statusIds: ["blocked"], done: false },
          { name: "To Do", statusIds: ["todo"], done: false },
          { name: "Done", statusIds: ["done"], done: true },
        ],
      }).find((mapping) => mapping.jiraStatusId === "todo")?.workbenchStatus,
    ).toBe("todo");
  });

  it("keeps Jira review in its own column while retaining three-state progress and local Tickets", () => {
    const review = { id: WorkbenchTicketId.make("review"), status: "in_progress" as const };
    const local = { id: WorkbenchTicketId.make("local"), status: "todo" as const };
    const done = { id: WorkbenchTicketId.make("done"), status: "done" as const };
    const columns = getWorkbenchBoardColumns({
      tickets: [review, local, done],
      mirrorColumns: [
        { name: "Doing", statusIds: ["doing"], done: false },
        { name: "Review", statusIds: ["review"], done: false },
      ],
      issueLinks: new Map([[review.id, { issue: { status: { id: "review" } } }]]),
    });
    expect(
      columns.map(({ title, tickets }) => ({ title, ids: tickets.map((ticket) => ticket.id) })),
    ).toEqual([
      { title: "Doing", ids: ["local"] },
      { title: "Review", ids: ["review"] },
      { title: "Done", ids: ["done"] },
    ]);
    expect(review.status).toBe("in_progress");
    expect(
      getWorkbenchBoardColumns({
        tickets: [review, local, done],
        mirrorColumns: null,
        issueLinks: new Map(),
      }).map((column) => column.title),
    ).toEqual(["Todo", "In Progress", "Done"]);
  });
});
