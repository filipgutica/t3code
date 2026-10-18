import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import * as JiraApi from "@t3tools/workbench/jira/JiraApi";
import * as JiraRepository from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Invocation from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as Threads from "../../orchestration-v2/ThreadManagementService.ts";
import * as Store from "../WorkbenchStore.ts";
import * as Research from "./JiraResearchService.ts";
import { JiraResearchToolkit, layerHandlers } from "./JiraResearchToolkit.ts";

const threadId = ThreadId.make("ticket-thread");
const projectId = WorkbenchProjectId.make("workspace");
const anchorProjectId = ProjectId.make("repository");
const connectionId = WorkbenchJiraConnectionId.make("workspace-connection");
const draft: WorkbenchTicketDraft & {
  readonly workArea: null;
  readonly planningRepositoryProjectIds: Array<ProjectId>;
} = {
  id: WorkbenchTicketId.make("ticket"),
  projectId,
  threadId,
  anchorProjectId,
  phase: "draft",
  revision: 0,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  fields: {
    title: "",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [anchorProjectId],
    primaryT3ProjectId: anchorProjectId,
    localOnly: false,
    jiraSprintId: null,
  },
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  workArea: null,
  planningRepositoryProjectIds: [anchorProjectId],
};
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding"),
  projectId,
  connectionId,
  jiraProjectId: "100",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 1,
  boardName: "Board",
  sprintId: 2,
  sprintName: "Sprint",
  defaultPrimaryT3ProjectId: anchorProjectId,
  defaultRepositoryProjectIds: [anchorProjectId],
  statusMappings: [],
  followActiveSprint: true,
  selectedSprints: [],
  observedActiveSprintIds: [],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
};
const scope: Invocation.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "provider-session",
  issuedAt: 1,
  thread: {
    threadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: "provider-session",
    readOnly: true,
  },
  client: undefined,
  capabilities: new Set(),
};
const issue = {
  key: "OTHER-1",
  summary: "Source issue",
  url: "https://example.atlassian.net/browse/OTHER-1",
  issueType: "Task",
  status: "Open",
  parent: null,
  relationships: [],
  updatedAt: null,
  description: "Acceptance criteria",
  truncated: false,
};

const makeHarness = Effect.fnUntraced(function* (
  options: {
    readonly missingDraft?: boolean;
    readonly bindings?: ReadonlyArray<WorkbenchJiraBinding>;
    readonly archived?: boolean;
    readonly stale?: boolean;
    readonly apiFailure?: WorkbenchJiraOperationError;
  } = {},
) {
  const reads: Array<{
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly issueKey: string;
  }> = [];
  const searches: Array<{
    readonly connectionId: WorkbenchJiraConnectionId;
    readonly jql: string;
  }> = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(Store.WorkbenchStore)({
      getTicketDraftForThread: (id) =>
        Effect.succeed(id === threadId && !options.missingDraft ? draft : null),
      getProject: (id) =>
        Effect.succeed(
          id === projectId
            ? Option.some({
                id: projectId,
                title: "Workspace",
                linkedProjectIds: [anchorProjectId],
                archivedAt: options.archived ? draft.createdAt : null,
                revision: 0,
                createdAt: draft.createdAt,
                updatedAt: draft.updatedAt,
              })
            : Option.none(),
        ),
    }),
    Layer.mock(JiraRepository.WorkbenchJiraRepository)({
      listBindings: () => Effect.succeed(options.bindings ?? [binding]),
    }),
    Layer.mock(JiraApi.JiraApi)({
      getIssue: (input) => {
        reads.push(input);
        return options.apiFailure === undefined
          ? Effect.succeed(issue)
          : Effect.fail(options.apiFailure);
      },
      searchIssues: (input) => {
        searches.push(input);
        return Effect.succeed({ issues: [issue], nextPageToken: null });
      },
    }),
    Layer.mock(Threads.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed(
          liveThreadShell(id, {
            runtimeMode: "approval-required",
            ...(options.stale ? { activeRunId: null } : {}),
          }),
        ),
    }),
  );
  const serviceLayer = Research.layer.pipe(Layer.provide(dependencies));
  const toolkit = yield* JiraResearchToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(layerHandlers).pipe(Layer.provide(serviceLayer)),
    ),
  );
  const call = <Name extends keyof typeof JiraResearchToolkit.tools>(
    name: Name,
    input: Parameters<typeof toolkit.handle<Name>>[1],
    invocation = scope,
  ) =>
    toolkit.handle(name, input).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunks) => chunks.at(-1)?.result),
      Effect.provideService(Invocation.McpInvocationContext, invocation),
      Effect.provide(serviceLayer),
    );
  return { reads, searches, call };
});

describe("workspace Jira research tools", () => {
  it.effect("reads and searches using the authenticated draft's connection in read-only mode", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        bindings: [
          {
            ...binding,
            id: WorkbenchJiraBindingId.make("other-binding"),
            projectId: WorkbenchProjectId.make("other-workspace"),
            connectionId: WorkbenchJiraConnectionId.make("other-connection"),
          },
          binding,
        ],
      });
      expect(yield* harness.call("workbench_jira_read_issue", { issueKey: "OTHER-1" })).toEqual(
        issue,
      );
      expect(
        yield* harness.call("workbench_jira_search_issues", {
          jql: "project = OTHER",
          maxResults: 5,
        }),
      ).toEqual({ issues: [issue], nextPageToken: null });
      expect(harness.reads).toEqual([{ issueKey: "OTHER-1", connectionId }]);
      expect(harness.searches).toEqual([{ jql: "project = OTHER", maxResults: 5, connectionId }]);
    }),
  );

  it.effect("rejects outside clients and stale provider sessions before contacting Jira", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const outside = {
        ...scope,
        thread: undefined,
        client: { sessionId: "outside", label: "Outside", access: "full-access" as const },
      };
      expect(
        yield* Effect.flip(
          harness.call("workbench_jira_read_issue", { issueKey: "OTHER-1" }, outside),
        ),
      ).toMatchObject({ code: "thread_credential_required" });
      const stale = yield* makeHarness({ stale: true });
      expect(
        yield* Effect.flip(stale.call("workbench_jira_read_issue", { issueKey: "OTHER-1" })),
      ).toMatchObject({ code: "parent_not_active" });
      expect(harness.reads).toEqual([]);
      expect(stale.reads).toEqual([]);
    }),
  );

  it.effect(
    "does not borrow another workspace connection when its own is missing or inactive",
    () =>
      Effect.gen(function* () {
        for (const [options, code] of [
          [{ missingDraft: true }, "invalid_binding"],
          [{ archived: true }, "invalid_binding"],
          [
            { bindings: [{ ...binding, projectId: WorkbenchProjectId.make("other-workspace") }] },
            "binding_not_found",
          ],
          [{ bindings: [{ ...binding, active: false }] }, "binding_inactive"],
        ] as const) {
          const harness = yield* makeHarness(options);
          expect(
            yield* Effect.flip(harness.call("workbench_jira_read_issue", { issueKey: "OTHER-1" })),
          ).toMatchObject({ code });
          expect(harness.reads).toEqual([]);
        }
      }),
  );

  it.effect(
    "reports authorization, forbidden, unavailable, and transport failures accurately",
    () =>
      Effect.gen(function* () {
        for (const httpStatus of [401, 403, 404, 503]) {
          const harness = yield* makeHarness({
            apiFailure: new WorkbenchJiraOperationError({
              code: "request_failed",
              httpStatus,
              message: "Safe Jira failure",
            }),
          });
          expect(
            yield* Effect.flip(harness.call("workbench_jira_read_issue", { issueKey: "OTHER-1" })),
          ).toMatchObject({ code: "request_failed", httpStatus, message: "Safe Jira failure" });
        }
      }),
  );

  it.effect(
    "rejects oversized searches and endpoint-shaped issue keys before contacting Jira",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.flip(harness.call("workbench_jira_read_issue", { issueKey: "../project" }));
        yield* Effect.flip(harness.call("workbench_jira_search_issues", { jql: "x".repeat(2001) }));
        yield* Effect.flip(
          harness.call("workbench_jira_search_issues", { jql: "project = WB", maxResults: 26 }),
        );
        expect(harness.reads).toEqual([]);
        expect(harness.searches).toEqual([]);
      }),
  );
});
