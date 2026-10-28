import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  NonNegativeInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

import { ModelSelection } from "./modelSelection.ts";

const makeWorkbenchId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

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

export const WorkbenchTicketGeneratedSummaryStatus = Schema.Literals(["pending", "ready", "error"]);
export type WorkbenchTicketGeneratedSummaryStatus =
  typeof WorkbenchTicketGeneratedSummaryStatus.Type;

export const WorkbenchTicketGeneratedSummary = Schema.Struct({
  text: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))),
  status: WorkbenchTicketGeneratedSummaryStatus,
  stale: Schema.Boolean,
  error: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(4_000))),
});
export type WorkbenchTicketGeneratedSummary = typeof WorkbenchTicketGeneratedSummary.Type;

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

/**
 * A Jira issue a Workbench Ticket or Epic points to. Workbench stores and shows
 * the link only; it never reads or writes Jira.
 */
export const WorkbenchJiraIssue = Schema.Struct({
  key: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
});
export type WorkbenchJiraIssue = typeof WorkbenchJiraIssue.Type;

/** Message for the `jira_issue_url_invalid` operation error and inline form errors. */
export const WORKBENCH_JIRA_ISSUE_URL_ERROR =
  "Enter a Jira issue URL, such as https://your-site.atlassian.net/browse/PROJ-123.";

const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[0-9]+$/u;
const BROWSE_PATH = /\/browse\/([^/]+)/u;
const GITHUB_ITEM_PATH = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9][0-9]*)(?:\/|$)/u;
// POSIX absolute paths, and Windows drive paths with either separator.
const ABSOLUTE_FILE_PATH = /^(?:\/(?!\/)|[A-Za-z]:[\\/])/u;
const MAX_REFERENCE_URL_LENGTH = 2_048;

const issueKey = (url: URL): string | null => {
  const candidate =
    BROWSE_PATH.exec(url.pathname)?.[1] ?? url.searchParams.get("selectedIssue") ?? "";
  const key = candidate.toUpperCase();
  return JIRA_ISSUE_KEY.test(key) ? key : null;
};

const parseHttpUrl = (input: string): URL | null => {
  const trimmed = input.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.href.length > MAX_REFERENCE_URL_LENGTH ? null : url;
};

/**
 * Accepts `/browse/KEY` and board `selectedIssue=KEY` links on any http(s)
 * host, so Jira Cloud, Data Center, and context-path installs all work.
 */
export const parseJiraIssueUrl = (input: string): WorkbenchJiraIssue | null => {
  const url = parseHttpUrl(input);
  const key = url === null ? null : issueKey(url);
  return url === null || key === null ? null : { key, url: url.href };
};

export const WorkbenchReferenceKind = Schema.Literals([
  "jira_issue",
  "github_issue",
  "github_pull_request",
  "file",
  "link",
]);
export type WorkbenchReferenceKind = typeof WorkbenchReferenceKind.Type;

export interface WorkbenchParsedReferenceUrl {
  /** Normalized URL; References are unique per Ticket on this value. */
  readonly url: string;
  readonly kind: WorkbenchReferenceKind;
  readonly label: string;
}

/** Message for the `reference_url_invalid` operation error and inline form errors. */
export const WORKBENCH_REFERENCE_URL_ERROR =
  "Enter an http or https URL, or an absolute file path, of up to 2,048 characters.";

const httpReference = (url: URL): WorkbenchParsedReferenceUrl => {
  const github =
    url.hostname === "github.com" || url.hostname === "www.github.com"
      ? GITHUB_ITEM_PATH.exec(url.pathname)
      : null;
  if (github) {
    const [, owner, repository, type, number] = github;
    const label = `${repository}#${number}`;
    // One PR has many URLs (`/files`, `/commits`, anchors); store one so they cannot duplicate.
    return type === "pull"
      ? {
          url: `https://github.com/${owner}/${repository}/pull/${number}`,
          kind: "github_pull_request",
          label,
        }
      : { url: url.href, kind: "github_issue", label };
  }
  const key = issueKey(url);
  return key === null
    ? { url: url.href, kind: "link", label: url.host }
    : { url: url.href, kind: "jira_issue", label: key };
};

const fileReference = (input: string): WorkbenchParsedReferenceUrl | null => {
  if (!ABSOLUTE_FILE_PATH.test(input) || input.length > MAX_REFERENCE_URL_LENGTH) return null;
  const label = input.split(/[\\/]/u).findLast((segment) => segment.length > 0);
  return label === undefined ? null : { url: input, kind: "file", label };
};

/**
 * Derives a Reference's kind and label on read; Workbench never fetches the target.
 * An absolute path is a file on the environment host.
 */
export const parseWorkbenchReferenceUrl = (input: string): WorkbenchParsedReferenceUrl | null => {
  const trimmed = input.trim();
  const file = fileReference(trimmed);
  if (file !== null) return file;
  const url = parseHttpUrl(trimmed);
  return url === null ? null : httpReference(url);
};

const ISSUE_REFERENCE_KINDS: ReadonlySet<WorkbenchReferenceKind> = new Set([
  "jira_issue",
  "github_issue",
]);

/** A Ticket's issue References (`jira_issue`, `github_issue`), in list order. */
export const workbenchTicketIssueReferences = (
  references: ReadonlyArray<{ readonly url: string }>,
): ReadonlyArray<WorkbenchParsedReferenceUrl> =>
  references.flatMap((reference) => {
    const parsed = parseWorkbenchReferenceUrl(reference.url);
    return parsed !== null && ISSUE_REFERENCE_KINDS.has(parsed.kind) ? [parsed] : [];
  });

/** A Ticket's short identity: its first issue Reference label, in list order. */
export const workbenchTicketIssueLabel = (
  references: ReadonlyArray<{ readonly url: string }>,
): string | null => workbenchTicketIssueReferences(references)[0]?.label ?? null;

export const WorkbenchProject = Schema.Struct({
  id: WorkbenchProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  linkedProjectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1)),
  // Legacy snapshots and local fixtures omit Workspace lifecycle fields.
  archivedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  revision: Schema.optionalKey(NonNegativeInt).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
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
  // Optional so snapshots from servers without Jira links still decode.
  jiraIssue: Schema.optionalKey(Schema.NullOr(WorkbenchJiraIssue)),
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
  // Compact snapshots replace archived content with an empty string; ticket reads stay complete.
  markdownOmitted: Schema.optionalKey(Schema.Boolean),
  primaryT3ProjectId: ProjectId,
  repositoryProjectIds: Schema.Array(ProjectId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  status: WorkbenchTicketStatus,
  blocked: Schema.Boolean,
  revision: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  // Optional for compatibility with snapshots produced before generated
  // ticket summaries were introduced. New snapshots always include it.
  generatedSummary: Schema.optionalKey(WorkbenchTicketGeneratedSummary),
  // Optional for compatibility with snapshots produced before Ticket
  // archiving was introduced. New snapshots always include null or a time.
  archivedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  // The Thread whose MCP update last changed the title or description; a user edit clears it.
  updatedByThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicket = typeof WorkbenchTicket.Type;

const WorkbenchReferenceTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(500));
const WorkbenchReferenceUrlInput = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_REFERENCE_URL_LENGTH),
);

/** A link a Ticket or its draft points to. Kind and label come from `parseWorkbenchReferenceUrl`. */
export const WorkbenchReference = Schema.Struct({
  ticketId: WorkbenchTicketId,
  url: WorkbenchReferenceUrlInput,
  title: Schema.NullOr(WorkbenchReferenceTitle),
  addedByThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});
export type WorkbenchReference = typeof WorkbenchReference.Type;

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

/** Workbench-owned preparation state; conversation history remains native. */
export const WorkbenchTicketDraftPhase = Schema.Literals([
  "creating",
  "draft",
  "promoting",
  "planning",
  "starting",
  "working",
  "discarding",
]);
export type WorkbenchTicketDraftPhase = typeof WorkbenchTicketDraftPhase.Type;
export const WorkbenchTicketDraftFields = Schema.Struct({
  title: TrimmedString.check(Schema.isMaxLength(240)),
  markdown: TrimmedString.check(Schema.isMaxLength(120_000)),
  kind: WorkbenchTicketKind,
  epicId: Schema.NullOr(WorkbenchEpicId),
  repositoryProjectIds: Schema.Array(ProjectId),
  primaryT3ProjectId: Schema.NullOr(ProjectId),
});
export type WorkbenchTicketDraftFields = typeof WorkbenchTicketDraftFields.Type;
export const WorkbenchTicketDraft = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  threadId: ThreadId,
  anchorProjectId: ProjectId,
  modelSelection: ModelSelection,
  revision: NonNegativeInt,
  phase: WorkbenchTicketDraftPhase,
  fields: WorkbenchTicketDraftFields,
  // As on WorkbenchTicket; older stored payloads omit it.
  updatedByThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkbenchTicketDraft = typeof WorkbenchTicketDraft.Type;

/** Compact ownership index for native conversation navigation. */
export const WorkbenchTicketPreparation = Schema.Struct({
  draftId: Schema.optional(WorkbenchTicketId),
  threadId: ThreadId,
  projectId: WorkbenchProjectId,
  ticketId: Schema.NullOr(WorkbenchTicketId),
  phase: WorkbenchTicketDraftPhase,
});
export type WorkbenchTicketPreparation = typeof WorkbenchTicketPreparation.Type;
export const WorkbenchBeginTicketDraftInput = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
});
export type WorkbenchBeginTicketDraftInput = typeof WorkbenchBeginTicketDraftInput.Type;
export const WorkbenchUpdateTicketDraftInput = Schema.Struct({
  id: WorkbenchTicketId,
  expectedRevision: NonNegativeInt,
  fields: WorkbenchTicketDraftFields,
});
export type WorkbenchUpdateTicketDraftInput = typeof WorkbenchUpdateTicketDraftInput.Type;
export const WorkbenchTicketDraftActionInput = Schema.Struct({
  id: WorkbenchTicketId,
  expectedRevision: NonNegativeInt,
});
export type WorkbenchTicketDraftActionInput = typeof WorkbenchTicketDraftActionInput.Type;

/** Generated recap of a Thread's latest finished run, shown to sibling Threads on its Ticket. */
export const WorkbenchThreadRecap = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  updatedAt: IsoDateTime,
});
export type WorkbenchThreadRecap = typeof WorkbenchThreadRecap.Type;

export const WorkbenchSnapshot = Schema.Struct({
  projects: Schema.Array(WorkbenchProject),
  supportsEpicLifecycle: Schema.optionalKey(Schema.Boolean),
  ticketDrafts: Schema.optionalKey(Schema.Array(WorkbenchTicketDraft)),
  epics: Schema.Array(WorkbenchEpic).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  tickets: Schema.Array(WorkbenchTicket),
  assignments: Schema.Array(WorkbenchAssignment),
  // Deleted Tickets stay out of the visible projection, but their native
  // Thread IDs remain reserved so those Threads cannot be reassigned.
  reservedThreadIds: Schema.Array(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  ticketWorkspaces: Schema.Array(WorkbenchTicketWorkspace).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  threadRecaps: Schema.Array(WorkbenchThreadRecap).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  // References of visible Tickets and unpromoted drafts, in insertion order per owner.
  references: Schema.Array(WorkbenchReference).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
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
  expectedRevision: Schema.optionalKey(NonNegativeInt),
  title: WorkbenchProject.fields.title,
  // The server treats this as an additive set. Existing links remain intact;
  // callers may send either the new IDs or the full selected list.
  linkedProjectIds: WorkbenchProject.fields.linkedProjectIds,
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateProjectInput = typeof WorkbenchUpdateProjectInput.Type;

export const WorkbenchArchiveProjectInput = Schema.Struct({
  id: WorkbenchProjectId,
  expectedRevision: NonNegativeInt,
  archivedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type WorkbenchArchiveProjectInput = typeof WorkbenchArchiveProjectInput.Type;

export const WorkbenchDeleteProjectInput = Schema.Struct({
  id: WorkbenchProjectId,
  expectedRevision: NonNegativeInt,
  expectedTicketCount: NonNegativeInt,
  expectedEpicCount: NonNegativeInt,
  deletedAt: IsoDateTime,
});
export type WorkbenchDeleteProjectInput = typeof WorkbenchDeleteProjectInput.Type;

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
  archivedAt: Schema.NullOr(IsoDateTime),
  expectedUpdatedAt: Schema.optionalKey(IsoDateTime),
});
export type WorkbenchArchiveEpicInput = typeof WorkbenchArchiveEpicInput.Type;

/** A Reference staged before its Ticket exists. */
export const WorkbenchReferenceDraft = Schema.Struct({
  url: WorkbenchReferenceUrlInput,
  title: Schema.optionalKey(WorkbenchReferenceTitle),
});
export type WorkbenchReferenceDraft = typeof WorkbenchReferenceDraft.Type;

export const WorkbenchCreateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  epicId: Schema.optionalKey(Schema.NullOr(WorkbenchEpicId)),
  title: WorkbenchTicket.fields.title,
  kind: WorkbenchTicketKind.pipe(Schema.withDecodingDefault(Effect.succeed("story" as const))),
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  repositoryProjectIds: Schema.optionalKey(Schema.Array(ProjectId).check(Schema.isMinLength(1))),
  references: Schema.optionalKey(Schema.Array(WorkbenchReferenceDraft)),
  createdAt: IsoDateTime,
});
export type WorkbenchCreateTicketInput = typeof WorkbenchCreateTicketInput.Type;

export const WorkbenchUpdateTicketInput = Schema.Struct({
  id: WorkbenchTicketId,
  expectedRevision: NonNegativeInt,
  epicId: Schema.optionalKey(Schema.NullOr(WorkbenchEpicId)),
  title: Schema.optionalKey(WorkbenchTicket.fields.title),
  kind: Schema.optionalKey(WorkbenchTicketKind),
  markdown: Schema.optionalKey(WorkbenchTicket.fields.markdown),
  primaryT3ProjectId: Schema.optionalKey(ProjectId),
  repositoryProjectIds: Schema.optionalKey(Schema.Array(ProjectId).check(Schema.isMinLength(1))),
  status: Schema.optionalKey(WorkbenchTicketStatus),
  blocked: Schema.optionalKey(Schema.Boolean),
  updatedAt: IsoDateTime,
});
export type WorkbenchUpdateTicketInput = typeof WorkbenchUpdateTicketInput.Type;

const WorkbenchJiraIssueUrlInput = Schema.NullOr(
  TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
);

/** `url: null` unlinks. The server parses the URL with `parseJiraIssueUrl`. */
export const WorkbenchSetJiraIssueLinkInput = Schema.Struct({
  epicId: WorkbenchEpicId,
  url: WorkbenchJiraIssueUrlInput,
  // Epics have no revision; their lifecycle already uses updatedAt as the version.
  expectedUpdatedAt: IsoDateTime,
});
export type WorkbenchSetJiraIssueLinkInput = typeof WorkbenchSetJiraIssueLinkInput.Type;

export const WorkbenchAddReferenceInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  ...WorkbenchReferenceDraft.fields,
});
export type WorkbenchAddReferenceInput = typeof WorkbenchAddReferenceInput.Type;

export const WorkbenchRemoveReferenceInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  url: WorkbenchReferenceUrlInput,
});
export type WorkbenchRemoveReferenceInput = typeof WorkbenchRemoveReferenceInput.Type;

export const WorkbenchArchiveTicketInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  archivedAt: Schema.NullOr(IsoDateTime),
  expectedRevision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type WorkbenchArchiveTicketInput = typeof WorkbenchArchiveTicketInput.Type;

export const WorkbenchDeleteTicketInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  expectedRevision: NonNegativeInt,
  deletedAt: IsoDateTime,
});
export type WorkbenchDeleteTicketInput = typeof WorkbenchDeleteTicketInput.Type;

export const WorkbenchRegenerateTicketSummaryInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
});
export type WorkbenchRegenerateTicketSummaryInput =
  typeof WorkbenchRegenerateTicketSummaryInput.Type;

export const WorkbenchCreateAssignmentInput = Schema.Struct({
  id: WorkbenchAssignmentId,
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});
export type WorkbenchCreateAssignmentInput = typeof WorkbenchCreateAssignmentInput.Type;

export const WorkbenchUnlinkAssignmentInput = Schema.Struct({
  ticketId: WorkbenchTicketId,
  threadId: ThreadId,
});
export type WorkbenchUnlinkAssignmentInput = typeof WorkbenchUnlinkAssignmentInput.Type;

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
  retained: Schema.optional(Schema.Boolean),
});
export type WorkbenchReleaseTicketWorkspaceInput = typeof WorkbenchReleaseTicketWorkspaceInput.Type;

export const WorkbenchOperationErrorCode = Schema.Literals([
  "ticket_draft_not_found",
  "ticket_draft_changed",
  "ticket_draft_busy",
  "ticket_draft_invalid",
  "ticket_draft_operation_failed",
  "project_not_found",
  "project_archived",
  "project_changed",
  "epic_not_found",
  "epic_project_mismatch",
  "epic_archived",
  "epic_changed",
  "ticket_not_found",
  "ticket_changed",
  "ticket_archived",
  "ticket_summary_generation_failed",
  "thread_recap_generation_failed",
  "jira_issue_url_invalid",
  "reference_url_invalid",
  "reference_owner_not_found",
  "linked_project_not_found",
  "linked_project_not_repository",
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

export class WorkbenchOperationError extends Schema.TaggedError<WorkbenchOperationError>()(
  "WorkbenchOperationError",
  {
    code: WorkbenchOperationErrorCode,
    message: TrimmedNonEmptyString,
  },
) {}
