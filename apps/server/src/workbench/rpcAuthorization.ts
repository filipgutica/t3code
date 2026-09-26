import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  WORKBENCH_WS_METHODS,
  WorkbenchRpcGroup,
} from "@t3tools/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

type WorkbenchRpcMethod = RpcGroup.Rpcs<typeof WorkbenchRpcGroup>["_tag"];

/** Workbench permission policy, composed into the complete server RPC map. */
export const WORKBENCH_RPC_REQUIRED_SCOPES = {
  [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: AuthOrchestrationReadScope,
  [WORKBENCH_WS_METHODS.workbenchCreateProject]: AuthOrchestrationOperateScope,
  [WORKBENCH_WS_METHODS.workbenchUpdateProject]: AuthOrchestrationOperateScope,
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
} satisfies Record<WorkbenchRpcMethod, AuthEnvironmentScope>;
