import {
  ProjectId,
  WORKBENCH_REFERENCE_URL_ERROR,
  WORKBENCH_WS_METHODS,
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
import { AskForChangeService } from "./AskForChangeService.ts";
import { TicketContextService } from "./TicketContextService.ts";
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
  Layer.mock(AskForChangeService)({}),
  Layer.mock(TicketDraftService)({}),
  Layer.mock(TicketContextService)({}),
  Layer.mock(TicketWorkspaceService)({}),
  Layer.mock(TicketSummaryService)({}),
  Layer.mock(WorkspaceLifecycleService)({}),
);

const ticketId = WorkbenchTicketId.make("jira-link-ticket");

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
  const ticket = yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Linked Ticket",
    markdown: "",
    repositoryProjectIds: [projectId],
    createdAt,
  });
  const handlers = makeWorkbenchRpcHandlers(yield* acquireWorkbenchRpcServices);
  return {
    store,
    ticket,
    addReference: handlers[WORKBENCH_WS_METHODS.workbenchAddReference],
    removeReference: handlers[WORKBENCH_WS_METHODS.workbenchRemoveReference],
  };
});

describe("workbench.references", () => {
  it.effect("adds and removes a Ticket Reference without changing the Ticket", () =>
    Effect.gen(function* () {
      const { store, ticket, addReference, removeReference } = yield* seed;
      const url = "https://github.com/acme/web/issues/61";
      const added = yield* addReference({ ticketId, url, title: "Focus after resend" });
      expect(added).toMatchObject({
        ticketId,
        url,
        title: "Focus after resend",
        addedByThreadId: null,
      });
      expect((yield* store.getSnapshot).references).toEqual([added]);
      yield* removeReference({ ticketId, url });
      expect((yield* store.getSnapshot).references).toEqual([]);
      expect(Option.getOrThrow(yield* store.getTicket(ticketId))).toEqual(ticket);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a URL that is not http or https without writing", () =>
    Effect.gen(function* () {
      const { store, addReference } = yield* seed;
      const error = yield* addReference({ ticketId, url: "javascript:alert(1)" }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "WorkbenchOperationError",
        code: "reference_url_invalid",
        message: WORKBENCH_REFERENCE_URL_ERROR,
      });
      expect((yield* store.getSnapshot).references).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );
});
