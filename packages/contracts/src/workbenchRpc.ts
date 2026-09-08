import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  WorkbenchAssignment,
  WorkbenchArchiveEpicInput,
  WorkbenchArchiveTicketInput,
  WorkbenchCreateAssignmentInput,
  WorkbenchCreateEpicInput,
  WorkbenchCreateProjectInput,
  WorkbenchCreateTicketInput,
  WorkbenchDeleteTicketInput,
  WorkbenchEpic,
  WorkbenchOperationError,
  WorkbenchPrepareTicketWorkspaceInput,
  WorkbenchProject,
  WorkbenchRegenerateTicketSummaryInput,
  WorkbenchReleaseTicketWorkspaceInput,
  WorkbenchReplaceAssignmentInput,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
  WorkbenchUpdateEpicInput,
  WorkbenchUpdateProjectInput,
  WorkbenchUpdateTicketInput,
} from "./workbench.ts";
import {
  WorkbenchJiraBeginAuthInput,
  WorkbenchJiraBeginAuthResult,
  WorkbenchJiraBinding,
  WorkbenchJiraBoard,
  WorkbenchJiraBoardConfiguration,
  WorkbenchJiraCompleteAuthInput,
  WorkbenchJiraCompleteAuthResult,
  WorkbenchJiraCreateBindingInput,
  WorkbenchJiraGetBoardConfigurationInput,
  WorkbenchJiraGetTicketTransitionsInput,
  WorkbenchJiraGetTicketTransitionsResult,
  WorkbenchJiraIssueSnapshot,
  WorkbenchJiraListBoardsInput,
  WorkbenchJiraListProjectsInput,
  WorkbenchJiraListSprintsInput,
  WorkbenchJiraOperationError,
  WorkbenchJiraProject,
  WorkbenchJiraSnapshot,
  WorkbenchJiraSprint,
  WorkbenchJiraSyncBindingInput,
  WorkbenchJiraSyncResult,
  WorkbenchJiraUpdateBindingInput,
  WorkbenchJiraUpdateTicketInput,
} from "./workbenchJira.ts";

export const WORKBENCH_WS_METHODS = {
  // Workbench project-management methods
  workbenchGetSnapshot: "workbench.getSnapshot",
  workbenchCreateProject: "workbench.projects.create",
  workbenchUpdateProject: "workbench.projects.update",
  workbenchCreateEpic: "workbench.epics.create",
  workbenchUpdateEpic: "workbench.epics.update",
  workbenchArchiveEpic: "workbench.epics.archive",
  workbenchCreateTicket: "workbench.tickets.create",
  workbenchUpdateTicket: "workbench.tickets.update",
  workbenchRegenerateTicketSummary: "workbench.tickets.regenerateSummary",
  workbenchArchiveTicket: "workbench.tickets.archive",
  workbenchDeleteTicket: "workbench.tickets.delete",
  workbenchCreateAssignment: "workbench.assignments.create",
  workbenchReplaceAssignment: "workbench.assignments.replace",
  workbenchPrepareTicketWorkspace: "workbench.ticketWorkspaces.prepare",
  workbenchReleaseTicketWorkspace: "workbench.ticketWorkspaces.release",
  workbenchJiraGetSnapshot: "workbench.jira.getSnapshot",
  workbenchJiraBeginAuth: "workbench.jira.auth.begin",
  workbenchJiraCompleteAuth: "workbench.jira.auth.complete",
  workbenchJiraListProjects: "workbench.jira.projects.list",
  workbenchJiraListBoards: "workbench.jira.boards.list",
  workbenchJiraListSprints: "workbench.jira.sprints.list",
  workbenchJiraGetBoardConfiguration: "workbench.jira.boards.getConfiguration",
  workbenchJiraCreateBinding: "workbench.jira.bindings.create",
  workbenchJiraUpdateBinding: "workbench.jira.bindings.update",
  workbenchJiraSyncBinding: "workbench.jira.bindings.sync",
  workbenchJiraUpdateTicket: "workbench.jira.tickets.update",
  workbenchJiraGetTicketTransitions: "workbench.jira.tickets.transitions",
} as const;

const WorkbenchRpcError = Schema.Union([WorkbenchOperationError, EnvironmentAuthorizationError]);

const WsWorkbenchGetSnapshotRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchGetSnapshot, {
  payload: Schema.Struct({}),
  success: WorkbenchSnapshot,
  error: WorkbenchRpcError,
});

const WsWorkbenchCreateProjectRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchCreateProject, {
  payload: WorkbenchCreateProjectInput,
  success: WorkbenchProject,
  error: WorkbenchRpcError,
});

const WsWorkbenchUpdateProjectRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchUpdateProject, {
  payload: WorkbenchUpdateProjectInput,
  success: WorkbenchProject,
  error: WorkbenchRpcError,
});

const WsWorkbenchCreateEpicRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchCreateEpic, {
  payload: WorkbenchCreateEpicInput,
  success: WorkbenchEpic,
  error: WorkbenchRpcError,
});

const WsWorkbenchUpdateEpicRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchUpdateEpic, {
  payload: WorkbenchUpdateEpicInput,
  success: WorkbenchEpic,
  error: WorkbenchRpcError,
});

const WsWorkbenchArchiveEpicRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchArchiveEpic, {
  payload: WorkbenchArchiveEpicInput,
  success: WorkbenchEpic,
  error: WorkbenchRpcError,
});

const WsWorkbenchCreateTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchCreateTicket, {
  payload: WorkbenchCreateTicketInput,
  success: WorkbenchTicket,
  error: WorkbenchRpcError,
});

const WsWorkbenchUpdateTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchUpdateTicket, {
  payload: WorkbenchUpdateTicketInput,
  success: WorkbenchTicket,
  error: WorkbenchRpcError,
});

const WsWorkbenchRegenerateTicketSummaryRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary,
  {
    payload: WorkbenchRegenerateTicketSummaryInput,
    success: WorkbenchTicket,
    error: WorkbenchRpcError,
  },
);

const WsWorkbenchArchiveTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchArchiveTicket, {
  payload: WorkbenchArchiveTicketInput,
  success: WorkbenchTicket,
  error: WorkbenchRpcError,
});

const WsWorkbenchDeleteTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchDeleteTicket, {
  payload: WorkbenchDeleteTicketInput,
  success: Schema.Void,
  error: WorkbenchRpcError,
});

const WsWorkbenchCreateAssignmentRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchCreateAssignment, {
  payload: WorkbenchCreateAssignmentInput,
  success: WorkbenchAssignment,
  error: WorkbenchRpcError,
});

const WsWorkbenchReplaceAssignmentRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchReplaceAssignment, {
  payload: WorkbenchReplaceAssignmentInput,
  success: WorkbenchAssignment,
  error: WorkbenchRpcError,
});

const WsWorkbenchPrepareTicketWorkspaceRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace,
  {
    payload: WorkbenchPrepareTicketWorkspaceInput,
    success: WorkbenchTicketWorkspace,
    error: WorkbenchRpcError,
  },
);

const WsWorkbenchReleaseTicketWorkspaceRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace,
  {
    payload: WorkbenchReleaseTicketWorkspaceInput,
    success: WorkbenchTicketWorkspace,
    error: WorkbenchRpcError,
  },
);

const WorkbenchJiraRpcError = Schema.Union([
  WorkbenchJiraOperationError,
  EnvironmentAuthorizationError,
]);

const WsWorkbenchJiraGetSnapshotRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot, {
  payload: Schema.Struct({}),
  success: WorkbenchJiraSnapshot,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraBeginAuthRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraBeginAuth, {
  payload: WorkbenchJiraBeginAuthInput,
  success: WorkbenchJiraBeginAuthResult,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraCompleteAuthRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraCompleteAuth, {
  payload: WorkbenchJiraCompleteAuthInput,
  success: WorkbenchJiraCompleteAuthResult,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraListProjectsRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraListProjects, {
  payload: WorkbenchJiraListProjectsInput,
  success: Schema.Array(WorkbenchJiraProject),
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraListBoardsRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraListBoards, {
  payload: WorkbenchJiraListBoardsInput,
  success: Schema.Array(WorkbenchJiraBoard),
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraListSprintsRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraListSprints, {
  payload: WorkbenchJiraListSprintsInput,
  success: Schema.Array(WorkbenchJiraSprint),
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraGetBoardConfigurationRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration,
  {
    payload: WorkbenchJiraGetBoardConfigurationInput,
    success: WorkbenchJiraBoardConfiguration,
    error: WorkbenchJiraRpcError,
  },
);

const WsWorkbenchJiraCreateBindingRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraCreateBinding, {
  payload: WorkbenchJiraCreateBindingInput,
  success: WorkbenchJiraBinding,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraUpdateBindingRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding, {
  payload: WorkbenchJiraUpdateBindingInput,
  success: WorkbenchJiraBinding,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraSyncBindingRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraSyncBinding, {
  payload: WorkbenchJiraSyncBindingInput,
  success: WorkbenchJiraSyncResult,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraUpdateTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchJiraUpdateTicket, {
  payload: WorkbenchJiraUpdateTicketInput,
  success: WorkbenchJiraIssueSnapshot,
  error: WorkbenchJiraRpcError,
});

const WsWorkbenchJiraGetTicketTransitionsRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchJiraGetTicketTransitions,
  {
    payload: WorkbenchJiraGetTicketTransitionsInput,
    success: WorkbenchJiraGetTicketTransitionsResult,
    error: WorkbenchJiraRpcError,
  },
);

export const WorkbenchRpcGroup = RpcGroup.make(
  WsWorkbenchGetSnapshotRpc,
  WsWorkbenchCreateProjectRpc,
  WsWorkbenchUpdateProjectRpc,
  WsWorkbenchCreateEpicRpc,
  WsWorkbenchUpdateEpicRpc,
  WsWorkbenchArchiveEpicRpc,
  WsWorkbenchCreateTicketRpc,
  WsWorkbenchUpdateTicketRpc,
  WsWorkbenchRegenerateTicketSummaryRpc,
  WsWorkbenchArchiveTicketRpc,
  WsWorkbenchDeleteTicketRpc,
  WsWorkbenchCreateAssignmentRpc,
  WsWorkbenchReplaceAssignmentRpc,
  WsWorkbenchPrepareTicketWorkspaceRpc,
  WsWorkbenchReleaseTicketWorkspaceRpc,
  WsWorkbenchJiraGetSnapshotRpc,
  WsWorkbenchJiraBeginAuthRpc,
  WsWorkbenchJiraCompleteAuthRpc,
  WsWorkbenchJiraListProjectsRpc,
  WsWorkbenchJiraListBoardsRpc,
  WsWorkbenchJiraListSprintsRpc,
  WsWorkbenchJiraGetBoardConfigurationRpc,
  WsWorkbenchJiraCreateBindingRpc,
  WsWorkbenchJiraUpdateBindingRpc,
  WsWorkbenchJiraSyncBindingRpc,
  WsWorkbenchJiraUpdateTicketRpc,
  WsWorkbenchJiraGetTicketTransitionsRpc,
);
