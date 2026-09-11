import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraBoard,
  type WorkbenchJiraBoardConfiguration,
  type WorkbenchJiraConnection,
  type WorkbenchJiraConnectionId,
  type WorkbenchJiraGetBoardConfigurationInput,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchJiraListAssignedSprintIssuesInput,
  type WorkbenchJiraListBoardsInput,
  type WorkbenchJiraListProjectsInput,
  type WorkbenchJiraListSprintsInput,
  type WorkbenchJiraProject,
  type WorkbenchJiraSprint,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { JiraAuthService } from "./JiraAuthService.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryError,
} from "./WorkbenchJiraRepository.ts";

const PageMetadata = {
  startAt: Schema.optionalKey(Schema.Number),
  maxResults: Schema.optionalKey(Schema.Number),
  total: Schema.optionalKey(Schema.Number),
  isLast: Schema.optionalKey(Schema.Boolean),
};

const RawProject = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
  projectTypeKey: Schema.optionalKey(Schema.String),
  avatarUrls: Schema.optionalKey(
    Schema.Struct({
      "48x48": Schema.optionalKey(Schema.String),
    }),
  ),
});
const ProjectPage = Schema.Struct({ ...PageMetadata, values: Schema.Array(RawProject) });

const RawBoard = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  type: Schema.String,
  location: Schema.optionalKey(
    Schema.Struct({ projectKeyOrId: Schema.optionalKey(Schema.String) }),
  ),
});
const BoardPage = Schema.Struct({ ...PageMetadata, values: Schema.Array(RawBoard) });

const RawSprint = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  state: Schema.String,
  goal: Schema.optionalKey(Schema.String),
  startDate: Schema.optionalKey(Schema.String),
  endDate: Schema.optionalKey(Schema.String),
  completeDate: Schema.optionalKey(Schema.String),
});
const SprintPage = Schema.Struct({ ...PageMetadata, values: Schema.Array(RawSprint) });

const RawBoardConfiguration = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  type: Schema.String,
  columnConfig: Schema.Struct({
    columns: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        statuses: Schema.Array(Schema.Struct({ id: Schema.String })),
      }),
    ),
  }),
  ranking: Schema.optionalKey(
    Schema.Struct({ rankCustomFieldId: Schema.optionalKey(Schema.Number) }),
  ),
});

const RawIssueReference = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  key: Schema.String,
  name: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
});
const RawParentIssue = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.optionalKey(
    Schema.Struct({
      summary: Schema.optionalKey(Schema.String),
      issuetype: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
    }),
  ),
});
const RawIssue = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    issuetype: Schema.Struct({ id: Schema.String, name: Schema.String }),
    status: Schema.Struct({ id: Schema.String, name: Schema.String }),
    updated: Schema.optionalKey(Schema.String),
    flagged: Schema.optionalKey(Schema.Boolean),
    epic: Schema.optionalKey(Schema.NullOr(RawIssueReference)),
    parent: Schema.optionalKey(Schema.NullOr(RawParentIssue)),
  }),
});
const RawEpicDetails = Schema.Struct({
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
const IssuePage = Schema.Struct({
  issues: Schema.Array(RawIssue),
  isLast: Schema.optionalKey(Schema.Boolean),
  nextPageToken: Schema.optionalKey(Schema.String),
});

const apiError = (
  code: "connection_not_found" | "request_failed" | "response_invalid",
  message: string,
) => new WorkbenchJiraOperationError({ code, message });

const httpStatusErrorMessage = (status: number): string => {
  switch (status) {
    case 401:
      return "Jira rejected authorization (HTTP 401). Reconnect Jira to authorize access again.";
    case 403:
      return "Jira denied access (HTTP 403). Check Jira project permissions and OAuth scopes, then reconnect Jira if the scopes changed.";
    case 429:
      return "Jira is rate-limiting requests (HTTP 429). Wait a moment and try again.";
    default:
      return `Jira returned HTTP ${status}.`;
  }
};

const repositoryError = (_cause: WorkbenchJiraRepositoryError) =>
  apiError("request_failed", "Jira connection metadata could not be loaded.");

const boardType = (value: string): WorkbenchJiraBoard["type"] =>
  value === "scrum" || value === "kanban" || value === "simple" ? value : "simple";

const sprintState = (value: string): WorkbenchJiraSprint["state"] =>
  value === "future" || value === "active" || value === "closed" ? value : "closed";

export interface JiraApiShape {
  readonly listProjects: (
    input: WorkbenchJiraListProjectsInput,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraProject>, WorkbenchJiraOperationError>;
  readonly listBoards: (
    input: WorkbenchJiraListBoardsInput,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraBoard>, WorkbenchJiraOperationError>;
  readonly listSprints: (
    input: WorkbenchJiraListSprintsInput,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraSprint>, WorkbenchJiraOperationError>;
  readonly getBoardConfiguration: (
    input: WorkbenchJiraGetBoardConfigurationInput,
  ) => Effect.Effect<WorkbenchJiraBoardConfiguration, WorkbenchJiraOperationError>;
  readonly listAssignedSprintIssues: (
    input: WorkbenchJiraListAssignedSprintIssuesInput,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraIssueSnapshot>, WorkbenchJiraOperationError>;
}

export class JiraApi extends Context.Service<JiraApi, JiraApiShape>()(
  "@t3tools/workbench/jira/JiraApi",
) {}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const auth = yield* JiraAuthService;
  const repository = yield* WorkbenchJiraRepository;

  const authorized = (connectionId: WorkbenchJiraConnectionId) =>
    Effect.gen(function* () {
      const connection = yield* repository
        .getConnection(connectionId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(connection)) {
        return yield* apiError("connection_not_found", "The Jira connection was not found.");
      }
      return {
        connection: connection.value,
        accessToken: yield* auth.getAccessToken(connectionId),
      };
    });

  const executeJson = <S extends Schema.Top>(input: {
    readonly connection: WorkbenchJiraConnection;
    readonly accessToken: string;
    readonly path: string;
    readonly urlParams?: Record<string, string>;
    readonly schema: S;
  }): Effect.Effect<S["Type"], WorkbenchJiraOperationError, S["DecodingServices"]> => {
    const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(input.connection.cloudId)}${input.path}`;
    const request = HttpClientRequest.get(
      url,
      input.urlParams === undefined ? undefined : { urlParams: input.urlParams },
    ).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(input.accessToken));
    return httpClient.execute(request).pipe(
      Effect.mapError(() => apiError("request_failed", "The Jira request could not be sent.")),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
              Effect.mapError(() =>
                apiError(
                  "response_invalid",
                  `Jira returned an unexpected response for ${input.path}.`,
                ),
              ),
            )
          : Effect.fail(apiError("request_failed", httpStatusErrorMessage(response.status))),
      ),
    );
  };

  const collectPages = <S extends Schema.Top, A>(input: {
    readonly connection: WorkbenchJiraConnection;
    readonly accessToken: string;
    readonly path: string;
    readonly baseParams?: Record<string, string>;
    readonly schema: S;
    readonly values: (page: S["Type"]) => ReadonlyArray<A>;
    readonly isLast: (page: S["Type"], received: number) => boolean;
  }) =>
    Effect.gen(function* () {
      const values: Array<A> = [];
      let startAt = 0;
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = yield* executeJson({
          connection: input.connection,
          accessToken: input.accessToken,
          path: input.path,
          urlParams: {
            ...input.baseParams,
            startAt: String(startAt),
            maxResults: "100",
          },
          schema: input.schema,
        });
        const received = input.values(page);
        values.push(...received);
        if (input.isLast(page, received.length) || received.length === 0) return values;
        startAt += received.length;
      }
      return yield* apiError(
        "response_invalid",
        "Jira pagination exceeded the supported page limit.",
      );
    });

  const listProjects: JiraApiShape["listProjects"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const projects = yield* collectPages({
        ...context,
        path: "/rest/api/3/project/search",
        schema: ProjectPage,
        values: (page) => page.values,
        isLast: (page, received) =>
          page.isLast === true ||
          (page.total !== undefined && (page.startAt ?? 0) + received >= page.total),
      });
      return projects.map(
        (project) =>
          ({
            id: project.id,
            key: project.key,
            name: project.name,
            projectTypeKey: project.projectTypeKey ?? null,
            avatarUrl: project.avatarUrls?.["48x48"] ?? null,
          }) satisfies WorkbenchJiraProject,
      );
    });

  const listBoards: JiraApiShape["listBoards"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const boards = yield* collectPages({
        ...context,
        path: "/rest/agile/1.0/board",
        baseParams: { projectKeyOrId: input.projectKeyOrId },
        schema: BoardPage,
        values: (page) => page.values,
        isLast: (page, received) =>
          page.isLast === true ||
          (page.total !== undefined && (page.startAt ?? 0) + received >= page.total),
      });
      return boards.map(
        (board) =>
          ({
            id: board.id,
            name: board.name,
            type: boardType(board.type),
            projectKeyOrId: board.location?.projectKeyOrId ?? null,
          }) satisfies WorkbenchJiraBoard,
      );
    });

  const listSprints: JiraApiShape["listSprints"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const sprints = yield* collectPages({
        ...context,
        path: `/rest/agile/1.0/board/${input.boardId}/sprint`,
        baseParams: { state: "active,future" },
        schema: SprintPage,
        values: (page) => page.values,
        isLast: (page, received) =>
          page.isLast === true ||
          (page.total !== undefined && (page.startAt ?? 0) + received >= page.total),
      });
      return sprints.map(
        (sprint) =>
          ({
            id: sprint.id,
            name: sprint.name,
            state: sprintState(sprint.state),
            goal: sprint.goal ?? "",
            startDate: sprint.startDate ?? null,
            endDate: sprint.endDate ?? null,
            completeDate: sprint.completeDate ?? null,
          }) satisfies WorkbenchJiraSprint,
      );
    });

  const getBoardConfiguration: JiraApiShape["getBoardConfiguration"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const config = yield* executeJson({
        ...context,
        path: `/rest/agile/1.0/board/${input.boardId}/configuration`,
        schema: RawBoardConfiguration,
      });
      const lastMappedColumn = config.columnConfig.columns.findLastIndex(
        (column) => column.statuses.length > 0,
      );
      return {
        boardId: config.id,
        name: config.name,
        type: boardType(config.type),
        columns: config.columnConfig.columns.map((column, index) => ({
          name: column.name,
          statusIds: column.statuses.map((status) => status.id),
          done: index === lastMappedColumn,
        })),
        rankFieldId:
          config.ranking?.rankCustomFieldId === undefined
            ? null
            : String(config.ranking.rankCustomFieldId),
      } satisfies WorkbenchJiraBoardConfiguration;
    });

  const listAssignedSprintIssues: JiraApiShape["listAssignedSprintIssues"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const issues: Array<typeof RawIssue.Type> = [];
      let nextPageToken: string | undefined;
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = yield* executeJson({
          ...context,
          path: `/rest/software/1.0/board/${input.boardId}/sprint/${input.sprintId}/issue`,
          urlParams: {
            jql: "assignee = currentUser()",
            fields: "summary,description,issuetype,status,updated,flagged,epic,parent",
            maxResults: "100",
            ...(nextPageToken === undefined ? {} : { nextPageToken }),
          },
          schema: IssuePage,
        });
        issues.push(...page.issues);
        if (page.isLast === true || page.nextPageToken === undefined) break;
        nextPageToken = page.nextPageToken;
        if (pageNumber === 99) {
          return yield* apiError(
            "response_invalid",
            "Jira pagination exceeded the supported page limit.",
          );
        }
      }
      const siteUrl = context.connection.siteUrl.replace(/\/+$/u, "");
      const snapshots = issues.map((issue, rank) => {
        const parentIsEpic = issue.fields.parent?.fields?.issuetype?.name.toLowerCase() === "epic";
        const directEpic = issue.fields.epic;
        const parentEpic = parentIsEpic ? issue.fields.parent : null;
        const epic =
          directEpic !== null && directEpic !== undefined
            ? {
                id: String(directEpic.id),
                key: directEpic.key,
                summary: directEpic.summary ?? directEpic.name ?? directEpic.key,
              }
            : parentEpic !== null && parentEpic !== undefined
              ? {
                  id: parentEpic.id,
                  key: parentEpic.key,
                  summary: parentEpic.fields?.summary ?? parentEpic.key,
                }
              : null;
        return {
          issueId: issue.id,
          key: issue.key,
          url: `${siteUrl}/browse/${encodeURIComponent(issue.key)}`,
          summary: issue.fields.summary,
          description: issue.fields.description ?? "",
          issueType: issue.fields.issuetype,
          status: issue.fields.status,
          epic,
          flagged: issue.fields.flagged ?? false,
          rank,
          remoteUpdatedAt: issue.fields.updated ?? null,
        } satisfies WorkbenchJiraIssueSnapshot;
      });
      const epicIds = [
        ...new Set(snapshots.flatMap((issue) => (issue.epic === null ? [] : [issue.epic.id]))),
      ];
      const epicDetails = yield* Effect.forEach(
        epicIds,
        (id) =>
          executeJson({
            ...context,
            path: `/rest/api/2/issue/${encodeURIComponent(id)}`,
            urlParams: { fields: "summary,description" },
            schema: RawEpicDetails,
          }).pipe(Effect.map((details) => [id, details.fields] as const)),
        { concurrency: 4 },
      );
      const epicById = new Map(epicDetails);
      return snapshots.map((issue) => {
        const details = issue.epic === null ? undefined : epicById.get(issue.epic.id);
        return {
          ...issue,
          epic:
            issue.epic === null || details === undefined
              ? issue.epic
              : {
                  ...issue.epic,
                  summary: details.summary,
                  ...(details.description === undefined
                    ? {}
                    : { description: details.description ?? "" }),
                },
        };
      });
    });

  return JiraApi.of({
    listProjects,
    listBoards,
    listSprints,
    getBoardConfiguration,
    listAssignedSprintIssues,
  });
});

export const layer = Layer.effect(JiraApi, make);
