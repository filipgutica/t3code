import { WORKBENCH_WS_METHODS, WorkbenchRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as RpcGroup from "effect/rpc/RpcGroup";

import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";

type WorkbenchRpcHandlers = RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WorkbenchRpcGroup>>;

export type WorkbenchRpcServices = {
  readonly workbench: WorkbenchStore.WorkbenchStore["Service"];
  readonly ticketWorkspaces: TicketWorkspaceService.TicketWorkspaceService["Service"];
  readonly workbenchJira: WorkbenchJiraService.WorkbenchJiraService["Service"];
  readonly ticketSummaries: TicketSummaryService.TicketSummaryService["Service"];
};

export const acquireWorkbenchRpcServices = Effect.gen(function* () {
  const workbench = yield* WorkbenchStore.WorkbenchStore;
  const ticketWorkspaces = yield* TicketWorkspaceService.TicketWorkspaceService;
  const workbenchJira = yield* WorkbenchJiraService.WorkbenchJiraService;
  const ticketSummaries = yield* TicketSummaryService.TicketSummaryService;

  return {
    workbench,
    ticketWorkspaces,
    workbenchJira,
    ticketSummaries,
  } satisfies WorkbenchRpcServices;
});

export const makeWorkbenchRpcHandlers = ({
  workbench,
  ticketWorkspaces,
  workbenchJira,
  ticketSummaries,
}: WorkbenchRpcServices) =>
  ({
    [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: (_input) => workbench.getSnapshot,
    [WORKBENCH_WS_METHODS.workbenchCreateProject]: (input) => workbench.createProject(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateProject]: (input) => workbench.updateProject(input),
    [WORKBENCH_WS_METHODS.workbenchCreateEpic]: (input) => workbench.createEpic(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateEpic]: (input) => workbench.updateEpic(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveEpic]: (input) => workbench.archiveEpic(input),
    [WORKBENCH_WS_METHODS.workbenchCreateTicket]: (input) => workbenchJira.createTicket(input),
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
    [WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]: (_input) => workbenchJira.getSnapshot,
    [WORKBENCH_WS_METHODS.workbenchJiraBeginAuth]: (input) => workbenchJira.beginAuth(input),
    [WORKBENCH_WS_METHODS.workbenchJiraCompleteAuth]: (input) => workbenchJira.completeAuth(input),
    [WORKBENCH_WS_METHODS.workbenchJiraClaimAuth]: (input) => workbenchJira.claimAuth(input),
    [WORKBENCH_WS_METHODS.workbenchJiraListProjects]: (input) => workbenchJira.listProjects(input),
    [WORKBENCH_WS_METHODS.workbenchJiraListBoards]: (input) => workbenchJira.listBoards(input),
    [WORKBENCH_WS_METHODS.workbenchJiraListSprints]: (input) => workbenchJira.listSprints(input),
    [WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration]: (input) =>
      workbenchJira.getBoardConfiguration(input),
    [WORKBENCH_WS_METHODS.workbenchJiraCreateBinding]: (input) =>
      workbenchJira.createBinding(input),
    [WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding]: (input) =>
      workbenchJira.updateBinding(input),
    [WORKBENCH_WS_METHODS.workbenchJiraSyncBinding]: (input) => workbenchJira.syncBinding(input),
    [WORKBENCH_WS_METHODS.workbenchJiraUpdateTicket]: (input) => workbenchJira.updateTicket(input),
    [WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions]: (input) =>
      workbenchJira.getTicketTransitions(input),
    [WORKBENCH_WS_METHODS.workbenchJiraMigrateLocalTickets]: (input) =>
      workbenchJira.migrateLocalTickets(input),
  }) satisfies WorkbenchRpcHandlers;
