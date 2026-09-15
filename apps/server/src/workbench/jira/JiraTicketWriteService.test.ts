import {
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  WorkbenchTicketId,
  WorkbenchProjectId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { JiraApi, JiraIssueCreateError } from "@t3tools/workbench/jira/JiraApi";
import { JiraAuthService } from "@t3tools/workbench/jira/JiraAuthService";
import { JiraSyncService } from "@t3tools/workbench/jira/JiraSyncService";
import { JiraTicketImporter } from "@t3tools/workbench/jira/JiraTicketImporter";
import * as JiraTicketWriteService from "@t3tools/workbench/jira/JiraTicketWriteService";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";

const connectionId = WorkbenchJiraConnectionId.make("connection-1");
const bindingId = WorkbenchJiraBindingId.make("binding-1");
const ticketId = WorkbenchTicketId.make("ticket-1");
const createdTicketId = WorkbenchTicketId.make("created-ticket-1");
const issueUpdatedAt = "2026-09-05T12:00:00.000Z";

const makeIssue = (overrides?: Partial<WorkbenchJiraIssueSnapshot>) =>
  ({
    issueId: "10001",
    key: "WB-1",
    url: "https://example.atlassian.net/browse/WB-1",
    summary: "Shared Jira Ticket",
    description: "Original description",
    issueType: { id: "10001", name: "Story" },
    status: { id: "1", name: "To Do" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: issueUpdatedAt,
    ...overrides,
  }) satisfies WorkbenchJiraIssueSnapshot;

const makeBinding = (
  additionalStatusMappings?: ReadonlyArray<{
    readonly jiraStatusId: string;
    readonly workbenchStatus: WorkbenchTicketStatus;
  }>,
): WorkbenchJiraBinding =>
  ({
    id: bindingId,
    projectId: WorkbenchProjectId.make("workspace-1"),
    connectionId,
    jiraProjectId: "10000",
    jiraProjectKey: "WB",
    jiraProjectName: "Workbench",
    boardId: 42,
    boardName: "Workbench Board",
    sprintId: 7,
    sprintName: "Sprint 7",
    defaultPrimaryT3ProjectId: ProjectId.make("project-1"),
    defaultRepositoryProjectIds: [ProjectId.make("project-1")],
    statusMappings: [
      { jiraStatusId: "1", workbenchStatus: "todo" },
      { jiraStatusId: "2", workbenchStatus: "in_progress" },
      ...(additionalStatusMappings ?? []),
    ],
    selectedSprints: [{ id: 7, name: "Sprint 7" }],
    followActiveSprint: false,
    observedActiveSprintIds: [],
    boardMode: "mapped",
    boardColumns: [],
    active: true,
    lastSyncedAt: issueUpdatedAt,
    lastSyncError: null,
    createdAt: issueUpdatedAt,
    updatedAt: issueUpdatedAt,
  }) satisfies WorkbenchJiraBinding;

const makeLink = (issue: WorkbenchJiraIssueSnapshot): WorkbenchJiraIssueLink => ({
  bindingId,
  ticketId,
  issue,
  active: true,
  linkedAt: issueUpdatedAt,
  lastSeenAt: issueUpdatedAt,
});

const makeOtherBinding = (): WorkbenchJiraBinding =>
  ({
    ...makeBinding(),
    id: WorkbenchJiraBindingId.make("binding-2"),
    jiraProjectId: "10001",
    jiraProjectKey: "OTHER",
    boardId: 43,
    sprintId: 8,
    sprintName: "Sprint 8",
    selectedSprints: [{ id: 8, name: "Sprint 8" }],
  }) satisfies WorkbenchJiraBinding;

const makeHarness = (options?: {
  readonly transitions?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly to: { readonly id: string; readonly name: string };
  }>;
  readonly failDescriptionWrite?: boolean;
  readonly failStatusWrite?: boolean;
  readonly failImport?: boolean;
  readonly missingIssue?: boolean;
  readonly missingRemoteUpdatedAt?: boolean;
  readonly preserveDescriptionOnPut?: boolean;
  readonly preserveStatusOnPost?: boolean;
  readonly writeScope?: boolean;
  readonly initialStatus?: WorkbenchJiraIssueSnapshot["status"];
  readonly postStatus?: WorkbenchJiraIssueSnapshot["status"];
  readonly additionalStatusMappings?: ReadonlyArray<{
    readonly jiraStatusId: string;
    readonly workbenchStatus: WorkbenchTicketStatus;
  }>;
  readonly failCreate?: boolean;
  readonly rejectedCreate?: boolean;
  readonly crashCreate?: boolean;
  readonly failPreflight?: boolean;
  readonly creationScopes?: boolean;
  readonly bindings?: ReadonlyArray<WorkbenchJiraBinding>;
  readonly bindingAfterPermit?: WorkbenchJiraBinding;
  readonly gatePreflight?: boolean;
}) =>
  Effect.gen(function* () {
    const initialIssue = makeIssue({
      remoteUpdatedAt: options?.missingRemoteUpdatedAt ? null : issueUpdatedAt,
      status: options?.initialStatus ?? makeIssue().status,
    });
    const issueRef = yield* Ref.make(initialIssue);
    const sprintReads = yield* Ref.make(0);
    const linksRef = yield* Ref.make<ReadonlyArray<WorkbenchJiraIssueLink>>([
      makeLink(initialIssue),
    ]);
    const imported = yield* Ref.make<
      Array<{
        readonly issue: WorkbenchJiraIssueSnapshot;
        readonly mappedStatus: WorkbenchTicketStatus;
        readonly repositoryProjectIds: ReadonlyArray<ProjectId> | undefined;
      }>
    >([]);
    const requests: Array<{
      readonly method: string;
      readonly url: string;
      readonly body?: string;
    }> = [];
    const createCalls = yield* Ref.make(0);
    const preflightCalls = yield* Ref.make(0);
    const preflightReady = yield* Deferred.make<void>();
    const preflightGate = yield* Deferred.make<void>();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE workbench_jira_ticket_creations (
        ticket_id TEXT PRIMARY KEY,
        binding_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        markdown TEXT NOT NULL,
        jira_issue_id TEXT,
        jira_issue_key TEXT,
        request_fingerprint TEXT NOT NULL,
        result_ticket_id TEXT,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    const binding = makeBinding(options?.additionalStatusMappings);
    let bindings = options?.bindings ?? [binding];

    const repository = WorkbenchJiraRepository.of({
      findConnectionByCloudId: () => Effect.succeed(Option.none()),
      getConnection: () =>
        Effect.succeed(
          Option.some({
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Example Jira",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes:
              options?.writeScope === false
                ? []
                : [
                    "write:jira-work",
                    ...(options?.creationScopes === false
                      ? []
                      : ["read:jira-user", "write:sprint:jira-software"]),
                  ],
            createdAt: issueUpdatedAt,
            updatedAt: issueUpdatedAt,
          }),
        ),
      listConnections: () => Effect.succeed([]),
      getCredentialId: () => Effect.succeed(Option.none()),
      upsertConnection: () => Effect.void,
      upsertConnections: () => Effect.void,
      getBinding: (requestedBindingId) =>
        Effect.succeed(
          Option.fromNullishOr(bindings.find((candidate) => candidate.id === requestedBindingId)),
        ),
      listBindings: () => Effect.succeed(bindings),
      upsertBinding: () => Effect.void,
      updateBindingSyncMetadata: () => Effect.succeed(true),
      updateBindingSyncError: () => Effect.succeed(true),
      listIssueLinks: () => Ref.get(linksRef),
      replaceIssueLinks: (_bindingId, links) => Ref.set(linksRef, links),
    } satisfies WorkbenchJiraRepositoryShape);

    const api = JiraApi.of({
      listProjects: () => Effect.die("unexpected project read"),
      listBoards: () => Effect.die("unexpected board read"),
      listSprints: () => Effect.die("unexpected sprint read"),
      getBoardConfiguration: () => Effect.die("unexpected configuration read"),
      listAssignedSprintIssues: () =>
        Ref.update(sprintReads, (count) => count + 1).pipe(
          Effect.andThen(Ref.get(issueRef)),
          Effect.map((issue) => (options?.missingIssue ? [] : [issue])),
        ),
      prepareIssueCreation: () =>
        Ref.updateAndGet(preflightCalls, (count) => count + 1).pipe(
          Effect.tap((count) =>
            count === 2 ? Deferred.succeed(preflightReady, undefined) : Effect.void,
          ),
          Effect.andThen(options?.gatePreflight ? Deferred.await(preflightGate) : Effect.void),
          Effect.andThen(
            options?.failPreflight
              ? Effect.fail(
                  new WorkbenchJiraOperationError({
                    code: "request_failed",
                    message: "metadata unavailable",
                  }),
                )
              : Effect.succeed({ issueTypeId: "10001", accountId: "user-1" }),
          ),
        ),
      createIssue: () =>
        Ref.update(createCalls, (count) => count + 1).pipe(
          Effect.andThen(
            options?.crashCreate
              ? Effect.die("simulated interruption")
              : options?.failCreate
                ? Effect.fail(
                    new JiraIssueCreateError({
                      outcome: options.rejectedCreate ? "rejected" : "unknown",
                      message: "The Jira request failed.",
                    }),
                  )
                : Effect.succeed({ id: "10001", key: "WB-1" }),
          ),
        ),
      addIssueToSprint: () => Effect.void,
    });
    const auth = JiraAuthService.of({
      begin: () => Effect.die("unexpected auth start"),
      complete: () => Effect.die("unexpected auth completion"),
      getAccessToken: () => Effect.succeed("access-token"),
    });
    const sync = JiraSyncService.of({
      withBindingPermit: (_bindingId, effect) =>
        Effect.suspend(() => {
          if (options?.bindingAfterPermit) bindings = [options.bindingAfterPermit];
          return effect;
        }),
      syncBinding: () => Effect.die("unexpected sync"),
    });
    const importer = JiraTicketImporter.of({
      upsertJiraProjection: (input) =>
        options?.failImport
          ? Effect.fail(
              new WorkbenchJiraOperationError({
                code: "persistence_failed",
                message: "The local Ticket could not be saved.",
              }),
            )
          : Ref.update(imported, (current) => [
              ...current,
              {
                issue: input.issue,
                mappedStatus: input.mappedStatus,
                repositoryProjectIds: input.repositoryProjectIds,
              },
            ]).pipe(Effect.as(input.existingTicketId!)),
    });
    const http = HttpClient.make((request) => {
      const body =
        request.body._tag === "Uint8Array"
          ? new TextDecoder().decode(request.body.body)
          : undefined;
      requests.push({
        method: request.method,
        url: request.url,
        ...(body === undefined ? {} : { body }),
      });
      if (request.method === "GET") {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              transitions: options?.transitions ?? [
                { id: "21", name: "Start work", to: { id: "2", name: "In Progress" } },
              ],
            }),
          ),
        );
      }
      if (options?.failDescriptionWrite && request.method === "PUT") {
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status: 403 })),
        );
      }
      if (options?.failStatusWrite && request.method === "POST") {
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status: 403 })),
        );
      }
      if (request.method === "PUT") {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        const parsed = JSON.parse(body) as { readonly fields?: { readonly description?: string } };
        return Ref.update(issueRef, (issue) => ({
          ...issue,
          ...(options?.preserveDescriptionOnPut
            ? {}
            : { description: parsed.fields?.description ?? issue.description }),
          remoteUpdatedAt: "2026-09-05T12:01:00.000Z",
        })).pipe(
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
        );
      }
      if (request.method === "POST") {
        return Ref.update(issueRef, (issue) => ({
          ...issue,
          ...(options?.preserveStatusOnPost
            ? {}
            : { status: options?.postStatus ?? { id: "2", name: "In Progress" } }),
          remoteUpdatedAt: "2026-09-05T12:02:00.000Z",
        })).pipe(
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
        );
      }
      return Effect.die(`unexpected HTTP method ${request.method}`);
    });

    const service = yield* JiraTicketWriteService.make.pipe(
      Effect.provideService(WorkbenchJiraRepository, repository),
      Effect.provideService(JiraApi, api),
      Effect.provideService(JiraAuthService, auth),
      Effect.provideService(JiraSyncService, sync),
      Effect.provideService(JiraTicketImporter, importer),
      Effect.provideService(HttpClient.HttpClient, http),
    );
    return {
      service,
      issueRef,
      linksRef,
      imported,
      requests,
      sprintReads,
      createCalls,
      preflightCalls,
      preflightReady,
      preflightGate,
    };
  });

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const runWithHarness = <A, E, R>(
  effect: (harness: Harness) => Effect.Effect<A, E, R>,
  options?: Parameters<typeof makeHarness>[0],
) =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(options);
    return yield* effect(harness);
  });

describe("JiraTicketWriteService", () => {
  it.effect("serializes same Ticket IDs across different Jira destinations", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const firstBinding = makeBinding();
          const secondBinding = makeOtherBinding();
          const firstInput = {
            id: createdTicketId,
            projectId: WorkbenchProjectId.make("workspace-1"),
            epicId: null,
            title: "Create in the first Jira project",
            kind: "story" as const,
            markdown: "Shared description",
            primaryT3ProjectId: ProjectId.make("project-1"),
            repositoryProjectIds: [ProjectId.make("project-1")],
            createdAt: issueUpdatedAt,
            binding: firstBinding,
          };
          const secondInput = {
            ...firstInput,
            title: "Create in the second Jira project",
            binding: secondBinding,
          };
          const firstFiber = yield* Effect.forkChild(
            Effect.exit(harness.service.createTicket(firstInput)),
          );
          const secondFiber = yield* Effect.forkChild(
            Effect.exit(harness.service.createTicket(secondInput)),
          );
          yield* Effect.yieldNow;

          yield* Deferred.await(harness.preflightReady);
          assert.strictEqual(yield* Ref.get(harness.preflightCalls), 2);
          yield* Deferred.succeed(harness.preflightGate, undefined);

          const outcomes = [yield* Fiber.join(firstFiber), yield* Fiber.join(secondFiber)];
          assert.strictEqual(outcomes.filter((outcome) => outcome._tag === "Success").length, 1);
          assert.strictEqual(outcomes.filter((outcome) => outcome._tag === "Failure").length, 1);
          assert.strictEqual(yield* Ref.get(harness.createCalls), 1);
        }),
      {
        bindings: [makeBinding(), makeOtherBinding()],
        gatePreflight: true,
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("creates a Jira issue once and resumes the local link on retry", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const input = {
          id: createdTicketId,
          projectId: WorkbenchProjectId.make("workspace-1"),
          epicId: null,
          title: "Create a shared Ticket",
          kind: "story" as const,
          markdown: "Shared description",
          primaryT3ProjectId: ProjectId.make("project-1"),
          repositoryProjectIds: [ProjectId.make("project-1")],
          createdAt: issueUpdatedAt,
          binding: makeBinding(),
        };
        yield* Ref.set(harness.linksRef, []);
        const first = yield* harness.service.createTicket(input);
        const second = yield* harness.service.createTicket(input);

        assert.strictEqual(first, createdTicketId);
        assert.strictEqual(second, createdTicketId);
        assert.strictEqual(yield* Ref.get(harness.createCalls), 1);
        assert.strictEqual((yield* Ref.get(harness.imported)).length, 1);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not retry an unconfirmed Jira creation", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const input = {
            id: createdTicketId,
            projectId: WorkbenchProjectId.make("workspace-1"),
            epicId: null,
            title: "Unconfirmed Ticket",
            kind: "story" as const,
            markdown: "Shared description",
            primaryT3ProjectId: ProjectId.make("project-1"),
            repositoryProjectIds: [ProjectId.make("project-1")],
            createdAt: issueUpdatedAt,
            binding: makeBinding(),
          };
          const first = yield* Effect.flip(harness.service.createTicket(input));
          const second = yield* Effect.flip(harness.service.createTicket(input));

          assert.strictEqual(first.code, "request_failed");
          assert.isTrue(second.message.includes("could not confirm"));
          assert.strictEqual(yield* Ref.get(harness.createCalls), 1);
        }),
      { failCreate: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  const creationInput = {
    id: createdTicketId,
    projectId: WorkbenchProjectId.make("workspace-1"),
    epicId: null,
    title: "Create shared work",
    kind: "story" as const,
    markdown: "Description",
    primaryT3ProjectId: ProjectId.make("project-1"),
    repositoryProjectIds: [ProjectId.make("project-1")],
    createdAt: issueUpdatedAt,
    binding: makeBinding(),
  };

  it.effect("does not POST again after a defect interrupts the first creation", () =>
    runWithHarness(
      (h) =>
        Effect.gen(function* () {
          yield* Effect.exit(h.service.createTicket(creationInput));
          const error = yield* Effect.flip(h.service.createTicket(creationInput));
          assert.isTrue(error.message.includes("will not be sent again"));
          assert.strictEqual(yield* Ref.get(h.createCalls), 1);
        }),
      { crashCreate: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("allows corrected input after a definitive Jira rejection", () =>
    runWithHarness(
      (h) =>
        Effect.gen(function* () {
          yield* Effect.flip(h.service.createTicket(creationInput));
          yield* Effect.flip(
            h.service.createTicket({ ...creationInput, title: "Corrected title" }),
          );
          assert.strictEqual(yield* Ref.get(h.createCalls), 2);
        }),
      { failCreate: true, rejectedCreate: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not reserve creation when metadata fails", () =>
    runWithHarness(
      (h) =>
        Effect.gen(function* () {
          yield* Effect.flip(h.service.createTicket(creationInput));
          assert.strictEqual(yield* Ref.get(h.createCalls), 0);
          const sql = yield* SqlClient.SqlClient;
          assert.deepStrictEqual(yield* sql`SELECT * FROM workbench_jira_ticket_creations`, []);
        }),
      { failPreflight: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("requires creation permissions before any Jira write", () =>
    runWithHarness(
      (h) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(h.service.createTicket(creationInput));
          assert.strictEqual(error.code, "authorization_failed");
          assert.strictEqual(yield* Ref.get(h.createCalls), 0);
        }),
      { creationScopes: false },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("adopts the Ticket identity already imported by sync", () =>
    runWithHarness((h) =>
      Effect.gen(function* () {
        const result = yield* h.service.createTicket(creationInput);
        assert.strictEqual(result, ticketId);
        assert.strictEqual((yield* Ref.get(h.linksRef)).length, 1);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("restores an omitted repository scope when adopting a synced Ticket", () =>
    runWithHarness((h) =>
      Effect.gen(function* () {
        const primaryT3ProjectId = ProjectId.make("project-2");
        const result = yield* h.service.createTicket({
          id: createdTicketId,
          projectId: WorkbenchProjectId.make("workspace-1"),
          epicId: null,
          title: "Create a shared Ticket",
          kind: "story" as const,
          markdown: "Shared description",
          primaryT3ProjectId,
          createdAt: issueUpdatedAt,
          binding: makeBinding(),
        });
        const imported = yield* Ref.get(h.imported);

        assert.strictEqual(result, ticketId);
        assert.deepStrictEqual(imported[0]?.repositoryProjectIds, [primaryT3ProjectId]);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects changed repository scope for an already-created request", () =>
    runWithHarness((h) =>
      Effect.gen(function* () {
        yield* h.service.createTicket(creationInput);
        const error = yield* Effect.flip(
          h.service.createTicket({
            ...creationInput,
            repositoryProjectIds: [ProjectId.make("other")],
          }),
        );
        assert.strictEqual(error.code, "invalid_binding");
        assert.strictEqual(yield* Ref.get(h.createCalls), 1);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("loads transition choices without rereading the assigned sprints", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        yield* Ref.update(harness.issueRef, (issue) => ({
          ...issue,
          remoteUpdatedAt: "2026-09-05T12:01:00.000Z",
        }));
        const result = yield* harness.service.getTicketTransitions({ ticketId });
        assert.strictEqual(yield* Ref.get(harness.sprintReads), 0);
        assert.strictEqual(result.remoteUpdatedAt, issueUpdatedAt);
        const error = yield* Effect.flip(
          harness.service.updateTicket({
            ticketId,
            transitionId: "21",
            expectedRemoteUpdatedAt: result.remoteUpdatedAt,
          }),
        );
        assert.strictEqual(error.code, "invalid_binding");
        assert.strictEqual(yield* Ref.get(harness.sprintReads), 1);
        assert.deepStrictEqual(
          harness.requests.map((request) => request.method),
          ["GET"],
        );
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );
  it.effect("lists available transitions with mapping availability and the remote timestamp", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const result = yield* harness.service.getTicketTransitions({ ticketId });

          assert.deepStrictEqual(result.transitions, [
            {
              id: "21",
              name: "Start work",
              to: { id: "2", name: "In Progress" },
              unavailableReason: null,
            },
            {
              id: "31",
              name: "Send to QA",
              to: { id: "99", name: "QA" },
              unavailableReason: "This Jira status is not mapped to Workbench.",
            },
          ]);
          assert.strictEqual(result.remoteUpdatedAt, issueUpdatedAt);
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET"],
          );
        }),
      {
        transitions: [
          { id: "21", name: "Start work", to: { id: "2", name: "In Progress" } },
          { id: "31", name: "Send to QA", to: { id: "99", name: "QA" } },
        ],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("writes the shared description and mapped status, then stores the readback", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const withDescription = yield* harness.service.updateTicket({
          ticketId,
          markdown: "Updated description",
          expectedRemoteUpdatedAt: issueUpdatedAt,
        });
        const updated = yield* harness.service.updateTicket({
          ticketId,
          status: "in_progress",
          expectedRemoteUpdatedAt: withDescription.remoteUpdatedAt,
        });
        const imported = yield* Ref.get(harness.imported);
        const links = yield* Ref.get(harness.linksRef);

        assert.strictEqual(updated.description, "Updated description");
        assert.strictEqual(updated.status.id, "2");
        assert.deepStrictEqual(
          harness.requests.map((request) => request.method),
          ["PUT", "GET", "POST"],
        );
        assert.strictEqual(imported.length, 2);
        assert.strictEqual(imported[0]?.mappedStatus, "todo");
        assert.strictEqual(imported[1]?.mappedStatus, "in_progress");
        assert.strictEqual(links[0]?.issue.description, "Updated description");
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("starts execution by transitioning a fresh Jira todo and storing its readback", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const started = yield* harness.service.startTicketExecution({ ticketId });
        const imported = yield* Ref.get(harness.imported);

        assert.strictEqual(started.status.id, "2");
        assert.deepStrictEqual(
          harness.requests.map((request) => request.method),
          ["GET", "POST"],
        );
        assert.strictEqual(imported.length, 1);
        assert.strictEqual(imported[0]?.mappedStatus, "in_progress");
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("starts in the first working mirror column instead of a later review column", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const started = yield* harness.service.startTicketExecution({ ticketId });
          assert.strictEqual(started.status.id, "2");
          assert.strictEqual(
            harness.requests.find((request) => request.method === "POST")?.body,
            JSON.stringify({ transition: { id: "21" } }),
          );
        }),
      {
        bindings: [
          {
            ...makeBinding([{ jiraStatusId: "4", workbenchStatus: "in_progress" }]),
            boardMode: "mirror_jira",
            boardColumns: [
              { name: "To Do", statusIds: ["1"], done: false },
              { name: "Implementation", statusIds: ["2"], done: false },
              { name: "Review", statusIds: ["4"], done: false },
            ],
          },
        ],
        transitions: [
          { id: "31", name: "Review", to: { id: "4", name: "Review" } },
          { id: "21", name: "Start", to: { id: "2", name: "Implementation" } },
        ],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("starts after a concurrent sync refreshes binding metadata", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const started = yield* harness.service.startTicketExecution({ ticketId });
          assert.strictEqual(started.status.id, "2");
          assert.strictEqual((yield* Ref.get(harness.imported))[0]?.mappedStatus, "in_progress");
        }),
      {
        bindingAfterPermit: {
          ...makeBinding(),
          updatedAt: "2026-09-14T23:00:00.000Z",
          lastSyncedAt: "2026-09-14T23:00:00.000Z",
        },
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects a different Jira connection while waiting to start", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(harness.service.startTicketExecution({ ticketId }));
          assert.strictEqual(error.code, "invalid_binding");
          assert.deepStrictEqual(harness.requests, []);
        }),
      {
        bindingAfterPermit: {
          ...makeBinding(),
          connectionId: WorkbenchJiraConnectionId.make("other-connection"),
        },
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("keeps a Jira issue already further along without applying a transition", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const current = yield* harness.service.startTicketExecution({ ticketId });
          const imported = yield* Ref.get(harness.imported);

          assert.strictEqual(current.status.id, "3");
          assert.deepStrictEqual(harness.requests, []);
          assert.strictEqual(imported[0]?.mappedStatus, "done");
        }),
      {
        initialStatus: { id: "3", name: "Done" },
        additionalStatusMappings: [{ jiraStatusId: "3", workbenchStatus: "done" }],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not guess when automatic Jira start has ambiguous transitions", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(harness.service.startTicketExecution({ ticketId }));
          const imported = yield* Ref.get(harness.imported);

          assert.strictEqual(error.code, "invalid_binding");
          assert.isTrue(error.message.includes("multiple transitions"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET"],
          );
          assert.strictEqual(imported.length, 0);
        }),
      {
        transitions: [
          { id: "21", name: "Start work", to: { id: "2", name: "In Progress" } },
          { id: "22", name: "Resume work", to: { id: "2", name: "In Progress" } },
        ],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not persist a local status when Jira rejects the automatic transition", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(harness.service.startTicketExecution({ ticketId }));
          const imported = yield* Ref.get(harness.imported);

          assert.strictEqual(error.code, "request_failed");
          assert.isTrue(error.message.includes("403"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET", "POST"],
          );
          assert.strictEqual(imported.length, 0);
        }),
      { failStatusWrite: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("requires the automatic Jira status readback before persisting", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(harness.service.startTicketExecution({ ticketId }));
          const imported = yield* Ref.get(harness.imported);

          assert.strictEqual(error.code, "request_failed");
          assert.isTrue(error.message.includes("still at Jira status"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET", "POST"],
          );
          assert.strictEqual(imported.length, 0);
        }),
      { preserveStatusOnPost: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not apply Jira's start transition again after a successful start", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        yield* harness.service.startTicketExecution({ ticketId });
        yield* harness.service.startTicketExecution({ ticketId });

        assert.strictEqual(
          harness.requests.filter((request) => request.method === "POST").length,
          1,
        );
        assert.strictEqual((yield* Ref.get(harness.imported)).length, 2);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects a stale remote timestamp before making a Jira write", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          harness.service.updateTicket({
            ticketId,
            markdown: "Should not write",
            expectedRemoteUpdatedAt: "2026-09-05T11:59:00.000Z",
          }),
        );
        assert.strictEqual(error.code, "invalid_binding");
        assert.isTrue(error.message.includes("changed remotely"));
        assert.deepStrictEqual(harness.requests, []);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects a Jira issue without a remote timestamp before making a Jira write", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              markdown: "Should not write",
              expectedRemoteUpdatedAt: null,
            }),
          );
          assert.strictEqual(error.code, "invalid_binding");
          assert.isTrue(error.message.includes("remote update timestamp"));
          assert.deepStrictEqual(harness.requests, []);
        }),
      { missingRemoteUpdatedAt: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("requires one shared field and still repairs the local projection for a no-op", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const neither = yield* Effect.flip(
          harness.service.updateTicket({ ticketId, expectedRemoteUpdatedAt: issueUpdatedAt }),
        );
        const both = yield* Effect.flip(
          harness.service.updateTicket({
            ticketId,
            markdown: "Original description",
            status: "todo",
            expectedRemoteUpdatedAt: issueUpdatedAt,
          }),
        );
        const markdownAndTransition = yield* Effect.flip(
          harness.service.updateTicket({
            ticketId,
            markdown: "Original description",
            transitionId: "21",
            expectedRemoteUpdatedAt: issueUpdatedAt,
          }),
        );
        const noOp = yield* harness.service.updateTicket({
          ticketId,
          markdown: "Original description",
          expectedRemoteUpdatedAt: issueUpdatedAt,
        });
        const imported = yield* Ref.get(harness.imported);

        assert.strictEqual(neither.code, "invalid_binding");
        assert.strictEqual(both.code, "invalid_binding");
        assert.strictEqual(markdownAndTransition.code, "invalid_binding");
        assert.strictEqual(noOp.description, "Original description");
        assert.strictEqual(imported.length, 1);
        assert.deepStrictEqual(harness.requests, []);
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("does not guess when more than one Jira transition maps to the target state", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              status: "in_progress",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );
          assert.strictEqual(error.code, "invalid_binding");
          assert.isTrue(error.message.includes("multiple transitions"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET"],
          );
        }),
      {
        transitions: [
          { id: "21", name: "Start work", to: { id: "2", name: "In Progress" } },
          { id: "22", name: "Resume work", to: { id: "2", name: "In Progress" } },
        ],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "applies the selected transition when multiple destinations share a Workbench state",
    () =>
      runWithHarness(
        (harness) =>
          Effect.gen(function* () {
            const updated = yield* harness.service.updateTicket({
              ticketId,
              transitionId: "31",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            });
            const imported = yield* Ref.get(harness.imported);
            const post = harness.requests.find((request) => request.method === "POST");

            assert.strictEqual(updated.status.id, "3");
            assert.strictEqual(imported[0]?.mappedStatus, "in_progress");
            assert.isTrue(post?.body?.includes('"id":"31"') ?? false);
            assert.deepStrictEqual(
              harness.requests.map((request) => request.method),
              ["GET", "POST"],
            );
          }),
        {
          initialStatus: { id: "2", name: "In Progress" },
          postStatus: { id: "3", name: "In Progress (QA)" },
          additionalStatusMappings: [{ jiraStatusId: "3", workbenchStatus: "in_progress" }],
          transitions: [
            { id: "21", name: "Start work", to: { id: "2", name: "In Progress" } },
            { id: "31", name: "Resume work", to: { id: "3", name: "In Progress (QA)" } },
          ],
        },
      ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects a stale transition id before making a Jira write", () =>
    runWithHarness((harness) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          harness.service.updateTicket({
            ticketId,
            transitionId: "99",
            expectedRemoteUpdatedAt: issueUpdatedAt,
          }),
        );

        assert.strictEqual(error.code, "invalid_binding");
        assert.isTrue(error.message.includes("no longer available"));
        assert.deepStrictEqual(
          harness.requests.map((request) => request.method),
          ["GET"],
        );
      }),
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects an explicit transition to an unmapped Jira status before writing", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              transitionId: "31",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );

          assert.strictEqual(error.code, "status_unmapped");
          assert.isTrue(error.message.includes("not mapped"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["GET"],
          );
        }),
      {
        transitions: [{ id: "31", name: "Send to QA", to: { id: "99", name: "QA" } }],
      },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("reports a denied Jira write without changing the local snapshot", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              markdown: "Updated description",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );
          const imported = yield* Ref.get(harness.imported);
          assert.strictEqual(error.code, "request_failed");
          assert.isTrue(error.message.includes("403"));
          assert.isTrue(error.message.includes("write"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["PUT"],
          );
          assert.strictEqual(imported.length, 0);
        }),
      { failDescriptionWrite: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("requires the write scope and assigned issue membership", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              markdown: "Should not write",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );
          assert.strictEqual(error.code, "authorization_failed");
          assert.isTrue(error.message.includes("Reconnect Jira"));
          assert.deepStrictEqual(harness.requests, []);
        }),
      { writeScope: false },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects an issue that is no longer in the assigned sprint set", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              markdown: "Should not write",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );
          assert.strictEqual(error.code, "invalid_binding");
          assert.isTrue(error.message.includes("no longer assigned"));
          assert.deepStrictEqual(harness.requests, []);
        }),
      { missingIssue: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "does not report success when Jira readback does not contain the requested description",
    () =>
      runWithHarness(
        (harness) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              harness.service.updateTicket({
                ticketId,
                markdown: "Updated description",
                expectedRemoteUpdatedAt: issueUpdatedAt,
              }),
            );
            const imported = yield* Ref.get(harness.imported);
            assert.strictEqual(error.code, "request_failed");
            assert.isTrue(error.message.includes("different content"));
            assert.deepStrictEqual(
              harness.requests.map((request) => request.method),
              ["PUT"],
            );
            assert.strictEqual(imported.length, 0);
          }),
        { preserveDescriptionOnPut: true },
      ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "does not report success when Jira readback does not contain the requested status",
    () =>
      runWithHarness(
        (harness) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              harness.service.updateTicket({
                ticketId,
                status: "in_progress",
                expectedRemoteUpdatedAt: issueUpdatedAt,
              }),
            );
            const imported = yield* Ref.get(harness.imported);
            assert.strictEqual(error.code, "request_failed");
            assert.isTrue(error.message.includes("still mapped to todo"));
            assert.deepStrictEqual(
              harness.requests.map((request) => request.method),
              ["GET", "POST"],
            );
            assert.strictEqual(imported.length, 0);
          }),
        { preserveStatusOnPost: true },
      ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "does not report success when an explicit transition reads back a different Jira status in the same Workbench state",
    () =>
      runWithHarness(
        (harness) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              harness.service.updateTicket({
                ticketId,
                transitionId: "31",
                expectedRemoteUpdatedAt: issueUpdatedAt,
              }),
            );
            const imported = yield* Ref.get(harness.imported);
            assert.strictEqual(error.code, "request_failed");
            assert.isTrue(error.message.includes("still at Jira status"));
            assert.deepStrictEqual(
              harness.requests.map((request) => request.method),
              ["GET", "POST"],
            );
            assert.strictEqual(imported.length, 0);
          }),
        {
          initialStatus: { id: "2", name: "In Progress" },
          preserveStatusOnPost: true,
          additionalStatusMappings: [{ jiraStatusId: "3", workbenchStatus: "in_progress" }],
          transitions: [
            { id: "31", name: "Resume work", to: { id: "3", name: "In Progress (QA)" } },
          ],
        },
      ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("reports a local persistence failure after Jira has accepted the write", () =>
    runWithHarness(
      (harness) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            harness.service.updateTicket({
              ticketId,
              markdown: "Updated description",
              expectedRemoteUpdatedAt: issueUpdatedAt,
            }),
          );
          assert.strictEqual(error.code, "persistence_failed");
          assert.isTrue(error.message.includes("Jira was updated"));
          assert.deepStrictEqual(
            harness.requests.map((request) => request.method),
            ["PUT"],
          );
        }),
      { failImport: true },
    ).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
  );
});
