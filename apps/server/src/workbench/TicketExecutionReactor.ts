import {
  CommandId,
  EventId,
  TurnItemId,
  type OrchestrationV2StoredEvent,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../serverActivation.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import {
  TicketExecutionService,
  layer as ticketExecutionLayer,
} from "@t3tools/workbench/TicketExecutionService";

type ExecutionFailure = {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly startedAt: string;
};

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

  const appendFailureActivity = (execution: ExecutionFailure, cause: Cause.Cause<unknown>) => {
    const occurredAt = DateTime.makeUnsafe(execution.startedAt);
    const identity = `workbench:ticket-execution-failed:${execution.runId}`;
    return sink
      .commitCommand({
        commandId: CommandId.make(identity),
        threadId: execution.threadId,
        commandType: "workbench.ticket-execution-failed",
        acceptedAt: occurredAt,
        effects: [],
        events: [
          {
            id: EventId.make(identity),
            type: "turn-item.updated",
            threadId: execution.threadId,
            runId: execution.runId,
            occurredAt: occurredAt,
            payload: {
              id: TurnItemId.make(identity),
              threadId: execution.threadId,
              runId: execution.runId,
              nodeId: null,
              providerThreadId: null,
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
              startedAt: occurredAt,
              completedAt: occurredAt,
              updatedAt: occurredAt,
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
                threadId: execution.threadId,
                cause: Cause.pretty(activityCause),
              }),
        ),
      );
  };

  const processEventSafely = Effect.fn("TicketExecutionReactor.processEventSafely")(
    (stored: OrchestrationV2StoredEvent) =>
      Effect.gen(function* () {
        const event = stored.event;
        const running =
          (event.type === "run.created" || event.type === "run.updated") &&
          event.payload.status === "running" &&
          event.payload.startedAt !== null &&
          (event.nodeId === undefined || event.nodeId === event.payload.rootNodeId);
        if (!running) return;
        const thread = yield* orchestrationEngine.getThreadShell(event.threadId);
        if (thread === null || thread.lineage.parentThreadId !== null) return;
        const pending = yield* tickets.consume({
          sequence: stored.sequence,
          run: {
            id: event.payload.id,
            threadId: event.threadId,
            startedAt: DateTime.formatIso(event.payload.startedAt ?? event.occurredAt),
          },
        });
        if (pending !== null)
          yield* tickets
            .resume(pending)
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : appendFailureActivity(pending, cause),
              ),
            );
        return stored.sequence;
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.fail(cause),
        ),
        Effect.retry({ times: 2, schedule: Schedule.exponential("250 millis") }),
        Effect.catch((cause) => {
          const event = stored.event;
          if (event.type === "run.created" || event.type === "run.updated") {
            return appendFailureActivity(
              {
                runId: event.payload.id,
                threadId: event.threadId,
                startedAt: DateTime.formatIso(event.occurredAt),
              },
              cause,
            ).pipe(Effect.andThen(Effect.failCause(cause)));
          }
          return Effect.failCause(cause);
        }),
      ),
  );
  const ready = yield* Deferred.make<void>();
  const seenSequence = yield* SubscriptionRef.make(0);
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));
  const initialize = tickets.initialize.pipe(
    Effect.retry({ schedule: Schedule.spaced("1 second") }),
    Effect.orDie,
  );
  const start: TicketExecutionReactorShape["start"] = Effect.fn("TicketExecutionReactor.start")(
    function* () {
      const sequence = yield* initialize;
      yield* noteSeen(sequence);
      yield* forkParked(
        Effect.gen(function* () {
          let afterSequence = sequence;
          let restartDelay = 1_000;
          while (true) {
            yield* Effect.gen(function* () {
              // Obligations survive independently of the contiguous local event cursor.
              const pending = yield* tickets.pending;
              for (const run of pending) {
                yield* tickets
                  .resume(run)
                  .pipe(
                    Effect.catchCause((cause) =>
                      Cause.hasInterruptsOnly(cause)
                        ? Effect.interrupt
                        : appendFailureActivity(run, cause),
                    ),
                  );
              }
              yield* Deferred.succeed(ready, undefined);
              yield* Stream.runForEach(sink.stream({ afterSequence }), (stored) =>
                processEventSafely(stored).pipe(
                  Effect.tap((consumedSequence) =>
                    Effect.sync(() => {
                      // Replayed ignored events do not advance the durable cursor.
                      if (consumedSequence !== undefined && consumedSequence > afterSequence) {
                        restartDelay = 1_000;
                      }
                    }),
                  ),
                  Effect.andThen(noteSeen(stored.sequence)),
                ),
              );
            }).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : Effect.logWarning("Ticket execution consumption will restart", {
                      cause: Cause.pretty(cause),
                    }),
              ),
            );
            yield* Effect.sleep(restartDelay);
            restartDelay = Math.min(restartDelay * 2, 30_000);
            // A failed event was never acknowledged; replay must start from persisted progress.
            afterSequence = yield* initialize;
          }
        }).pipe(Effect.orDie, Effect.ensuring(Deferred.succeed(ready, undefined))),
      );
    },
  );

  const drainThrough: TicketExecutionReactorShape["drainThrough"] = Effect.fn(
    "TicketExecutionReactor.drainThrough",
  )(function* (target) {
    yield* Deferred.await(ready);
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
  });

  return {
    start,
    drain: Deferred.await(ready).pipe(
      Effect.andThen(sink.latestSequence()),
      Effect.orDie,
      Effect.flatMap(drainThrough),
    ),
    drainThrough,
  } satisfies TicketExecutionReactorShape;
});

export const layer = Layer.effect(TicketExecutionReactor, make).pipe(
  Layer.provide(ticketExecutionLayer),
);
