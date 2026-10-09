import {
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  type WorkbenchTicketDraft,
  type WorkbenchTicketDraftActionInput,
  type WorkbenchBeginTicketDraftInput,
  type WorkbenchUpdateTicketDraftInput,
  type WorkbenchJiraOperationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { TicketDraftHost } from "./TicketDraftHost.ts";
import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

export class TicketDraftService extends Context.Service<
  TicketDraftService,
  {
    readonly begin: (
      input: WorkbenchBeginTicketDraftInput,
    ) => Effect.Effect<WorkbenchTicketDraft, WorkbenchOperationError>;
    readonly update: (
      input: WorkbenchUpdateTicketDraftInput,
    ) => Effect.Effect<WorkbenchTicketDraft, WorkbenchOperationError>;
    readonly promote: (
      input: WorkbenchTicketDraftActionInput,
    ) => Effect.Effect<WorkbenchTicketDraft, WorkbenchOperationError | WorkbenchJiraOperationError>;
    readonly startWork: (
      input: WorkbenchTicketDraftActionInput,
    ) => Effect.Effect<WorkbenchTicketDraft, WorkbenchOperationError>;
    readonly discard: (
      input: WorkbenchTicketDraftActionInput,
    ) => Effect.Effect<void, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/TicketDraftService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const host = yield* TicketDraftHost;
  const workspaces = yield* TicketWorkspaceService;
  const mutations = yield* Semaphore.make(1);
  const currentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const requireRevision = (draft: WorkbenchTicketDraft, expected: number) =>
    draft.revision === expected
      ? Effect.void
      : Effect.fail(
          new WorkbenchOperationError({
            code: "ticket_draft_changed",
            message: "This ticket draft changed. Reload it before continuing.",
          }),
        );
  const begin = Effect.fn("TicketDraftService.begin")(function* (
    input: WorkbenchBeginTicketDraftInput,
  ) {
    yield* host.validatePlanningModel(input.modelSelection);
    let draft = yield* store.beginTicketDraft(input);
    if (draft.phase !== "creating") return draft;
    yield* host.createThread(draft);
    draft = yield* store.transitionTicketDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      from: ["creating"],
      phase: "draft",
    });
    return draft;
  });
  const promote = Effect.fn("TicketDraftService.promote")(function* (
    input: WorkbenchTicketDraftActionInput,
  ) {
    let draft = yield* store.getTicketDraft(input.id);
    if (draft.phase === "planning" || draft.phase === "working") return draft;
    yield* requireRevision(draft, input.expectedRevision);
    if (
      !draft.fields.title.trim() ||
      draft.fields.primaryT3ProjectId === null ||
      draft.fields.repositoryProjectIds.length === 0
    ) {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_invalid",
        message:
          "Add a title and select the ticket's repositories and primary repository before creating it.",
      });
    }
    const primary = draft.fields.primaryT3ProjectId;
    yield* host.requireIdle(draft.threadId);
    if (draft.phase !== "promoting") {
      draft = yield* store.transitionTicketDraft({ ...input, from: ["draft"], phase: "promoting" });
    }
    // Content is frozen in promoting. The stable ticket ID reuses Jira's uncertain-create recovery.
    const snapshot = yield* store.getSnapshot;
    if (!snapshot.tickets.some((ticket) => ticket.id === draft.id)) {
      const { jiraSprintId, ...fields } = draft.fields;
      yield* host
        .createTicket({
          id: draft.id,
          projectId: draft.projectId,
          ...fields,
          primaryT3ProjectId: primary,
          ...(jiraSprintId !== null ? { jiraSprintId } : {}),
          createdAt: draft.createdAt,
        })
        .pipe(
          Effect.tapError(() =>
            store.restoreUncreatedTicketDraft({ id: draft.id, expectedRevision: draft.revision }),
          ),
        );
    }
    const savedTicket = (yield* store.getSnapshot).tickets.find((ticket) => ticket.id === draft.id);
    if (!savedTicket)
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The saved ticket is no longer available.",
      });
    yield* host.bindThread({
      draft: { ...draft, fields: { ...draft.fields, title: savedTicket.title } },
      projectId: savedTicket.primaryT3ProjectId,
      branch: null,
      worktreePath: null,
    });
    const assignments = (yield* store.getSnapshot).assignments;
    const existing = assignments.find((assignment) => assignment.threadId === draft.threadId);
    if (existing && (existing.ticketId !== draft.id || existing.supersededAt !== null)) {
      return yield* new WorkbenchOperationError({
        code: "assignment_already_exists",
        message: "This planning Thread already has a different ticket assignment.",
      });
    }
    if (!existing) {
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make(`ticket-draft:${draft.id}`),
        ticketId: draft.id,
        threadId: draft.threadId,
        createdAt: yield* currentAt,
      });
    }
    return yield* store.transitionTicketDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      from: ["promoting"],
      phase: "planning",
    });
  });
  const startWork = Effect.fn("TicketDraftService.startWork")(function* (
    input: WorkbenchTicketDraftActionInput,
  ) {
    let draft = yield* store.getTicketDraft(input.id);
    if (draft.phase === "working") return draft;
    yield* requireRevision(draft, input.expectedRevision);
    yield* host.requireIdle(draft.threadId);
    if (draft.phase !== "starting") {
      draft = yield* store.transitionTicketDraft({
        ...input,
        from: ["planning"],
        phase: "starting",
      });
    }
    // Use the live ticket: its repository scope can change after promotion.
    const ticket = (yield* store.getSnapshot).tickets.find(
      (candidate) => candidate.id === draft.id,
    );
    if (!ticket)
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "This ticket is no longer available.",
      });
    const assignment = (yield* store.getSnapshot).assignments.find(
      (candidate) =>
        candidate.ticketId === draft.id &&
        candidate.threadId === draft.threadId &&
        candidate.supersededAt === null,
    );
    if (!assignment)
      return yield* new WorkbenchOperationError({
        code: "assignment_changed",
        message: "The ticket's planning Thread is no longer linked.",
      });
    const workspace = yield* workspaces.prepare({
      ticketId: draft.id,
      requestedAt: yield* currentAt,
    });
    const primary = workspace.repositories.find(
      (repository) =>
        repository.projectId === ticket.primaryT3ProjectId && repository.status === "ready",
    );
    if (workspace.status !== "ready" || !primary) {
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_preparation_failed",
        message:
          "The work area's primary worktree is not ready. Retry preparation before continuing.",
      });
    }
    const latestTicket = (yield* store.getSnapshot).tickets.find(
      (candidate) => candidate.id === ticket.id,
    );
    if (!latestTicket || latestTicket.revision !== ticket.revision)
      return yield* new WorkbenchOperationError({
        code: "ticket_changed",
        message: "The ticket changed during preparation. Reload and retry Start work.",
      });
    yield* host.bindThread({
      draft,
      projectId: ticket.primaryT3ProjectId,
      branch: primary.branchName,
      worktreePath: primary.worktreePath,
    });
    yield* host.startExecutionMode(draft);
    return yield* store.completeTicketDraftWork({
      id: draft.id,
      expectedRevision: draft.revision,
      expectedTicketRevision: ticket.revision,
      expectedWorkAreaAttemptId: workspace.attemptId,
    });
  });
  const discard = Effect.fn("TicketDraftService.discard")(function* (
    input: WorkbenchTicketDraftActionInput,
  ) {
    const existing = yield* store.getTicketDraft(input.id).pipe(
      Effect.asSome,
      Effect.catchTags({
        WorkbenchOperationError: (error) =>
          error.code === "ticket_draft_not_found" ? Effect.succeedNone : Effect.fail(error),
      }),
    );
    if (Option.isNone(existing)) return;
    let draft = existing.value;
    yield* requireRevision(draft, input.expectedRevision);
    yield* host.requireDiscardable(draft);
    if (draft.phase !== "discarding")
      draft = yield* store.transitionTicketDraft({
        ...input,
        from: ["creating", "draft", "promoting"],
        phase: "discarding",
      });
    yield* host.deleteThread(draft);
    yield* store.removeTicketDraft({ id: draft.id, expectedRevision: draft.revision });
  });
  return TicketDraftService.of({
    begin: (input) => mutations.withPermits(1)(begin(input)),
    update: (input) => mutations.withPermits(1)(store.updateTicketDraft(input)),
    promote: (input) => mutations.withPermits(1)(promote(input)),
    startWork: (input) => mutations.withPermits(1)(startWork(input)),
    discard: (input) => mutations.withPermits(1)(discard(input)),
  });
});

export const layer = Layer.effect(TicketDraftService, make);
