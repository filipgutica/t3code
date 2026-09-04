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
  getBinding: () => Effect.succeed(Option.none()),
  listBindings: () => Effect.succeed([]),
  upsertBinding: () => Effect.void,
  listIssueLinks: () => Effect.succeed([]),
  replaceIssueLinks: () => Effect.void,
} satisfies WorkbenchJiraRepositoryShape);

const auth = JiraAuthService.of({
  begin: () => Effect.die("unexpected begin"),
  complete: () => Effect.die("unexpected complete"),
  getAccessToken: () => Effect.succeed("access-token"),
});

describe("JiraApi", () => {
  it.effect("normalizes board configuration and assigned sprint issues", () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
        requests.push(request);
        const nextPageToken = request.urlParams.params.find(
          ([name]) => name === "nextPageToken",
        )?.[1];
        const body = request.url.includes("/configuration")
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
      assert.deepStrictEqual(requests[1]?.urlParams.params[0], ["jql", "assignee = currentUser()"]);
      assert.strictEqual(requests[1]?.headers.authorization, "Bearer access-token");
      assert.deepStrictEqual(requests[2]?.urlParams.params.at(-1), ["nextPageToken", "page-2"]);
    }),
  );
});
