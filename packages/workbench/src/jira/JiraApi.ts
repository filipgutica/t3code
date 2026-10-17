import {
  WorkbenchJiraOperationError,
  TrimmedNonEmptyString,
  type WorkbenchJiraReadIssueInput,
  type WorkbenchJiraResearchIssue,
  type WorkbenchJiraResearchIssueSummary,
  type WorkbenchJiraSearchIssuesInput,
  type WorkbenchJiraSearchIssuesResult,
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
  type WorkbenchCreateTicketInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse, UrlParams } from "effect/http";

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
const ResearchIssueReference = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(100)),
  fields: Schema.Struct({ summary: Schema.String }),
});
const ResearchIssueFields = {
  summary: Schema.String,
  issuetype: Schema.Struct({ name: Schema.String }),
  status: Schema.Struct({ name: Schema.String }),
  parent: Schema.optionalKey(Schema.NullOr(ResearchIssueReference)),
  issuelinks: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.Struct({ inward: Schema.String, outward: Schema.String }),
        inwardIssue: Schema.optionalKey(ResearchIssueReference),
        outwardIssue: Schema.optionalKey(ResearchIssueReference),
      }),
    ),
  ),
  updated: Schema.optionalKey(Schema.String),
};
const ResearchIssueSummary = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(100)),
  fields: Schema.Struct(ResearchIssueFields),
});
const ResearchIssue = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(100)),
  fields: Schema.Struct({
    ...ResearchIssueFields,
    description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
const ResearchIssuePage = Schema.Struct({
  issues: Schema.Array(ResearchIssueSummary),
  nextPageToken: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000))),
  isLast: Schema.optionalKey(Schema.Boolean),
});
const researchFields = "summary,issuetype,status,parent,issuelinks,updated";

const researchSummary = (
  issue: typeof ResearchIssueSummary.Type,
  siteUrl: string,
): WorkbenchJiraResearchIssueSummary => {
  let truncated = false;
  const text = (value: string, limit = 500) => {
    if (value.length <= limit) return value;
    truncated = true;
    return value.slice(0, limit);
  };
  const links = issue.fields.issuelinks ?? [];
  if (links.length > 20) truncated = true;
  const result = {
    key: issue.key,
    url: `${siteUrl.replace(/\/+$/u, "")}/browse/${encodeURIComponent(issue.key)}`,
    summary: text(issue.fields.summary),
    issueType: text(issue.fields.issuetype.name, 200),
    status: text(issue.fields.status.name, 200),
    parent:
      issue.fields.parent == null
        ? null
        : {
            key: issue.fields.parent.key,
            summary: text(issue.fields.parent.fields.summary),
          },
    relationships: links.slice(0, 20).flatMap((link) => {
      const related = link.inwardIssue ?? link.outwardIssue;
      return related === undefined
        ? []
        : [
            {
              relationship: text(
                link.inwardIssue === undefined ? link.type.outward : link.type.inward,
                200,
              ),
              issue: { key: related.key, summary: text(related.fields.summary, 240) },
            },
          ];
    }),
    updatedAt: issue.fields.updated == null ? null : text(issue.fields.updated, 100),
  };
  return { ...result, truncated };
};

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
const IssueTypePage = Schema.Struct({
  ...PageMetadata,
  issueTypes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
const CurrentUser = Schema.Struct({ accountId: Schema.String });
const CreatedIssue = Schema.Struct({ id: Schema.String, key: Schema.String });

export class JiraIssueCreateError extends Data.TaggedError("JiraIssueCreateError")<{
  readonly outcome: "rejected" | "unknown";
  readonly message: string;
}> {}

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
    case 404:
      return "Jira could not provide this resource (HTTP 404). It may not exist or your account may not have access.";
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

type ListAssignedSprintIssuesInput = WorkbenchJiraListAssignedSprintIssuesInput & {
  /** Issue IDs Jira should reconcile into the sprint search before returning results. */
  readonly reconcileIssueIds?: ReadonlyArray<string>;
};

export interface JiraApiShape {
  readonly getCreationIssue?: (input: {
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly issueKey: string;
  }) => Effect.Effect<
    {
      readonly id: string;
      readonly key: string;
      readonly projectId: string;
      readonly issueTypeId: string;
    },
    WorkbenchJiraOperationError
  >;
  readonly getIssue: (
    input: WorkbenchJiraReadIssueInput & { readonly connectionId: WorkbenchJiraConnectionId },
  ) => Effect.Effect<WorkbenchJiraResearchIssue, WorkbenchJiraOperationError>;
  readonly searchIssues: (
    input: WorkbenchJiraSearchIssuesInput & { readonly connectionId: WorkbenchJiraConnectionId },
  ) => Effect.Effect<WorkbenchJiraSearchIssuesResult, WorkbenchJiraOperationError>;
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
    input: ListAssignedSprintIssuesInput,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraIssueSnapshot>, WorkbenchJiraOperationError>;
  readonly prepareIssueCreation: (input: {
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly projectKey: string;
    readonly kind: WorkbenchCreateTicketInput["kind"];
  }) => Effect.Effect<
    { readonly issueTypeId: string; readonly accountId: string },
    WorkbenchJiraOperationError
  >;
  /** The Jira Epic issue type and current account used by local migration. */
  readonly prepareEpicCreation?: (input: {
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly projectKey: string;
  }) => Effect.Effect<
    { readonly issueTypeId: string; readonly accountId: string },
    WorkbenchJiraOperationError
  >;
  /** Creates a Jira issue. Sprint placement is a separate resumable step. */
  readonly createIssue: (input: {
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly projectKey: string;
    readonly ticket: {
      readonly id: string;
      readonly title: WorkbenchCreateTicketInput["title"];
      readonly markdown: WorkbenchCreateTicketInput["markdown"];
      readonly kind: WorkbenchCreateTicketInput["kind"];
    };
    readonly issueTypeId: string;
    readonly accountId: string;
    readonly epicIssueId?: string;
  }) => Effect.Effect<{ readonly id: string; readonly key: string }, JiraIssueCreateError>;
  readonly addIssueToSprint: (input: {
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly sprintId: number;
    readonly issueKey: string;
  }) => Effect.Effect<void, WorkbenchJiraOperationError>;
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

  const executeJsonRequest = <S extends Schema.Top>(input: {
    readonly path: string;
    readonly request: HttpClientRequest.HttpClientRequest;
    readonly schema: S;
  }): Effect.Effect<S["Type"], WorkbenchJiraOperationError, S["DecodingServices"]> => {
    return httpClient.execute(input.request).pipe(
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
          : Effect.fail(
              new WorkbenchJiraOperationError({
                code: "request_failed",
                httpStatus: response.status,
                message: httpStatusErrorMessage(response.status),
              }),
            ),
      ),
    );
  };

  const executeRequest = (input: { readonly request: HttpClientRequest.HttpClientRequest }) =>
    httpClient.execute(input.request).pipe(
      Effect.mapError(() => apiError("request_failed", "The Jira request could not be sent.")),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.void
          : Effect.fail(apiError("request_failed", httpStatusErrorMessage(response.status))),
      ),
    );

  const executeCreateRequest = (input: { readonly request: HttpClientRequest.HttpClientRequest }) =>
    httpClient.execute(input.request).pipe(
      Effect.mapError(
        () =>
          new JiraIssueCreateError({
            outcome: "unknown",
            message: "The Jira issue request could not be sent. Check Jira before retrying.",
          }),
      ),
      Effect.flatMap((response) => {
        if (response.status >= 200 && response.status < 300) {
          return HttpClientResponse.schemaBodyJson(CreatedIssue)(response).pipe(
            Effect.mapError(
              () =>
                new JiraIssueCreateError({
                  outcome: "unknown",
                  message:
                    "Jira may have created the issue, but returned an invalid response. Check Jira before retrying.",
                }),
            ),
          );
        }
        return Effect.fail(
          new JiraIssueCreateError({
            outcome: response.status >= 400 && response.status < 500 ? "rejected" : "unknown",
            message: httpStatusErrorMessage(response.status),
          }),
        );
      }),
    );

  const executeJson = <S extends Schema.Top>(input: {
    readonly connection: WorkbenchJiraConnection;
    readonly accessToken: string;
    readonly path: string;
    readonly urlParams?: UrlParams.Input;
    readonly schema: S;
  }): Effect.Effect<S["Type"], WorkbenchJiraOperationError, S["DecodingServices"]> => {
    const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(input.connection.cloudId)}${input.path}`;
    const request = HttpClientRequest.get(
      url,
      input.urlParams === undefined ? undefined : { urlParams: input.urlParams },
    ).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(input.accessToken));
    return executeJsonRequest({ path: input.path, schema: input.schema, request });
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

  const getCreationIssue: JiraApiShape["getCreationIssue"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const issue = yield* executeJson({
        ...context,
        path: `/rest/api/2/issue/${encodeURIComponent(input.issueKey)}`,
        urlParams: { fields: "project,issuetype" },
        schema: Schema.Struct({
          id: TrimmedNonEmptyString,
          key: TrimmedNonEmptyString,
          fields: Schema.Struct({
            project: Schema.Struct({ id: TrimmedNonEmptyString }),
            issuetype: Schema.Struct({ id: TrimmedNonEmptyString }),
          }),
        }),
      });
      return {
        id: issue.id,
        key: issue.key,
        projectId: issue.fields.project.id,
        issueTypeId: issue.fields.issuetype.id,
      };
    });

  const getIssue: JiraApiShape["getIssue"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      // V2 supplies Jira's text description rather than an Atlassian document tree.
      const issue = yield* executeJson({
        ...context,
        path: `/rest/api/2/issue/${encodeURIComponent(input.issueKey)}`,
        urlParams: { fields: `${researchFields},description` },
        schema: ResearchIssue,
      });
      const summary = researchSummary(issue, context.connection.siteUrl);
      const description = issue.fields.description ?? "";
      return {
        ...summary,
        description: description.slice(0, 30_000),
        truncated: summary.truncated || description.length > 30_000,
      };
    });

  const searchIssues: JiraApiShape["searchIssues"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const page = yield* executeJson({
        ...context,
        path: "/rest/api/3/search/jql",
        urlParams: {
          jql: input.jql,
          fields: researchFields,
          maxResults: String(input.maxResults ?? 10),
          ...(input.nextPageToken === undefined ? {} : { nextPageToken: input.nextPageToken }),
        },
        schema: ResearchIssuePage,
      });
      if (page.issues.length > (input.maxResults ?? 10)) {
        return yield* apiError(
          "response_invalid",
          "Jira returned more issues than the requested page limit.",
        );
      }
      return {
        issues: page.issues.map((issue) => researchSummary(issue, context.connection.siteUrl)),
        nextPageToken: page.isLast === true ? null : (page.nextPageToken ?? null),
      };
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
            ...(input.reconcileIssueIds === undefined
              ? {}
              : { reconcileIssues: input.reconcileIssueIds }),
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

  const prepareIssueCreation: JiraApiShape["prepareIssueCreation"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const issueTypes = yield* collectPages({
        ...context,
        path: `/rest/api/3/issue/createmeta/${encodeURIComponent(input.projectKey)}/issuetypes`,
        schema: IssueTypePage,
        values: (page) => page.issueTypes,
        isLast: (page, received) =>
          page.isLast === true ||
          (page.total !== undefined && (page.startAt ?? 0) + received >= page.total),
      });
      const desiredType = input.kind === "bug" ? "bug" : "story";
      const issueType = issueTypes.find(
        (candidate) => candidate.name.trim().toLowerCase() === desiredType,
      );
      if (issueType === undefined) {
        return yield* apiError(
          "request_failed",
          `Jira project ${input.projectKey} does not expose a ${desiredType} issue type for this account.`,
        );
      }
      const currentUser = yield* executeJson({
        ...context,
        path: "/rest/api/3/myself",
        schema: CurrentUser,
      });
      return { issueTypeId: issueType.id, accountId: currentUser.accountId };
    });

  const prepareEpicCreation: NonNullable<JiraApiShape["prepareEpicCreation"]> = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      const issueTypes = yield* collectPages({
        ...context,
        path: `/rest/api/3/issue/createmeta/${encodeURIComponent(input.projectKey)}/issuetypes`,
        schema: IssueTypePage,
        values: (page) => page.issueTypes,
        isLast: (page, received) =>
          page.isLast === true ||
          (page.total !== undefined && (page.startAt ?? 0) + received >= page.total),
      });
      const issueType = issueTypes.find(
        (candidate) => candidate.name.trim().toLowerCase() === "epic",
      );
      if (issueType === undefined) {
        return yield* apiError(
          "request_failed",
          `Jira project ${input.projectKey} does not expose an Epic issue type for this account.`,
        );
      }
      const currentUser = yield* executeJson({
        ...context,
        path: "/rest/api/3/myself",
        schema: CurrentUser,
      });
      return { issueTypeId: issueType.id, accountId: currentUser.accountId };
    });

  const createIssue: JiraApiShape["createIssue"] = (input) =>
    Effect.gen(function* () {
      const context = yield* authorized(input.connectionId).pipe(
        Effect.mapError(
          (error) =>
            new JiraIssueCreateError({
              outcome: "rejected",
              message: error.message,
            }),
        ),
      );
      return yield* executeCreateRequest({
        request: HttpClientRequest.post(
          `https://api.atlassian.com/ex/jira/${encodeURIComponent(context.connection.cloudId)}/rest/api/2/issue`,
        ).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(context.accessToken),
          HttpClientRequest.bodyJsonUnsafe({
            fields: {
              project: { key: input.projectKey },
              summary: input.ticket.title,
              description: input.ticket.markdown,
              issuetype: { id: input.issueTypeId },
              assignee: { accountId: input.accountId },
              ...(input.epicIssueId === undefined ? {} : { parent: { id: input.epicIssueId } }),
            },
          }),
        ),
      });
    });

  const addIssueToSprint: NonNullable<JiraApiShape["addIssueToSprint"]> = (input) => {
    const path = `/rest/agile/1.0/sprint/${input.sprintId}/issue`;
    return Effect.gen(function* () {
      const context = yield* authorized(input.connectionId);
      yield* executeRequest({
        request: HttpClientRequest.post(
          `https://api.atlassian.com/ex/jira/${encodeURIComponent(context.connection.cloudId)}${path}`,
        ).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(context.accessToken),
          HttpClientRequest.bodyJsonUnsafe({ issues: [input.issueKey] }),
        ),
      });
    });
  };

  return JiraApi.of({
    getIssue,
    getCreationIssue,
    searchIssues,
    listProjects,
    listBoards,
    listSprints,
    getBoardConfiguration,
    listAssignedSprintIssues,
    prepareIssueCreation,
    prepareEpicCreation,
    createIssue,
    addIssueToSprint,
  });
});

export const layer = Layer.effect(JiraApi, make);
