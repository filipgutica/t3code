import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchReferenceKind,
  WorkbenchTicketDraftPhase,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
  parseWorkbenchReferenceUrl,
  workbenchHostRepositoryProjectIds,
  type ProviderInteractionMode,
  type RuntimeMode,
  type WorkbenchReference,
  type WorkbenchTicket,
  type WorkbenchTicketWorktree,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchAgentHost } from "./WorkbenchAgentHost.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import {
  WorkbenchStore,
  type WorkbenchThreadContextSnapshot,
  type WorkbenchThreadOwner,
} from "./WorkbenchStore.ts";

export class WorkstreamNotOwnedError extends Schema.TaggedError<WorkstreamNotOwnedError>()(
  "WorkstreamNotOwnedError",
  {},
) {
  override get message(): string {
    return "This Thread does not belong to a Ticket";
  }
}

export class WorkstreamChangedError extends Schema.TaggedError<WorkstreamChangedError>()(
  "WorkstreamChangedError",
  { currentRevision: NonNegativeInt },
) {
  override get message(): string {
    return `The Ticket changed. It is now at revision ${this.currentRevision}. Read it again, then retry with that revision.`;
  }
}

const AgentReference = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  kind: WorkbenchReferenceKind,
  label: Schema.String,
});

const AgentRepository = Schema.Struct({
  projectId: ProjectId,
  name: Schema.String,
  selected: Schema.Boolean,
  worktreePath: Schema.NullOr(Schema.String).annotate({
    description: "Prepared worktree for this Ticket, when there is one.",
  }),
  worktrees: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Other worktrees in the Ticket's workspace, such as ones other Threads added.",
  }),
});

const sharedStateFields = {
  id: WorkbenchTicketId,
  revision: NonNegativeInt,
  title: Schema.String,
  brief: Schema.String,
  progress: Schema.String,
  repositories: Schema.Array(AgentRepository),
  references: Schema.Array(AgentReference),
  artifactsDir: Schema.String,
};

export const WorkstreamState = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workstream"),
    ...sharedStateFields,
    status: WorkbenchTicketStatus,
    threads: Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        title: Schema.String,
        recap: Schema.NullOr(Schema.String),
      }),
    ),
    pullRequests: Schema.Array(
      Schema.Struct({ url: Schema.String, state: Schema.NullOr(Schema.String) }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("draft"),
    ...sharedStateFields,
    phase: WorkbenchTicketDraftPhase,
  }),
]);
export type WorkstreamState = typeof WorkstreamState.Type;

export const WorkstreamUpdateResult = Schema.Struct({
  state: WorkstreamState,
  warning: Schema.optionalKey(Schema.String),
});
export type WorkstreamUpdateResult = typeof WorkstreamUpdateResult.Type;

export interface WorkstreamUpdateInput {
  readonly threadId: ThreadId;
  readonly expectedRevision: number;
  readonly title?: string | undefined;
  readonly brief?: string | undefined;
  readonly progress?: string | undefined;
  readonly status?: WorkbenchTicketStatus | undefined;
  readonly repositoryProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export const AgentThreadResult = Schema.Struct({ threadId: ThreadId, title: Schema.String });
export type AgentThreadResult = typeof AgentThreadResult.Type;

export interface AgentThreadStartInput {
  readonly threadId: ThreadId;
  /** One of the Ticket's repositories; defaults to the calling Thread's, else the first. */
  readonly repositoryProjectId?: ProjectId | undefined;
  readonly title?: string | undefined;
  readonly message: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export const AgentReferenceResult = AgentReference;
export type AgentReferenceResult = typeof AgentReference.Type;

type AgentServiceError = WorkbenchOperationError | WorkstreamNotOwnedError | WorkstreamChangedError;

/** Workbench operations an agent runs on the Ticket or draft its own Thread belongs to. */
export class WorkbenchAgentService extends Context.Service<
  WorkbenchAgentService,
  {
    readonly read: (threadId: ThreadId) => Effect.Effect<WorkstreamState, AgentServiceError>;
    readonly update: (
      input: WorkstreamUpdateInput,
    ) => Effect.Effect<WorkstreamUpdateResult, AgentServiceError>;
    readonly addReference: (input: {
      readonly threadId: ThreadId;
      readonly url: string;
      readonly title?: string | undefined;
    }) => Effect.Effect<AgentReferenceResult, AgentServiceError>;
    readonly updateReference: (input: {
      readonly threadId: ThreadId;
      readonly url: string;
      readonly title: string;
    }) => Effect.Effect<AgentReferenceResult, AgentServiceError>;
    readonly removeReference: (input: {
      readonly threadId: ThreadId;
      readonly url: string;
    }) => Effect.Effect<void, AgentServiceError>;
    /** Starts another Thread on the caller's Ticket, as Create Thread does, then sends it `message`. */
    readonly startThread: (
      input: AgentThreadStartInput,
    ) => Effect.Effect<AgentThreadResult, AgentServiceError>;
  }
>()("@t3tools/workbench/WorkbenchAgentService") {}

const agentReference = (reference: WorkbenchReference): AgentReferenceResult => {
  const parsed = parseWorkbenchReferenceUrl(reference.url);
  return {
    url: reference.url,
    title: reference.title,
    kind: parsed?.kind ?? "link",
    label: parsed?.label ?? reference.url,
  };
};

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const host = yield* WorkbenchAgentHost;
  const native = yield* WorkbenchNativeAccess;
  const workspaces = yield* TicketWorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  const currentAt = DateTime.now.pipe(
    Effect.map((now) => IsoDateTime.make(DateTime.formatIso(now))),
  );

  const requireOwner = Effect.fn("WorkbenchAgentService.requireOwner")(function* (
    threadId: ThreadId,
  ) {
    const owner = yield* store.resolveThreadOwner(threadId);
    if (Option.isNone(owner)) return yield* new WorkstreamNotOwnedError();
    return owner.value;
  });
  const ownerId = (owner: WorkbenchThreadOwner) =>
    owner.kind === "ticket" ? owner.ticketId : owner.draftId;

  const requireTicket = Effect.fn("WorkbenchAgentService.requireTicket")(function* (
    ticketId: WorkbenchTicketId,
  ) {
    const ticket = yield* store.getTicket(ticketId);
    if (Option.isNone(ticket)) return yield* new WorkstreamNotOwnedError();
    return ticket.value;
  });

  const describeRepositories = Effect.fn("WorkbenchAgentService.describeRepositories")(function* ({
    workspaceId,
    selected,
    worktreePaths,
    worktrees = [],
  }: {
    readonly workspaceId: WorkbenchTicket["projectId"];
    readonly selected: ReadonlyArray<ProjectId>;
    readonly worktreePaths: ReadonlyMap<ProjectId, string>;
    readonly worktrees?: ReadonlyArray<WorkbenchTicketWorktree>;
  }) {
    const workspace = yield* store.getProject(workspaceId);
    const linked = Option.isSome(workspace) ? workspace.value.linkedProjectIds : [];
    const ids = [...new Set([...selected, ...linked])];
    const remote = Option.isSome(workspace) ? (workspace.value.remoteProjects ?? {}) : {};
    const titles = new Map([
      ...(yield* host.describeProjects(ids)).map((project) => [project.id, project.title] as const),
      // This host cannot read a remote Project; name it and its machine from the stored labels.
      ...Object.entries(remote).map(
        ([id, project]) =>
          [id, `${project.projectTitle} (on ${project.environmentLabel})`] as const,
      ),
    ]);
    return ids.map((projectId) => {
      const paths = worktrees
        .filter((worktree) => worktree.projectId === projectId)
        .map((worktree) => worktree.path);
      return {
        projectId,
        name: titles.get(projectId) ?? projectId,
        selected: selected.includes(projectId),
        worktreePath: worktreePaths.get(projectId) ?? null,
        ...(paths.length > 0 ? { worktrees: paths } : {}),
      };
    });
  });

  const readTicket = Effect.fn("WorkbenchAgentService.readTicket")(function* ({
    ticketId,
    threadId,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly threadId: ThreadId;
  }) {
    const ticket = yield* requireTicket(ticketId);
    const workspace = yield* store.getTicketWorkspace(ticketId);
    const worktreePaths = new Map(
      Option.isSome(workspace)
        ? workspace.value.repositories
            .filter((repository) => repository.status === "ready")
            .map((repository) => [repository.projectId, repository.worktreePath] as const)
        : [],
    );
    // A failed listing only hides the other worktrees; the rest of the Ticket still reads.
    const worktrees = yield* workspaces.listWorktrees({ ticketId }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Ticket worktrees could not be read", {
          ticketId,
          error: error.message,
        }).pipe(Effect.as<ReadonlyArray<WorkbenchTicketWorktree>>([])),
      ),
    );
    const roster = yield* store.getThreadRoster(threadId);
    const members = Option.isSome(roster)
      ? [
          { threadId, recap: roster.value.recap },
          // A Thread on another machine is not readable or addressable from here.
          ...roster.value.siblings
            .filter((sibling) => sibling.environmentId === undefined)
            .map((sibling) => ({ threadId: sibling.threadId, recap: sibling.recap })),
        ]
      : [];
    const threads = yield* host.describeThreads(members.map((member) => member.threadId));
    const references = yield* store.listReferences(ticketId);
    const pullRequests = new Map<string, string | null>();
    for (const thread of threads) {
      for (const pullRequest of thread.pullRequests) {
        pullRequests.set(pullRequest.url, pullRequest.state);
      }
    }
    for (const reference of references.map(agentReference)) {
      if (reference.kind === "github_pull_request" && !pullRequests.has(reference.url)) {
        pullRequests.set(reference.url, null);
      }
    }
    return {
      kind: "workstream" as const,
      id: ticket.id,
      revision: ticket.revision,
      title: ticket.title,
      brief: ticket.markdown,
      progress: ticket.progress ?? "",
      status: ticket.status,
      repositories: yield* describeRepositories({
        workspaceId: ticket.projectId,
        selected: ticket.repositoryProjectIds,
        worktreePaths,
        worktrees,
      }),
      references: references.map(agentReference),
      threads: members.flatMap((member) => {
        const thread = threads.find((candidate) => candidate.id === member.threadId);
        return thread === undefined
          ? []
          : [{ threadId: member.threadId, title: thread.title, recap: member.recap?.text ?? null }];
      }),
      pullRequests: [...pullRequests].map(([url, state]) => ({ url, state })),
      artifactsDir: yield* host.ensureArtifactsDir(ticket.id),
    } satisfies WorkstreamState;
  });

  const readDraft = Effect.fn("WorkbenchAgentService.readDraft")(function* (
    draftId: WorkbenchTicketId,
  ) {
    const draft = yield* store.getTicketDraft(draftId);
    return {
      kind: "draft" as const,
      id: draft.id,
      revision: draft.revision,
      phase: draft.phase,
      title: draft.fields.title,
      brief: draft.fields.markdown,
      progress: draft.progress ?? "",
      repositories: yield* describeRepositories({
        workspaceId: draft.projectId,
        selected: draft.fields.repositoryProjectIds,
        worktreePaths: new Map(),
      }),
      references: (yield* store.listReferences(draft.id)).map(agentReference),
      artifactsDir: yield* host.ensureArtifactsDir(draft.id),
    } satisfies WorkstreamState;
  });

  const readOwner = (owner: WorkbenchThreadOwner, threadId: ThreadId) =>
    owner.kind === "ticket"
      ? readTicket({ ticketId: owner.ticketId, threadId })
      : readDraft(owner.draftId);

  // What a Thread reads or writes itself is not sent back to it as a change on its next turn.
  // Recording is best effort: a miss only resends that part.
  const recordSeen = (input: {
    readonly threadId: ThreadId;
    readonly ownerId: WorkbenchTicketId;
    readonly update: (snapshot: WorkbenchThreadContextSnapshot) => WorkbenchThreadContextSnapshot;
  }) =>
    store.updateSeenThreadContext(input).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Workbench seen context could not be recorded", {
          threadId: input.threadId,
          error: error.message,
        }),
      ),
    );
  const recordSeenState = (threadId: ThreadId, state: WorkstreamState) =>
    recordSeen({
      threadId,
      ownerId: state.id,
      update: (snapshot) => ({
        ...snapshot,
        revision: state.revision,
        brief: state.brief,
        progress: state.progress,
        references: state.references.map(({ url, title }) => ({ url, title })),
      }),
    });

  const read = Effect.fn("WorkbenchAgentService.read")(function* (threadId: ThreadId) {
    const state = yield* readOwner(yield* requireOwner(threadId), threadId);
    yield* recordSeenState(threadId, state);
    return state;
  });

  // A stale write reports the current revision, so the agent can reread and retry.
  // The owner was resolved before the write; the store rechecks it inside the transaction.
  const lostOwnership = <A>(effect: Effect.Effect<A, AgentServiceError>) =>
    effect.pipe(
      Effect.catchTags({
        WorkbenchOperationError: (error) =>
          Effect.fail(error.code === "thread_not_owner" ? new WorkstreamNotOwnedError() : error),
      }),
    );

  const staleAs =
    (
      code: WorkbenchOperationError["code"],
      currentRevision: Effect.Effect<number, AgentServiceError>,
    ) =>
    <A>(effect: Effect.Effect<A, WorkbenchOperationError>) =>
      effect.pipe(
        Effect.catchTags({
          WorkbenchOperationError: (error) =>
            error.code === code
              ? Effect.flatMap(currentRevision, (revision) =>
                  Effect.fail(new WorkstreamChangedError({ currentRevision: revision })),
                )
              : Effect.fail(error),
        }),
      );

  const updateTicket = Effect.fn("WorkbenchAgentService.updateTicket")(function* (
    ticketId: WorkbenchTicketId,
    input: WorkstreamUpdateInput,
  ) {
    const current = yield* requireTicket(ticketId);
    const repositoryProjectIds = input.repositoryProjectIds;
    const saved = yield* store
      .updateTicket({
        id: ticketId,
        expectedRevision: input.expectedRevision,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.brief === undefined ? {} : { markdown: input.brief }),
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(repositoryProjectIds === undefined
          ? {}
          : { repositoryProjectIds: [...repositoryProjectIds] }),
        updatedAt: yield* currentAt,
        writer: { kind: "agent", threadId: input.threadId },
      })
      .pipe(
        staleAs("ticket_changed", requireTicket(ticketId).pipe(Effect.map((t) => t.revision))),
        lostOwnership,
      );
    const scopeChanged =
      saved.repositoryProjectIds.length !== current.repositoryProjectIds.length ||
      saved.repositoryProjectIds.some((id) => !current.repositoryProjectIds.includes(id));
    const workspace = yield* store.getTicketWorkspace(ticketId);
    // As in the UI, a ready work area gains worktrees for added repositories right away.
    if (!scopeChanged || Option.isNone(workspace) || workspace.value.status !== "ready") return {};
    return yield* workspaces.prepare({ ticketId, requestedAt: yield* currentAt }).pipe(
      Effect.as({}),
      Effect.catch((error) =>
        Effect.succeed({
          warning: `Repositories saved. Preparing their worktrees failed: ${error.message}`,
        }),
      ),
    );
  });

  const updateDraft = Effect.fn("WorkbenchAgentService.updateDraft")(function* (
    draftId: WorkbenchTicketId,
    input: WorkstreamUpdateInput,
  ) {
    if (input.status !== undefined) {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_invalid",
        message: "A draft has no status. Leave status out until the Ticket is created.",
      });
    }
    const draft = yield* store.getTicketDraft(draftId);
    const repositoryProjectIds = input.repositoryProjectIds ?? draft.fields.repositoryProjectIds;
    yield* store
      .updateTicketDraft({
        id: draftId,
        expectedRevision: input.expectedRevision,
        fields: {
          ...draft.fields,
          title: input.title ?? draft.fields.title,
          markdown: input.brief ?? draft.fields.markdown,
          repositoryProjectIds: [...repositoryProjectIds],
        },
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        writer: { kind: "agent", threadId: input.threadId },
      })
      .pipe(
        staleAs(
          "ticket_draft_changed",
          store.getTicketDraft(draftId).pipe(Effect.map((current) => current.revision)),
        ),
      );
    return {};
  });

  const update = Effect.fn("WorkbenchAgentService.update")(function* (
    input: WorkstreamUpdateInput,
  ) {
    const owner = yield* requireOwner(input.threadId);
    const outcome: { readonly warning?: string } =
      owner.kind === "ticket"
        ? yield* updateTicket(owner.ticketId, input)
        : yield* updateDraft(owner.draftId, input);
    const state = yield* readOwner(owner, input.threadId);
    yield* recordSeenState(input.threadId, state);
    return { state, ...outcome };
  });

  const addReference = Effect.fn("WorkbenchAgentService.addReference")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
    readonly title?: string | undefined;
  }) {
    const owner = yield* requireOwner(input.threadId);
    const reference = yield* store
      .addReference({
        ticketId: ownerId(owner),
        url: input.url,
        ...(input.title === undefined ? {} : { title: input.title }),
        addedByThreadId: input.threadId,
      })
      .pipe(lostOwnership);
    yield* recordSeen({
      threadId: input.threadId,
      ownerId: reference.ticketId,
      update: (snapshot) =>
        snapshot.references.some(({ url }) => url === reference.url)
          ? snapshot
          : {
              ...snapshot,
              references: [...snapshot.references, { url: reference.url, title: reference.title }],
            },
    });
    return agentReference(reference);
  });

  const updateReference = Effect.fn("WorkbenchAgentService.updateReference")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
    readonly title: string;
  }) {
    const owner = yield* requireOwner(input.threadId);
    const reference = yield* store
      .updateReference({
        ticketId: ownerId(owner),
        url: input.url,
        title: input.title,
        actingThreadId: input.threadId,
      })
      .pipe(lostOwnership);
    yield* recordSeen({
      threadId: input.threadId,
      ownerId: reference.ticketId,
      update: (snapshot) => ({
        ...snapshot,
        references: snapshot.references.map((seen) =>
          seen.url === reference.url ? { url: seen.url, title: reference.title } : seen,
        ),
      }),
    });
    return agentReference(reference);
  });

  const removeReference = Effect.fn("WorkbenchAgentService.removeReference")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
  }) {
    const owner = yield* requireOwner(input.threadId);
    const url = parseWorkbenchReferenceUrl(input.url)?.url ?? input.url.trim();
    yield* store
      .removeReference({ ticketId: ownerId(owner), url, actingThreadId: input.threadId })
      .pipe(lostOwnership);
    yield* recordSeen({
      threadId: input.threadId,
      ownerId: ownerId(owner),
      update: (snapshot) => ({
        ...snapshot,
        references: snapshot.references.filter((seen) => seen.url !== url),
      }),
    });
  });

  const threadRepository = Effect.fn("WorkbenchAgentService.threadRepository")(function* ({
    ticket,
    callerThreadId,
    requested,
  }: {
    readonly ticket: WorkbenchTicket;
    readonly callerThreadId: ThreadId;
    readonly requested: ProjectId | undefined;
  }) {
    const board = Option.getOrUndefined(yield* store.getProject(ticket.projectId));
    // Threads start on this machine; a repository on another one has no worktree here.
    const linked = workbenchHostRepositoryProjectIds(board, ticket.repositoryProjectIds);
    if (requested !== undefined) {
      if (linked.includes(requested)) return requested;
      const remote = board?.remoteProjects?.[requested];
      if (remote !== undefined && ticket.repositoryProjectIds.includes(requested)) {
        return yield* new WorkbenchOperationError({
          code: "repository_not_linked",
          message: `${remote.projectTitle} is on ${remote.environmentLabel}, and Workbench can't start a Thread on another machine. Ask the user to start one there from the Ticket.`,
        });
      }
      return yield* new WorkbenchOperationError({
        code: "repository_not_linked",
        message:
          "That repository is not linked to this Ticket. Use a `projectId` from `repositories[]` with `selected: true` in workbench_ticket_read.",
      });
    }
    const caller = yield* native.findThread(callerThreadId);
    if (Option.isSome(caller) && linked.includes(caller.value.projectId)) {
      return caller.value.projectId;
    }
    const first = linked[0];
    if (first !== undefined) return first;
    return yield* new WorkbenchOperationError({
      code: "repository_not_linked",
      message:
        ticket.repositoryProjectIds.length === 0
          ? "This Ticket has no repositories. Add one before starting a Thread."
          : "This Ticket's repositories are all on other machines, so Workbench can't start a Thread here. Ask the user to start one there from the Ticket.",
    });
  });

  const startThread = Effect.fn("WorkbenchAgentService.startThread")(function* (
    input: AgentThreadStartInput,
  ) {
    const owner = yield* requireOwner(input.threadId);
    if (owner.kind !== "ticket") {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_invalid",
        message: "A draft has no Threads. Start one after the Ticket is created.",
      });
    }
    const ticket = yield* requireTicket(owner.ticketId);
    const projectId = yield* threadRepository({
      ticket,
      callerThreadId: input.threadId,
      requested: input.repositoryProjectId,
    });
    const workspace = yield* workspaces.prepare({
      ticketId: ticket.id,
      requestedAt: yield* currentAt,
    });
    const checkout = workspace.repositories.find(
      (repository) => repository.status === "ready" && repository.projectId === projectId,
    );
    if (checkout === undefined) {
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_repository_not_found",
        message: "The chosen repository has no ready worktree for this Ticket.",
      });
    }
    const title = input.title ?? ticket.title;
    const threadId = yield* host.createThread({
      callerThreadId: input.threadId,
      projectId,
      title,
      branch: checkout.branchName,
      worktreePath: checkout.worktreePath,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
    });
    // Linked before its first turn, so that turn carries the Ticket context.
    yield* store
      .createAssignment({
        id: WorkbenchAssignmentId.make(yield* random.uuidV4()),
        ticketId: ticket.id,
        threadId,
        createdAt: yield* currentAt,
      })
      .pipe(Effect.tapError(() => host.deleteThread(threadId).pipe(Effect.ignore)));
    yield* host.sendMessage({ threadId, senderThreadId: input.threadId, text: input.message });
    return { threadId, title };
  });

  return WorkbenchAgentService.of({
    read,
    update,
    addReference,
    updateReference,
    removeReference,
    startThread,
  });
});

export const layer = Layer.effect(WorkbenchAgentService, make);
