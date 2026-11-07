import {
  WorkbenchOperationError,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchLinkThreadInput,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ThreadLinkHost, type ThreadBinding } from "./ThreadLinkHost.ts";
import { TicketWorkspaceService, prepareTicketCheckout } from "./TicketWorkspaceService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

/** Links an existing Thread to a Ticket, forking it into the Ticket's checkout when it runs elsewhere. */
export class ThreadLinkService extends Context.Service<
  ThreadLinkService,
  {
    readonly linkThread: (
      input: WorkbenchLinkThreadInput,
    ) => Effect.Effect<WorkbenchAssignment, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/ThreadLinkService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const native = yield* WorkbenchNativeAccess;
  const workspaces = yield* TicketWorkspaceService;
  const host = yield* ThreadLinkHost;

  /** Where the Thread runs, if it is live and no Ticket or draft owns it. */
  const requireLinkableSource = Effect.fn("ThreadLinkService.requireLinkableSource")(function* (
    threadId: ThreadId,
  ) {
    const source = yield* native.findThread(threadId);
    if (Option.isNone(source) || source.value.archivedAt) {
      return yield* new WorkbenchOperationError({
        code: "thread_not_found",
        message: "The Thread does not exist or is archived.",
      });
    }
    // The fork path never assigns the source, so the store cannot catch a source another Ticket owns.
    if (Option.isSome(yield* store.resolveThreadOwner(threadId))) {
      return yield* new WorkbenchOperationError({
        code: "assignment_already_exists",
        message: "This Thread already belongs to a Ticket or draft.",
      });
    }
    return {
      projectId: source.value.projectId,
      branch: source.value.branch ?? null,
      worktreePath: source.value.worktreePath ?? null,
    } satisfies ThreadBinding;
  });

  const runsInTicketCheckout = Effect.fn("ThreadLinkService.runsInTicketCheckout")(function* (
    ticket: WorkbenchTicket,
    binding: ThreadBinding,
  ) {
    const workspace = yield* store.getTicketWorkspace(ticket.id);
    return (
      Option.isSome(workspace) &&
      workspace.value.repositories.some(
        (repository) =>
          repository.status === "ready" &&
          repository.projectId === binding.projectId &&
          repository.worktreePath === binding.worktreePath,
      )
    );
  });

  const linkThread = Effect.fn("ThreadLinkService.linkThread")(function* (
    input: WorkbenchLinkThreadInput,
  ) {
    const ticket = yield* store.getTicket(input.ticketId);
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    const from = yield* requireLinkableSource(input.threadId);
    if (yield* runsInTicketCheckout(ticket.value, from))
      return yield* store.createAssignment(input);

    const repositories = ticket.value.repositoryProjectIds;
    const projectId = repositories.includes(from.projectId)
      ? from.projectId
      : input.repositoryProjectId;
    if (projectId === undefined || !repositories.includes(projectId)) {
      return yield* new WorkbenchOperationError({
        code: "repository_not_linked",
        message: "Choose one of this Ticket's repositories for the forked Thread.",
      });
    }
    const checkout = yield* prepareTicketCheckout({
      workspaces,
      ticketId: ticket.value.id,
      projectId,
      requestedAt: input.createdAt,
    });
    const to = { projectId, branch: checkout.branchName, worktreePath: checkout.worktreePath };
    // Uninterruptible so a dropped request cannot strand a fork between its creation and cleanup.
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const forkId = yield* host.forkThread(input.threadId);
        return yield* host.rebindThread({ threadId: forkId, from, to }).pipe(
          Effect.andThen(store.createAssignment({ ...input, threadId: forkId })),
          Effect.onError(() => host.deleteThread(forkId).pipe(Effect.ignore)),
        );
      }),
    );
  });

  return ThreadLinkService.of({ linkThread });
});

export const layer = Layer.effect(ThreadLinkService, make);
