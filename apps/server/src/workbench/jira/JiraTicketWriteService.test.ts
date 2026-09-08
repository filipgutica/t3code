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
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { JiraApi } from "@t3tools/workbench/jira/JiraApi";
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

const makeHarness = (options?: {
  readonly transitions?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly to: { readonly id: string; readonly name: string };
  }>;
  readonly failDescriptionWrite?: boolean;
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
}) =>
  Effect.gen(function* () {
    const initialIssue = makeIssue({
      remoteUpdatedAt: options?.missingRemoteUpdatedAt ? null : issueUpdatedAt,
      status: options?.initialStatus ?? makeIssue().status,
    });
    const issueRef = yield* Ref.make(initialIssue);
    const linksRef = yield* Ref.make<ReadonlyArray<WorkbenchJiraIssueLink>>([
      makeLink(initialIssue),
    ]);
    const imported = yield* Ref.make<
      Array<{
        readonly issue: WorkbenchJiraIssueSnapshot;
        readonly mappedStatus: WorkbenchTicketStatus;
      }>
    >([]);
    const requests: Array<{
      readonly method: string;
      readonly url: string;
      readonly body?: string;
    }> = [];
    const binding = makeBinding(options?.additionalStatusMappings);

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
            scopes: options?.writeScope === false ? [] : ["write:jira-work"],
            createdAt: issueUpdatedAt,
            updatedAt: issueUpdatedAt,
          }),
        ),
      listConnections: () => Effect.succeed([]),
      getCredentialId: () => Effect.succeed(Option.none()),
      upsertConnection: () => Effect.void,
      upsertConnections: () => Effect.void,
      getBinding: () => Effect.succeed(Option.some(binding)),
      listBindings: () => Effect.succeed([binding]),
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
        Ref.get(issueRef).pipe(Effect.map((issue) => (options?.missingIssue ? [] : [issue]))),
    });
    const auth = JiraAuthService.of({
      begin: () => Effect.die("unexpected auth start"),
      complete: () => Effect.die("unexpected auth completion"),
      getAccessToken: () => Effect.succeed("access-token"),
    });
    const sync = JiraSyncService.of({
      withBindingPermit: (_bindingId, effect) => effect,
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
              { issue: input.issue, mappedStatus: input.mappedStatus },
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
    return { service, issueRef, linksRef, imported, requests };
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
