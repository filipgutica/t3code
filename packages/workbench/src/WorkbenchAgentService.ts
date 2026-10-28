import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  WorkbenchOperationError,
  WorkbenchReferenceKind,
  WorkbenchTicketDraftPhase,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
  parseWorkbenchReferenceUrl,
  type WorkbenchReference,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchAgentHost } from "./WorkbenchAgentHost.ts";
import { WorkbenchStore, type WorkbenchThreadOwner } from "./WorkbenchStore.ts";

export class WorkstreamNotOwnedError extends Schema.TaggedError<WorkstreamNotOwnedError>()(
  "WorkstreamNotOwnedError",
  {},
) {
  override get message(): string {
    return "This Thread does not belong to a Workstream";
  }
}

export class WorkstreamChangedError extends Schema.TaggedError<WorkstreamChangedError>()(
  "WorkstreamChangedError",
  { currentRevision: NonNegativeInt },
) {
  override get message(): string {
    return `The Workstream changed. It is now at revision ${this.currentRevision}. Read it again, then retry with that revision.`;
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
    description: "Prepared worktree for this Workstream, when there is one.",
  }),
});

const sharedStateFields = {
  id: WorkbenchTicketId,
  revision: NonNegativeInt,
  title: Schema.String,
  brief: Schema.String,
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
  readonly status?: WorkbenchTicketStatus | undefined;
  readonly repositoryProjectIds?: ReadonlyArray<ProjectId> | undefined;
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
    readonly removeReference: (input: {
      readonly threadId: ThreadId;
      readonly url: string;
    }) => Effect.Effect<void, AgentServiceError>;
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
  const workspaces = yield* TicketWorkspaceService;
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
  }: {
    readonly workspaceId: WorkbenchTicket["projectId"];
    readonly selected: ReadonlyArray<ProjectId>;
    readonly worktreePaths: ReadonlyMap<ProjectId, string>;
  }) {
    const workspace = yield* store.getProject(workspaceId);
    const linked = Option.isSome(workspace) ? workspace.value.linkedProjectIds : [];
    const ids = [...new Set([...selected, ...linked])];
    const titles = new Map(
      (yield* host.describeProjects(ids)).map((project) => [project.id, project.title]),
    );
    return ids.map((projectId) => ({
      projectId,
      name: titles.get(projectId) ?? projectId,
      selected: selected.includes(projectId),
      worktreePath: worktreePaths.get(projectId) ?? null,
    }));
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
    const roster = yield* store.getThreadRoster(threadId);
    const members = Option.isSome(roster)
      ? [
          { threadId, recap: roster.value.recap },
          ...roster.value.siblings.map((sibling) => ({
            threadId: sibling.threadId,
            recap: sibling.recap,
          })),
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
      status: ticket.status,
      repositories: yield* describeRepositories({
        workspaceId: ticket.projectId,
        selected: ticket.repositoryProjectIds,
        worktreePaths,
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

  const read = Effect.fn("WorkbenchAgentService.read")(function* (threadId: ThreadId) {
    return yield* readOwner(yield* requireOwner(threadId), threadId);
  });

  // A stale write reports the current revision, so the agent can reread and retry.
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
    if (repositoryProjectIds !== undefined) {
      // Users may still remove such a repository; an agent must not pull one out from under a sibling.
      const inUse = yield* store.listActiveThreadProjectIds(ticketId);
      if (
        inUse.some(
          (id) => current.repositoryProjectIds.includes(id) && !repositoryProjectIds.includes(id),
        )
      ) {
        return yield* new WorkbenchOperationError({
          code: "ticket_repository_scope_locked",
          message: "A repository that an active Thread works in cannot be removed.",
        });
      }
    }
    // Agents do not choose a primary; keep it, or promote the first repository when it leaves.
    const primaryT3ProjectId =
      repositoryProjectIds === undefined ||
      repositoryProjectIds.includes(current.primaryT3ProjectId)
        ? undefined
        : repositoryProjectIds[0];
    const saved = yield* store
      .updateTicket({
        id: ticketId,
        expectedRevision: input.expectedRevision,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.brief === undefined ? {} : { markdown: input.brief }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(repositoryProjectIds === undefined
          ? {}
          : { repositoryProjectIds: [...repositoryProjectIds] }),
        ...(primaryT3ProjectId === undefined ? {} : { primaryT3ProjectId }),
        updatedAt: yield* currentAt,
        updatedByThreadId: input.threadId,
      })
      .pipe(staleAs("ticket_changed", requireTicket(ticketId).pipe(Effect.map((t) => t.revision))));
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
        message: "A draft has no status. Leave status out until the Workstream is created.",
      });
    }
    const draft = yield* store.getTicketDraft(draftId);
    const repositoryProjectIds = input.repositoryProjectIds ?? draft.fields.repositoryProjectIds;
    const primary = draft.fields.primaryT3ProjectId;
    yield* store
      .updateTicketDraft({
        id: draftId,
        expectedRevision: input.expectedRevision,
        fields: {
          ...draft.fields,
          title: input.title ?? draft.fields.title,
          markdown: input.brief ?? draft.fields.markdown,
          repositoryProjectIds: [...repositoryProjectIds],
          primaryT3ProjectId:
            primary !== null && repositoryProjectIds.includes(primary)
              ? primary
              : (repositoryProjectIds[0] ?? null),
        },
        updatedByThreadId: input.threadId,
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
    return { state: yield* readOwner(owner, input.threadId), ...outcome };
  });

  const addReference = Effect.fn("WorkbenchAgentService.addReference")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
    readonly title?: string | undefined;
  }) {
    const owner = yield* requireOwner(input.threadId);
    const reference = yield* store.addReference({
      ticketId: ownerId(owner),
      url: input.url,
      ...(input.title === undefined ? {} : { title: input.title }),
      addedByThreadId: input.threadId,
    });
    return agentReference(reference);
  });

  const removeReference = Effect.fn("WorkbenchAgentService.removeReference")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
  }) {
    const owner = yield* requireOwner(input.threadId);
    yield* store.removeReference({ ticketId: ownerId(owner), url: input.url });
  });

  return WorkbenchAgentService.of({ read, update, addReference, removeReference });
});

export const layer = Layer.effect(WorkbenchAgentService, make);
