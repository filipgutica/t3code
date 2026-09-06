import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

const makeWorkbenchId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const WorkbenchProjectId = makeWorkbenchId("WorkbenchProjectId");
export type WorkbenchProjectId = typeof WorkbenchProjectId.Type;

export const WorkbenchTicketId = makeWorkbenchId("WorkbenchTicketId");
export type WorkbenchTicketId = typeof WorkbenchTicketId.Type;

export const WorkbenchEpicId = makeWorkbenchId("WorkbenchEpicId");
export type WorkbenchEpicId = typeof WorkbenchEpicId.Type;

export const WorkbenchAssignmentId = makeWorkbenchId("WorkbenchAssignmentId");
export type WorkbenchAssignmentId = typeof WorkbenchAssignmentId.Type;

export const WorkbenchTicketWorkspaceAttemptId = makeWorkbenchId(
  "WorkbenchTicketWorkspaceAttemptId",
);
export type WorkbenchTicketWorkspaceAttemptId = typeof WorkbenchTicketWorkspaceAttemptId.Type;

export const WorkbenchTicketKind = Schema.Literals(["story", "bug"]);
export type WorkbenchTicketKind = typeof WorkbenchTicketKind.Type;

export const WorkbenchTicketStatus = Schema.Literals(["todo", "in_progress", "done"]);
export type WorkbenchTicketStatus = typeof WorkbenchTicketStatus.Type;

export const WorkbenchTicketWorkspaceStatus = Schema.Literals([
  "preparing",
  "ready",
  "releasing",
  "failed",
  "released",
]);
export type WorkbenchTicketWorkspaceStatus = typeof WorkbenchTicketWorkspaceStatus.Type;

export const WorkbenchTicketWorkspaceRepositoryStatus = Schema.Literals([
  "pending",
  "ready",
  "failed",
  "released",
]);
export type WorkbenchTicketWorkspaceRepositoryStatus =
  typeof WorkbenchTicketWorkspaceRepositoryStatus.Type;

export const WorkbenchProject = Schema.Struct({
  id: WorkbenchProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  linkedProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchProject = typeof WorkbenchProject.Type;

export const WorkbenchEpic = Schema.Struct({
  id: WorkbenchEpicId,
  projectId: WorkbenchProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  markdown: TrimmedString.check(Schema.isMaxLength(120_000)),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchEpic = typeof WorkbenchEpic.Type;

export const WorkbenchTicket = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  epicId: Schema.NullOr(WorkbenchEpicId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  kind: WorkbenchTicketKind.pipe(Schema.withDecodingDefault(Effect.succeed("story" as const))),
  markdown: TrimmedString.check(Schema.isMaxLength(120_000)),
  primaryT3ProjectId: ProjectId,
  repositoryProjectIds: Schema.Array(ProjectId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  status: WorkbenchTicketStatus,
  blocked: Schema.Boolean,
  // Optional for compatibility with snapshots produced before Ticket
  // archiving was introduced. New snapshots always include null or a time.
  archivedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicket = typeof WorkbenchTicket.Type;

export const WorkbenchAssignment = Schema.Struct({
  id: WorkbenchAssignmentId,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  supersededAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type WorkbenchAssignment = typeof WorkbenchAssignment.Type;

const WorkbenchTicketWorkspaceErrorMessage = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));

export const WorkbenchTicketWorkspaceRepository = Schema.Struct({
  projectId: ProjectId,
  isPrimary: Schema.Boolean,
  sourcePath: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  status: WorkbenchTicketWorkspaceRepositoryStatus,
  errorMessage: Schema.NullOr(WorkbenchTicketWorkspaceErrorMessage),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicketWorkspaceRepository = typeof WorkbenchTicketWorkspaceRepository.Type;

export const WorkbenchTicketWorkspace = Schema.Struct({
  ticketId: WorkbenchTicketId,
  attemptId: WorkbenchTicketWorkspaceAttemptId,
  status: WorkbenchTicketWorkspaceStatus,
  branchName: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  errorMessage: Schema.NullOr(WorkbenchTicketWorkspaceErrorMessage),
  repositories: Schema.Array(WorkbenchTicketWorkspaceRepository).check(Schema.isMinLength(1)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicketWorkspace = typeof WorkbenchTicketWorkspace.Type;

export const WorkbenchSnapshot = Schema.Struct({
  projects: Schema.Array(WorkbenchProject),
  epics: Schema.Array(WorkbenchEpic).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  tickets: Schema.Array(WorkbenchTicket),
  assignments: Schema.Array(WorkbenchAssignment),
  ticketWorkspaces: Schema.Array(WorkbenchTicketWorkspace).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type WorkbenchSnapshot = typeof WorkbenchSnapshot.Type;

export const WorkbenchCreateProjectInput = Schema.Struct({
  id: WorkbenchProjectId,
  title: WorkbenchProject.fields.title,
  linkedProjectIds: WorkbenchProject.fields.linkedProjectIds,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateProjectInput = typeof WorkbenchCreateProjectInput.Type;

export const WorkbenchUpdateProjectInput = Schema.Struct({
  id: WorkbenchProjectId,
  title: WorkbenchProject.fields.title,
  // The server treats this as an additive set. Existing links remain intact;
  // callers may send either the new IDs or the full selected list.
  linkedProjectIds: WorkbenchProject.fields.linkedProjectIds,
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateProjectInput = typeof WorkbenchUpdateProjectInput.Type;

export const WorkbenchCreateEpicInput = Schema.Struct({
  id: WorkbenchEpicId,
  projectId: WorkbenchProjectId,
  title: WorkbenchEpic.fields.title,
  markdown: WorkbenchEpic.fields.markdown,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateEpicInput = typeof WorkbenchCreateEpicInput.Type;

export const WorkbenchUpdateEpicInput = Schema.Struct({
  id: WorkbenchEpicId,
  title: WorkbenchEpic.fields.title,
  markdown: WorkbenchEpic.fields.markdown,
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateEpicInput = typeof WorkbenchUpdateEpicInput.Type;

export const WorkbenchArchiveEpicInput = Schema.Struct({
  id: WorkbenchEpicId,
  archivedAt: IsoDateTime,
});
export type WorkbenchArchiveEpicInput = typeof WorkbenchArchiveEpicInput.Type;

export const WorkbenchCreateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  epicId: Schema.optionalKey(Schema.NullOr(WorkbenchEpicId)),
  title: WorkbenchTicket.fields.title,
  kind: WorkbenchTicketKind.pipe(Schema.withDecodingDefault(Effect.succeed("story" as const))),
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  repositoryProjectIds: Schema.optionalKey(Schema.Array(ProjectId).check(Schema.isMinLength(1))),
  createdAt: IsoDateTime,
});
export type WorkbenchCreateTicketInput = typeof WorkbenchCreateTicketInput.Type;

export const WorkbenchUpdateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  epicId: Schema.optionalKey(Schema.NullOr(WorkbenchEpicId)),
  title: WorkbenchTicket.fields.title,
  kind: Schema.optionalKey(WorkbenchTicketKind),
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: Schema.optionalKey(ProjectId),
  repositoryProjectIds: Schema.optionalKey(Schema.Array(ProjectId).check(Schema.isMinLength(1))),
  status: WorkbenchTicketStatus,
  blocked: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateTicketInput = typeof WorkbenchUpdateTicketInput.Type;

export const WorkbenchArchiveTicketInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  archivedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type WorkbenchArchiveTicketInput = typeof WorkbenchArchiveTicketInput.Type;

export const WorkbenchDeleteTicketInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  deletedAt: IsoDateTime,
});
export type WorkbenchDeleteTicketInput = typeof WorkbenchDeleteTicketInput.Type;

export const WorkbenchCreateAssignmentInput = Schema.Struct({
  id: WorkbenchAssignmentId,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateAssignmentInput = typeof WorkbenchCreateAssignmentInput.Type;

export const WorkbenchReplaceAssignmentInput = Schema.Struct({
  id: Schema.optionalKey(WorkbenchAssignmentId),
  ticketId: WorkbenchTicketId,
  previousThreadId: ThreadId,
  threadId: ThreadId,
  replacedAt: IsoDateTime,
});
export type WorkbenchReplaceAssignmentInput = typeof WorkbenchReplaceAssignmentInput.Type;

export const WorkbenchPrepareTicketWorkspaceInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  requestedAt: IsoDateTime,
});
export type WorkbenchPrepareTicketWorkspaceInput = typeof WorkbenchPrepareTicketWorkspaceInput.Type;

export const WorkbenchReleaseTicketWorkspaceInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  releasedAt: IsoDateTime,
});
export type WorkbenchReleaseTicketWorkspaceInput = typeof WorkbenchReleaseTicketWorkspaceInput.Type;

export const WorkbenchOperationErrorCode = Schema.Literals([
  "project_not_found",
  "epic_not_found",
  "epic_project_mismatch",
  "epic_archived",
  "ticket_not_found",
  "ticket_archived",
  "jira_managed_ticket",
  "linked_project_not_found",
  "primary_project_not_linked",
  "repository_not_linked",
  "primary_repository_not_selected",
  "ticket_repository_scope_locked",
  "thread_not_found",
  "thread_project_mismatch",
  "assignment_not_found",
  "assignment_already_exists",
  "assignment_changed",
  "ticket_workspace_not_found",
  "ticket_workspace_preparation_in_progress",
  "ticket_workspace_already_ready",
  "ticket_workspace_preparation_changed",
  "ticket_workspace_repository_not_found",
  "ticket_workspace_preparation_failed",
  "ticket_workspace_in_use",
  "persistence_failed",
]);
export type WorkbenchOperationErrorCode = typeof WorkbenchOperationErrorCode.Type;

export class WorkbenchOperationError extends Schema.TaggedErrorClass<WorkbenchOperationError>()(
  "WorkbenchOperationError",
  {
    code: WorkbenchOperationErrorCode,
    message: TrimmedNonEmptyString,
  },
) {}
