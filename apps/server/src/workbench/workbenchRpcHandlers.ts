import {
  WORKBENCH_JIRA_ISSUE_URL_ERROR,
  WORKBENCH_WS_METHODS,
  WorkbenchOperationError,
  WorkbenchRpcGroup,
  parseJiraIssueUrl,
  type WorkbenchSetJiraIssueLinkInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as RpcGroup from "effect/rpc/RpcGroup";

import * as TicketDraftService from "./TicketDraftService.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";

type WorkbenchRpcHandlers = RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WorkbenchRpcGroup>>;

export type WorkbenchRpcServices = {
  readonly ticketDrafts: TicketDraftService.TicketDraftService["Service"];
  readonly workbench: WorkbenchStore.WorkbenchStore["Service"];
  readonly ticketWorkspaces: TicketWorkspaceService.TicketWorkspaceService["Service"];
  readonly ticketSummaries: TicketSummaryService.TicketSummaryService["Service"];
  readonly workspaceLifecycle: WorkspaceLifecycleService.WorkspaceLifecycleService["Service"];
};

export const acquireWorkbenchRpcServices = Effect.gen(function* () {
  const ticketDrafts = yield* TicketDraftService.TicketDraftService;
  const workbench = yield* WorkbenchStore.WorkbenchStore;
  const ticketWorkspaces = yield* TicketWorkspaceService.TicketWorkspaceService;
  const ticketSummaries = yield* TicketSummaryService.TicketSummaryService;
  const workspaceLifecycle = yield* WorkspaceLifecycleService.WorkspaceLifecycleService;

  return {
    ticketDrafts,
    workbench,
    ticketWorkspaces,
    ticketSummaries,
    workspaceLifecycle,
  } satisfies WorkbenchRpcServices;
});

const decodeJiraIssue = (url: string | null) => {
  if (url === null) return Effect.succeed(null);
  const issue = parseJiraIssueUrl(url);
  return issue === null
    ? Effect.fail(
        new WorkbenchOperationError({
          code: "jira_issue_url_invalid",
          message: WORKBENCH_JIRA_ISSUE_URL_ERROR,
        }),
      )
    : Effect.succeed(issue);
};

// Untraced: RPC instrumentation already spans every Workbench call, and the store spans the write.
const setEpicJiraIssueLink = Effect.fnUntraced(function* (
  workbench: WorkbenchStore.WorkbenchStore["Service"],
  input: WorkbenchSetJiraIssueLinkInput,
) {
  return yield* workbench.setEpicJiraIssueLink({
    epicId: input.epicId,
    jiraIssue: yield* decodeJiraIssue(input.url),
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
});

export const makeWorkbenchRpcHandlers = ({
  ticketDrafts,
  workbench,
  ticketWorkspaces,
  ticketSummaries,
  workspaceLifecycle,
}: WorkbenchRpcServices) =>
  ({
    [WORKBENCH_WS_METHODS.workbenchBeginTicketDraft]: (input) => ticketDrafts.begin(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft]: (input) => ticketDrafts.update(input),
    [WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft]: (input) => ticketDrafts.promote(input),
    [WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft]: (input) => ticketDrafts.discard(input),
    [WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork]: (input) => ticketDrafts.startWork(input),
    [WORKBENCH_WS_METHODS.workbenchGetTicketPreparations]: (_input) =>
      workbench.getTicketPreparations,
    [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: (input) =>
      input.compact ? workbench.getCompactSnapshot : workbench.getSnapshot,
    [WORKBENCH_WS_METHODS.workbenchGetTicket]: (input) =>
      workbench.getTicket(input.ticketId).pipe(Effect.map(Option.getOrNull)),
    [WORKBENCH_WS_METHODS.workbenchCreateProject]: (input) => workbench.createProject(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateProject]: (input) => workbench.updateProject(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveProject]: (input) => workspaceLifecycle.archive(input),
    [WORKBENCH_WS_METHODS.workbenchDeleteProject]: (input) => workspaceLifecycle.delete(input),
    [WORKBENCH_WS_METHODS.workbenchCreateEpic]: (input) => workbench.createEpic(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateEpic]: (input) => workbench.updateEpic(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveEpic]: (input) => workbench.archiveEpic(input),
    [WORKBENCH_WS_METHODS.workbenchCreateTicket]: (input) => workbench.createTicket(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateTicket]: (input) => workbench.updateTicket(input),
    [WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary]: (input) =>
      ticketSummaries.regenerate(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveTicket]: (input) => workbench.archiveTicket(input),
    [WORKBENCH_WS_METHODS.workbenchDeleteTicket]: (input) => workbench.deleteTicket(input),
    [WORKBENCH_WS_METHODS.workbenchCreateAssignment]: (input) => workbench.createAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchUnlinkAssignment]: (input) => workbench.unlinkAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchReplaceAssignment]: (input) =>
      workbench.replaceAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace]: (input) =>
      ticketWorkspaces.prepare(input),
    [WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace]: (input) =>
      ticketWorkspaces.release(input),
    [WORKBENCH_WS_METHODS.workbenchSetJiraIssueLink]: (input) =>
      setEpicJiraIssueLink(workbench, input),
    [WORKBENCH_WS_METHODS.workbenchAddReference]: (input) =>
      workbench.addReference({ ...input, addedByThreadId: null }),
    [WORKBENCH_WS_METHODS.workbenchRemoveReference]: (input) => workbench.removeReference(input),
  }) satisfies WorkbenchRpcHandlers;
