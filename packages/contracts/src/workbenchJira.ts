import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { WorkbenchProjectId, WorkbenchTicketId, WorkbenchTicketStatus } from "./workbench.ts";

const makeJiraId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const WorkbenchJiraConnectionId = makeJiraId("WorkbenchJiraConnectionId");
export type WorkbenchJiraConnectionId = typeof WorkbenchJiraConnectionId.Type;

export const WorkbenchJiraBindingId = makeJiraId("WorkbenchJiraBindingId");
export type WorkbenchJiraBindingId = typeof WorkbenchJiraBindingId.Type;

export const WorkbenchJiraSite = Schema.Struct({
  cloudId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
  scopes: Schema.Array(TrimmedNonEmptyString),
});
export type WorkbenchJiraSite = typeof WorkbenchJiraSite.Type;

export const WorkbenchJiraConnection = Schema.Struct({
  id: WorkbenchJiraConnectionId,
  cloudId: WorkbenchJiraSite.fields.cloudId,
  siteName: WorkbenchJiraSite.fields.name,
  siteUrl: WorkbenchJiraSite.fields.url,
  avatarUrl: WorkbenchJiraSite.fields.avatarUrl,
  scopes: WorkbenchJiraSite.fields.scopes,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchJiraConnection = typeof WorkbenchJiraConnection.Type;

export const WorkbenchJiraProject = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  projectTypeKey: Schema.NullOr(TrimmedNonEmptyString),
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkbenchJiraProject = typeof WorkbenchJiraProject.Type;

export const WorkbenchJiraBoardType = Schema.Literals(["scrum", "kanban", "simple"]);
export type WorkbenchJiraBoardType = typeof WorkbenchJiraBoardType.Type;

export const WorkbenchJiraBoard = Schema.Struct({
  id: PositiveInt,
  name: TrimmedNonEmptyString,
  type: WorkbenchJiraBoardType,
  projectKeyOrId: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkbenchJiraBoard = typeof WorkbenchJiraBoard.Type;

export const WorkbenchJiraSprintState = Schema.Literals(["future", "active", "closed"]);
export type WorkbenchJiraSprintState = typeof WorkbenchJiraSprintState.Type;

export const WorkbenchJiraSprint = Schema.Struct({
  id: PositiveInt,
  name: TrimmedNonEmptyString,
  state: WorkbenchJiraSprintState,
  goal: TrimmedString,
  startDate: Schema.NullOr(IsoDateTime),
  endDate: Schema.NullOr(IsoDateTime),
  completeDate: Schema.NullOr(IsoDateTime),
});
export type WorkbenchJiraSprint = typeof WorkbenchJiraSprint.Type;

export const WorkbenchJiraBoardColumn = Schema.Struct({
  name: TrimmedNonEmptyString,
  statusIds: Schema.Array(TrimmedNonEmptyString),
  done: Schema.Boolean,
});
export type WorkbenchJiraBoardColumn = typeof WorkbenchJiraBoardColumn.Type;

export const WorkbenchJiraBoardConfiguration = Schema.Struct({
  boardId: PositiveInt,
  name: TrimmedNonEmptyString,
  type: WorkbenchJiraBoardType,
  columns: Schema.Array(WorkbenchJiraBoardColumn),
  rankFieldId: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkbenchJiraBoardConfiguration = typeof WorkbenchJiraBoardConfiguration.Type;

export const WorkbenchJiraBoardMode = Schema.Literals(["mapped", "mirror_jira"]);
export type WorkbenchJiraBoardMode = typeof WorkbenchJiraBoardMode.Type;

export const WorkbenchJiraStatusMapping = Schema.Struct({
  jiraStatusId: TrimmedNonEmptyString,
  workbenchStatus: WorkbenchTicketStatus,
});
export type WorkbenchJiraStatusMapping = typeof WorkbenchJiraStatusMapping.Type;

export const WorkbenchJiraSelectedSprint = Schema.Struct({
  id: PositiveInt,
  name: TrimmedNonEmptyString,
});
export type WorkbenchJiraSelectedSprint = typeof WorkbenchJiraSelectedSprint.Type;

export const WorkbenchJiraBinding = Schema.Struct({
  id: WorkbenchJiraBindingId,
  projectId: WorkbenchProjectId,
  connectionId: WorkbenchJiraConnectionId,
  jiraProjectId: WorkbenchJiraProject.fields.id,
  jiraProjectKey: WorkbenchJiraProject.fields.key,
  jiraProjectName: WorkbenchJiraProject.fields.name,
  boardId: WorkbenchJiraBoard.fields.id,
  boardName: WorkbenchJiraBoard.fields.name,
  sprintId: WorkbenchJiraSprint.fields.id,
  sprintName: WorkbenchJiraSprint.fields.name,
  defaultPrimaryT3ProjectId: ProjectId,
  defaultRepositoryProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  statusMappings: Schema.Array(WorkbenchJiraStatusMapping),
  followActiveSprint: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  selectedSprints: Schema.Array(WorkbenchJiraSelectedSprint).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  observedActiveSprintIds: Schema.Array(PositiveInt).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  boardMode: WorkbenchJiraBoardMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("mapped" as const)),
  ),
  boardColumns: Schema.Array(WorkbenchJiraBoardColumn).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  active: Schema.Boolean,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  lastSyncError: Schema.NullOr(TrimmedString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchJiraBinding = typeof WorkbenchJiraBinding.Type;

export const WorkbenchJiraCreateBindingInput = Schema.Struct({
  id: WorkbenchJiraBindingId,
  projectId: WorkbenchProjectId,
  connectionId: WorkbenchJiraConnectionId,
  jiraProjectId: WorkbenchJiraProject.fields.id,
  jiraProjectKey: WorkbenchJiraProject.fields.key,
  jiraProjectName: WorkbenchJiraProject.fields.name,
  boardId: WorkbenchJiraBoard.fields.id,
  boardName: WorkbenchJiraBoard.fields.name,
  sprintId: WorkbenchJiraSprint.fields.id,
  sprintName: WorkbenchJiraSprint.fields.name,
  defaultPrimaryT3ProjectId: ProjectId,
  defaultRepositoryProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  statusMappings: Schema.Array(WorkbenchJiraStatusMapping),
  followActiveSprint: Schema.optionalKey(Schema.Boolean),
  selectedSprints: Schema.optionalKey(Schema.Array(WorkbenchJiraSelectedSprint)),
  boardMode: Schema.optionalKey(WorkbenchJiraBoardMode),
  createdAt: IsoDateTime,
});
export type WorkbenchJiraCreateBindingInput = typeof WorkbenchJiraCreateBindingInput.Type;

export const WorkbenchJiraUpdateBindingInput = Schema.Struct({
  id: WorkbenchJiraBindingId,
  sprintId: WorkbenchJiraSprint.fields.id,
  sprintName: WorkbenchJiraSprint.fields.name,
  defaultPrimaryT3ProjectId: ProjectId,
  defaultRepositoryProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  statusMappings: Schema.Array(WorkbenchJiraStatusMapping),
  followActiveSprint: Schema.optionalKey(Schema.Boolean),
  selectedSprints: Schema.optionalKey(Schema.Array(WorkbenchJiraSelectedSprint)),
  boardMode: Schema.optionalKey(WorkbenchJiraBoardMode),
  active: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type WorkbenchJiraUpdateBindingInput = typeof WorkbenchJiraUpdateBindingInput.Type;

export const WorkbenchJiraIssueType = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type WorkbenchJiraIssueType = typeof WorkbenchJiraIssueType.Type;

export const WorkbenchJiraIssueStatus = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type WorkbenchJiraIssueStatus = typeof WorkbenchJiraIssueStatus.Type;

export const WorkbenchJiraEpicReference = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
});
export type WorkbenchJiraEpicReference = typeof WorkbenchJiraEpicReference.Type;

/** Jira-owned fields captured by a manual sprint refresh. */
export const WorkbenchJiraIssueSnapshot = Schema.Struct({
  issueId: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  issueType: WorkbenchJiraIssueType,
  status: WorkbenchJiraIssueStatus,
  epic: Schema.NullOr(WorkbenchJiraEpicReference),
  flagged: Schema.Boolean,
  rank: Schema.Int,
  remoteUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type WorkbenchJiraIssueSnapshot = typeof WorkbenchJiraIssueSnapshot.Type;

/**
 * The link contains Jira synchronization state, including the shared description.
 * Repository scope, Assignments, and native Threads remain locally owned.
 */
export const WorkbenchJiraIssueLink = Schema.Struct({
  bindingId: WorkbenchJiraBindingId,
  ticketId: WorkbenchTicketId,
  issue: WorkbenchJiraIssueSnapshot,
  active: Schema.Boolean,
  linkedAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type WorkbenchJiraIssueLink = typeof WorkbenchJiraIssueLink.Type;

export const WorkbenchJiraTicketTransition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  to: Schema.Struct({ id: TrimmedNonEmptyString, name: TrimmedNonEmptyString }),
  unavailableReason: Schema.NullOr(Schema.String),
});
export type WorkbenchJiraTicketTransition = typeof WorkbenchJiraTicketTransition.Type;

export const WorkbenchJiraGetTicketTransitionsInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
});
export type WorkbenchJiraGetTicketTransitionsInput =
  typeof WorkbenchJiraGetTicketTransitionsInput.Type;

export const WorkbenchJiraGetTicketTransitionsResult = Schema.Struct({
  transitions: Schema.Array(WorkbenchJiraTicketTransition),
  remoteUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type WorkbenchJiraGetTicketTransitionsResult =
  typeof WorkbenchJiraGetTicketTransitionsResult.Type;

export const WorkbenchJiraUpdateTicketInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  markdown: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(120_000))),
  status: Schema.optionalKey(WorkbenchTicketStatus),
  transitionId: Schema.optionalKey(TrimmedNonEmptyString),
  expectedRemoteUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type WorkbenchJiraUpdateTicketInput = typeof WorkbenchJiraUpdateTicketInput.Type;

export const WorkbenchJiraBeginAuthInput = Schema.Struct({
  redirectUri: TrimmedNonEmptyString,
});
export type WorkbenchJiraBeginAuthInput = typeof WorkbenchJiraBeginAuthInput.Type;

export const WorkbenchJiraBeginAuthResult = Schema.Struct({
  authorizationUrl: TrimmedNonEmptyString,
  state: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  /** Broker authorizations complete out of band and are claimed by polling. */
  mode: Schema.optionalKey(Schema.Literals(["direct", "broker"])),
});
export type WorkbenchJiraBeginAuthResult = typeof WorkbenchJiraBeginAuthResult.Type;

export const WorkbenchJiraCompleteAuthInput = Schema.Struct({
  code: TrimmedNonEmptyString,
  state: TrimmedNonEmptyString,
  redirectUri: TrimmedNonEmptyString,
});
export type WorkbenchJiraCompleteAuthInput = typeof WorkbenchJiraCompleteAuthInput.Type;

export const WorkbenchJiraCompleteAuthResult = Schema.Struct({
  connections: Schema.Array(WorkbenchJiraConnection).check(Schema.isMinLength(1)),
});
export type WorkbenchJiraCompleteAuthResult = typeof WorkbenchJiraCompleteAuthResult.Type;

export const WorkbenchJiraClaimAuthInput = Schema.Struct({
  state: TrimmedNonEmptyString,
});
export type WorkbenchJiraClaimAuthInput = typeof WorkbenchJiraClaimAuthInput.Type;

export const WorkbenchJiraClaimAuthResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({
    status: Schema.Literal("complete"),
    connections: Schema.Array(WorkbenchJiraConnection).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    error: TrimmedNonEmptyString,
  }),
]);
export type WorkbenchJiraClaimAuthResult = typeof WorkbenchJiraClaimAuthResult.Type;

export const WorkbenchJiraListBoardsInput = Schema.Struct({
  connectionId: WorkbenchJiraConnectionId,
  projectKeyOrId: TrimmedNonEmptyString,
});
export type WorkbenchJiraListBoardsInput = typeof WorkbenchJiraListBoardsInput.Type;

export const WorkbenchJiraListProjectsInput = Schema.Struct({
  connectionId: WorkbenchJiraConnectionId,
});
export type WorkbenchJiraListProjectsInput = typeof WorkbenchJiraListProjectsInput.Type;

export const WorkbenchJiraListSprintsInput = Schema.Struct({
  connectionId: WorkbenchJiraConnectionId,
  boardId: PositiveInt,
});
export type WorkbenchJiraListSprintsInput = typeof WorkbenchJiraListSprintsInput.Type;

export const WorkbenchJiraGetBoardConfigurationInput = Schema.Struct({
  connectionId: WorkbenchJiraConnectionId,
  boardId: PositiveInt,
});
export type WorkbenchJiraGetBoardConfigurationInput =
  typeof WorkbenchJiraGetBoardConfigurationInput.Type;

export const WorkbenchJiraListAssignedSprintIssuesInput = Schema.Struct({
  connectionId: WorkbenchJiraConnectionId,
  boardId: PositiveInt,
  sprintId: PositiveInt,
});
export type WorkbenchJiraListAssignedSprintIssuesInput =
  typeof WorkbenchJiraListAssignedSprintIssuesInput.Type;

export const WorkbenchJiraSyncBindingInput = Schema.Struct({
  bindingId: WorkbenchJiraBindingId,
});
export type WorkbenchJiraSyncBindingInput = typeof WorkbenchJiraSyncBindingInput.Type;

export const WorkbenchJiraSyncResult = Schema.Struct({
  bindingId: WorkbenchJiraBindingId,
  syncedAt: IsoDateTime,
  activated: Schema.Int,
  updated: Schema.Int,
  deactivated: Schema.Int,
  links: Schema.Array(WorkbenchJiraIssueLink),
});
export type WorkbenchJiraSyncResult = typeof WorkbenchJiraSyncResult.Type;

export const WorkbenchJiraSnapshot = Schema.Struct({
  connections: Schema.Array(WorkbenchJiraConnection),
  bindings: Schema.Array(WorkbenchJiraBinding),
  issueLinks: Schema.Array(WorkbenchJiraIssueLink),
});
export type WorkbenchJiraSnapshot = typeof WorkbenchJiraSnapshot.Type;

export const WorkbenchJiraOperationErrorCode = Schema.Literals([
  "not_configured",
  "invalid_oauth_state",
  "oauth_state_expired",
  "oauth_exchange_failed",
  "authorization_failed",
  "connection_not_found",
  "binding_not_found",
  "binding_inactive",
  "invalid_binding",
  "status_unmapped",
  "credential_missing",
  "request_failed",
  "response_invalid",
  "persistence_failed",
]);
export type WorkbenchJiraOperationErrorCode = typeof WorkbenchJiraOperationErrorCode.Type;

export class WorkbenchJiraOperationError extends Schema.TaggedError<WorkbenchJiraOperationError>()(
  "WorkbenchJiraOperationError",
  {
    code: WorkbenchJiraOperationErrorCode,
    message: TrimmedNonEmptyString,
  },
) {}
