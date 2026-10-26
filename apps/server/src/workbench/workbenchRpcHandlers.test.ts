import {
  ProjectId,
  WORKBENCH_JIRA_ISSUE_URL_ERROR,
  WORKBENCH_WS_METHODS,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { WorkspaceLifecycleService } from "@t3tools/workbench/WorkspaceLifecycleService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { TicketDraftService } from "./TicketDraftService.ts";
import { TicketSummaryService } from "./TicketSummaryService.ts";
import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";
import { acquireWorkbenchRpcServices, makeWorkbenchRpcHandlers } from "./workbenchRpcHandlers.ts";

const TestLayer = Layer.mergeAll(
  WorkbenchStoreLive.pipe(
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        isRepository: () => Effect.succeed(true),
      }),
    ),
  ),
  Layer.mock(TicketDraftService)({}),
  Layer.mock(TicketWorkspaceService)({}),
  Layer.mock(TicketSummaryService)({}),
  Layer.mock(WorkspaceLifecycleService)({}),
);

const ticketId = WorkbenchTicketId.make("jira-link-ticket");
const epicId = WorkbenchEpicId.make("jira-link-epic");

const seed = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const sql = yield* SqlClient.SqlClient;
  const projectId = ProjectId.make("jira-link-project");
  const workspaceId = WorkbenchProjectId.make("jira-link-workspace");
  const createdAt = "2026-10-25T12:00:00.000Z";
  yield* sql`INSERT INTO projection_projects
    (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
    VALUES (${projectId}, 'Links', '/repos/links', '[]', ${createdAt}, ${createdAt}, NULL)`;
  yield* store.createProject({
    id: workspaceId,
    title: "Links",
    linkedProjectIds: [projectId],
    createdAt,
  });
  const epic = yield* store.createEpic({
    id: epicId,
    projectId: workspaceId,
    title: "Linked Epic",
    markdown: "",
    createdAt,
  });
  const ticket = yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Linked Ticket",
    kind: "story",
    markdown: "",
    primaryT3ProjectId: projectId,
    createdAt,
  });
  const handlers = makeWorkbenchRpcHandlers(yield* acquireWorkbenchRpcServices);
  return { store, epic, ticket, setLink: handlers[WORKBENCH_WS_METHODS.workbenchSetJiraIssueLink] };
});

describe("workbench.setJiraIssueLink", () => {
  it.effect("links, changes, and unlinks a Ticket from a Jira issue URL", () =>
    Effect.gen(function* () {
      const { store, ticket, setLink } = yield* seed;
      const linked = yield* setLink({
        kind: "ticket",
        ticketId,
        url: "https://example.atlassian.net/browse/orbit-375",
        expectedRevision: ticket.revision,
      });
      expect(linked).toMatchObject({
        kind: "ticket",
        ticket: {
          id: ticketId,
          jiraIssue: { key: "ORBIT-375", url: "https://example.atlassian.net/browse/orbit-375" },
        },
      });
      if (linked.kind !== "ticket") return expect.unreachable();
      // Board links carry the key in the query string.
      const changed = yield* setLink({
        kind: "ticket",
        ticketId,
        url: "https://example.atlassian.net/jira/software/projects/ORBIT/boards/1?selectedIssue=ORBIT-9",
        expectedRevision: linked.ticket.revision,
      });
      if (changed.kind !== "ticket") return expect.unreachable();
      expect(changed.ticket.jiraIssue?.key).toBe("ORBIT-9");
      expect(yield* store.getTicketJiraIssueKey(ticketId)).toEqual(Option.some("ORBIT-9"));
      const unlinked = yield* setLink({
        kind: "ticket",
        ticketId,
        url: null,
        expectedRevision: changed.ticket.revision,
      });
      if (unlinked.kind !== "ticket") return expect.unreachable();
      expect(unlinked.ticket.jiraIssue ?? null).toBeNull();
      expect(yield* store.getTicketJiraIssueKey(ticketId)).toEqual(Option.none());
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("links and unlinks an Epic", () =>
    Effect.gen(function* () {
      const { epic, setLink } = yield* seed;
      const linked = yield* setLink({
        kind: "epic",
        epicId,
        url: "https://jira.example.com/browse/ORBIT-1",
        expectedUpdatedAt: epic.updatedAt,
      });
      expect(linked).toMatchObject({
        kind: "epic",
        epic: { id: epicId, jiraIssue: { key: "ORBIT-1" } },
      });
      if (linked.kind !== "epic") return expect.unreachable();
      const unlinked = yield* setLink({
        kind: "epic",
        epicId,
        url: null,
        expectedUpdatedAt: linked.epic.updatedAt,
      });
      if (unlinked.kind !== "epic") return expect.unreachable();
      expect(unlinked.epic.jiraIssue ?? null).toBeNull();
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a URL that is not a Jira issue without writing", () =>
    Effect.gen(function* () {
      const { store, ticket, setLink } = yield* seed;
      for (const url of ["javascript:alert(1)//browse/ORBIT-1", "https://example.com/wiki/page"]) {
        const error = yield* setLink({
          kind: "ticket",
          ticketId,
          url,
          expectedRevision: ticket.revision,
        }).pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "WorkbenchOperationError",
          code: "jira_issue_url_invalid",
          message: WORKBENCH_JIRA_ISSUE_URL_ERROR,
        });
      }
      const current = yield* store.getTicket(ticketId);
      expect(Option.getOrThrow(current).revision).toBe(ticket.revision);
    }).pipe(Effect.provide(TestLayer)),
  );
});
