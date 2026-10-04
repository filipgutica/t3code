import {
  CommandId,
  type OrchestrationV2ThreadShellSnapshot,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchOperationError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { OrchestratorV2, type OrchestratorV2Shape } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { isAutoSettlementCandidate } from "../orchestration-v2/ThreadSettlementService.ts";
import { forkParked } from "../serverActivation.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

type SettlementWorkbenchSnapshot = {
  readonly tickets: ReadonlyArray<Pick<WorkbenchTicket, "id" | "status" | "archivedAt">>;
  readonly assignments: ReadonlyArray<
    Pick<WorkbenchAssignment, "ticketId" | "threadId" | "supersededAt">
  >;
};

/** Done is a Workbench completion signal; native commands still own settlement and its race guards. */
export const settleDoneTicketThreads = Effect.fn("Workbench.settleDoneTicketThreads")(function* ({
  tickets,
  assignments,
  snapshot,
  dispatch,
  readCurrentWorkbench,
}: SettlementWorkbenchSnapshot & {
  readonly readCurrentWorkbench: Effect.Effect<
    SettlementWorkbenchSnapshot,
    WorkbenchOperationError
  >;
  readonly snapshot: OrchestrationV2ThreadShellSnapshot;
  readonly dispatch: OrchestratorV2Shape["dispatch"];
}) {
  const doneTicketIds = new Set(
    tickets
      .filter((ticket) => ticket.status === "done" && ticket.archivedAt == null)
      .map((ticket) => ticket.id),
  );
  const threadIds = new Set(
    assignments
      .filter(
        (assignment) => assignment.supersededAt === null && doneTicketIds.has(assignment.ticketId),
      )
      .map((assignment) => assignment.threadId),
  );
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  for (const thread of snapshot.threads) {
    if (
      !threadIds.has(thread.id) ||
      thread.status !== "completed" ||
      thread.latestRunCompletedAt == null ||
      thread.hasActionableProposedPlan ||
      !isAutoSettlementCandidate(thread, now)
    )
      continue;
    const current = yield* readCurrentWorkbench;
    const currentAssignment = current.assignments.find(
      (assignment) =>
        assignment.threadId === thread.id &&
        assignment.supersededAt === null &&
        doneTicketIds.has(assignment.ticketId),
    );
    if (
      !currentAssignment ||
      !current.tickets.some(
        (ticket) =>
          ticket.id === currentAssignment.ticketId &&
          ticket.status === "done" &&
          ticket.archivedAt == null,
      )
    )
      continue;
    yield* dispatch({
      type: "thread.auto-settle",
      commandId: CommandId.make(
        `server:workbench-settle:${thread.id}:${DateTime.toEpochMillis(thread.updatedAt)}`,
      ),
      threadId: thread.id,
      snapshotAt: thread.updatedAt,
      settledAt: thread.latestRunCompletedAt,
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Done Ticket thread settlement skipped", {
              threadId: thread.id,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  }
});

// Reconcile on activation and periodically: both Jira imports and local status changes
// write the Workbench projection, including Tickets already Done before this server starts.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const workbench = yield* WorkbenchStore;
    const snapshots = yield* ThreadManagementService;
    const engine = yield* OrchestratorV2;
    const reconcile = Effect.gen(function* () {
      const workbenchSnapshot = yield* workbench.getSnapshot;
      if (
        !workbenchSnapshot.tickets.some(
          (ticket) => ticket.status === "done" && ticket.archivedAt == null,
        )
      )
        return;
      const snapshot = yield* snapshots.getShellSnapshot();
      yield* settleDoneTicketThreads({
        ...workbenchSnapshot,
        snapshot,
        dispatch: engine.dispatch,
        readCurrentWorkbench: workbench.getSnapshot,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Done Ticket settlement reconciliation failed", {
              cause: Cause.pretty(cause),
            }),
      ),
    );
    yield* forkParked(reconcile.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid));
  }),
);
