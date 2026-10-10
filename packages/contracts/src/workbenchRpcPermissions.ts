import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import { WORKBENCH_WS_METHODS, WorkbenchRpcGroup } from "./workbenchRpc.ts";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type WorkbenchRpcMethod = RpcGroup.Rpcs<typeof WorkbenchRpcGroup>["_tag"];

/** Existing Workbench policy shared by server enforcement and client mutation guards. */
export const WORKBENCH_RPC_REQUIRED_SCOPES = {
  [WORKBENCH_WS_METHODS.workbenchBeginTicketDraft]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchGetTicketPreparations]: AuthOrchestrationReadScope,
  [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: AuthOrchestrationReadScope,
  [WORKBENCH_WS_METHODS.workbenchCreateProject]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUpdateProject]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchArchiveProject]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchDeleteProject]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchCreateEpic]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUpdateEpic]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchArchiveEpic]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchCreateTicket]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUpdateTicket]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchArchiveTicket]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchDeleteTicket]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchCreateAssignment]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUnlinkAssignment]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchReplaceAssignment]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]: AuthOrchestrationReadScope,
  [WORKBENCH_WS_METHODS.workbenchJiraBeginAuth]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraCompleteAuth]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraClaimAuth]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraListProjects]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraListBoards]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraListSprints]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraCreateBinding]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraSyncBinding]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraUpdateTicket]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions]: AuthOrchestrationReadScope,
  [WORKBENCH_WS_METHODS.workbenchJiraMigrateLocalTickets]: AuthOrchestrationOperateScope,
} as const satisfies Record<WorkbenchRpcMethod, AuthEnvironmentScope>;

const {
  [WORKBENCH_WS_METHODS.workbenchGetTicketPreparations]: _preparations,
  [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: _snapshot,
  [WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]: _jiraSnapshot,
  [WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions]: _transitions,
  ...mutationScopes
} = WORKBENCH_RPC_REQUIRED_SCOPES;

export const WORKBENCH_CLIENT_GUARDED_RPC_SCOPES = mutationScopes;
