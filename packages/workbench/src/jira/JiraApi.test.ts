import { assert, describe, it, vi } from "@effect/vitest";
import { WorkbenchJiraConnectionId, type WorkbenchJiraConnection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as JiraApi from "./JiraApi.ts";
import { JiraAuthService } from "./JiraAuthService.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "./WorkbenchJiraRepository.ts";

const connectionId = WorkbenchJiraConnectionId.make("connection-1");
const connection: WorkbenchJiraConnection = {
  id: connectionId,
  cloudId: "cloud-1",
  siteName: "Example Jira",
  siteUrl: "https://example.atlassian.net",
  avatarUrl: null,
  scopes: [],
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const repository = WorkbenchJiraRepository.of({
  findConnectionByCloudId: () => Effect.succeed(Option.some(connection)),
  getConnection: () => Effect.succeed(Option.some(connection)),
  listConnections: () => Effect.succeed([connection]),
  getCredentialId: () => Effect.succeed(Option.some("credential-1")),
  upsertConnection: () => Effect.void,
  upsertConnections: () => Effect.void,
  getBinding: () => Effect.succeed(Option.none()),
  listBindings: () => Effect.succeed([]),
  upsertBinding: () => Effect.void,
  updateBindingSyncMetadata: () => Effect.succeed(true),
  updateBindingSyncError: () => Effect.succeed(true),
  listIssueLinks: () => Effect.succeed([]),
  replaceIssueLinks: () => Effect.void,
} satisfies WorkbenchJiraRepositoryShape);

const auth = JiraAuthService.of({
  begin: () => Effect.die("unexpected begin"),
  complete: () => Effect.die("unexpected complete"),
  getAccessToken: () => Effect.succeed("access-token"),
});

describe("JiraApi", () => {
  it.effect("imports descriptions and normalizes numeric and string Epic IDs", () =>
    Effect.gen(function* () {
      for (const epicId of [10000, "10000"]) {
        const service = yield* JiraApi.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository),
          Effect.provideService(JiraAuthService, auth),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json(
                    request.url.includes("/rest/api/2/issue/")
                      ? {
                          fields: {
                            summary: "Jira integration",
                            description: "Epic acceptance criteria.",
                          },
                        }
                      : {
                          isLast: true,
                          issues: [
                            {
                              id: "10001",
                              key: "WB-1",
                              fields: {
                                summary: "Assigned issue",
                                description: "Jira description with acceptance criteria.",
                                issuetype: { id: "1", name: "Story" },
                                status: { id: "2", name: "In Progress" },
                                epic: {
                                  id: epicId,
                                  key: "WB-EPIC",
                                  name: "Integration",
                                  summary: "Jira integration",
                                },
                              },
                            },
                          ],
                        },
                  ),
                ),
              ),
            ),
          ),
        );
        const issues = yield* service.listAssignedSprintIssues({
          connectionId,
          boardId: 42,
          sprintId: 7,
        });
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0]?.description, "Jira description with acceptance criteria.");
        assert.deepStrictEqual(issues[0]?.epic, {
          id: "10000",
          key: "WB-EPIC",
          summary: "Jira integration",
          description: "Epic acceptance criteria.",
        });
      }
    }),
  );

  it.effect("explains how to recover from Jira authorization and access failures", () =>
    Effect.gen(function* () {
      const statuses = [401, 403, 429];
      const execute = (request: HttpClientRequest.HttpClientRequest) => {
        const status = statuses.shift();
        if (status === undefined) return Effect.die("unexpected request");
        return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}, { status })));
      };
      const service = yield* JiraApi.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const unauthorized = yield* Effect.flip(service.listProjects({ connectionId }));
      const forbidden = yield* Effect.flip(service.listProjects({ connectionId }));
      const rateLimited = yield* Effect.flip(service.listProjects({ connectionId }));

      assert.strictEqual(unauthorized.code, "request_failed");
      assert.isTrue(unauthorized.message.includes("401"));
      assert.isTrue(unauthorized.message.includes("Reconnect Jira"));
      assert.isTrue(forbidden.message.includes("403"));
      assert.isTrue(forbidden.message.includes("permissions"));
      assert.isTrue(forbidden.message.includes("scopes"));
      assert.isTrue(rateLimited.message.includes("429"));
      assert.isTrue(rateLimited.message.includes("Wait"));
      assert.isTrue(rateLimited.message.includes("try again"));
    }),
  );

  it.effect("normalizes board configuration and assigned sprint issues", () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
        requests.push(request);
        const nextPageToken = request.urlParams.params.find(
          ([name]) => name === "nextPageToken",
        )?.[1];
        const body = request.url.includes("/rest/api/2/issue/")
          ? { fields: { summary: "Jira integration", description: null } }
          : request.url.includes("/configuration")
            ? {
                id: 42,
                name: "Workbench board",
                type: "scrum",
                columnConfig: {
                  columns: [
                    { name: "To Do", statuses: [{ id: "1" }] },
                    { name: "In Progress", statuses: [{ id: "2" }] },
                    { name: "Done", statuses: [{ id: "3" }] },
                    { name: "Unused", statuses: [] },
                  ],
                },
                ranking: { rankCustomFieldId: 10019 },
              }
            : nextPageToken === undefined
              ? {
                  isLast: false,
                  nextPageToken: "page-2",
                  issues: [
                    {
                      id: "10001",
                      key: "WB-1",
                      fields: {
                        summary: "Mirror assigned sprint tickets",
                        issuetype: { id: "story", name: "Story" },
                        status: { id: "2", name: "In Progress" },
                        updated: "2026-09-03T00:00:00.000Z",
                        flagged: true,
                        parent: {
                          id: "10000",
                          key: "WB-EPIC",
                          fields: {
                            summary: "Jira integration",
                            issuetype: { name: "Epic" },
                          },
                        },
                      },
                    },
                  ],
                }
              : {
                  isLast: true,
                  issues: [
                    {
                      id: "10002",
                      key: "WB-2",
                      fields: {
                        summary: "Second page",
                        issuetype: { id: "bug", name: "Bug" },
                        status: { id: "2", name: "In Progress" },
                        updated: "2026-09-03T00:00:00.000Z",
                        flagged: false,
                        epic: { id: 10000, key: "WB-EPIC", summary: "Jira integration" },
                      },
                    },
                  ],
                };
        return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));
      });
      const service = yield* JiraApi.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const config = yield* service.getBoardConfiguration({ connectionId, boardId: 42 });
      const issues = yield* service.listAssignedSprintIssues({
        connectionId,
        boardId: 42,
        sprintId: 7,
      });

      assert.deepStrictEqual(
        config.columns.map((column) => column.done),
        [false, false, true, false],
      );
      assert.strictEqual(config.rankFieldId, "10019");
      assert.strictEqual(issues[0]?.epic?.key, "WB-EPIC");
      assert.isTrue(issues[0]?.flagged ?? false);
      assert.strictEqual(issues[1]?.rank, 1);
      assert.strictEqual(issues[1]?.description, "");
      assert.strictEqual(issues[0]?.epic?.description, "");
      assert.deepStrictEqual(issues[1]?.epic, issues[0]?.epic);
      assert.strictEqual(
        requests.filter((request) => request.url.includes("/rest/api/2/issue/")).length,
        1,
      );
      assert.isTrue(
        requests[1]?.urlParams.params
          .find(([key]) => key === "fields")?.[1]
          .split(",")
          .includes("description") ?? false,
      );
      assert.isTrue(
        requests[1]?.url.includes("/rest/software/1.0/board/42/sprint/7/issue") ?? false,
      );
      assert.deepStrictEqual(requests[1]?.urlParams.params[0], ["jql", "assignee = currentUser()"]);
      assert.strictEqual(requests[1]?.headers.authorization, "Bearer access-token");
      assert.deepStrictEqual(requests[2]?.urlParams.params.at(-1), ["nextPageToken", "page-2"]);
    }),
  );
});
