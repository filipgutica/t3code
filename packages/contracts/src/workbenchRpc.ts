import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  WorkbenchTicketDraft,
  WorkbenchTicketPreparation,
  WorkbenchBeginTicketDraftInput,
  WorkbenchUpdateTicketDraftInput,
  WorkbenchTicketDraftActionInput,
  WorkbenchAssignment,
  WorkbenchArchiveEpicInput,
  WorkbenchArchiveProjectInput,
  WorkbenchDeleteProjectInput,
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
  WorkbenchSetJiraIssueLinkInput,
  WorkbenchSetJiraIssueLinkResult,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketWorkspace,
  WorkbenchUnlinkAssignmentInput,
  WorkbenchUpdateEpicInput,
  WorkbenchUpdateProjectInput,
  WorkbenchUpdateTicketInput,
} from "./workbench.ts";

export const WORKBENCH_WS_METHODS = {
  // Workbench project-management methods
  workbenchBeginTicketDraft: "workbench.ticketDrafts.begin",
  workbenchUpdateTicketDraft: "workbench.ticketDrafts.update",
  workbenchPromoteTicketDraft: "workbench.ticketDrafts.promote",
  workbenchDiscardTicketDraft: "workbench.ticketDrafts.discard",
  workbenchStartTicketDraftWork: "workbench.ticketDrafts.startWork",
  workbenchGetTicketPreparations: "workbench.ticketPreparations.get",
  workbenchGetSnapshot: "workbench.getSnapshot",
  workbenchGetTicket: "workbench.tickets.get",
  workbenchCreateProject: "workbench.projects.create",
  workbenchUpdateProject: "workbench.projects.update",
  workbenchArchiveProject: "workbench.projects.archive",
  workbenchDeleteProject: "workbench.projects.delete",
  workbenchCreateEpic: "workbench.epics.create",
  workbenchUpdateEpic: "workbench.epics.update",
  workbenchArchiveEpic: "workbench.epics.archive",
  workbenchCreateTicket: "workbench.tickets.create",
  workbenchUpdateTicket: "workbench.tickets.update",
  workbenchRegenerateTicketSummary: "workbench.tickets.regenerateSummary",
  workbenchArchiveTicket: "workbench.tickets.archive",
  workbenchDeleteTicket: "workbench.tickets.delete",
  workbenchCreateAssignment: "workbench.assignments.create",
  workbenchUnlinkAssignment: "workbench.assignments.unlink",
  workbenchReplaceAssignment: "workbench.assignments.replace",
  workbenchPrepareTicketWorkspace: "workbench.ticketWorkspaces.prepare",
  workbenchReleaseTicketWorkspace: "workbench.ticketWorkspaces.release",
  workbenchSetJiraIssueLink: "workbench.setJiraIssueLink",
} as const;

const WorkbenchRpcError = Schema.Union([WorkbenchOperationError, EnvironmentAuthorizationError]);

const WsWorkbenchGetTicketPreparationsRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchGetTicketPreparations,
  {
    payload: Schema.Struct({}),
    success: Schema.Array(WorkbenchTicketPreparation),
    error: WorkbenchRpcError,
  },
);

const WsWorkbenchGetTicketRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchGetTicket, {
  payload: Schema.Struct({ ticketId: WorkbenchTicketId }),
  success: Schema.NullOr(WorkbenchTicket),
  error: WorkbenchRpcError,
});

const WsWorkbenchGetSnapshotRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchGetSnapshot, {
  payload: Schema.Struct({ compact: Schema.optionalKey(Schema.Boolean) }),
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

const WsWorkbenchArchiveProjectRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchArchiveProject, {
  payload: WorkbenchArchiveProjectInput,
  success: WorkbenchProject,
  error: WorkbenchRpcError,
});

const WsWorkbenchDeleteProjectRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchDeleteProject, {
  payload: WorkbenchDeleteProjectInput,
  success: Schema.Void,
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

const WsWorkbenchUnlinkAssignmentRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchUnlinkAssignment, {
  payload: WorkbenchUnlinkAssignmentInput,
  success: Schema.Void,
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

const WsWorkbenchSetJiraIssueLinkRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchSetJiraIssueLink, {
  payload: WorkbenchSetJiraIssueLinkInput,
  success: WorkbenchSetJiraIssueLinkResult,
  error: WorkbenchRpcError,
});

const WsWorkbenchBeginTicketDraftRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchBeginTicketDraft, {
  payload: WorkbenchBeginTicketDraftInput,
  success: WorkbenchTicketDraft,
  error: WorkbenchRpcError,
});
const WsWorkbenchUpdateTicketDraftRpc = Rpc.make(WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft, {
  payload: WorkbenchUpdateTicketDraftInput,
  success: WorkbenchTicketDraft,
  error: WorkbenchRpcError,
});
const WsWorkbenchPromoteTicketDraftRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft,
  {
    payload: WorkbenchTicketDraftActionInput,
    success: WorkbenchTicketDraft,
    error: WorkbenchRpcError,
  },
);
const WsWorkbenchDiscardTicketDraftRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft,
  {
    payload: WorkbenchTicketDraftActionInput,
    success: Schema.Void,
    error: WorkbenchRpcError,
  },
);
const WsWorkbenchStartTicketDraftWorkRpc = Rpc.make(
  WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork,
  {
    payload: WorkbenchTicketDraftActionInput,
    success: WorkbenchTicketDraft,
    error: WorkbenchRpcError,
  },
);

export const WorkbenchRpcGroup = RpcGroup.make(
  WsWorkbenchGetTicketPreparationsRpc,
  WsWorkbenchBeginTicketDraftRpc,
  WsWorkbenchUpdateTicketDraftRpc,
  WsWorkbenchPromoteTicketDraftRpc,
  WsWorkbenchDiscardTicketDraftRpc,
  WsWorkbenchStartTicketDraftWorkRpc,
  WsWorkbenchGetSnapshotRpc,
  WsWorkbenchGetTicketRpc,
  WsWorkbenchCreateProjectRpc,
  WsWorkbenchUpdateProjectRpc,
  WsWorkbenchArchiveProjectRpc,
  WsWorkbenchDeleteProjectRpc,
  WsWorkbenchCreateEpicRpc,
  WsWorkbenchUpdateEpicRpc,
  WsWorkbenchArchiveEpicRpc,
  WsWorkbenchCreateTicketRpc,
  WsWorkbenchUpdateTicketRpc,
  WsWorkbenchRegenerateTicketSummaryRpc,
  WsWorkbenchArchiveTicketRpc,
  WsWorkbenchDeleteTicketRpc,
  WsWorkbenchCreateAssignmentRpc,
  WsWorkbenchUnlinkAssignmentRpc,
  WsWorkbenchReplaceAssignmentRpc,
  WsWorkbenchPrepareTicketWorkspaceRpc,
  WsWorkbenchReleaseTicketWorkspaceRpc,
  WsWorkbenchSetJiraIssueLinkRpc,
);
