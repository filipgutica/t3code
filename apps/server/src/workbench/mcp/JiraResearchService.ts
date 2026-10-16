import {
  OrchestratorMcpFailure,
  WorkbenchJiraReadIssueInput,
  WorkbenchJiraSearchIssuesInput,
  WorkbenchJiraOperationError,
  type WorkbenchJiraResearchIssue,
  type WorkbenchJiraSearchIssuesResult,
} from "@t3tools/contracts";
import * as JiraApi from "@t3tools/workbench/jira/JiraApi";
import * as JiraRepository from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { assertLiveCaller, loadCaller, unavailable } from "../../mcp/threadAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as WorkbenchStore from "../WorkbenchStore.ts";

const decodeReadIssue = Schema.decodeEffect(WorkbenchJiraReadIssueInput);
const decodeSearchIssues = Schema.decodeEffect(WorkbenchJiraSearchIssuesInput);

/**
 * @effect-expect-leaking McpInvocationContext -- Authentication is request-scoped and must not be captured by the shared server layer.
 */
export class JiraResearchService extends Context.Service<
  JiraResearchService,
  {
    readonly getIssue: (
      input: WorkbenchJiraReadIssueInput,
    ) => Effect.Effect<
      WorkbenchJiraResearchIssue,
      OrchestratorMcpFailure | WorkbenchJiraOperationError,
      McpInvocationContext.McpInvocationContext
    >;
    readonly searchIssues: (
      input: WorkbenchJiraSearchIssuesInput,
    ) => Effect.Effect<
      WorkbenchJiraSearchIssuesResult,
      OrchestratorMcpFailure | WorkbenchJiraOperationError,
      McpInvocationContext.McpInvocationContext
    >;
  }
>()("t3/workbench/mcp/JiraResearchService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore.WorkbenchStore;
  const repository = yield* JiraRepository.WorkbenchJiraRepository;
  const api = yield* JiraApi.JiraApi;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const connectionForCaller = Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const { thread } = yield* McpInvocationContext.requireThreadScope(
      scope,
      "Workspace Jira research",
    );
    const caller = yield* loadCaller().pipe(
      Effect.provideService(ThreadManagement.ThreadManagementService, threads),
    );
    yield* assertLiveCaller(caller);
    const draft = yield* store
      .getTicketDraftForThread(thread.threadId)
      .pipe(Effect.mapError(unavailable));
    if (draft === null || draft.phase === "discarding") {
      return yield* new WorkbenchJiraOperationError({
        code: "invalid_binding",
        message: "This thread has no active Workbench ticket conversation.",
      });
    }
    const project = yield* store.getProject(draft.projectId).pipe(Effect.mapError(unavailable));
    if (Option.isNone(project) || project.value.archivedAt !== null) {
      return yield* new WorkbenchJiraOperationError({
        code: "invalid_binding",
        message: "The ticket workspace is unavailable or archived.",
      });
    }
    const bindings = yield* repository.listBindings().pipe(Effect.mapError(unavailable));
    const binding = bindings.find((entry) => entry.projectId === draft.projectId);
    if (binding === undefined) {
      return yield* new WorkbenchJiraOperationError({
        code: "binding_not_found",
        message:
          "This workspace has no Jira connection. Connect Jira in Workbench workspace settings.",
      });
    }
    if (!binding.active) {
      return yield* new WorkbenchJiraOperationError({
        code: "binding_inactive",
        message:
          "This workspace's Jira connection is inactive. Enable it in Workbench workspace settings.",
      });
    }
    return binding.connectionId;
  });

  return JiraResearchService.of({
    getIssue: Effect.fn("JiraResearchService.getIssue")(function* (input) {
      const checked = yield* decodeReadIssue(input).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "Provide a Jira issue key, for example MA-5496.",
            }),
        ),
      );
      const connectionId = yield* connectionForCaller;
      return yield* api.getIssue({ ...checked, connectionId });
    }),
    searchIssues: Effect.fn("JiraResearchService.searchIssues")(function* (input) {
      const checked = yield* decodeSearchIssues(input).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "Provide JQL up to 2000 characters and a result limit from 1 to 25.",
            }),
        ),
      );
      const connectionId = yield* connectionForCaller;
      return yield* api.searchIssues({ ...checked, connectionId });
    }),
  });
});

export const layer = Layer.effect(JiraResearchService, make);
