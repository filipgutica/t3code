import {
  EnvironmentAuthorizationError,
  WORKBENCH_WS_METHODS,
  WorkbenchRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";

type ObserveRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

type WorkbenchRpcHandlers = RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WorkbenchRpcGroup>>;

export const makeWorkbenchRpcHandlers = ({
  observeRpcEffect,
  workbench,
  ticketWorkspaces,
  workbenchJira,
  ticketSummaries,
}: {
  readonly observeRpcEffect: ObserveRpcEffect;
  readonly workbench: WorkbenchStore.WorkbenchStore["Service"];
  readonly ticketWorkspaces: TicketWorkspaceService.TicketWorkspaceService["Service"];
  readonly workbenchJira: WorkbenchJiraService.WorkbenchJiraService["Service"];
  readonly ticketSummaries: TicketSummaryService.TicketSummaryService["Service"];
}) =>
  ({
    [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: (_input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchGetSnapshot, workbench.getSnapshot, {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchCreateProject]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchCreateProject,
        workbench.createProject(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchUpdateProject]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchUpdateProject,
        workbench.updateProject(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchCreateEpic]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchCreateEpic, workbench.createEpic(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchUpdateEpic]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchUpdateEpic, workbench.updateEpic(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchArchiveEpic]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchArchiveEpic, workbench.archiveEpic(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchCreateTicket]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchCreateTicket, workbench.createTicket(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchUpdateTicket]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchUpdateTicket, workbench.updateTicket(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary,
        ticketSummaries.regenerate(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchArchiveTicket]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchArchiveTicket,
        workbench.archiveTicket(input),
        {
          "rpc.aggregate": "workbench",
        },
      ),
    [WORKBENCH_WS_METHODS.workbenchDeleteTicket]: (input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchDeleteTicket, workbench.deleteTicket(input), {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchCreateAssignment]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchCreateAssignment,
        workbench.createAssignment(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchReplaceAssignment]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchReplaceAssignment,
        workbench.replaceAssignment(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace,
        ticketWorkspaces.prepare(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace,
        ticketWorkspaces.release(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]: (_input) =>
      observeRpcEffect(WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot, workbenchJira.getSnapshot, {
        "rpc.aggregate": "workbench",
      }),
    [WORKBENCH_WS_METHODS.workbenchJiraBeginAuth]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraBeginAuth,
        workbenchJira.beginAuth(input),
        {
          "rpc.aggregate": "workbench",
        },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraCompleteAuth]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraCompleteAuth,
        workbenchJira.completeAuth(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraClaimAuth]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraClaimAuth,
        workbenchJira.claimAuth(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraListProjects]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraListProjects,
        workbenchJira.listProjects(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraListBoards]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraListBoards,
        workbenchJira.listBoards(input),
        {
          "rpc.aggregate": "workbench",
        },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraListSprints]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraListSprints,
        workbenchJira.listSprints(input),
        {
          "rpc.aggregate": "workbench",
        },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration,
        workbenchJira.getBoardConfiguration(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraCreateBinding]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraCreateBinding,
        workbenchJira.createBinding(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding,
        workbenchJira.updateBinding(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraSyncBinding]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraSyncBinding,
        workbenchJira.syncBinding(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraUpdateTicket]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraUpdateTicket,
        workbenchJira.updateTicket(input),
        { "rpc.aggregate": "workbench" },
      ),
    [WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions]: (input) =>
      observeRpcEffect(
        WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions,
        workbenchJira.getTicketTransitions(input),
        { "rpc.aggregate": "workbench" },
      ),
  }) satisfies WorkbenchRpcHandlers;
