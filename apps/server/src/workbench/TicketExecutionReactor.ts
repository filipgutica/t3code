import {
  CommandId,
  EventId,
  TurnItemId,
  type OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../serverActivation.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { makeProviderFailure } from "../orchestration-v2/ProviderFailure.ts";
import {
  TicketExecutionService,
  layer as ticketExecutionLayer,
} from "@t3tools/workbench/TicketExecutionService";

type RunEvent = Extract<
  OrchestrationV2StoredEvent["event"],
  { type: "run.created" | "run.updated" }
>;
type ExecutionEvent = { readonly sequence: number; readonly event: RunEvent };

export interface TicketExecutionReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

export class TicketExecutionReactor extends Context.Service<
  TicketExecutionReactor,
  TicketExecutionReactorShape
>()("t3/workbench/TicketExecutionReactor") {}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestratorV2;
  const tickets = yield* TicketExecutionService;
  const sink = yield* EventSinkV2;

  const appendFailureActivity = ({ event }: ExecutionEvent, cause: Cause.Cause<unknown>) => {
    const identity = `workbench:ticket-execution-failed:${event.payload.id}`;
    return sink
      .commitCommand({
        commandId: CommandId.make(identity),
        threadId: event.threadId,
        commandType: "workbench.ticket-execution-failed",
        acceptedAt: event.occurredAt,
        effects: [],
        events: [
          {
            id: EventId.make(identity),
            type: "turn-item.updated",
            threadId: event.threadId,
            runId: event.payload.id,
            occurredAt: event.occurredAt,
            payload: {
              id: TurnItemId.make(identity),
              threadId: event.threadId,
              runId: event.payload.id,
              nodeId: event.payload.rootNodeId,
              providerThreadId: event.payload.providerThreadId,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              // EventSink allocates the item's canonical position in its transaction.
              ordinal: 0,
              status: "failed",
              type: "error",
              title: "Could not move the linked Ticket to In Progress.",
              failure: makeProviderFailure({
                message: Cause.pretty(cause),
                code: "workbench_ticket_execution_failed",
                class: "unknown",
                retryable: true,
              }),
              startedAt: event.occurredAt,
              completedAt: event.occurredAt,
              updatedAt: event.occurredAt,
            },
          },
        ],
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((activityCause) =>
          Cause.hasInterruptsOnly(activityCause)
            ? Effect.interrupt
            : Effect.logWarning("Ticket execution failure activity could not be recorded", {
                threadId: event.threadId,
                cause: Cause.pretty(activityCause),
              }),
        ),
      );
  };

  const processEventSafely = (execution: ExecutionEvent) =>
    Effect.gen(function* () {
      const { event } = execution;
      const thread = yield* orchestrationEngine.getThreadShell(event.threadId);
      if (thread === null || thread.lineage.parentThreadId !== null) return;
      yield* tickets.start({
        threadId: event.threadId,
        startedAt: DateTime.formatIso(event.payload.startedAt ?? event.occurredAt),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : appendFailureActivity(execution, cause),
      ),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);
  const seenSequence = yield* SubscriptionRef.make(0);
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));
  const processedTurns = new Map<string, number>();

  const start: TicketExecutionReactorShape["start"] = Effect.fn("TicketExecutionReactor.start")(
    function* () {
      const { snapshotSequence } = yield* orchestrationEngine.getShellSnapshot().pipe(Effect.orDie);
      yield* noteSeen(snapshotSequence);
      // Capture before activation, then replay from that cursor and tail live
      // events, so native startup producers cannot outrun this subscription.
      const events = sink.stream({
        afterSequence: snapshotSequence,
      });
      yield* forkParked(
        Stream.runForEach(events, (stored) => {
          const event = stored.event;
          if (event.type === "thread.deleted") processedTurns.delete(event.threadId);
          if (event.type !== "run.created" && event.type !== "run.updated")
            return noteSeen(stored.sequence);
          const isNewRun =
            event.payload.status === "running" &&
            event.payload.startedAt !== null &&
            (event.nodeId === undefined || event.nodeId === event.payload.rootNodeId) &&
            event.payload.ordinal > (processedTurns.get(event.threadId) ?? 0);
          if (isNewRun) processedTurns.set(event.threadId, event.payload.ordinal);
          return (
            isNewRun ? worker.enqueue({ sequence: stored.sequence, event }) : Effect.void
          ).pipe(Effect.andThen(noteSeen(stored.sequence)));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Ticket execution event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  const drainThrough: TicketExecutionReactorShape["drainThrough"] = Effect.fn(
    "TicketExecutionReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* worker.drain;
  });

  return {
    start,
    drain: worker.drain,
    drainThrough,
  } satisfies TicketExecutionReactorShape;
});

export const layer = Layer.effect(TicketExecutionReactor, make).pipe(
  Layer.provide(ticketExecutionLayer),
);
