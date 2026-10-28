import {
  RunId,
  WorkbenchAssignment,
  WorkbenchAssignmentId,
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchOperationError,
  WorkbenchProject,
  WorkbenchProjectId,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketGeneratedSummary,
  WorkbenchTicketGeneratedSummaryStatus,
  WorkbenchTicketId,
  WorkbenchTicketWorkspace,
  WorkbenchTicketWorkspaceAttemptId,
  WorkbenchTicketWorkspaceRepository,
  WorkbenchThreadRecap,
  WorkbenchReference,
  WORKBENCH_REFERENCE_URL_ERROR,
  IsoDateTime,
  ThreadId,
  ProjectId,
  type WorkbenchArchiveTicketInput,
  type WorkbenchArchiveProjectInput,
  type WorkbenchDeleteProjectInput,
  type WorkbenchCreateAssignmentInput,
  type WorkbenchUnlinkAssignmentInput,
  type WorkbenchArchiveEpicInput,
  type WorkbenchCreateEpicInput,
  type WorkbenchCreateProjectInput,
  type WorkbenchCreateTicketInput,
  type WorkbenchDeleteTicketInput,
  type WorkbenchReplaceAssignmentInput,
  type WorkbenchUpdateEpicInput,
  type WorkbenchUpdateProjectInput,
  type WorkbenchUpdateTicketInput,
  type WorkbenchJiraIssue,
  type WorkbenchAddReferenceInput,
  type WorkbenchReferenceDraft,
  type WorkbenchRemoveReferenceInput,
  parseWorkbenchReferenceUrl,
  workbenchTicketIssueLabel,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { sha256 } from "@noble/hashes/sha2";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Hex from "effect/encoding/Hex";

import { listTicketDrafts, makeTicketDraftPersistence } from "./TicketDraftPersistence.ts";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";

const WorkbenchProjectRow = Schema.Struct({
  id: WorkbenchProjectId,
  title: WorkbenchProject.fields.title,
  archivedAt: Schema.NullOr(IsoDateTime),
  revision: Schema.Number,
  createdAt: WorkbenchProject.fields.createdAt,
  updatedAt: WorkbenchProject.fields.updatedAt,
});
const WorkbenchProjectLinkRow = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
  position: Schema.Number,
});
const JiraIssueColumns = {
  jiraIssueKey: Schema.NullOr(Schema.String),
  jiraIssueUrl: Schema.NullOr(Schema.String),
};
const jiraIssueFromRow = (row: {
  readonly jiraIssueKey: string | null;
  readonly jiraIssueUrl: string | null;
}): WorkbenchJiraIssue | null =>
  row.jiraIssueKey !== null && row.jiraIssueUrl !== null
    ? { key: row.jiraIssueKey, url: row.jiraIssueUrl }
    : null;
const WorkbenchEpicRow = Schema.Struct({
  id: WorkbenchEpicId,
  projectId: WorkbenchProjectId,
  title: WorkbenchEpic.fields.title,
  markdown: WorkbenchEpic.fields.markdown,
  archivedAt: WorkbenchEpic.fields.archivedAt,
  ...JiraIssueColumns,
  createdAt: WorkbenchEpic.fields.createdAt,
  updatedAt: WorkbenchEpic.fields.updatedAt,
});
const epicFromRow = ({
  jiraIssueKey,
  jiraIssueUrl,
  ...epic
}: typeof WorkbenchEpicRow.Type): WorkbenchEpic =>
  WorkbenchEpic.make({ ...epic, jiraIssue: jiraIssueFromRow({ jiraIssueKey, jiraIssueUrl }) });
// Epic versions must advance even within one clock tick or after clock skew.
const advanceEpicUpdatedAt = (previousUpdatedAt: string, updatedAt: string) =>
  DateTime.formatIso(
    DateTime.makeUnsafe(
      Math.max(
        DateTime.toEpochMillis(DateTime.makeUnsafe(updatedAt)),
        DateTime.toEpochMillis(DateTime.makeUnsafe(previousUpdatedAt)) + 1,
      ),
    ),
  );

const WorkbenchTicketRepositoryRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  repositoryProjectId: ProjectId,
  position: Schema.Number,
});
const WorkbenchTicketWorkspaceRow = Schema.Struct({
  ticketId: WorkbenchTicketWorkspace.fields.ticketId,
  attemptId: WorkbenchTicketWorkspace.fields.attemptId,
  status: WorkbenchTicketWorkspace.fields.status,
  branchName: WorkbenchTicketWorkspace.fields.branchName,
  errorMessage: WorkbenchTicketWorkspace.fields.errorMessage,
  createdAt: WorkbenchTicketWorkspace.fields.createdAt,
  updatedAt: WorkbenchTicketWorkspace.fields.updatedAt,
});
const WorkbenchTicketWorkspaceRepositoryRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  attemptId: WorkbenchTicketWorkspaceAttemptId,
  projectId: ProjectId,
  isPrimary: Schema.Number,
  sourcePath: WorkbenchTicketWorkspaceRepository.fields.sourcePath,
  worktreePath: WorkbenchTicketWorkspaceRepository.fields.worktreePath,
  branchName: WorkbenchTicketWorkspaceRepository.fields.branchName,
  status: WorkbenchTicketWorkspaceRepository.fields.status,
  errorMessage: WorkbenchTicketWorkspaceRepository.fields.errorMessage,
  createdAt: WorkbenchTicketWorkspaceRepository.fields.createdAt,
  updatedAt: WorkbenchTicketWorkspaceRepository.fields.updatedAt,
});
const FindProjectLinkInput = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
});
const FindTicketInput = Schema.Struct({ ticketId: WorkbenchTicketId });
const FindEpicInput = Schema.Struct({ epicId: WorkbenchEpicId });
const WorkbenchTicketRow = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  epicId: Schema.NullOr(WorkbenchEpicId),
  title: WorkbenchTicket.fields.title,
  kind: WorkbenchTicket.fields.kind,
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  status: WorkbenchTicket.fields.status,
  blocked: Schema.Number,
  revision: Schema.Number,
  generatedSummaryText: Schema.NullOr(Schema.String),
  generatedSummaryStatus: WorkbenchTicketGeneratedSummaryStatus,
  generatedSummaryStale: Schema.Number,
  generatedSummaryError: Schema.NullOr(Schema.String),
  generatedSummarySourceHash: Schema.NullOr(Schema.String),
  generatedSummaryRequestId: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(IsoDateTime),
  updatedByThreadId: Schema.NullOr(ThreadId),
  createdAt: WorkbenchTicket.fields.createdAt,
  updatedAt: WorkbenchTicket.fields.updatedAt,
});

const generatedSummaryFromRow = (
  row: Pick<
    typeof WorkbenchTicketRow.Type,
    | "generatedSummaryText"
    | "generatedSummaryStatus"
    | "generatedSummaryStale"
    | "generatedSummaryError"
  >,
): WorkbenchTicketGeneratedSummary => ({
  text: row.generatedSummaryText,
  status: row.generatedSummaryStatus,
  stale: row.generatedSummaryStale === 1,
  error: row.generatedSummaryError,
});

type WorkbenchTicketSummaryRow = Pick<
  typeof WorkbenchTicketRow.Type,
  | "generatedSummaryText"
  | "generatedSummaryStatus"
  | "generatedSummaryStale"
  | "generatedSummaryError"
  | "generatedSummarySourceHash"
  | "generatedSummaryRequestId"
>;

const summaryUpdate = ({
  row,
  contentChanged,
}: {
  readonly row: WorkbenchTicketSummaryRow;
  readonly contentChanged: boolean;
}) => {
  if (!contentChanged) {
    return {
      generatedSummaryStatus: row.generatedSummaryStatus,
      generatedSummaryStale: row.generatedSummaryStale,
      generatedSummaryError: row.generatedSummaryError,
      generatedSummarySourceHash: row.generatedSummarySourceHash,
      generatedSummaryRequestId: row.generatedSummaryRequestId,
      generatedSummary: generatedSummaryFromRow(row),
    };
  }
  const stale = row.generatedSummaryText !== null;
  return {
    generatedSummaryStatus: "pending" as const,
    generatedSummaryStale: stale ? 1 : 0,
    generatedSummaryError: null,
    generatedSummarySourceHash: null,
    generatedSummaryRequestId: null,
    generatedSummary: {
      text: row.generatedSummaryText,
      status: "pending" as const,
      stale,
      error: null,
    },
  };
};

const ticketFromRow = (
  row: typeof WorkbenchTicketRow.Type,
  repositoryProjectIds: ReadonlyArray<ProjectId>,
): WorkbenchTicket =>
  WorkbenchTicket.make({
    id: row.id,
    projectId: row.projectId,
    epicId: row.epicId,
    title: row.title,
    kind: row.kind,
    markdown: row.markdown,
    primaryT3ProjectId: row.primaryT3ProjectId,
    repositoryProjectIds,
    status: row.status,
    blocked: row.blocked === 1,
    revision: row.revision,
    generatedSummary: generatedSummaryFromRow(row),
    archivedAt: row.archivedAt,
    updatedByThreadId: row.updatedByThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const ticketProvenance = ({
  input,
  current,
  contentChanged,
}: {
  readonly input: { readonly updatedByThreadId?: ThreadId };
  readonly current: typeof WorkbenchTicketRow.Type;
  readonly contentChanged: boolean;
}) => (contentChanged ? (input.updatedByThreadId ?? null) : current.updatedByThreadId);

const ticketSummarySourceHash = (title: string, markdown: string): string =>
  Hex.encode(sha256(new TextEncoder().encode(JSON.stringify([title, markdown]))));

const normalizeSummaryText = (text: string): string =>
  Array.from(text.trim()).slice(0, 500).join("");
const normalizeSummaryError = (error: string): string =>
  Array.from(error.trim()).slice(0, 4_000).join("");

export interface WorkbenchTicketChange {
  readonly ticketId: WorkbenchTicketId;
}

export interface WorkbenchRequestTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
}

export interface WorkbenchCompleteTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
  readonly summary: string;
}

export interface WorkbenchFailTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
  readonly error: string;
}

export interface WorkbenchClaimTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  /** Stable Workspace identity; it may differ from the branch used for new worktrees. */
  readonly branchName: string;
  /**
   * Branch selected for new worktrees. `null` means none is selected yet; omitted means
   * `branchName`. A selected name is kept by later claims.
   */
  readonly generatedBranchName?: string | null;
  readonly repositories: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly isPrimary: boolean;
    readonly sourcePath: string;
    readonly worktreePath: string;
    /** Current branch observed at an existing registered worktree. */
    readonly branchName?: string;
  }>;
  readonly claimedAt: string;
}

export interface WorkbenchTicketWorkspaceRepositoryReadyInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly updatedAt: string;
}

export interface WorkbenchFailTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId | null;
  readonly errorMessage: string;
  readonly failedAt: string;
}

export interface WorkbenchFailTicketWorkspaceExtensionInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId | null;
  readonly errorMessage: string;
  readonly failedAt: string;
}

export interface WorkbenchReleaseTicketWorkspaceRepositoryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId;
  readonly releasedAt: string;
  /** Branch observed immediately before removing the worktree, when available. */
  readonly branchName?: string;
}

export interface WorkbenchStoredThreadRecap {
  readonly runId: RunId;
  readonly text: string;
  /** Terminal time of the recapped run; a recap never replaces one for a later run. */
  readonly updatedAt: IsoDateTime;
}

export type WorkbenchThreadOwner =
  | { readonly kind: "ticket"; readonly ticketId: WorkbenchTicketId }
  | { readonly kind: "draft"; readonly draftId: WorkbenchTicketId };

export interface WorkbenchThreadRoster {
  readonly ticket: {
    readonly id: WorkbenchTicketId;
    readonly title: string;
    /** First issue Reference label; see `workbenchTicketIssueLabel`. */
    readonly issueLabel: string | null;
  };
  readonly recap: WorkbenchStoredThreadRecap | null;
  /** Other current Threads on the Ticket, oldest Assignment first. */
  readonly siblings: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly recap: WorkbenchStoredThreadRecap | null;
  }>;
}

export interface WorkbenchCompleteTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly completedAt: string;
}

export interface WorkbenchConsumeTicketExecutionInput {
  readonly sequence: number;
  readonly run: {
    readonly id: RunId;
    readonly threadId: ThreadId;
    readonly startedAt: IsoDateTime;
  };
}

export interface WorkbenchTicketWorkspaceRepositoryState {
  readonly projectId: ProjectId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly status: WorkbenchTicketWorkspaceRepository["status"];
}

export interface WorkbenchClaimTicketWorkspaceReleaseInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly claimedAt: string;
  readonly requireActiveTicket?: boolean;
  /** Retained cleanup requires a persisted Ticket tombstone. */
  readonly requireDeletedTicket?: boolean;
  /** Explicit reset refuses every still-live linked native Thread. */
  readonly requireNoLinkedThreads?: boolean;
  readonly expectedRevision?: number;
}

interface WorkbenchStoreShape extends Omit<
  Effect.Success<typeof makeTicketDraftPersistence>,
  "getTicketDraftForThread"
> {
  readonly getTicketDraftForThread: (threadId: ThreadId) => Effect.Effect<
    | (NonNullable<
        Effect.Success<
          ReturnType<Effect.Success<typeof makeTicketDraftPersistence>["getTicketDraftForThread"]>
        >
      > & {
        readonly workArea: WorkbenchTicketWorkspace | null;
      })
    | null,
    WorkbenchOperationError
  >;
  readonly getSnapshot: Effect.Effect<WorkbenchSnapshot, WorkbenchOperationError>;
  readonly getCompactSnapshot: Effect.Effect<WorkbenchSnapshot, WorkbenchOperationError>;
  readonly getTicket: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly getEpic: (
    epicId: WorkbenchEpicId,
  ) => Effect.Effect<Option.Option<WorkbenchEpic>, WorkbenchOperationError>;
  readonly listTicketsNeedingSummary: Effect.Effect<
    ReadonlyArray<WorkbenchTicket>,
    WorkbenchOperationError
  >;
  readonly getTicketSummaryCandidate: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly recheckTicketSummary: (ticketId: WorkbenchTicketId) => Effect.Effect<void>;
  readonly ticketChanges: Stream.Stream<WorkbenchTicketChange>;
  readonly getProject: (
    projectId: WorkbenchProjectId,
  ) => Effect.Effect<Option.Option<WorkbenchProject>, WorkbenchOperationError>;
  readonly requireActiveProject: (
    projectId: WorkbenchProjectId,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  readonly archiveProject: (
    input: WorkbenchArchiveProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
  readonly deleteProject: (
    input: WorkbenchDeleteProjectInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  readonly createProject: (
    input: WorkbenchCreateProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
  readonly updateProject: (
    input: WorkbenchUpdateProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
  readonly createEpic: (
    input: WorkbenchCreateEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly updateEpic: (
    input: WorkbenchUpdateEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly archiveEpic: (
    input: WorkbenchArchiveEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly createTicket: (
    input: WorkbenchCreateTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  /**
   * A changed title or description records `updatedByThreadId`, which an
   * agent passes and a user edit omits.
   */
  readonly updateTicket: (
    input: WorkbenchUpdateTicketInput & { readonly updatedByThreadId?: ThreadId },
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  /** Restores the native event cursor and settles runs held by older releases. */
  readonly initializeTicketExecution: Effect.Effect<number, WorkbenchOperationError>;
  /** Moves the Ticket assigned to a newly running native Thread to In Progress. */
  readonly consumeTicketExecution: (
    input: WorkbenchConsumeTicketExecutionInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  /**
   * Adds a Reference without bumping any revision. An existing URL returns its
   * Reference unchanged.
   */
  readonly addReference: (
    input: WorkbenchAddReferenceInput & { readonly addedByThreadId: ThreadId | null },
  ) => Effect.Effect<WorkbenchReference, WorkbenchOperationError>;
  /** Projects the Ticket's active, non-planning Threads work in. */
  readonly listActiveThreadProjectIds: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<ReadonlyArray<ProjectId>, WorkbenchOperationError>;
  /** One owner's References, in insertion order. */
  readonly listReferences: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<ReadonlyArray<WorkbenchReference>, WorkbenchOperationError>;
  /** Removes a Reference without bumping any revision; a missing URL is a no-op. */
  readonly removeReference: (
    input: WorkbenchRemoveReferenceInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  /** `null` unlinks. A stale `expectedUpdatedAt` fails with `epic_changed`. */
  readonly setEpicJiraIssueLink: (input: {
    readonly epicId: WorkbenchEpicId;
    readonly jiraIssue: WorkbenchJiraIssue | null;
    readonly expectedUpdatedAt: string;
  }) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly requestTicketSummary: (
    input: WorkbenchRequestTicketSummaryInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly completeTicketSummary: (
    input: WorkbenchCompleteTicketSummaryInput,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly failTicketSummary: (
    input: WorkbenchFailTicketSummaryInput,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly archiveTicket: (
    input: WorkbenchArchiveTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly deleteTicket: (
    input: WorkbenchDeleteTicketInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  readonly createAssignment: (
    input: WorkbenchCreateAssignmentInput,
  ) => Effect.Effect<WorkbenchAssignment, WorkbenchOperationError>;
  readonly unlinkAssignment: (
    input: WorkbenchUnlinkAssignmentInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  readonly replaceAssignment: (
    input: WorkbenchReplaceAssignmentInput,
  ) => Effect.Effect<WorkbenchAssignment, WorkbenchOperationError>;
  readonly hasThreadAtWorktreePath: (
    worktreePath: string,
  ) => Effect.Effect<boolean, WorkbenchOperationError>;
  readonly getTicketWorkspace: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<WorkbenchTicketWorkspace>, WorkbenchOperationError>;
  /**
   * What a Thread may edit: the Ticket of its active Assignment, or else the
   * draft it plans while that draft is still unsaved.
   */
  readonly resolveThreadOwner: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<WorkbenchThreadOwner>, WorkbenchOperationError>;
  /** The Ticket a Thread currently works on, with that Ticket's other Threads. */
  readonly getThreadRoster: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<WorkbenchThreadRoster>, WorkbenchOperationError>;
  readonly upsertThreadRecap: (
    input: WorkbenchStoredThreadRecap & { readonly threadId: ThreadId },
  ) => Effect.Effect<void, WorkbenchOperationError>;
  /** Current Threads of Tickets, which are the Threads that get recaps. */
  readonly listTicketThreadIds: Effect.Effect<ReadonlyArray<ThreadId>, WorkbenchOperationError>;
  /** Branch selected for new worktrees, when this Ticket Workspace has one. */
  readonly getTicketWorkspaceGeneratedBranchName: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<string>, WorkbenchOperationError>;
  /** Internal ownership state used to reconcile a Workspace incrementally. */
  readonly getTicketWorkspaceRepositoryStates: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<
    ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>,
    WorkbenchOperationError
  >;
  readonly claimTicketWorkspaceRecovery: (input: {
    readonly ticketId: WorkbenchTicketId;
    readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
    readonly claimedAt: string;
    readonly expectedRevision: number;
  }) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly claimTicketWorkspace: (
    input: WorkbenchClaimTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly markTicketWorkspaceRepositoryReady: (
    input: WorkbenchTicketWorkspaceRepositoryReadyInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly completeTicketWorkspace: (
    input: WorkbenchCompleteTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly failTicketWorkspace: (
    input: WorkbenchFailTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly failTicketWorkspaceExtension: (
    input: WorkbenchFailTicketWorkspaceExtensionInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly releaseTicketWorkspaceRepository: (
    input: WorkbenchReleaseTicketWorkspaceRepositoryInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly claimTicketWorkspaceRelease: (
    input: WorkbenchClaimTicketWorkspaceReleaseInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly completeTicketWorkspaceRelease: (
    input: WorkbenchCompleteTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
}

export class WorkbenchStore extends Context.Service<WorkbenchStore, WorkbenchStoreShape>()(
  "@t3tools/workbench/WorkbenchStore",
) {}

const ThreadRosterRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  title: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  runId: Schema.NullOr(RunId),
  text: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(IsoDateTime),
});
const recapFromRosterRow = (row: typeof ThreadRosterRow.Type): WorkbenchStoredThreadRecap | null =>
  row.runId === null || row.text === null || row.updatedAt === null
    ? null
    : { runId: row.runId, text: row.text, updatedAt: row.updatedAt };

const persistenceError = (_cause: unknown) =>
  new WorkbenchOperationError({
    code: "persistence_failed",
    message: "Workbench data could not be saved or loaded.",
  });
const isWorkbenchOperationError = Schema.is(WorkbenchOperationError);
const workbenchStoreError = (cause: unknown) =>
  isWorkbenchOperationError(cause) ? cause : persistenceError(cause);

/** Parses staged References before any write and keeps the first of each normalized URL. */
const normalizeStagedReferences = (references: ReadonlyArray<WorkbenchReferenceDraft>) => {
  const byUrl = new Map<string, { readonly url: string; readonly title: string | null }>();
  for (const reference of references) {
    const parsed = parseWorkbenchReferenceUrl(reference.url);
    if (parsed === null) {
      return Effect.fail(
        new WorkbenchOperationError({
          code: "reference_url_invalid",
          message: WORKBENCH_REFERENCE_URL_ERROR,
        }),
      );
    }
    if (!byUrl.has(parsed.url))
      byUrl.set(parsed.url, { url: parsed.url, title: reference.title ?? null });
  }
  return Effect.succeed([...byUrl.values()]);
};

const makeWorkbenchStore = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const native = yield* WorkbenchNativeAccess;
  const ticketDraftPersistence = yield* makeTicketDraftPersistence;
  const ticketChangesPubSub = yield* PubSub.unbounded<WorkbenchTicketChange>();
  const ticketChanges = Stream.fromPubSub(ticketChangesPubSub);

  const publishTicketChange = (ticketId: WorkbenchTicketId) =>
    PubSub.publish(ticketChangesPubSub, { ticketId });
  const recheckTicketSummary = (ticketId: WorkbenchTicketId) => publishTicketChange(ticketId);

  /** An existing URL keeps its Reference; new ones append in insertion order. */
  const insertReference = (reference: {
    readonly ticketId: WorkbenchTicketId;
    readonly url: string;
    readonly title: string | null;
    readonly addedByThreadId: ThreadId | null;
    readonly createdAt: string;
  }) => sql`
    INSERT OR IGNORE INTO workbench_references
      (ticket_id, url, title, added_by_thread_id, position, created_at)
    SELECT ${reference.ticketId}, ${reference.url}, ${reference.title},
      ${reference.addedByThreadId}, COALESCE(MAX(position), -1) + 1, ${reference.createdAt}
    FROM workbench_references WHERE ticket_id = ${reference.ticketId}
  `;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchProjectRow,
    execute: () => sql`
      SELECT
        project_id AS "id",
        title,
        archived_at AS "archivedAt",
        revision,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_projects
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC, project_id ASC
    `,
  });
  const listProjectLinkRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchProjectLinkRow,
    execute: () => sql`
      SELECT
        workbench_project_id AS "projectId",
        t3_project_id AS "linkedProjectId",
        position
      FROM workbench_project_links
      ORDER BY workbench_project_id ASC, position ASC
    `,
  });
  const listEpicRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchEpicRow,
    execute: () => sql`
      SELECT
        epic_id AS "id",
        workbench_project_id AS "projectId",
        title,
        markdown,
        archived_at AS "archivedAt",
        jira_issue_key AS "jiraIssueKey",
        jira_issue_url AS "jiraIssueUrl",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_epics
      WHERE workbench_project_id IN (SELECT project_id FROM workbench_projects WHERE deleted_at IS NULL)
      ORDER BY created_at ASC, epic_id ASC
    `,
  });
  const listTicketRows = SqlSchema.findAll({
    Request: Schema.Boolean,
    Result: WorkbenchTicketRow,
    execute: (compact) => sql`
      SELECT
        ticket_id AS "id",
        workbench_project_id AS "projectId",
        epic_id AS "epicId",
        title,
        kind,
        CASE WHEN ${compact ? 1 : 0} AND archived_at IS NOT NULL THEN '' ELSE markdown END AS markdown,
        primary_t3_project_id AS "primaryT3ProjectId",
        status,
        blocked,
        revision,
        generated_summary AS "generatedSummaryText",
        generated_summary_status AS "generatedSummaryStatus",
        generated_summary_stale AS "generatedSummaryStale",
        generated_summary_error AS "generatedSummaryError",
        generated_summary_source_hash AS "generatedSummarySourceHash",
        generated_summary_request_id AS "generatedSummaryRequestId",
        archived_at AS "archivedAt",
        updated_by_thread_id AS "updatedByThreadId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC, ticket_id ASC
    `,
  });
  const listTicketSummaryCandidateIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ ticketId: WorkbenchTicketId }),
    execute: () => sql`
      SELECT ticket.ticket_id AS "ticketId"
      FROM workbench_tickets AS ticket
      WHERE ticket.deleted_at IS NULL
        AND ticket.workbench_project_id IN (SELECT project_id FROM workbench_projects WHERE deleted_at IS NULL AND archived_at IS NULL)
        AND ticket.archived_at IS NULL
        AND ticket.generated_summary_status = 'pending'
      ORDER BY ticket.created_at ASC, ticket.ticket_id ASC
    `,
  });
  const listTicketRepositoryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketRepositoryRow,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "repositoryProjectId",
        position
      FROM workbench_ticket_repositories
      ORDER BY ticket_id ASC, position ASC
    `,
  });
  const listTicketRepositoryRowsByTicket = SqlSchema.findAll({
    Request: FindTicketInput,
    Result: WorkbenchTicketRepositoryRow,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "repositoryProjectId",
        position
      FROM workbench_ticket_repositories
      WHERE ticket_id = ${ticketId}
      ORDER BY position ASC
    `,
  });
  const listAssignmentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchAssignment,
    execute: () => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id IN (
        SELECT ticket_id
        FROM workbench_tickets
        WHERE deleted_at IS NULL
      )
      ORDER BY created_at ASC, assignment_id ASC
    `,
  });
  const listReservedThreadIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ id: ThreadId }),
    execute: () => sql`
      SELECT DISTINCT assignment.thread_id AS "id"
      FROM workbench_assignments AS assignment
      INNER JOIN workbench_tickets AS ticket
        ON ticket.ticket_id = assignment.ticket_id
      WHERE ticket.deleted_at IS NOT NULL
      ORDER BY assignment.thread_id ASC
    `,
  });
  const listTicketWorkspaceRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketWorkspaceRow,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        attempt_id AS "attemptId",
        status,
        branch_name AS "branchName",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspaces
      ORDER BY created_at ASC, ticket_id ASC
    `,
  });
  const listTicketWorkspaceRepositoryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketWorkspaceRepositoryRow,
    execute: () => sql`
      SELECT
        repository.ticket_id AS "ticketId",
        COALESCE(repository.attempt_id, workspace.attempt_id) AS "attemptId",
        repository.t3_project_id AS "projectId",
        repository.is_primary AS "isPrimary",
        repository.source_path AS "sourcePath",
        repository.worktree_path AS "worktreePath",
        repository.branch_name AS "branchName",
        repository.status,
        repository.error_message AS "errorMessage",
        repository.created_at AS "createdAt",
        repository.updated_at AS "updatedAt"
      FROM workbench_ticket_workspace_repositories AS repository
      INNER JOIN workbench_ticket_workspaces AS workspace
        ON workspace.ticket_id = repository.ticket_id
      ORDER BY repository.ticket_id ASC, repository.is_primary DESC, repository.t3_project_id ASC
    `,
  });
  const findTicketWorkspaceRow = SqlSchema.findOneOption({
    Request: FindTicketInput,
    Result: WorkbenchTicketWorkspaceRow,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        attempt_id AS "attemptId",
        status,
        branch_name AS "branchName",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspaces
      WHERE ticket_id = ${ticketId}
    `,
  });
  // Planning and working drafts already hold an Assignment; the draft row covers the hand-off.
  // A replaced draft Thread keeps its working row, so its superseded Assignment must win.
  const retiredDraftThread = sql`
    SELECT 1 FROM workbench_assignments AS retired
    WHERE retired.thread_id = draft.thread_id AND retired.superseded_at IS NOT NULL
  `;
  const listThreadRosterRows = SqlSchema.findAll({
    Request: ThreadId,
    Result: ThreadRosterRow,
    execute: (threadId) => sql`
      WITH ticket AS (
        SELECT ticket_id, title
        FROM workbench_tickets
        WHERE deleted_at IS NULL AND ticket_id IN (
          SELECT ticket_id FROM workbench_assignments
          WHERE thread_id = ${threadId} AND superseded_at IS NULL
          UNION
          SELECT draft.draft_id FROM workbench_ticket_drafts AS draft
          WHERE draft.thread_id = ${threadId}
            AND draft.phase IN ('planning', 'starting', 'working')
            AND NOT EXISTS (${retiredDraftThread})
        )
        LIMIT 1
      ),
      member AS (
        SELECT assignment.thread_id, assignment.created_at
        FROM workbench_assignments AS assignment
        INNER JOIN ticket ON ticket.ticket_id = assignment.ticket_id
        WHERE assignment.superseded_at IS NULL
        UNION ALL
        SELECT draft.thread_id, NULL
        FROM workbench_ticket_drafts AS draft
        INNER JOIN ticket ON ticket.ticket_id = draft.draft_id
        WHERE draft.phase = 'working' AND NOT EXISTS (${retiredDraftThread})
      )
      SELECT
        ticket.ticket_id AS "ticketId",
        ticket.title AS "title",
        member.thread_id AS "threadId",
        recap.run_id AS "runId",
        recap.text AS "text",
        recap.updated_at AS "updatedAt"
      FROM ticket
      LEFT JOIN member ON 1 = 1
      LEFT JOIN workbench_thread_recaps AS recap ON recap.thread_id = member.thread_id
      ORDER BY member.created_at IS NULL, member.created_at, member.thread_id
    `,
  });
  const listReferencesByTicket = SqlSchema.findAll({
    Request: FindTicketInput,
    Result: WorkbenchReference,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        url,
        title,
        added_by_thread_id AS "addedByThreadId",
        created_at AS "createdAt"
      FROM workbench_references
      WHERE ticket_id = ${ticketId}
      ORDER BY position
    `,
  });
  const getThreadRoster: WorkbenchStoreShape["getThreadRoster"] = Effect.fn(
    "WorkbenchStore.getThreadRoster",
  )(
    function* (threadId) {
      const rows = yield* listThreadRosterRows(threadId);
      const first = rows[0];
      if (!first) return Option.none<WorkbenchThreadRoster>();
      const references = yield* listReferencesByTicket({ ticketId: first.ticketId });
      const seen = new Set<ThreadId>();
      let recap: WorkbenchStoredThreadRecap | null = null;
      const siblings: Array<WorkbenchThreadRoster["siblings"][number]> = [];
      for (const row of rows) {
        if (row.threadId === null || seen.has(row.threadId)) continue;
        seen.add(row.threadId);
        if (row.threadId === threadId) recap = recapFromRosterRow(row);
        else siblings.push({ threadId: row.threadId, recap: recapFromRosterRow(row) });
      }
      return Option.some({
        ticket: {
          id: first.ticketId,
          title: first.title,
          issueLabel: workbenchTicketIssueLabel(references),
        },
        recap,
        siblings,
      });
    },
    NodeSqliteClient.readOnly,
    Effect.mapError(persistenceError),
  );
  const listThreadOwnerRows = SqlSchema.findAll({
    Request: ThreadId,
    Result: Schema.Struct({ kind: Schema.Literals(["ticket", "draft"]), id: WorkbenchTicketId }),
    execute: (threadId) => sql`
      SELECT 'ticket' AS kind, assignment.ticket_id AS id, 0 AS rank
      FROM workbench_assignments AS assignment
      INNER JOIN workbench_tickets AS ticket ON ticket.ticket_id = assignment.ticket_id
      WHERE assignment.thread_id = ${threadId}
        AND assignment.superseded_at IS NULL
        AND ticket.deleted_at IS NULL
      UNION ALL
      SELECT 'draft', draft_id, 1
      FROM workbench_ticket_drafts
      WHERE thread_id = ${threadId} AND phase IN ('creating', 'draft', 'promoting')
      ORDER BY rank
    `,
  });
  const resolveThreadOwner: WorkbenchStoreShape["resolveThreadOwner"] = Effect.fn(
    "WorkbenchStore.resolveThreadOwner",
  )(
    function* (threadId) {
      const [owner] = yield* listThreadOwnerRows(threadId);
      if (owner === undefined) return Option.none<WorkbenchThreadOwner>();
      return Option.some<WorkbenchThreadOwner>(
        owner.kind === "ticket"
          ? { kind: "ticket", ticketId: owner.id }
          : { kind: "draft", draftId: owner.id },
      );
    },
    NodeSqliteClient.readOnly,
    Effect.mapError(persistenceError),
  );
  const upsertThreadRecap: WorkbenchStoreShape["upsertThreadRecap"] = Effect.fn(
    "WorkbenchStore.upsertThreadRecap",
  )((input) =>
    sql`
      INSERT INTO workbench_thread_recaps (thread_id, run_id, text, updated_at)
      VALUES (${input.threadId}, ${input.runId}, ${input.text}, ${input.updatedAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        run_id = excluded.run_id,
        text = excluded.text,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= workbench_thread_recaps.updated_at
    `.pipe(Effect.asVoid, Effect.mapError(persistenceError)),
  );
  const listTicketThreadIdRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ threadId: ThreadId }),
    execute: () => sql`
      SELECT assignment.thread_id AS "threadId"
      FROM workbench_assignments AS assignment
      INNER JOIN workbench_tickets AS ticket ON ticket.ticket_id = assignment.ticket_id
      WHERE ticket.deleted_at IS NULL
        AND assignment.superseded_at IS NULL
      ORDER BY assignment.thread_id ASC
    `,
  });
  const listTicketThreadIds = listTicketThreadIdRows().pipe(
    Effect.map((rows) => rows.map((row) => row.threadId)),
    Effect.mapError(persistenceError),
    Effect.withSpan("WorkbenchStore.listTicketThreadIds"),
  );
  // Drafts own References until promotion; a promoted draft's id is its Ticket's id.
  const listReferenceRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchReference,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        url,
        title,
        added_by_thread_id AS "addedByThreadId",
        created_at AS "createdAt"
      FROM workbench_references
      WHERE ticket_id IN (SELECT ticket_id FROM workbench_tickets WHERE deleted_at IS NULL)
        OR ticket_id IN (
          SELECT draft_id FROM workbench_ticket_drafts
          WHERE phase IN ('creating', 'draft', 'promoting')
        )
      ORDER BY ticket_id ASC, position ASC
    `,
  });
  const listThreadRecapRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchThreadRecap,
    execute: () => sql`
      SELECT thread_id AS "threadId", text, updated_at AS "updatedAt"
      FROM workbench_thread_recaps
      WHERE thread_id IN (
        SELECT assignment.thread_id
        FROM workbench_assignments AS assignment
        INNER JOIN workbench_tickets AS ticket ON ticket.ticket_id = assignment.ticket_id
        WHERE ticket.deleted_at IS NULL
        UNION
        SELECT thread_id FROM workbench_ticket_drafts
      )
      ORDER BY thread_id ASC
    `,
  });
  const findTicketWorkspaceGeneratedBranchName = SqlSchema.findOneOption({
    Request: FindTicketInput,
    Result: Schema.Struct({ generatedBranchName: Schema.NullOr(Schema.String) }),
    execute: ({ ticketId }) => sql`
      SELECT generated_branch_name AS "generatedBranchName"
      FROM workbench_ticket_workspaces
      WHERE ticket_id = ${ticketId}
    `,
  });
  const getTicketWorkspaceGeneratedBranchName: WorkbenchStoreShape["getTicketWorkspaceGeneratedBranchName"] =
    Effect.fn("WorkbenchStore.getTicketWorkspaceGeneratedBranchName")((ticketId) =>
      findTicketWorkspaceGeneratedBranchName({ ticketId }).pipe(
        Effect.map((row) =>
          Option.flatMap(row, ({ generatedBranchName }) => Option.fromNullOr(generatedBranchName)),
        ),
        Effect.mapError(persistenceError),
      ),
    );
  const hasThreadAtWorktreePath: WorkbenchStoreShape["hasThreadAtWorktreePath"] = Effect.fn(
    "WorkbenchStore.hasThreadAtWorktreePath",
  )(function* (worktreePath: string) {
    return yield* native.hasThreadAtWorktreePath(worktreePath);
  });
  const listTicketWorkspaceRepositoriesByTicket = SqlSchema.findAll({
    Request: FindTicketInput,
    Result: WorkbenchTicketWorkspaceRepositoryRow,
    execute: ({ ticketId }) => sql`
      SELECT
        repository.ticket_id AS "ticketId",
        COALESCE(repository.attempt_id, workspace.attempt_id) AS "attemptId",
        repository.t3_project_id AS "projectId",
        repository.is_primary AS "isPrimary",
        repository.source_path AS "sourcePath",
        repository.worktree_path AS "worktreePath",
        repository.branch_name AS "branchName",
        repository.status,
        repository.error_message AS "errorMessage",
        repository.created_at AS "createdAt",
        repository.updated_at AS "updatedAt"
      FROM workbench_ticket_workspace_repositories AS repository
      INNER JOIN workbench_ticket_workspaces AS workspace
        ON workspace.ticket_id = repository.ticket_id
      WHERE repository.ticket_id = ${ticketId}
      ORDER BY repository.is_primary DESC, repository.t3_project_id ASC
    `,
  });
  const findT3Project = Effect.fn("WorkbenchStore.findT3Project")(function* ({
    linkedProjectId,
  }: {
    readonly linkedProjectId: ProjectId;
  }) {
    return yield* native.findProject(linkedProjectId);
  });
  const validateLinkedProject = Effect.fn("WorkbenchStore.validateLinkedProject")(function* ({
    linkedProjectId,
  }: {
    readonly linkedProjectId: ProjectId;
  }) {
    const project = yield* findT3Project({ linkedProjectId }).pipe(
      Effect.mapError(persistenceError),
    );
    if (Option.isNone(project)) {
      return yield* new WorkbenchOperationError({
        code: "linked_project_not_found",
        message: "A linked T3 Project does not exist on this environment.",
      });
    }
    if (!(yield* native.isRepository(project.value.workspaceRoot))) {
      return yield* new WorkbenchOperationError({
        code: "linked_project_not_repository",
        message: "A linked T3 Project must point to a Git repository.",
      });
    }
    return project.value;
  });
  const findProject = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: WorkbenchProjectId }),
    Result: WorkbenchProjectRow,
    execute: ({ id }) => sql`
      SELECT
        project_id AS "id",
        title,
        archived_at AS "archivedAt",
        revision,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_projects
      WHERE project_id = ${id} AND deleted_at IS NULL
    `,
  });
  const getProject: WorkbenchStoreShape["getProject"] = Effect.fn("WorkbenchStore.getProject")(
    (projectId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const project = yield* findProject({ id: projectId });
            if (Option.isNone(project)) return Option.none<WorkbenchProject>();
            const links = yield* listProjectLinkRows();
            return Option.some(
              WorkbenchProject.make({
                ...project.value,
                linkedProjectIds: links
                  .filter((link) => link.projectId === projectId)
                  .map((link) => link.linkedProjectId),
              }),
            );
          }),
        )
        .pipe(NodeSqliteClient.readOnly, Effect.mapError(workbenchStoreError)),
  );

  const requireActiveProject: WorkbenchStoreShape["requireActiveProject"] = Effect.fn(
    "WorkbenchStore.requireActiveProject",
  )(function* (projectId) {
    const project = yield* findProject({ id: projectId }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(project))
      return yield* new WorkbenchOperationError({
        code: "project_not_found",
        message: "The Workbench Workspace does not exist.",
      });
    if (project.value.archivedAt !== null)
      return yield* new WorkbenchOperationError({
        code: "project_archived",
        message: "Archived Workbench Workspaces are read-only. Restore the Workspace first.",
      });
    return;
  });

  const lockProject = (projectId: WorkbenchProjectId) => sql`
    UPDATE workbench_projects SET updated_at = updated_at WHERE project_id = ${projectId}
  `;
  const requireProjectRevision = Effect.fnUntraced(function* (input: {
    readonly id: WorkbenchProjectId;
    readonly expectedRevision: number;
  }) {
    yield* lockProject(input.id);
    const project = yield* getProject(input.id);
    if (Option.isNone(project))
      return yield* new WorkbenchOperationError({
        code: "project_not_found",
        message: "The Workbench Workspace does not exist.",
      });
    if (project.value.revision !== input.expectedRevision)
      return yield* new WorkbenchOperationError({
        code: "project_changed",
        message: "The Workbench Workspace changed. Refresh it and try again.",
      });
    return project.value;
  });

  const requireStableProjectWorkspaces = Effect.fnUntraced(function* (
    projectId: WorkbenchProjectId,
  ) {
    const busy = yield* sql`
      SELECT 1 FROM workbench_ticket_workspaces w JOIN workbench_tickets t ON t.ticket_id = w.ticket_id
      WHERE t.workbench_project_id = ${projectId} AND w.status IN ('preparing', 'releasing') LIMIT 1
    `;
    const changingDrafts = yield* sql`SELECT 1 FROM workbench_ticket_drafts
      WHERE workbench_project_id = ${projectId} AND phase IN ('creating', 'promoting', 'starting', 'discarding') LIMIT 1`;
    if (changingDrafts.length > 0)
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_busy",
        message:
          "Ticket preparation is changing. Finish or retry it before changing the workspace lifecycle.",
      });
    if (busy.length > 0)
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_in_use",
        message:
          "A Ticket Workspace is changing. Wait for it to finish before changing the Workspace lifecycle.",
      });
  });

  const findProjectLink = SqlSchema.findOneOption({
    Request: FindProjectLinkInput,
    Result: WorkbenchProjectLinkRow,
    execute: ({ projectId, linkedProjectId }) => sql`
      SELECT
        workbench_project_id AS "projectId",
        t3_project_id AS "linkedProjectId",
        position
      FROM workbench_project_links
      WHERE workbench_project_id = ${projectId}
        AND t3_project_id = ${linkedProjectId}
    `,
  });
  const findTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: WorkbenchTicketId }),
    Result: WorkbenchTicketRow,
    execute: ({ id }) => sql`
      SELECT
        ticket_id AS "id",
        workbench_project_id AS "projectId",
        epic_id AS "epicId",
        title,
        kind,
        markdown,
        primary_t3_project_id AS "primaryT3ProjectId",
        status,
        blocked,
        revision,
        generated_summary AS "generatedSummaryText",
        generated_summary_status AS "generatedSummaryStatus",
        generated_summary_stale AS "generatedSummaryStale",
        generated_summary_error AS "generatedSummaryError",
        generated_summary_source_hash AS "generatedSummarySourceHash",
        generated_summary_request_id AS "generatedSummaryRequestId",
        archived_at AS "archivedAt",
        updated_by_thread_id AS "updatedByThreadId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      WHERE ticket_id = ${id}
        AND deleted_at IS NULL
    `,
  });
  const lockAndFindTicket = Effect.fn("WorkbenchStore.lockAndFindTicket")(function* ({
    ticketId,
    activeOnly,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly activeOnly: boolean;
  }) {
    // SQLite's no-op UPDATE acquires the writer lock. Callers must invoke this
    // helper from their existing transaction before checking ticket invariants.
    const predicates = [sql`ticket_id = ${ticketId}`];
    if (activeOnly) predicates.push(sql`deleted_at IS NULL`);
    yield* sql`
      UPDATE workbench_tickets
      SET updated_at = updated_at
      WHERE ${sql.and(predicates)}
    `;
    return yield* findTicket({ id: ticketId });
  });
  const requireTicketRevision = Effect.fn("WorkbenchStore.requireTicketRevision")(function* ({
    ticketId,
    expectedRevision,
    revisionMessage,
    activeOnly,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly expectedRevision: number;
    readonly revisionMessage: string;
    readonly activeOnly: boolean;
  }) {
    const ticket = yield* lockAndFindTicket({ ticketId, activeOnly });
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    yield* requireActiveProject(ticket.value.projectId);
    if (ticket.value.revision !== expectedRevision) {
      return yield* new WorkbenchOperationError({
        code: "ticket_changed",
        message: revisionMessage,
      });
    }
    return ticket.value;
  });
  const requireActiveTicket = Effect.fn("WorkbenchStore.requireActiveTicket")(function* ({
    ticketId,
    archivedMessage,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly archivedMessage: string;
  }) {
    const ticket = yield* lockAndFindTicket({ ticketId, activeOnly: false });
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    yield* requireActiveProject(ticket.value.projectId);
    if (ticket.value.archivedAt !== null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: archivedMessage,
      });
    }
    return ticket.value;
  });
  const findEpicRow = SqlSchema.findOneOption({
    Request: FindEpicInput,
    Result: WorkbenchEpicRow,
    execute: ({ epicId }) => sql`
      SELECT
        epic_id AS "id",
        workbench_project_id AS "projectId",
        title,
        markdown,
        archived_at AS "archivedAt",
        jira_issue_key AS "jiraIssueKey",
        jira_issue_url AS "jiraIssueUrl",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_epics
      WHERE epic_id = ${epicId}
        AND workbench_project_id IN (SELECT project_id FROM workbench_projects WHERE deleted_at IS NULL)
    `,
  });
  const findEpic = (input: typeof FindEpicInput.Type) =>
    findEpicRow(input).pipe(Effect.map(Option.map(epicFromRow)));
  const findNativeThread = Effect.fn("WorkbenchStore.findNativeThread")(function* ({
    threadId,
  }: {
    readonly threadId: ThreadId;
  }) {
    return yield* native.findThread(threadId);
  });
  const findActiveAssignmentByTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
      AND superseded_at IS NULL
    `,
  });
  const listActiveAssignmentsByTicket = SqlSchema.findAll({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
        AND superseded_at IS NULL
      ORDER BY created_at ASC, assignment_id ASC
    `,
  });
  const findActiveAssignmentByTicketAndThread = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId, threadId: ThreadId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId, threadId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
        AND thread_id = ${threadId}
        AND superseded_at IS NULL
    `,
  });
  const findAssignmentByThread = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: WorkbenchAssignment,
    execute: ({ threadId }) => sql`
      SELECT assignment_id AS "id", ticket_id AS "ticketId", thread_id AS "threadId",
        created_at AS "createdAt", superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE thread_id = ${threadId}
    `,
  });
  const findActiveLiveAssignmentByTicket = Effect.fn(
    "WorkbenchStore.findActiveLiveAssignmentByTicket",
  )(function* ({ ticketId }: { readonly ticketId: WorkbenchTicketId }) {
    // Keep the assignment read and native existence checks in the caller's
    // transaction. The native adapter uses the same SqlClient connection.
    const assignments = yield* listActiveAssignmentsByTicket({ ticketId });
    for (const assignment of assignments) {
      const thread = yield* native.findThread(assignment.threadId);
      if (Option.isSome(thread)) return Option.some(assignment);
    }
    return Option.none<WorkbenchAssignment>();
  });
  const listLinkedAssignmentsByTicket = SqlSchema.findAll({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
      ORDER BY created_at ASC, assignment_id ASC
    `,
  });
  const findLinkedLiveAssignmentByTicket = Effect.fn(
    "WorkbenchStore.findLinkedLiveAssignmentByTicket",
  )(function* ({ ticketId }: { readonly ticketId: WorkbenchTicketId }) {
    // Keep every assignment in this guard, including superseded history. A
    // native archived Thread remains live until it is explicitly deleted.
    const assignments = yield* listLinkedAssignmentsByTicket({ ticketId });
    for (const assignment of assignments) {
      const thread = yield* native.findThread(assignment.threadId);
      if (Option.isSome(thread)) return Option.some(assignment);
    }
    return Option.none<WorkbenchAssignment>();
  });
  const supersedeAssignmentRow = SqlSchema.findOneOption({
    Request: Schema.Struct({
      ticketId: WorkbenchTicketId,
      previousThreadId: ThreadId,
      replacedAt: WorkbenchAssignment.fields.createdAt,
    }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId, previousThreadId, replacedAt }) => sql`
      UPDATE workbench_assignments
      SET superseded_at = ${replacedAt}
      WHERE ticket_id = ${ticketId}
        AND thread_id = ${previousThreadId}
        AND superseded_at IS NULL
      RETURNING
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
    `,
  });

  const hydrateTicketWorkspace = ({
    workspace,
    repositories,
  }: {
    workspace: typeof WorkbenchTicketWorkspaceRow.Type;
    repositories: ReadonlyArray<typeof WorkbenchTicketWorkspaceRepositoryRow.Type>;
  }) =>
    WorkbenchTicketWorkspace.make({
      ...workspace,
      repositories: repositories.map((repository) => ({
        projectId: repository.projectId,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
        branchName: repository.branchName,
        status: repository.status,
        errorMessage: repository.errorMessage,
        createdAt: repository.createdAt,
        updatedAt: repository.updatedAt,
        isPrimary: repository.isPrimary === 1,
      })),
    });

  const loadTicketWorkspace = Effect.fn("WorkbenchStore.loadTicketWorkspace")(function* (
    ticketId: WorkbenchTicketId,
  ) {
    const workspace = yield* findTicketWorkspaceRow({ ticketId });
    if (Option.isNone(workspace)) return Option.none<WorkbenchTicketWorkspace>();
    const repositories = yield* listTicketWorkspaceRepositoriesByTicket({ ticketId });
    return Option.some(hydrateTicketWorkspace({ workspace: workspace.value, repositories }));
  });

  const requireWorkspaceMutationTicket = Effect.fnUntraced(function* (
    ticketId: WorkbenchTicketId,
    allowRetained = false,
  ) {
    const ticket = yield* lockAndFindTicket({ ticketId, activeOnly: false });
    if (Option.isSome(ticket)) {
      yield* requireActiveProject(ticket.value.projectId);
      return;
    }
    if (allowRetained) {
      yield* requireDeletedWorkspaceTicket(ticketId);
      const workspace = yield* findTicketWorkspaceRow({ ticketId });
      if (
        Option.isSome(workspace) &&
        (workspace.value.status === "releasing" || workspace.value.status === "released")
      )
        return;
    }
    return yield* new WorkbenchOperationError({
      code: "ticket_not_found",
      message: "The Workbench Ticket does not exist.",
    });
  });

  const requireTicketWorkspaceAttempt = Effect.fn("WorkbenchStore.requireTicketWorkspaceAttempt")(
    function* ({
      ticketId,
      attemptId,
    }: {
      ticketId: WorkbenchTicketId;
      attemptId: WorkbenchTicketWorkspaceAttemptId;
    }) {
      const workspace = yield* findTicketWorkspaceRow({ ticketId });
      if (Option.isNone(workspace)) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_not_found",
          message: "The Ticket Workspace does not exist.",
        });
      }
      if (workspace.value.attemptId !== attemptId) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_changed",
          message: "The Ticket Workspace preparation changed before it could be updated.",
        });
      }
      return workspace.value;
    },
  );

  const getSnapshot = Effect.fn("WorkbenchStore.getSnapshot")(function* (compact: boolean) {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [
          projectRows,
          linkRows,
          epicRows,
          ticketRows,
          ticketRepositoryRows,
          assignments,
          reservedThreadRows,
          ticketWorkspaceRows,
          ticketWorkspaceRepositoryRows,
          threadRecaps,
          references,
        ] = yield* Effect.all([
          listProjectRows(),
          listProjectLinkRows(),
          listEpicRows(),
          listTicketRows(compact),
          listTicketRepositoryRows(),
          listAssignmentRows(),
          listReservedThreadIds(),
          listTicketWorkspaceRows(),
          listTicketWorkspaceRepositoryRows(),
          listThreadRecapRows(),
          listReferenceRows(),
        ]);
        const linksByProject = new Map<
          string,
          Array<(typeof WorkbenchProjectLinkRow.Type)["linkedProjectId"]>
        >();
        for (const link of linkRows) {
          const links = linksByProject.get(link.projectId) ?? [];
          links.push(link.linkedProjectId);
          linksByProject.set(link.projectId, links);
        }
        const repositoriesByTicket = new Map<string, Array<ProjectId>>();
        for (const repository of ticketRepositoryRows) {
          const repositories = repositoriesByTicket.get(repository.ticketId) ?? [];
          repositories.push(repository.repositoryProjectId);
          repositoriesByTicket.set(repository.ticketId, repositories);
        }
        const workspaceRepositoriesByTicket = new Map<
          string,
          Array<typeof WorkbenchTicketWorkspaceRepositoryRow.Type>
        >();
        for (const repository of ticketWorkspaceRepositoryRows) {
          const repositories = workspaceRepositoriesByTicket.get(repository.ticketId) ?? [];
          repositories.push(repository);
          workspaceRepositoriesByTicket.set(repository.ticketId, repositories);
        }
        return WorkbenchSnapshot.make({
          supportsEpicLifecycle: true,
          ticketDrafts: yield* listTicketDrafts.pipe(
            Effect.provideService(WorkbenchNativeAccess, native),
            Effect.provideService(SqlClient.SqlClient, sql),
          ),
          projects: projectRows.map((project) => ({
            ...project,
            linkedProjectIds: linksByProject.get(project.id) ?? [],
          })),
          epics: epicRows.map(epicFromRow),
          tickets: ticketRows.map((ticket) => ({
            ...ticketFromRow(
              ticket,
              repositoriesByTicket.get(ticket.id) ?? [ticket.primaryT3ProjectId],
            ),
            ...(compact && ticket.archivedAt !== null ? { markdownOmitted: true } : {}),
          })),
          assignments,
          reservedThreadIds: reservedThreadRows.map((row) => row.id),
          ticketWorkspaces: ticketWorkspaceRows.map((workspace) =>
            hydrateTicketWorkspace({
              workspace,
              repositories: workspaceRepositoriesByTicket.get(workspace.ticketId) ?? [],
            }),
          ),
          threadRecaps,
          references,
        });
      }),
    );
  }, Effect.mapError(persistenceError));

  const listTicketsNeedingSummary = Effect.fn("WorkbenchStore.listTicketsNeedingSummary")(
    function* () {
      const candidateRows = yield* listTicketSummaryCandidateIds().pipe(
        Effect.mapError(persistenceError),
      );
      const candidateIds = new Set(candidateRows.map(({ ticketId }) => ticketId));
      const snapshot = yield* getSnapshot(false);
      return snapshot.tickets.filter((ticket) => candidateIds.has(ticket.id));
    },
    NodeSqliteClient.readOnly,
  );

  const getTicketSummaryCandidate = Effect.fn("WorkbenchStore.getTicketSummaryCandidate")(
    (ticketId: WorkbenchTicketId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const ticket = yield* findTicket({ id: ticketId });
            if (
              Option.isNone(ticket) ||
              ticket.value.archivedAt !== null ||
              ticket.value.generatedSummaryStatus !== "pending"
            ) {
              return Option.none<WorkbenchTicket>();
            }
            const project = yield* findProject({ id: ticket.value.projectId });
            if (Option.isNone(project) || project.value.archivedAt !== null)
              return Option.none<WorkbenchTicket>();
            const repositories = yield* listTicketRepositoryRowsByTicket({ ticketId });
            return Option.some(
              ticketFromRow(
                ticket.value,
                repositories.length > 0
                  ? repositories.map((repository) => repository.repositoryProjectId)
                  : [ticket.value.primaryT3ProjectId],
              ),
            );
          }),
        )
        .pipe(NodeSqliteClient.readOnly, Effect.mapError(persistenceError)),
  );

  const getTicketWorkspace: WorkbenchStoreShape["getTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.getTicketWorkspace",
  )((ticketId) =>
    sql
      .withTransaction(loadTicketWorkspace(ticketId))
      .pipe(NodeSqliteClient.readOnly, Effect.mapError(persistenceError)),
  );

  const getTicketWorkspaceRepositoryStates: WorkbenchStoreShape["getTicketWorkspaceRepositoryStates"] =
    Effect.fn("WorkbenchStore.getTicketWorkspaceRepositoryStates")((ticketId) =>
      sql
        .withTransaction(
          sql<WorkbenchTicketWorkspaceRepositoryState>`
            SELECT
              repository.t3_project_id AS "projectId",
              COALESCE(repository.attempt_id, workspace.attempt_id) AS "attemptId",
              repository.status AS "status"
            FROM workbench_ticket_workspace_repositories AS repository
            INNER JOIN workbench_ticket_workspaces AS workspace
              ON workspace.ticket_id = repository.ticket_id
            WHERE repository.ticket_id = ${ticketId}
            ORDER BY repository.t3_project_id ASC
          `,
        )
        .pipe(NodeSqliteClient.readOnly, Effect.mapError(persistenceError)),
    );

  const validateTicketWorkspaceClaim = Effect.fn("WorkbenchStore.validateTicketWorkspaceClaim")(
    function* (input: WorkbenchClaimTicketWorkspaceInput) {
      const ticket = yield* requireActiveTicket({
        ticketId: input.ticketId,
        archivedMessage: "Archived Workbench Tickets cannot receive a Workspace.",
      });
      const ticketRepositories = yield* listTicketRepositoryRowsByTicket({
        ticketId: input.ticketId,
      });
      const expectedProjectIds = ticketRepositories.map(
        (repository) => repository.repositoryProjectId,
      );
      const suppliedProjectIds = input.repositories.map((repository) => repository.projectId);
      const repositoryScopeMatches =
        new Set(suppliedProjectIds).size === suppliedProjectIds.length &&
        suppliedProjectIds.length === expectedProjectIds.length &&
        suppliedProjectIds.every((projectId) => expectedProjectIds.includes(projectId));
      const primaryRepositories = input.repositories.filter((repository) => repository.isPrimary);
      if (
        !repositoryScopeMatches ||
        primaryRepositories.length !== 1 ||
        primaryRepositories[0]?.projectId !== ticket.primaryT3ProjectId
      ) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_changed",
          message: "The Ticket repository scope changed before its Workspace could be prepared.",
        });
      }
    },
  );

  const selectedGeneratedBranchName = (input: WorkbenchClaimTicketWorkspaceInput) =>
    input.generatedBranchName === undefined ? input.branchName : input.generatedBranchName;

  const reconcileReadyTicketWorkspace = Effect.fn("WorkbenchStore.reconcileReadyTicketWorkspace")(
    function* (input: WorkbenchClaimTicketWorkspaceInput) {
      yield* sql`
      UPDATE workbench_ticket_workspace_repositories
      SET is_primary = 0, updated_at = ${input.claimedAt}
      WHERE ticket_id = ${input.ticketId}
    `;
      const primary = input.repositories.find((repository) => repository.isPrimary);
      if (primary !== undefined) {
        yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET is_primary = 1, updated_at = ${input.claimedAt}
        WHERE ticket_id = ${input.ticketId}
          AND t3_project_id = ${primary.projectId}
      `;
      }
      for (const repository of input.repositories) {
        if (repository.branchName === undefined) continue;
        yield* sql`
          UPDATE workbench_ticket_workspace_repositories
          SET branch_name = ${repository.branchName}, updated_at = ${input.claimedAt}
          WHERE ticket_id = ${input.ticketId}
            AND t3_project_id = ${repository.projectId}
        `;
      }
      yield* sql`
      UPDATE workbench_ticket_workspaces
      SET
        generated_branch_name = COALESCE(
          generated_branch_name,
          ${selectedGeneratedBranchName(input)}
        ),
        error_message = NULL,
        updated_at = ${input.claimedAt}
      WHERE ticket_id = ${input.ticketId}
    `;
      return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
    },
  );

  const beginTicketWorkspaceClaim = Effect.fn("WorkbenchStore.beginTicketWorkspaceClaim")(
    function* ({
      input,
      existing,
    }: {
      readonly input: WorkbenchClaimTicketWorkspaceInput;
      readonly existing: Option.Option<typeof WorkbenchTicketWorkspaceRow.Type>;
    }) {
      if (Option.isSome(existing)) {
        yield* sql`
          DELETE FROM workbench_ticket_workspace_repositories
          WHERE ticket_id = ${input.ticketId}
            AND status <> 'ready'
        `;
        yield* sql`
          UPDATE workbench_ticket_workspaces
          SET
            attempt_id = ${input.attemptId},
            status = 'preparing',
            generated_branch_name = COALESCE(
              generated_branch_name,
              ${selectedGeneratedBranchName(input)}
            ),
            error_message = NULL,
            updated_at = ${input.claimedAt}
          WHERE ticket_id = ${input.ticketId}
        `;
        return;
      }
      yield* sql`
        INSERT INTO workbench_ticket_workspaces (
          ticket_id,
          attempt_id,
          status,
          branch_name,
          generated_branch_name,
          error_message,
          created_at,
          updated_at
        ) VALUES (
          ${input.ticketId},
          ${input.attemptId},
          'preparing',
          ${input.branchName},
          ${selectedGeneratedBranchName(input)},
          NULL,
          ${input.claimedAt},
          ${input.claimedAt}
        )
      `;
    },
  );

  const persistTicketWorkspaceRepositories = Effect.fn(
    "WorkbenchStore.persistTicketWorkspaceRepositories",
  )(function* ({
    input,
    readyProjectIds,
  }: {
    readonly input: WorkbenchClaimTicketWorkspaceInput;
    readonly readyProjectIds: ReadonlySet<ProjectId>;
  }) {
    yield* sql`
      UPDATE workbench_ticket_workspace_repositories
      SET is_primary = 0, updated_at = ${input.claimedAt}
      WHERE ticket_id = ${input.ticketId}
    `;
    for (const repository of input.repositories) {
      if (readyProjectIds.has(repository.projectId)) {
        if (repository.branchName !== undefined || repository.isPrimary) {
          yield* sql`
            UPDATE workbench_ticket_workspace_repositories
            SET
              is_primary = CASE WHEN ${repository.isPrimary ? 1 : 0} = 1 THEN 1 ELSE is_primary END,
              branch_name = COALESCE(${repository.branchName ?? null}, branch_name),
              updated_at = ${input.claimedAt}
            WHERE ticket_id = ${input.ticketId}
              AND t3_project_id = ${repository.projectId}
          `;
        }
        continue;
      }
      yield* sql`
        INSERT INTO workbench_ticket_workspace_repositories (
          ticket_id,
          t3_project_id,
          attempt_id,
          is_primary,
          source_path,
          worktree_path,
          branch_name,
          status,
          error_message,
          created_at,
          updated_at
        ) VALUES (
          ${input.ticketId},
          ${repository.projectId},
          ${input.attemptId},
          ${repository.isPrimary ? 1 : 0},
          ${repository.sourcePath},
          ${repository.worktreePath},
          ${repository.branchName ?? input.branchName},
          'pending',
          NULL,
          ${input.claimedAt},
          ${input.claimedAt}
        )
      `;
    }
  });

  const claimTicketWorkspaceRecovery: WorkbenchStoreShape["claimTicketWorkspaceRecovery"] =
    Effect.fn("WorkbenchStore.claimTicketWorkspaceRecovery")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireTicketRevision({
              ticketId: input.ticketId,
              expectedRevision: input.expectedRevision,
              revisionMessage: "The Ticket changed before Workspace recovery could start.",
              activeOnly: true,
            });
            yield* requireActiveTicket({
              ticketId: input.ticketId,
              archivedMessage: "Archived Workbench Tickets cannot recover a Workspace.",
            });
            const workspace = yield* requireTicketWorkspaceAttempt(input);
            if (workspace.status !== "failed") {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_preparation_changed",
                message: "The Ticket Workspace changed before recovery could start.",
              });
            }
            yield* sql`
          UPDATE workbench_ticket_workspaces
          SET status = 'preparing', updated_at = ${input.claimedAt}
          WHERE ticket_id = ${input.ticketId}
        `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const claimTicketWorkspace: WorkbenchStoreShape["claimTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.claimTicketWorkspace",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* validateTicketWorkspaceClaim(input);
          const branchOwner = yield* sql<{ readonly ticketId: WorkbenchTicketId }>`
            SELECT ticket_id AS "ticketId"
            FROM workbench_ticket_workspaces
            WHERE branch_name = ${input.branchName} AND ticket_id <> ${input.ticketId}
            LIMIT 1
          `;
          if (branchOwner.length > 0) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_failed",
              message: `The Ticket Workspace branch ${input.branchName} is already assigned to another Ticket.`,
            });
          }
          const existing = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (Option.isSome(existing) && existing.value.status === "preparing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_in_progress",
              message: "The Ticket Workspace is already being prepared.",
            });
          }
          if (Option.isSome(existing) && existing.value.status === "releasing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_in_progress",
              message: "The Ticket Workspace is being released.",
            });
          }
          const existingRepositories = Option.isSome(existing)
            ? yield* listTicketWorkspaceRepositoriesByTicket({ ticketId: input.ticketId })
            : [];
          const readyProjectIds = new Set(
            existingRepositories
              .filter((repository) => repository.status === "ready")
              .map((repository) => repository.projectId),
          );
          const needsPreparation = Option.isNone(existing)
            ? true
            : existing.value.status !== "ready" ||
              input.repositories.some((repository) => !readyProjectIds.has(repository.projectId));
          if (Option.isSome(existing) && !needsPreparation) {
            return yield* reconcileReadyTicketWorkspace(input);
          }
          yield* beginTicketWorkspaceClaim({ input, existing });
          yield* persistTicketWorkspaceRepositories({ input, readyProjectIds });
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const requirePreparingTicketWorkspace = Effect.fnUntraced(function* (input: {
    readonly ticketId: WorkbenchTicketId;
    readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  }) {
    yield* requireWorkspaceMutationTicket(input.ticketId);
    const workspace = yield* requireTicketWorkspaceAttempt(input);
    if (workspace.status !== "preparing")
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_preparation_changed",
        message: "The Ticket Workspace is no longer being prepared.",
      });
  });

  const markTicketWorkspaceRepositoryReady: WorkbenchStoreShape["markTicketWorkspaceRepositoryReady"] =
    Effect.fn("WorkbenchStore.markTicketWorkspaceRepositoryReady")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requirePreparingTicketWorkspace(input);
            const updated = yield* sql<{
              readonly projectId: ProjectId;
            }>`
              UPDATE workbench_ticket_workspace_repositories
              SET
                worktree_path = ${input.worktreePath},
                branch_name = ${input.branchName},
                status = 'ready',
                error_message = NULL,
                updated_at = ${input.updatedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
                AND attempt_id = ${input.attemptId}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET updated_at = ${input.updatedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const completeTicketWorkspace: WorkbenchStoreShape["completeTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.completeTicketWorkspace",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requirePreparingTicketWorkspace(input);
          const repositories = yield* listTicketWorkspaceRepositoriesByTicket({
            ticketId: input.ticketId,
          });
          if (
            repositories.length === 0 ||
            repositories.some((repository) => repository.status !== "ready")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_failed",
              message: "Every Ticket repository must be ready before its Workspace is ready.",
            });
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'ready', error_message = NULL, updated_at = ${input.completedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const persistTicketWorkspaceFailure = Effect.fnUntraced(function* ({
    input,
    matchRepositoryAttempt,
  }: {
    readonly input: WorkbenchFailTicketWorkspaceInput;
    readonly matchRepositoryAttempt: boolean;
  }) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireWorkspaceMutationTicket(input.ticketId);
          yield* requireTicketWorkspaceAttempt(input);
          if (input.projectId !== null) {
            const updated = yield* sql<{ readonly projectId: ProjectId }>`
              UPDATE workbench_ticket_workspace_repositories
              SET status = 'failed', error_message = ${input.errorMessage}, updated_at = ${input.failedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
                AND ${matchRepositoryAttempt ? sql`attempt_id = ${input.attemptId}` : sql`1 = 1`}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'failed', error_message = ${input.errorMessage}, updated_at = ${input.failedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const failTicketWorkspace: WorkbenchStoreShape["failTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.failTicketWorkspace",
  )((input) => persistTicketWorkspaceFailure({ input, matchRepositoryAttempt: false }));

  const failTicketWorkspaceExtension: WorkbenchStoreShape["failTicketWorkspaceExtension"] =
    Effect.fn("WorkbenchStore.failTicketWorkspaceExtension")((input) =>
      persistTicketWorkspaceFailure({ input, matchRepositoryAttempt: true }),
    );

  const releaseTicketWorkspaceRepository: WorkbenchStoreShape["releaseTicketWorkspaceRepository"] =
    Effect.fn("WorkbenchStore.releaseTicketWorkspaceRepository")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireWorkspaceMutationTicket(input.ticketId, true);
            yield* requireTicketWorkspaceAttempt(input);
            const updated = yield* sql<{ readonly projectId: ProjectId }>`
              UPDATE workbench_ticket_workspace_repositories
              SET
                status = 'released',
                branch_name = COALESCE(${input.branchName ?? null}, branch_name),
                updated_at = ${input.releasedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET updated_at = ${input.releasedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const ensureNoNativeThreadUsesWorkspace = Effect.fnUntraced(function* ({
    ticketId,
  }: {
    ticketId: WorkbenchTicketId;
  }) {
    const repositories = yield* listTicketWorkspaceRepositoriesByTicket({
      ticketId: ticketId,
    });
    for (const repository of repositories) {
      if (
        repository.status !== "released" &&
        (yield* native.hasThreadAtWorktreePath(repository.worktreePath))
      ) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_in_use",
          message:
            "The Ticket Workspace cannot be reset while a native Thread still uses one of its worktrees.",
        });
      }
    }
  });

  const requireDeletedWorkspaceTicket = Effect.fnUntraced(function* (ticketId: WorkbenchTicketId) {
    const tickets = yield* sql<{ deletedAt: string | null }>`
      SELECT deleted_at AS "deletedAt"
      FROM workbench_tickets
      WHERE ticket_id = ${ticketId}
    `;
    const ticket = tickets[0];
    if (ticket === undefined) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.deletedAt === null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_changed",
        message: "Only a deleted Ticket's retained Workspace can be removed.",
      });
    }
  });

  const claimTicketWorkspaceRelease: WorkbenchStoreShape["claimTicketWorkspaceRelease"] = Effect.fn(
    "WorkbenchStore.claimTicketWorkspaceRelease",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          if (input.requireDeletedTicket !== true) {
            yield* requireWorkspaceMutationTicket(input.ticketId);
          }
          if (input.requireActiveTicket === true) {
            yield* requireActiveTicket({
              ticketId: input.ticketId,
              archivedMessage: "Archived Workbench Tickets cannot release a Workspace.",
            });
          }
          if (input.requireDeletedTicket === true) {
            yield* requireDeletedWorkspaceTicket(input.ticketId);
          }
          if (input.expectedRevision !== undefined) {
            yield* requireTicketRevision({
              ticketId: input.ticketId,
              expectedRevision: input.expectedRevision,
              revisionMessage: "The Ticket changed before Workspace recovery could start.",
              activeOnly: true,
            });
          }
          const workspace = yield* requireTicketWorkspaceAttempt(input);
          if (workspace.status === "released") {
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }
          if (workspace.status === "preparing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_in_progress",
              message: "The Ticket Workspace is still being prepared.",
            });
          }
          const assignment = yield* input.requireNoLinkedThreads
            ? findLinkedLiveAssignmentByTicket({ ticketId: input.ticketId })
            : findActiveLiveAssignmentByTicket({ ticketId: input.ticketId });
          if (Option.isSome(assignment)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: input.requireNoLinkedThreads
                ? "The Ticket Workspace cannot be reset while it has linked Agent Threads, including archived or historical Threads."
                : "The Ticket Workspace cannot be released while it has an active Agent Thread.",
            });
          }
          if (input.requireNoLinkedThreads === true) {
            yield* ensureNoNativeThreadUsesWorkspace({ ticketId: input.ticketId });
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'releasing', updated_at = ${input.claimedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const completeTicketWorkspaceRelease: WorkbenchStoreShape["completeTicketWorkspaceRelease"] =
    Effect.fn("WorkbenchStore.completeTicketWorkspaceRelease")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireWorkspaceMutationTicket(input.ticketId, true);
            yield* requireTicketWorkspaceAttempt(input);
            const repositories = yield* listTicketWorkspaceRepositoriesByTicket({
              ticketId: input.ticketId,
            });
            if (repositories.some((repository) => repository.status === "ready")) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_preparation_failed",
                message: "Every prepared repository must be removed before release completes.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspace_repositories
              SET status = 'released', updated_at = ${input.completedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET status = 'released', updated_at = ${input.completedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const createProject: WorkbenchStoreShape["createProject"] = Effect.fn(
    "WorkbenchStore.createProject",
  )(function* (input) {
    const linkedProjectIds = [...new Set(input.linkedProjectIds)];
    for (const linkedProjectId of linkedProjectIds) {
      yield* validateLinkedProject({ linkedProjectId });
    }

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
          INSERT INTO workbench_projects (project_id, title, created_at, updated_at)
          VALUES (${input.id}, ${input.title}, ${input.createdAt}, ${input.createdAt})
        `;
          for (const [position, linkedProjectId] of linkedProjectIds.entries()) {
            yield* sql`
            INSERT INTO workbench_project_links (
              workbench_project_id,
              t3_project_id,
              position
            ) VALUES (${input.id}, ${linkedProjectId}, ${position})
          `;
          }
        }),
      )
      .pipe(Effect.mapError(persistenceError));

    return WorkbenchProject.make({
      ...input,
      linkedProjectIds,
      archivedAt: null,
      revision: 0,
      updatedAt: input.createdAt,
    });
  });

  const archiveProject: WorkbenchStoreShape["archiveProject"] = Effect.fn(
    "WorkbenchStore.archiveProject",
  )(function* (input) {
    const { project, pendingTickets } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireProjectRevision(input);
          yield* requireStableProjectWorkspaces(input.id);
          const sequence = yield* native.executionSequence;
          yield* sql`
        UPDATE workbench_projects SET archived_at = ${input.archivedAt}, revision = revision + 1,
          execution_after_sequence = MAX(execution_after_sequence, ${sequence}), updated_at = ${input.updatedAt} WHERE project_id = ${input.id}
      `;
          // Old summary requests and delayed native executions must not cross a
          // Workspace archive/restore boundary, even when workers finish later.
          yield* sql`
        UPDATE workbench_tickets SET generated_summary_request_id = NULL
        WHERE workbench_project_id = ${input.id} AND deleted_at IS NULL
      `;
          const pendingTickets =
            input.archivedAt === null
              ? yield* sql<{ readonly ticketId: WorkbenchTicketId }>`
                SELECT ticket_id AS "ticketId" FROM workbench_tickets
                WHERE workbench_project_id = ${input.id} AND deleted_at IS NULL
                  AND archived_at IS NULL AND generated_summary_status = 'pending'
              `
              : [];
          return {
            project: WorkbenchProject.make({
              ...current,
              archivedAt: input.archivedAt,
              revision: input.expectedRevision + 1,
              updatedAt: input.updatedAt,
            }),
            pendingTickets,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    for (const { ticketId } of pendingTickets) yield* publishTicketChange(ticketId);
    return project;
  });

  const requireIdlePlanningThreads = Effect.fn("WorkbenchStore.requireIdlePlanningThreads")(
    function* (threadIds: ReadonlyArray<ThreadId>) {
      for (const threadId of threadIds) {
        if (yield* native.hasPendingThreadWork(threadId)) {
          return yield* new WorkbenchOperationError({
            code: "ticket_draft_busy",
            message:
              "Stop or finish the planning conversation before deleting its Ticket or workspace.",
          });
        }
      }
    },
  );

  const deleteProject: WorkbenchStoreShape["deleteProject"] = Effect.fn(
    "WorkbenchStore.deleteProject",
  )((input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireProjectRevision(input);
          yield* requireStableProjectWorkspaces(input.id);
          const planningThreads = yield* sql<{
            readonly threadId: ThreadId;
          }>`SELECT thread_id AS "threadId"
            FROM workbench_ticket_drafts WHERE workbench_project_id = ${input.id} AND phase <> 'working'`;
          yield* requireIdlePlanningThreads(planningThreads.map((row) => row.threadId));
          const counts = yield* sql<{ readonly ticketCount: number; readonly epicCount: number }>`
        SELECT (SELECT COUNT(*) FROM workbench_tickets WHERE workbench_project_id = ${input.id} AND deleted_at IS NULL) AS "ticketCount",
          (SELECT COUNT(*) FROM workbench_epics WHERE workbench_project_id = ${input.id}) AS "epicCount"
      `;
          if (
            counts[0]?.ticketCount !== input.expectedTicketCount ||
            counts[0]?.epicCount !== input.expectedEpicCount
          )
            return yield* new WorkbenchOperationError({
              code: "project_changed",
              message:
                "The Workspace planning data changed. Review the updated deletion counts and try again.",
            });
          // Tombstones preserve Assignment reservations and retained worktree ownership.
          yield* sql`
        UPDATE workbench_tickets SET deleted_at = ${input.deletedAt}, updated_at = ${input.deletedAt},
          revision = revision + 1, generated_summary_request_id = NULL
        WHERE workbench_project_id = ${input.id} AND deleted_at IS NULL
      `;
          yield* sql`
        UPDATE workbench_projects SET deleted_at = ${input.deletedAt}, updated_at = ${input.deletedAt},
          revision = revision + 1 WHERE project_id = ${input.id}
      `;
          // Workspace deletion retains native conversations, including idle planning Threads.
          yield* sql`DELETE FROM workbench_ticket_drafts WHERE workbench_project_id = ${input.id}`;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError)),
  );

  const updateProject: WorkbenchStoreShape["updateProject"] = Effect.fn(
    "WorkbenchStore.updateProject",
  )(function* (input) {
    const linkedProjectIds = [...new Set(input.linkedProjectIds)];
    const currentLinks = yield* sql<{ readonly id: ProjectId }>`
      SELECT t3_project_id AS id FROM workbench_project_links WHERE workbench_project_id = ${input.id}
    `.pipe(NodeSqliteClient.readOnly, Effect.mapError(persistenceError));
    const existingIds = new Set(currentLinks.map((link) => link.id));
    const validatedRoots = new Map<ProjectId, string>();
    for (const linkedProjectId of linkedProjectIds) {
      if (!existingIds.has(linkedProjectId)) {
        const project = yield* validateLinkedProject({ linkedProjectId });
        validatedRoots.set(linkedProjectId, project.workspaceRoot);
      }
    }
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Acquire SQLite's writer lock before reading links. This serializes
          // additive link updates from concurrent clients.
          yield* sql`
            UPDATE workbench_projects
            SET updated_at = updated_at
            WHERE project_id = ${input.id}
          `;
          const current = yield* findProject({ id: input.id });
          if (Option.isNone(current)) {
            return yield* new WorkbenchOperationError({
              code: "project_not_found",
              message: "The Workbench Workspace does not exist.",
            });
          }

          yield* requireActiveProject(input.id);
          if (
            input.expectedRevision !== undefined &&
            current.value.revision !== input.expectedRevision
          )
            return yield* new WorkbenchOperationError({
              code: "project_changed",
              message: "The Workbench Workspace changed. Refresh it and try again.",
            });
          const currentLinks = (yield* listProjectLinkRows()).filter(
            (link) => link.projectId === input.id,
          );
          const existingProjectIds = currentLinks.map((link) => link.linkedProjectId);
          const existingProjectIdSet = new Set(existingProjectIds);
          const additions = linkedProjectIds.filter(
            (linkedProjectId) => !existingProjectIdSet.has(linkedProjectId),
          );
          for (const linkedProjectId of additions) {
            const project = yield* findT3Project({ linkedProjectId });
            if (Option.isNone(project)) {
              return yield* new WorkbenchOperationError({
                code: "linked_project_not_found",
                message: "A linked T3 Project does not exist on this environment.",
              });
            }
            if (project.value.workspaceRoot !== validatedRoots.get(linkedProjectId)) {
              return yield* new WorkbenchOperationError({
                code: "project_changed",
                message: "A selected repository's workspace root changed. Retry the operation.",
              });
            }
          }

          yield* sql`
            UPDATE workbench_projects
            SET title = ${input.title}, updated_at = ${input.updatedAt}, revision = revision + 1
            WHERE project_id = ${input.id}
          `;
          const nextPosition = currentLinks.reduce(
            (position, link) => Math.max(position, link.position + 1),
            0,
          );
          for (const [offset, linkedProjectId] of additions.entries()) {
            yield* sql`
              INSERT INTO workbench_project_links (
                workbench_project_id,
                t3_project_id,
                position
              ) VALUES (${input.id}, ${linkedProjectId}, ${nextPosition + offset})
            `;
          }

          return WorkbenchProject.make({
            ...current.value,
            title: input.title,
            revision: current.value.revision + 1,
            linkedProjectIds: [...existingProjectIds, ...additions],
            updatedAt: input.updatedAt,
          });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const requireMutableEpic = Effect.fnUntraced(function* (epicId: WorkbenchEpicId) {
    yield* sql`UPDATE workbench_epics SET updated_at = updated_at WHERE epic_id = ${epicId}`;
    const epic = yield* findEpic({ epicId });
    if (Option.isNone(epic))
      return yield* new WorkbenchOperationError({
        code: "epic_not_found",
        message: "The Workbench Epic does not exist.",
      });
    yield* requireActiveProject(epic.value.projectId);
    return epic.value;
  });

  const createEpic: WorkbenchStoreShape["createEpic"] = Effect.fn("WorkbenchStore.createEpic")(
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* lockProject(input.projectId);
            yield* requireActiveProject(input.projectId);
            yield* sql`
      INSERT INTO workbench_epics (
        epic_id,
        workbench_project_id,
        title,
        markdown,
        archived_at,
        created_at,
        updated_at
      ) VALUES (
        ${input.id},
        ${input.projectId},
        ${input.title},
        ${input.markdown},
        NULL,
        ${input.createdAt},
        ${input.createdAt}
      )
    `.pipe(Effect.mapError(persistenceError));
            return WorkbenchEpic.make({
              ...input,
              archivedAt: null,
              jiraIssue: null,
              updatedAt: input.createdAt,
            });
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError)),
  );

  const updateEpic: WorkbenchStoreShape["updateEpic"] = Effect.fn("WorkbenchStore.updateEpic")(
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const current = yield* requireMutableEpic(input.id);
            const updatedAt = advanceEpicUpdatedAt(current.updatedAt, input.updatedAt);
            yield* sql`
      UPDATE workbench_epics
      SET
        title = ${input.title},
        markdown = ${input.markdown},
        updated_at = ${updatedAt}
      WHERE epic_id = ${input.id}
    `.pipe(Effect.mapError(persistenceError));
            const updated = yield* findEpic({ epicId: input.id }).pipe(
              Effect.mapError(persistenceError),
            );
            return Option.getOrThrow(updated);
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError)),
  );

  const archiveEpic: WorkbenchStoreShape["archiveEpic"] = Effect.fn("WorkbenchStore.archiveEpic")(
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const current = yield* requireMutableEpic(input.id);
            if (
              input.expectedUpdatedAt !== undefined &&
              input.expectedUpdatedAt !== current.updatedAt
            ) {
              return yield* new WorkbenchOperationError({
                code: "epic_changed",
                message: "The Workbench Epic changed. Refresh it and try again.",
              });
            }
            const updatedAt = advanceEpicUpdatedAt(
              current.updatedAt,
              DateTime.formatIso(yield* DateTime.now),
            );
            yield* sql`
      UPDATE workbench_epics
      SET archived_at = ${input.archivedAt}, updated_at = ${updatedAt}
      WHERE epic_id = ${input.id}
    `.pipe(Effect.mapError(persistenceError));
            return WorkbenchEpic.make({
              ...current,
              archivedAt: input.archivedAt,
              updatedAt,
            });
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError)),
  );

  const validateTicketRepositoryScope = Effect.fn("WorkbenchStore.validateTicketRepositoryScope")(
    function* ({
      projectId,
      primaryT3ProjectId,
      repositoryProjectIds,
    }: {
      projectId: WorkbenchProjectId;
      primaryT3ProjectId: ProjectId;
      repositoryProjectIds: ReadonlyArray<ProjectId>;
    }) {
      const normalizedRepositoryProjectIds = [...new Set(repositoryProjectIds)];
      if (!normalizedRepositoryProjectIds.includes(primaryT3ProjectId)) {
        return yield* new WorkbenchOperationError({
          code: "primary_repository_not_selected",
          message: "The primary Ticket repository must be included in its repository scope.",
        });
      }
      for (const linkedProjectId of normalizedRepositoryProjectIds) {
        const link = yield* findProjectLink({ projectId, linkedProjectId }).pipe(
          Effect.mapError(persistenceError),
        );
        if (Option.isNone(link)) {
          return yield* new WorkbenchOperationError({
            code:
              linkedProjectId === primaryT3ProjectId
                ? "primary_project_not_linked"
                : "repository_not_linked",
            message: "A Ticket repository is not linked to its Workbench Workspace.",
          });
        }
      }
      return normalizedRepositoryProjectIds;
    },
  );

  const validateTicketEpic = Effect.fn("WorkbenchStore.validateTicketEpic")(function* ({
    projectId,
    epicId,
    allowArchived = false,
  }: {
    projectId: WorkbenchProjectId;
    epicId: WorkbenchEpicId | null;
    allowArchived?: boolean;
  }) {
    if (epicId === null) return null;
    const epic = yield* findEpic({ epicId }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(epic)) {
      return yield* new WorkbenchOperationError({
        code: "epic_not_found",
        message: "The Workbench Epic does not exist.",
      });
    }
    if (epic.value.projectId !== projectId) {
      return yield* new WorkbenchOperationError({
        code: "epic_project_mismatch",
        message: "The Workbench Epic belongs to a different Workspace.",
      });
    }
    if (epic.value.archivedAt !== null && !allowArchived) {
      return yield* new WorkbenchOperationError({
        code: "epic_archived",
        message: "Archived Workbench Epics cannot receive Tickets.",
      });
    }
    return epicId;
  });

  const createTicket: WorkbenchStoreShape["createTicket"] = Effect.fn(
    "WorkbenchStore.createTicket",
  )(function* (input) {
    const { references: stagedReferences = [], ...ticketInput } = input;
    const references = yield* normalizeStagedReferences(stagedReferences);
    const { epicId, repositoryProjectIds } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* lockProject(input.projectId);
          yield* requireActiveProject(input.projectId);
          const epicId = yield* validateTicketEpic({
            projectId: input.projectId,
            epicId: input.epicId ?? null,
          });
          const repositoryProjectIds = yield* validateTicketRepositoryScope({
            projectId: input.projectId,
            primaryT3ProjectId: input.primaryT3ProjectId,
            repositoryProjectIds: input.repositoryProjectIds ?? [input.primaryT3ProjectId],
          });
          yield* sql`
            INSERT INTO workbench_tickets (
              ticket_id,
              workbench_project_id,
              epic_id,
              title,
              kind,
              markdown,
              primary_t3_project_id,
              status,
              blocked,
              revision,
              generated_summary,
              generated_summary_status,
              generated_summary_stale,
              generated_summary_error,
              generated_summary_source_hash,
              generated_summary_request_id,
              created_at,
              updated_at
            ) VALUES (
              ${input.id},
              ${input.projectId},
              ${epicId},
              ${input.title},
              ${input.kind},
              ${input.markdown},
              ${input.primaryT3ProjectId},
              'todo',
              0,
              0,
              NULL,
              'pending',
              0,
              NULL,
              NULL,
              NULL,
              ${input.createdAt},
              ${input.createdAt}
            )
          `;
          for (const [position, repositoryProjectId] of repositoryProjectIds.entries()) {
            yield* sql`
              INSERT INTO workbench_ticket_repositories (
                ticket_id,
                t3_project_id,
                position
              ) VALUES (${input.id}, ${repositoryProjectId}, ${position})
            `;
          }
          for (const reference of references) {
            yield* insertReference({
              ticketId: input.id,
              ...reference,
              addedByThreadId: null,
              createdAt: input.createdAt,
            });
          }
          return { epicId, repositoryProjectIds };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));

    const ticket = WorkbenchTicket.make({
      ...ticketInput,
      epicId,
      repositoryProjectIds,
      updatedByThreadId: null,
      status: "todo",
      blocked: false,
      revision: 0,
      generatedSummary: {
        text: null,
        status: "pending",
        stale: false,
        error: null,
      },
      archivedAt: null,
      updatedAt: input.createdAt,
    });
    yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const resolveTicketUpdateFields = ({
    input,
    current,
  }: {
    readonly input: WorkbenchUpdateTicketInput;
    readonly current: typeof WorkbenchTicketRow.Type;
  }) => ({
    epicId: input.epicId === undefined ? current.epicId : input.epicId,
    title: input.title ?? current.title,
    kind: input.kind ?? current.kind,
    markdown: input.markdown ?? current.markdown,
    status: input.status ?? current.status,
    blocked: input.blocked ?? current.blocked === 1,
  });

  const recordLocalExecutionReset = Effect.fnUntraced(function* ({
    ticketId,
    status,
  }: {
    ticketId: WorkbenchTicketId;
    status: WorkbenchUpdateTicketInput["status"];
  }) {
    if (status === "todo") {
      const sequence = yield* native.executionSequence;
      yield* sql`UPDATE workbench_tickets SET execution_after_sequence = ${sequence} WHERE ticket_id = ${ticketId}`;
    }
  });

  const listActiveThreadProjectIds: WorkbenchStoreShape["listActiveThreadProjectIds"] = Effect.fn(
    "WorkbenchStore.listActiveThreadProjectIds",
  )(function* (ticketId) {
    // A planning Thread moves to the live scope at Start work, so it does not pin one.
    const assignments = yield* sql<{ readonly threadId: ThreadId }>`
          SELECT a.thread_id AS "threadId" FROM workbench_assignments a
          WHERE a.ticket_id = ${ticketId} AND a.superseded_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM workbench_ticket_drafts d
              WHERE d.thread_id = a.thread_id AND d.phase <> 'working')
        `;
    const projectIds = new Set<ProjectId>();
    for (const { threadId } of assignments) {
      const thread = yield* native.findThread(threadId);
      if (Option.isSome(thread)) projectIds.add(thread.value.projectId);
    }
    return [...projectIds];
  }, Effect.mapError(workbenchStoreError));

  const updateTicket: WorkbenchStoreShape["updateTicket"] = Effect.fn(
    "WorkbenchStore.updateTicket",
  )(function* (input) {
    const { ticket, contentChanged } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireTicketRevision({
            ticketId: input.id,
            expectedRevision: input.expectedRevision,
            revisionMessage: "The Workbench Ticket changed before it could be updated.",
            activeOnly: false,
          });
          if (current.archivedAt !== null) {
            return yield* new WorkbenchOperationError({
              code: "ticket_archived",
              message: "Archived Workbench Tickets cannot be modified.",
            });
          }
          const currentRepositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.id,
          });
          const {
            epicId: requestedEpicId,
            title,
            kind,
            markdown,
            status,
            blocked,
          } = resolveTicketUpdateFields({ input, current });
          const epicId = yield* validateTicketEpic({
            projectId: current.projectId,
            epicId: requestedEpicId,
            allowArchived: requestedEpicId === current.epicId,
          });
          const currentRepositoryProjectIds = currentRepositories.map(
            (repository) => repository.repositoryProjectId,
          );
          const primaryT3ProjectId = input.primaryT3ProjectId ?? current.primaryT3ProjectId;
          const repositoryProjectIds = yield* validateTicketRepositoryScope({
            projectId: current.projectId,
            primaryT3ProjectId,
            repositoryProjectIds:
              input.repositoryProjectIds ??
              (currentRepositoryProjectIds.length > 0
                ? currentRepositoryProjectIds
                : [current.primaryT3ProjectId]),
          });
          const existingTicketWorkspace = yield* loadTicketWorkspace(input.id);
          const repositoryScopeChanged =
            primaryT3ProjectId !== current.primaryT3ProjectId ||
            repositoryProjectIds.length !== currentRepositoryProjectIds.length ||
            repositoryProjectIds.some(
              (repositoryProjectId) => !currentRepositoryProjectIds.includes(repositoryProjectId),
            );
          if (
            repositoryScopeChanged &&
            Option.isSome(existingTicketWorkspace) &&
            (existingTicketWorkspace.value.status === "preparing" ||
              existingTicketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "Ticket repository scope cannot change while its Workspace is changing.",
            });
          }
          yield* recordLocalExecutionReset({ ticketId: input.id, status: input.status });
          const contentChanged = title !== current.title || markdown !== current.markdown;
          const updatedByThreadId = ticketProvenance({ input, current, contentChanged });
          const summary = summaryUpdate({ row: current, contentChanged });
          yield* sql`
            UPDATE workbench_tickets
            SET
              title = ${title},
              epic_id = ${epicId},
              kind = ${kind},
              markdown = ${markdown},
              primary_t3_project_id = ${primaryT3ProjectId},
              status = ${status},
              blocked = ${blocked ? 1 : 0},
              updated_by_thread_id = ${updatedByThreadId},
              generated_summary_status = ${summary.generatedSummaryStatus},
              generated_summary_stale = ${summary.generatedSummaryStale},
              generated_summary_error = ${summary.generatedSummaryError},
              generated_summary_source_hash = ${summary.generatedSummarySourceHash},
              generated_summary_request_id = ${summary.generatedSummaryRequestId},
              revision = revision + 1,
              updated_at = ${input.updatedAt}
            WHERE ticket_id = ${input.id}
              AND revision = ${input.expectedRevision}
          `;
          if (repositoryScopeChanged) {
            yield* sql`
              DELETE FROM workbench_ticket_repositories
              WHERE ticket_id = ${input.id}
            `;
            for (const [position, repositoryProjectId] of repositoryProjectIds.entries()) {
              yield* sql`
                INSERT INTO workbench_ticket_repositories (
                  ticket_id,
                  t3_project_id,
                  position
                ) VALUES (${input.id}, ${repositoryProjectId}, ${position})
              `;
            }
            if (Option.isSome(existingTicketWorkspace)) {
              yield* sql`
                UPDATE workbench_ticket_workspace_repositories
                SET is_primary = 0, updated_at = ${input.updatedAt}
                WHERE ticket_id = ${input.id}
              `;
              yield* sql`
                UPDATE workbench_ticket_workspace_repositories
                SET is_primary = 1, updated_at = ${input.updatedAt}
                WHERE ticket_id = ${input.id}
                  AND t3_project_id = ${primaryT3ProjectId}
              `;
            }
          }
          return {
            ticket: WorkbenchTicket.make({
              id: current.id,
              projectId: current.projectId,
              epicId,
              title,
              kind,
              markdown,
              primaryT3ProjectId,
              repositoryProjectIds,
              status,
              blocked,
              revision: current.revision + 1,
              generatedSummary: summary.generatedSummary,
              archivedAt: current.archivedAt,
              updatedByThreadId,
              createdAt: current.createdAt,
              updatedAt: input.updatedAt,
            }),
            contentChanged,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    if (contentChanged) yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const advanceTicketForRun = (input: { readonly runId: RunId; readonly ticketId: string }) =>
    sql`UPDATE workbench_tickets SET status = 'in_progress', revision = revision + 1,
      updated_at = MAX(updated_at, (SELECT started_at FROM workbench_execution_runs WHERE run_id = ${input.runId}))
      WHERE ticket_id = ${input.ticketId}`;

  /** Runs that older releases held for a Jira transition settle on the local path. */
  const settleHeldTicketExecutions = Effect.gen(function* () {
    const held = yield* sql<{
      readonly runId: RunId;
    }>`SELECT run_id AS "runId" FROM workbench_execution_runs
      WHERE state IN ('pending', 'uncertain') ORDER BY sequence`;
    for (const { runId } of held) {
      // These are the admission checks the Jira path applied. Uncertain runs skip
      // the Workspace fence: their transition may have been sent before an archive.
      const admitted = yield* sql<{ readonly ticketId: string }>`
        SELECT t.ticket_id AS "ticketId" FROM workbench_execution_runs r
        JOIN workbench_assignments a ON a.assignment_id = r.assignment_id
        JOIN workbench_tickets t ON t.ticket_id = a.ticket_id
        JOIN workbench_projects p ON p.project_id = t.workbench_project_id
        WHERE r.run_id = ${runId}
          AND a.superseded_at IS NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL
          AND t.deleted_at IS NULL AND t.archived_at IS NULL
          AND (r.state = 'uncertain' OR p.execution_after_sequence < r.sequence)
          AND NOT EXISTS (SELECT 1 FROM workbench_ticket_drafts d WHERE d.thread_id = a.thread_id AND d.phase <> 'working')
          AND t.status = 'todo' AND a.execution_after_sequence < r.sequence
          AND t.execution_after_sequence < r.sequence`;
      if (admitted[0] !== undefined) {
        yield* advanceTicketForRun({ runId, ticketId: admitted[0].ticketId });
      }
      yield* sql`UPDATE workbench_execution_runs SET state = 'done' WHERE run_id = ${runId}`;
    }
  });

  const initializeTicketExecution = sql
    .withTransaction(
      Effect.gen(function* () {
        // Acquire the SQLite writer before the high-water and run baseline reads.
        yield* sql`UPDATE workbench_execution_cursor SET sequence = sequence WHERE singleton = 1`;
        yield* settleHeldTicketExecutions;
        const existing = yield* sql<{
          readonly sequence: number;
        }>`SELECT sequence FROM workbench_execution_cursor WHERE singleton = 1`;
        if (existing[0] !== undefined) return existing[0].sequence;
        const sequence = yield* native.executionSequence;
        const started = yield* native.startedExecutionRunIds;
        for (const id of started) {
          yield* sql`INSERT OR IGNORE INTO workbench_execution_runs (run_id, sequence, state) VALUES (${id}, ${sequence}, 'done')`;
        }
        yield* sql`INSERT INTO workbench_execution_cursor (singleton, sequence) VALUES (1, ${sequence})`;
        return sequence;
      }),
    )
    .pipe(Effect.mapError(workbenchStoreError));

  const consumeTicketExecution: WorkbenchStoreShape["consumeTicketExecution"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_execution_cursor SET sequence = sequence WHERE singleton = 1`;
          const cursor = yield* sql<{
            readonly sequence: number;
          }>`SELECT sequence FROM workbench_execution_cursor WHERE singleton = 1`;
          if (cursor[0] === undefined)
            return yield* new WorkbenchOperationError({
              code: "persistence_failed",
              message: "Ticket execution consumption has not been initialized.",
            });
          if (input.sequence <= cursor[0].sequence) return;
          const run = input.run;
          const prior =
            yield* sql`SELECT run_id FROM workbench_execution_runs WHERE run_id = ${run.id}`;
          if (prior.length === 0) {
            const assignments = yield* sql<{
              readonly id: WorkbenchAssignmentId;
              readonly ticketId: WorkbenchTicketId;
            }>`
          SELECT a.assignment_id AS id, a.ticket_id AS "ticketId" FROM workbench_assignments a
          JOIN workbench_tickets t ON t.ticket_id = a.ticket_id
            JOIN workbench_projects p ON p.project_id = t.workbench_project_id
          WHERE a.thread_id = ${run.threadId} AND a.superseded_at IS NULL
            AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.execution_after_sequence < ${input.sequence} AND t.deleted_at IS NULL AND t.archived_at IS NULL AND t.status = 'todo'
            AND NOT EXISTS (SELECT 1 FROM workbench_ticket_drafts d WHERE d.thread_id = a.thread_id AND d.phase <> 'working')
            AND a.execution_after_sequence < ${input.sequence}
            AND t.execution_after_sequence < ${input.sequence}`;
            const assignment = assignments[0];
            yield* sql`INSERT INTO workbench_execution_runs (run_id, thread_id, sequence, ticket_id, assignment_id, started_at, state)
          VALUES (${run.id}, ${run.threadId}, ${input.sequence}, ${assignment?.ticketId ?? null}, ${assignment?.id ?? null}, ${run.startedAt}, 'done')`;
            if (assignment !== undefined) {
              yield* advanceTicketForRun({ runId: run.id, ticketId: assignment.ticketId });
            }
          }
          // Every preceding event was applied in this lane.
          yield* sql`UPDATE workbench_execution_cursor SET sequence = ${input.sequence} WHERE singleton = 1`;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));

  // Lock both possible owners before checking them, so a discard or delete cannot interleave.
  const requireReferenceOwner = Effect.fn("WorkbenchStore.requireReferenceOwner")(function* (
    ticketId: WorkbenchTicketId,
  ) {
    yield* sql`UPDATE workbench_tickets SET updated_at = updated_at WHERE ticket_id = ${ticketId}`;
    yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${ticketId}`;
    const owners = yield* sql`
      SELECT 1 FROM workbench_tickets WHERE ticket_id = ${ticketId} AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM workbench_ticket_drafts
      WHERE draft_id = ${ticketId} AND phase IN ('creating', 'draft', 'promoting')
    `;
    if (owners.length === 0) {
      return yield* new WorkbenchOperationError({
        code: "reference_owner_not_found",
        message: "The Workbench Ticket no longer exists or is being discarded.",
      });
    }
  });

  const findReference = SqlSchema.findOne({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId, url: Schema.String }),
    Result: WorkbenchReference,
    execute: ({ ticketId, url }) => sql`
      SELECT
        ticket_id AS "ticketId",
        url,
        title,
        added_by_thread_id AS "addedByThreadId",
        created_at AS "createdAt"
      FROM workbench_references
      WHERE ticket_id = ${ticketId} AND url = ${url}
    `,
  });

  const listReferences: WorkbenchStoreShape["listReferences"] = (ticketId) =>
    listReferencesByTicket({ ticketId }).pipe(
      Effect.mapError(persistenceError),
      Effect.withSpan("WorkbenchStore.listReferences"),
    );

  const removeReference: WorkbenchStoreShape["removeReference"] = Effect.fn(
    "WorkbenchStore.removeReference",
  )(function* (input) {
    const url = parseWorkbenchReferenceUrl(input.url)?.url ?? input.url.trim();
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireReferenceOwner(input.ticketId);
          yield* sql`DELETE FROM workbench_references WHERE ticket_id = ${input.ticketId} AND url = ${url}`;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const addReference: WorkbenchStoreShape["addReference"] = Effect.fn(
    "WorkbenchStore.addReference",
  )(function* (input) {
    const [reference] = yield* normalizeStagedReferences([input]);
    const createdAt = IsoDateTime.make(DateTime.formatIso(yield* DateTime.now));
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireReferenceOwner(input.ticketId);
          yield* insertReference({
            ticketId: input.ticketId,
            ...reference!,
            addedByThreadId: input.addedByThreadId,
            createdAt,
          });
          return yield* findReference({ ticketId: input.ticketId, url: reference!.url });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const setEpicJiraIssueLink: WorkbenchStoreShape["setEpicJiraIssueLink"] = Effect.fn(
    "WorkbenchStore.setEpicJiraIssueLink",
  )(function* ({ epicId, jiraIssue, expectedUpdatedAt }) {
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireMutableEpic(epicId);
          if (current.updatedAt !== expectedUpdatedAt) {
            return yield* new WorkbenchOperationError({
              code: "epic_changed",
              message: "The Workbench Epic changed. Refresh it and try again.",
            });
          }
          const updatedAt = advanceEpicUpdatedAt(current.updatedAt, now);
          yield* sql`
            UPDATE workbench_epics
            SET jira_issue_key = ${jiraIssue?.key ?? null}, jira_issue_url = ${jiraIssue?.url ?? null},
              updated_at = ${updatedAt}
            WHERE epic_id = ${epicId}
          `;
          return WorkbenchEpic.make({ ...current, jiraIssue, updatedAt });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const requestTicketSummary: WorkbenchStoreShape["requestTicketSummary"] = Effect.fn(
    "WorkbenchStore.requestTicketSummary",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* lockAndFindTicket({ ticketId: input.ticketId, activeOnly: true });
          if (Option.isNone(current)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_not_found",
              message: "The Workbench Ticket does not exist.",
            });
          }
          yield* requireActiveProject(current.value.projectId);
          if (current.value.archivedAt !== null) {
            return yield* new WorkbenchOperationError({
              code: "ticket_archived",
              message: "Archived Workbench Tickets cannot generate a summary.",
            });
          }
          const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
          yield* sql`
            UPDATE workbench_tickets
            SET
              generated_summary_status = 'pending',
              generated_summary_stale = ${current.value.generatedSummaryStale},
              generated_summary_error = NULL,
              generated_summary_source_hash = ${sourceHash},
              generated_summary_request_id = ${input.requestId}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
          `;
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return ticketFromRow(
            {
              ...current.value,
              generatedSummaryStatus: "pending",
              generatedSummaryStale: current.value.generatedSummaryStale,
              generatedSummaryError: null,
              generatedSummarySourceHash: sourceHash,
              generatedSummaryRequestId: input.requestId,
            },
            repositories.length > 0
              ? repositories.map((repository) => repository.repositoryProjectId)
              : [current.value.primaryT3ProjectId],
          );
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const findCurrentTicketSummaryRequest = Effect.fnUntraced(function* (
    input: WorkbenchRequestTicketSummaryInput,
  ) {
    const current = yield* lockAndFindTicket({ ticketId: input.ticketId, activeOnly: true });
    if (Option.isNone(current) || current.value.archivedAt !== null)
      return Option.none<typeof WorkbenchTicketRow.Type>();
    const project = yield* findProject({ id: current.value.projectId });
    if (Option.isNone(project) || project.value.archivedAt !== null)
      return Option.none<typeof WorkbenchTicketRow.Type>();
    const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
    if (
      current.value.generatedSummaryRequestId !== input.requestId ||
      current.value.generatedSummarySourceHash !== sourceHash
    )
      return Option.none<typeof WorkbenchTicketRow.Type>();
    return current;
  });

  const settleTicketSummary = Effect.fnUntraced(function* (
    input: WorkbenchCompleteTicketSummaryInput | WorkbenchFailTicketSummaryInput,
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* findCurrentTicketSummaryRequest(input);
          if (Option.isNone(current)) return Option.none<WorkbenchTicket>();
          const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
          const succeeded = "summary" in input;
          const text = succeeded
            ? normalizeSummaryText(input.summary)
            : current.value.generatedSummaryText;
          const status = succeeded ? "ready" : "error";
          const stale = succeeded ? 0 : current.value.generatedSummaryStale;
          const error = succeeded ? null : normalizeSummaryError(input.error);
          const updated = yield* sql<{ readonly ticketId: string }>`
        UPDATE workbench_tickets SET generated_summary = ${text}, generated_summary_status = ${status},
          generated_summary_stale = ${stale}, generated_summary_error = ${error},
          generated_summary_request_id = NULL, generated_summary_source_hash = ${sourceHash}
        WHERE ticket_id = ${input.ticketId} AND deleted_at IS NULL
          AND generated_summary_request_id = ${input.requestId} AND generated_summary_source_hash = ${sourceHash}
        RETURNING ticket_id AS "ticketId"
      `;
          if (updated.length === 0) return Option.none<WorkbenchTicket>();
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return Option.some(
            ticketFromRow(
              {
                ...current.value,
                generatedSummaryText: text,
                generatedSummaryStatus: status,
                generatedSummaryStale: stale,
                generatedSummaryError: error,
                generatedSummarySourceHash: sourceHash,
                generatedSummaryRequestId: null,
              },
              repositories.length > 0
                ? repositories.map((repository) => repository.repositoryProjectId)
                : [current.value.primaryT3ProjectId],
            ),
          );
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const completeTicketSummary: WorkbenchStoreShape["completeTicketSummary"] = Effect.fn(
    "WorkbenchStore.completeTicketSummary",
  )((input) => settleTicketSummary(input));

  const failTicketSummary: WorkbenchStoreShape["failTicketSummary"] = Effect.fn(
    "WorkbenchStore.failTicketSummary",
  )((input) => settleTicketSummary(input));

  const archiveTicket: WorkbenchStoreShape["archiveTicket"] = Effect.fn(
    "WorkbenchStore.archiveTicket",
  )(function* (input) {
    const { ticket, shouldPublishChange } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireTicketRevision({
            ticketId: input.ticketId,
            expectedRevision: input.expectedRevision,
            revisionMessage:
              "The Workbench Ticket changed before its lifecycle state could be updated.",
            activeOnly: true,
          });
          const workspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(workspace) &&
            (workspace.value.status === "preparing" || workspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot be archived.",
            });
          }
          yield* sql`
            UPDATE workbench_tickets
            SET archived_at = ${input.archivedAt},
                revision = revision + 1,
                updated_at = ${input.updatedAt}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND revision = ${input.expectedRevision}
          `;
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return {
            ticket: ticketFromRow(
              {
                ...current,
                archivedAt: input.archivedAt,
                revision: current.revision + 1,
                updatedAt: input.updatedAt,
              },
              repositories.length > 0
                ? repositories.map((repository) => repository.repositoryProjectId)
                : [current.primaryT3ProjectId],
            ),
            shouldPublishChange: input.archivedAt === null,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    if (shouldPublishChange) yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const deleteTicket: WorkbenchStoreShape["deleteTicket"] = Effect.fn(
    "WorkbenchStore.deleteTicket",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireTicketRevision({
            ticketId: input.ticketId,
            expectedRevision: input.expectedRevision,
            revisionMessage: "The Workbench Ticket changed before it could be deleted.",
            activeOnly: true,
          });
          const changingDrafts =
            yield* sql`SELECT 1 FROM workbench_ticket_drafts WHERE draft_id = ${input.ticketId}
            AND phase IN ('promoting', 'starting')`;
          if (changingDrafts.length > 0)
            return yield* new WorkbenchOperationError({
              code: "ticket_draft_busy",
              message: "Finish or retry ticket preparation before deleting the ticket.",
            });
          const planningThreads = yield* sql<{
            readonly threadId: ThreadId;
          }>`SELECT thread_id AS "threadId"
            FROM workbench_ticket_drafts WHERE draft_id = ${input.ticketId} AND phase <> 'working'`;
          yield* requireIdlePlanningThreads(planningThreads.map((row) => row.threadId));
          const workspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(workspace) &&
            (workspace.value.status === "preparing" || workspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot be deleted.",
            });
          }
          yield* sql`
            UPDATE workbench_tickets
            SET deleted_at = ${input.deletedAt},
                revision = revision + 1,
                updated_at = ${input.deletedAt}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND revision = ${input.expectedRevision}
          `;
          // Native Thread history and Assignment reservations survive ticket deletion.
          yield* sql`DELETE FROM workbench_ticket_drafts WHERE draft_id = ${input.ticketId}`;
          return undefined;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const requireAssignableThread = Effect.fn("WorkbenchStore.requireAssignableThread")(function* ({
    ticketId,
    threadId,
  }: {
    ticketId: WorkbenchTicketId;
    threadId: ThreadId;
  }) {
    const ticket = yield* requireActiveTicket({
      ticketId,
      archivedMessage: "Archived Workbench Tickets cannot receive Agent Threads.",
    });
    const nativeThread = yield* findNativeThread({ threadId }).pipe(
      Effect.mapError(persistenceError),
    );
    if (Option.isNone(nativeThread)) {
      return yield* new WorkbenchOperationError({
        code: "thread_not_found",
        message: "The native T3 Thread does not exist.",
      });
    }
    if (nativeThread.value.projectId !== ticket.primaryT3ProjectId) {
      return yield* new WorkbenchOperationError({
        code: "thread_project_mismatch",
        message: "The native T3 Thread belongs to a different T3 Project.",
      });
    }
    return ticket;
  });

  const createAssignment: WorkbenchStoreShape["createAssignment"] = Effect.fn(
    "WorkbenchStore.createAssignment",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          const existingAssignment = yield* findAssignmentByThread({ threadId: input.threadId });
          if (Option.isSome(existingAssignment)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "This native T3 Thread already belongs to a Workbench Ticket.",
            });
          }
          const ticketWorkspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(ticketWorkspace) &&
            (ticketWorkspace.value.status === "preparing" ||
              ticketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot receive an Assignment.",
            });
          }
          yield* requireAssignableThread({
            ticketId: input.ticketId,
            threadId: input.threadId,
          });
          yield* sql`
            INSERT INTO workbench_assignments (assignment_id, ticket_id, thread_id, created_at, execution_after_sequence)
            VALUES (${input.id}, ${input.ticketId}, ${input.threadId}, ${input.createdAt}, ${yield* native.executionSequence})
          `;
          return WorkbenchAssignment.make({ ...input, supersededAt: null });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const unlinkAssignment: WorkbenchStoreShape["unlinkAssignment"] = Effect.fn(
    "WorkbenchStore.unlinkAssignment",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireActiveTicket({
            ticketId: input.ticketId,
            archivedMessage: "Archived Workbench Tickets cannot unlink an Agent Thread.",
          });
          const ticketWorkspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(ticketWorkspace) &&
            (ticketWorkspace.value.status === "preparing" ||
              ticketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot unlink an Agent Thread.",
            });
          }
          // Remove historical rows too so the native Thread can be linked to
          // this Ticket again after an explicit unlink.
          yield* sql`
            DELETE FROM workbench_assignments
            WHERE ticket_id = ${input.ticketId}
              AND thread_id = ${input.threadId}
          `;
          return undefined;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const replaceAssignment: WorkbenchStoreShape["replaceAssignment"] = Effect.fn(
    "WorkbenchStore.replaceAssignment",
  )(function* (input) {
    const replacement = WorkbenchAssignment.make({
      id: input.id ?? WorkbenchAssignmentId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
      ticketId: input.ticketId,
      threadId: input.threadId,
      createdAt: input.replacedAt,
      supersededAt: null,
    });
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireActiveTicket({
            ticketId: input.ticketId,
            archivedMessage: "Archived Workbench Tickets cannot replace an Agent Thread.",
          });
          const ticketWorkspace = yield* loadTicketWorkspace(input.ticketId);
          if (
            Option.isSome(ticketWorkspace) &&
            (ticketWorkspace.value.status === "preparing" ||
              ticketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot replace an Agent Thread.",
            });
          }
          const assignment = yield* findActiveAssignmentByTicketAndThread({
            ticketId: input.ticketId,
            threadId: input.previousThreadId,
          });
          if (Option.isNone(assignment)) {
            const activeAssignment = yield* findActiveAssignmentByTicket({
              ticketId: input.ticketId,
            });
            if (Option.isSome(activeAssignment)) {
              return yield* new WorkbenchOperationError({
                code: "assignment_changed",
                message: "The Workbench Assignment changed before it could be replaced.",
              });
            }
            return yield* new WorkbenchOperationError({
              code: "assignment_not_found",
              message: "The Workbench Assignment does not exist.",
            });
          }
          const existingReplacement = yield* findAssignmentByThread({ threadId: input.threadId });
          if (Option.isSome(existingReplacement)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "This native T3 Thread already belongs to a Workbench Ticket.",
            });
          }
          yield* requireAssignableThread({ ticketId: input.ticketId, threadId: input.threadId });
          const superseded = yield* supersedeAssignmentRow(input);
          if (Option.isNone(superseded)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_changed",
              message: "The Workbench Assignment changed before it could be replaced.",
            });
          }
          yield* sql`
            INSERT INTO workbench_assignments (
              assignment_id,
              ticket_id,
              thread_id,
              created_at,
              superseded_at,
              execution_after_sequence
            ) VALUES (
              ${replacement.id},
              ${replacement.ticketId},
              ${replacement.threadId},
              ${replacement.createdAt},
              NULL,
              ${yield* native.executionSequence}
            )
          `;
          return replacement;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  return WorkbenchStore.of({
    ...ticketDraftPersistence,
    getTicketDraftForThread: Effect.fn("WorkbenchStore.getTicketDraftForThread")(
      function* (threadId) {
        const draft = yield* ticketDraftPersistence.getTicketDraftForThread(threadId);
        if (!draft) return null;
        const workArea = yield* loadTicketWorkspace(draft.id);
        return { ...draft, workArea: Option.getOrNull(workArea) };
      },
      sql.withTransaction,
      NodeSqliteClient.readOnly,
      Effect.mapError(workbenchStoreError),
    ),
    getTicket: Effect.fn("WorkbenchStore.getTicket")(
      function* (ticketId) {
        const ticket = yield* findTicket({ id: ticketId });
        if (Option.isNone(ticket)) return Option.none<WorkbenchTicket>();
        const repositories = yield* listTicketRepositoryRowsByTicket({ ticketId });
        return Option.some(
          ticketFromRow(
            ticket.value,
            repositories.length > 0
              ? repositories.map((repository) => repository.repositoryProjectId)
              : [ticket.value.primaryT3ProjectId],
          ),
        );
      },
      sql.withTransaction,
      NodeSqliteClient.readOnly,
      Effect.mapError(persistenceError),
    ),
    getEpic: Effect.fn("WorkbenchStore.getEpic")((epicId) =>
      findEpic({ epicId }).pipe(NodeSqliteClient.readOnly, Effect.mapError(persistenceError)),
    ),
    getSnapshot: getSnapshot(false).pipe(NodeSqliteClient.readOnly),
    getCompactSnapshot: getSnapshot(true).pipe(NodeSqliteClient.readOnly),
    listTicketsNeedingSummary: listTicketsNeedingSummary(),
    getTicketSummaryCandidate,
    recheckTicketSummary,
    ticketChanges,
    getProject,
    requireActiveProject,
    archiveProject,
    deleteProject,
    createProject,
    updateProject,
    createEpic,
    updateEpic,
    archiveEpic,
    createTicket,
    updateTicket,
    initializeTicketExecution,
    consumeTicketExecution,
    addReference,
    removeReference,
    setEpicJiraIssueLink,
    requestTicketSummary,
    completeTicketSummary,
    failTicketSummary,
    archiveTicket,
    deleteTicket,
    createAssignment,
    unlinkAssignment,
    replaceAssignment,
    hasThreadAtWorktreePath,
    getTicketWorkspace,
    getThreadRoster,
    resolveThreadOwner,
    listReferences,
    listActiveThreadProjectIds,
    upsertThreadRecap,
    listTicketThreadIds,
    getTicketWorkspaceGeneratedBranchName,
    getTicketWorkspaceRepositoryStates,
    claimTicketWorkspace,
    claimTicketWorkspaceRecovery,
    markTicketWorkspaceRepositoryReady,
    completeTicketWorkspace,
    failTicketWorkspace,
    failTicketWorkspaceExtension,
    releaseTicketWorkspaceRepository,
    claimTicketWorkspaceRelease,
    completeTicketWorkspaceRelease,
  });
});

export const WorkbenchStoreLive = Layer.effect(
  WorkbenchStore,
  ensureWorkbenchSchema.pipe(Effect.andThen(makeWorkbenchStore)),
);
