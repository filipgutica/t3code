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

export const WorkbenchAssignmentId = makeWorkbenchId("WorkbenchAssignmentId");
export type WorkbenchAssignmentId = typeof WorkbenchAssignmentId.Type;

export const WorkbenchTicketStatus = Schema.Literals([
  "todo",
  "in_progress",
  "ready_for_review",
  "done",
]);
export type WorkbenchTicketStatus = typeof WorkbenchTicketStatus.Type;

export const WorkbenchProject = Schema.Struct({
  id: WorkbenchProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  linkedProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchProject = typeof WorkbenchProject.Type;

export const WorkbenchTicket = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  markdown: TrimmedString.check(Schema.isMaxLength(120_000)),
  primaryT3ProjectId: ProjectId,
  status: WorkbenchTicketStatus,
  blocked: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicket = typeof WorkbenchTicket.Type;

export const WorkbenchAssignment = Schema.Struct({
  id: WorkbenchAssignmentId,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});
export type WorkbenchAssignment = typeof WorkbenchAssignment.Type;

export const WorkbenchSnapshot = Schema.Struct({
  projects: Schema.Array(WorkbenchProject),
  tickets: Schema.Array(WorkbenchTicket),
  assignments: Schema.Array(WorkbenchAssignment),
});
export type WorkbenchSnapshot = typeof WorkbenchSnapshot.Type;

export const WorkbenchCreateProjectInput = Schema.Struct({
  id: WorkbenchProjectId,
  title: WorkbenchProject.fields.title,
  linkedProjectIds: WorkbenchProject.fields.linkedProjectIds,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateProjectInput = typeof WorkbenchCreateProjectInput.Type;

export const WorkbenchCreateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  title: WorkbenchTicket.fields.title,
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateTicketInput = typeof WorkbenchCreateTicketInput.Type;

export const WorkbenchUpdateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  title: WorkbenchTicket.fields.title,
  markdown: WorkbenchTicket.fields.markdown,
  status: WorkbenchTicketStatus,
  blocked: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateTicketInput = typeof WorkbenchUpdateTicketInput.Type;

export const WorkbenchCreateAssignmentInput = Schema.Struct({
  id: WorkbenchAssignmentId,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateAssignmentInput = typeof WorkbenchCreateAssignmentInput.Type;

export const WorkbenchReplaceAssignmentInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  previousThreadId: ThreadId,
  threadId: ThreadId,
  replacedAt: IsoDateTime,
});
export type WorkbenchReplaceAssignmentInput = typeof WorkbenchReplaceAssignmentInput.Type;

export const WorkbenchOperationErrorCode = Schema.Literals([
  "project_not_found",
  "ticket_not_found",
  "linked_project_not_found",
  "primary_project_not_linked",
  "thread_not_found",
  "thread_project_mismatch",
  "assignment_not_found",
  "assignment_already_exists",
  "assignment_changed",
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
