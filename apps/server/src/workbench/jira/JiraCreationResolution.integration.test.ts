import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ModelSelection,
  ProviderInstanceId,
  ThreadId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient } from "effect/http";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi, JiraIssueCreateError } from "@t3tools/workbench/jira/JiraApi";
import { JiraAuthService } from "@t3tools/workbench/jira/JiraAuthService";
import * as JiraSync from "@t3tools/workbench/jira/JiraSyncService";
import * as JiraWriter from "@t3tools/workbench/jira/JiraTicketWriteService";
import * as JiraService from "@t3tools/workbench/jira/WorkbenchJiraService";
import { layer as importerLayer } from "@t3tools/workbench/jira/JiraTicketImporter";
import {
  WorkbenchJiraRepository,
  layerSql as repositoryLayer,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";

const TestLayer = importerLayer.pipe(
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(repositoryLayer),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(
    Layer.mock(GitWorkflowService.GitWorkflowService, { isRepository: () => Effect.succeed(true) }),
  ),
);
const at = "2026-10-17T00:00:00.000Z";
const workspaceId = WorkbenchProjectId.make("resolve-workspace");
const nativeId = ProjectId.make("resolve-native");
const ticketId = WorkbenchTicketId.make("resolve-ticket");
const epicId = WorkbenchEpicId.make("resolve-epic");
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("resolve-binding"),
  projectId: workspaceId,
  connectionId: WorkbenchJiraConnectionId.make("resolve-connection"),
  jiraProjectId: "100",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Board",
  sprintId: 7,
  sprintName: "Sprint",
  selectedSprints: [{ id: 7, name: "Sprint" }],
  defaultPrimaryT3ProjectId: nativeId,
  defaultRepositoryProjectIds: [nativeId],
  statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
  followActiveSprint: false,
  observedActiveSprintIds: [],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: at,
  updatedAt: at,
};
const harness = (
  kind: "ticket" | "epic",
  options?: { projectId?: string; typeId?: string; missing?: boolean; localTicket?: boolean },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* WorkbenchStore;
    const repository = yield* WorkbenchJiraRepository;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${nativeId}, 'Repo', '/repos/resolve', '[]', ${at}, ${at})`;
    yield* store.createProject({
      id: workspaceId,
      title: "Resolve",
      linkedProjectIds: [nativeId],
      createdAt: at,
    });
    yield* repository.upsertConnection(
      {
        id: binding.connectionId,
        cloudId: "cloud",
        siteName: "Jira",
        siteUrl: "https://example.atlassian.net",
        avatarUrl: null,
        scopes: ["write:jira-work", "read:jira-user", "write:sprint:jira-software"],
        createdAt: at,
        updatedAt: at,
      },
      "mock-credential",
    );
    yield* repository.upsertBinding(binding);
    let creates = 0;
    const sprintMoves: Array<{ sprintId: number; issueKey: string }> = [];
    const issue = {
      issueId: "200",
      key: "WB-20",
      url: "https://example.atlassian.net/browse/WB-20",
      summary: "Recovered",
      description: "Description",
      issueType: { id: "story", name: "Story" },
      status: { id: "1", name: "To Do" },
      epic: null,
      flagged: false,
      rank: 0,
      remoteUpdatedAt: at,
    };
    const apiLayer = Layer.mock(JiraApi, {
      prepareIssueCreation: () => Effect.succeed({ issueTypeId: "story", accountId: "user" }),
      prepareEpicCreation: () => Effect.succeed({ issueTypeId: "epic", accountId: "user" }),
      createIssue: () =>
        Effect.sync(() => {
          creates++;
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new JiraIssueCreateError({
                outcome: "unknown",
                message: "Jira may have accepted the issue.",
              }),
            ),
          ),
        ),
      getCreationIssue: () =>
        options?.missing
          ? Effect.fail(
              new WorkbenchJiraOperationError({
                code: "request_failed",
                httpStatus: 404,
                message: "Missing issue",
              }),
            )
          : Effect.succeed({
              id: "200",
              key: "WB-20",
              projectId: options?.projectId ?? "100",
              issueTypeId: options?.typeId ?? (kind === "ticket" ? "story" : "epic"),
            }),
      addIssueToSprint: (input) =>
        Effect.sync(() => {
          sprintMoves.push(input);
        }),
      listAssignedSprintIssues: () => Effect.succeed([issue]),
    });
    const api = yield* JiraApi.pipe(Effect.provide(apiLayer));
    const auth = yield* JiraAuthService.pipe(
      Effect.provide(
        Layer.mock(JiraAuthService, { getAccessToken: () => Effect.succeed("mock-token") }),
      ),
    );
    const sync = yield* JiraSync.make.pipe(Effect.provideService(JiraApi, api));
    const writer = yield* JiraWriter.make.pipe(
      Effect.provideService(JiraApi, api),
      Effect.provideService(JiraAuthService, auth),
      Effect.provideService(JiraSync.JiraSyncService, sync),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected HTTP")),
      ),
    );
    const service = yield* JiraService.make.pipe(
      Effect.provideService(JiraApi, api),
      Effect.provideService(JiraAuthService, auth),
      Effect.provideService(JiraSync.JiraSyncService, sync),
      Effect.provideService(JiraWriter.JiraTicketWriteService, writer),
    );
    const createInput = {
      id: ticketId,
      projectId: workspaceId,
      title: "Recovered",
      markdown: "Description",
      kind: "story" as const,
      primaryT3ProjectId: nativeId,
      repositoryProjectIds: [nativeId],
      createdAt: at,
    };
    if (kind === "ticket") {
      if (options?.localTicket) yield* service.createTicket({ ...createInput, localOnly: true });
      yield* service
        .createTicket({
          ...createInput,
          ...(options?.localTicket ? { existingLocalTicketRevision: 0 } : {}),
        })
        .pipe(Effect.flip);
    } else {
      yield* store.createEpic({
        id: epicId,
        projectId: workspaceId,
        title: "Epic",
        markdown: "Description",
        createdAt: at,
      });
      yield* service
        .migrateLocalTickets({
          bindingId: binding.id,
          action: "publish",
          tickets: [],
          epics: [{ id: epicId, updatedAt: at }],
        })
        .pipe(Effect.flip);
    }
    const input = { bindingId: binding.id, kind, id: kind === "ticket" ? ticketId : epicId };
    const table =
      kind === "ticket" ? "workbench_jira_ticket_creations" : "workbench_jira_epic_creations";
    const rows = () =>
      sql<{
        state: string;
        jiraIssueId: string | null;
      }>`SELECT state, jira_issue_id AS "jiraIssueId" FROM ${sql(table)}`;
    const archive = () =>
      store.archiveProject({
        id: workspaceId,
        expectedRevision: 0,
        expectedJiraBindingId: binding.id,
        archivedAt: at,
        updatedAt: at,
      });
    return {
      sql,
      store,
      service,
      sync,
      repository,
      input,
      table,
      rows,
      archive,
      createInput,
      creates: () => creates,
      sprintMoves,
    };
  });

describe("uncertain Jira creation recovery", () => {
  it.effect("not-created restores a promoting draft to editing", () =>
    Effect.gen(function* () {
      const h = yield* harness("ticket");
      const draft = yield* h.store.beginTicketDraft({
        id: ticketId,
        projectId: workspaceId,
        threadId: ThreadId.make("resolve-draft-thread"),
        modelSelection: ModelSelection.make({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
        }),
      });
      yield* h.store.transitionTicketDraft({
        id: ticketId,
        expectedRevision: draft.revision,
        from: ["creating"],
        phase: "promoting",
      });
      yield* h.service.resolveCreation({ ...h.input, outcome: { type: "not_created" } });
      expect((yield* h.store.getTicketDraft(ticketId)).phase).toBe("draft");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect("recovery preserves local edits made after an uncertain Ticket publication", () =>
    Effect.gen(function* () {
      const h = yield* harness("ticket", { localTicket: true });
      yield* h.store.updateTicket({
        id: ticketId,
        expectedRevision: 0,
        title: "Newer local title",
        updatedAt: at,
      });
      yield* h.service
        .resolveCreation({ ...h.input, outcome: { type: "created", issueKey: "WB-20" } })
        .pipe(Effect.flip);
      expect(
        (yield* h.store.getSnapshot).tickets.find((ticket) => ticket.id === ticketId)?.title,
      ).toBe("Newer local title");
      expect(h.sprintMoves).toEqual([]);
      expect(yield* h.rows()).toEqual([{ state: "created", jiraIssueId: "200" }]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: not-created permits a fresh Jira attempt",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        expect((yield* h.service.getSnapshot).uncertainCreations).toContainEqual({
          ...h.input,
          title: kind === "ticket" ? "Recovered" : "Epic",
        });
        yield* h.service.resolveCreation({ ...h.input, outcome: { type: "not_created" } });
        if (kind === "ticket") yield* h.service.createTicket(h.createInput).pipe(Effect.flip);
        else
          yield* h.service
            .migrateLocalTickets({
              bindingId: binding.id,
              action: "publish",
              tickets: [],
              epics: [{ id: epicId, updatedAt: at }],
            })
            .pipe(Effect.flip);
        expect(h.creates()).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: a linked issue cannot be claimed again",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        yield* h.store.createEpic({
          id: WorkbenchEpicId.make("other-epic"),
          projectId: workspaceId,
          title: "Other Epic",
          markdown: "",
          createdAt: at,
        });
        yield* h.sql`INSERT INTO workbench_jira_epic_links (binding_id, jira_issue_id, jira_issue_key, epic_id) VALUES (${binding.id}, '200', 'WB-20', 'other-epic')`;
        expect(
          yield* h.service
            .resolveCreation({ ...h.input, outcome: { type: "created", issueKey: "WB-20" } })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "invalid_binding" });
        expect(yield* h.rows()).toEqual([{ state: "uncertain", jiraIssueId: null }]);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: changing the bound project cannot resolve an old creation",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        yield* h.repository.upsertBinding({ ...binding, jiraProjectKey: "OTHER" });
        yield* h.service
          .resolveCreation({ ...h.input, outcome: { type: "created", issueKey: "WB-20" } })
          .pipe(Effect.flip);
        expect(yield* h.rows()).toEqual([{ state: "uncertain", jiraIssueId: null }]);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: not-created clears the ledger and permits local work and archive",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        expect(yield* h.archive().pipe(Effect.flip)).toMatchObject({
          code: "jira_operation_pending",
        });
        yield* h.service.resolveCreation({ ...h.input, outcome: { type: "not_created" } });
        expect(yield* h.rows()).toEqual([]);
        if (kind === "ticket")
          expect((yield* h.service.createTicket({ ...h.createInput, localOnly: true })).id).toBe(
            ticketId,
          );
        expect((yield* h.archive()).archivedAt).toBe(at);
        yield* h.store.deleteProject({
          id: workspaceId,
          expectedRevision: 1,
          expectedJiraBindingId: binding.id,
          expectedTicketCount: kind === "ticket" ? 1 : 0,
          expectedEpicCount: kind === "epic" ? 1 : 0,
          deletedAt: at,
        });
        expect((yield* h.store.getSnapshot).projects).toEqual([]);
        expect(h.creates()).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: created-as-key verifies and finishes the saved creation without POST",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        yield* h.service.resolveCreation({
          ...h.input,
          outcome: { type: "created", issueKey: "WB-20" },
        });
        expect(yield* h.rows()).toEqual([{ state: "created", jiraIssueId: "200" }]);
        if (kind === "ticket") {
          expect(h.sprintMoves).toEqual([
            { connectionId: binding.connectionId, sprintId: 7, issueKey: "WB-20" },
          ]);
          expect((yield* h.repository.listIssueLinks(binding.id))[0]?.ticketId).toBe(ticketId);
        } else expect((yield* h.repository.listEpicLinks!(binding.id))[0]?.epicId).toBe(epicId);
        expect((yield* h.archive()).archivedAt).toBe(at);
        yield* h.store.deleteProject({
          id: workspaceId,
          expectedRevision: 1,
          expectedJiraBindingId: binding.id,
          expectedTicketCount: kind === "ticket" ? 1 : 0,
          expectedEpicCount: kind === "epic" ? 1 : 0,
          deletedAt: at,
        });
        expect((yield* h.store.getSnapshot).projects).toEqual([]);
        expect(h.creates()).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(["ticket", "epic"] as const)(
    "%s: pending rows and occupied binding permits cannot be resolved",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harness(kind);
        yield* h.sql`UPDATE ${h.sql(h.table)} SET state = 'pending'`;
        yield* h.service
          .resolveCreation({ ...h.input, outcome: { type: "not_created" } })
          .pipe(Effect.flip);
        expect((yield* h.rows())[0]?.state).toBe("pending");
        yield* h.sql`UPDATE ${h.sql(h.table)} SET state = 'uncertain'`;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const fiber = yield* h.sync
          .withBindingPermit(
            binding.id,
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        expect(
          yield* h.service
            .resolveCreation({ ...h.input, outcome: { type: "not_created" } })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "request_failed" });
        expect((yield* h.rows())[0]?.state).toBe("uncertain");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect.each(
    (["ticket", "epic"] as const).flatMap((kind) => [
      { kind, reason: "wrong project", options: { projectId: "other" } },
      { kind, reason: "wrong type", options: { typeId: "other" } },
      { kind, reason: "missing issue", options: { missing: true } },
    ]),
  )("$kind: $reason preserves uncertainty and the archive guard", ({ kind, options }) =>
    Effect.gen(function* () {
      const h = yield* harness(kind, options);
      yield* h.service
        .resolveCreation({ ...h.input, outcome: { type: "created", issueKey: "WB-20" } })
        .pipe(Effect.flip);
      expect(yield* h.rows()).toEqual([{ state: "uncertain", jiraIssueId: null }]);
      expect(yield* h.archive().pipe(Effect.flip)).toMatchObject({
        code: "jira_operation_pending",
      });
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
