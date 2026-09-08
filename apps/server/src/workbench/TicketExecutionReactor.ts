import { CommandId, EventId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../serverActivation.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import {
  TicketExecutionService,
  layer as ticketExecutionLayer,
} from "@t3tools/workbench/TicketExecutionService";

type ThreadSessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;

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
  const orchestrationEngine = yield* OrchestrationEngineService;
  const tickets = yield* TicketExecutionService;

  const appendFailureActivity = (event: ThreadSessionSetEvent, cause: Cause.Cause<unknown>) =>
    orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`server:ticket-execution-failed:${event.sequence}`),
        threadId: event.payload.threadId,
        activity: {
          id: EventId.make(`workbench:ticket-execution-failed:${event.sequence}`),
          tone: "error",
          kind: "workbench.ticket.execution.failed",
          summary: "Could not move the linked Ticket to In Progress.",
          payload: { detail: Cause.pretty(cause) },
          turnId: event.payload.session.activeTurnId,
          createdAt: event.occurredAt,
        },
        createdAt: event.occurredAt,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((activityCause) =>
          Cause.hasInterruptsOnly(activityCause)
            ? Effect.interrupt
            : Effect.logWarning("Ticket execution failure activity could not be recorded", {
                threadId: event.payload.threadId,
                cause: Cause.pretty(activityCause),
              }),
        ),
      );

  const processEventSafely = (event: ThreadSessionSetEvent) =>
    tickets
      .start({ threadId: event.payload.threadId, startedAt: event.occurredAt })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : appendFailureActivity(event, cause),
        ),
      );

  const worker = yield* makeDrainableWorker(processEventSafely);
  const seenSequence = yield* SubscriptionRef.make(0);
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));
  const processedTurns = new Map<string, string>();

  const start: TicketExecutionReactorShape["start"] = Effect.fn("TicketExecutionReactor.start")(
    function* () {
      const events = yield* orchestrationEngine.subscribeDomainEvents;
      yield* orchestrationEngine.latestSequence.pipe(Effect.flatMap(noteSeen));
      yield* forkParked(
        Stream.runForEach(events, (event) => {
          if (event.type === "thread.deleted") processedTurns.delete(event.aggregateId);
          if (event.type !== "thread.session-set") return noteSeen(event.sequence);
          const activeTurnId = event.payload.session.activeTurnId;
          const isNewTurn =
            event.payload.session.status === "running" &&
            activeTurnId !== null &&
            processedTurns.get(event.payload.threadId) !== activeTurnId;
          if (isNewTurn) processedTurns.set(event.payload.threadId, activeTurnId);
          return (isNewTurn ? worker.enqueue(event) : Effect.void).pipe(
            Effect.andThen(noteSeen(event.sequence)),
          );
        }),
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
