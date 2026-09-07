import * as NodeCrypto from "node:crypto";
import type {
  WorkbenchOperationError,
  WorkbenchRegenerateTicketSummaryInput,
  WorkbenchTicket,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { TicketSummaryHost } from "./TicketSummaryHost.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

export class TicketSummaryService extends Context.Service<
  TicketSummaryService,
  {
    readonly regenerate: (
      input: WorkbenchRegenerateTicketSummaryInput,
    ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
    /** Wait for currently scheduled generations to finish, including superseding requests. */
    readonly awaitIdle: Effect.Effect<void>;
  }
>()("@t3tools/workbench/TicketSummaryService") {}

interface SummaryJob {
  readonly requestId: string;
  readonly ticket: WorkbenchTicket;
}

export const TicketSummaryServiceLive = Layer.effect(
  TicketSummaryService,
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    const host = yield* TicketSummaryHost;
    const queue = yield* Queue.unbounded<WorkbenchTicketId>();
    const lock = yield* Semaphore.make(1);
    // One queued entry per ticket and one running model call per environment.
    const jobs = new Map<WorkbenchTicketId, SummaryJob>();
    const queued = new Set<WorkbenchTicketId>();
    let idle = yield* Deferred.make<void>();
    yield* Deferred.succeed(idle, undefined);

    const enqueue = Effect.fn("TicketSummaryService.enqueue")(function* ({
      ticketId,
      automatic,
    }: {
      readonly ticketId: WorkbenchTicketId;
      readonly automatic: boolean;
    }) {
      if (automatic) {
        const candidate = yield* store.getTicketSummaryCandidate(ticketId);
        if (Option.isNone(candidate)) return Option.none<WorkbenchTicket>();
        const existing = jobs.get(ticketId);
        if (
          existing &&
          existing.ticket.title === candidate.value.title &&
          existing.ticket.markdown === candidate.value.markdown
        ) {
          return Option.some(existing.ticket);
        }
      }
      const requestId = NodeCrypto.randomUUID();
      const ticket = yield* store.requestTicketSummary({ ticketId, requestId });
      if (jobs.size === 0) idle = yield* Deferred.make<void>();
      jobs.set(ticketId, { requestId, ticket });
      if (!queued.has(ticketId)) {
        queued.add(ticketId);
        yield* Queue.offer(queue, ticketId);
      }
      return Option.some(ticket);
    }, lock.withPermit);

    const finish = (job: SummaryJob) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (jobs.get(job.ticket.id)?.requestId === job.requestId) jobs.delete(job.ticket.id);
          if (jobs.size === 0) yield* Deferred.succeed(idle, undefined);
        }),
      );

    const processNext = Effect.gen(function* () {
      const ticketId = yield* Queue.take(queue);
      const job = yield* lock.withPermit(
        Effect.sync(() => {
          queued.delete(ticketId);
          return jobs.get(ticketId);
        }),
      );
      if (!job) return;
      yield* Effect.gen(function* () {
        const current = yield* store.getTicketSummaryCandidate(ticketId);
        if (
          Option.isNone(current) ||
          current.value.title !== job.ticket.title ||
          current.value.markdown !== job.ticket.markdown
        )
          return;
        const summary = yield* host.generate(job.ticket).pipe(
          Effect.map(Option.some),
          Effect.catch((error) =>
            store
              .failTicketSummary({
                ticketId,
                requestId: job.requestId,
                error: error.message,
              })
              .pipe(Effect.as(Option.none<string>())),
          ),
        );
        if (Option.isSome(summary)) {
          yield* store.completeTicketSummary({
            ticketId,
            requestId: job.requestId,
            summary: summary.value,
          });
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.failCause(cause)
            : store
                .failTicketSummary({
                  ticketId,
                  requestId: job.requestId,
                  error: "Summary generation failed. Try regenerating the summary.",
                })
                .pipe(
                  Effect.catchCause(() =>
                    Effect.logError("Ticket summary failure could not be saved."),
                  ),
                ),
        ),
        Effect.ensuring(finish(job)),
      );
    });
    yield* processNext.pipe(Effect.forever, Effect.forkScoped);
    yield* store.ticketChanges.pipe(
      Stream.runForEach(({ ticketId }) =>
        enqueue({ ticketId, automatic: true }).pipe(
          Effect.catch(() => Effect.logWarning("A ticket summary could not be scheduled.")),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    // Pending rows include first-time backfill and work interrupted by a server restart.
    for (const ticket of yield* store.listTicketsNeedingSummary) {
      yield* enqueue({ ticketId: ticket.id, automatic: true });
    }
    return TicketSummaryService.of({
      regenerate: (input) =>
        enqueue({ ticketId: input.ticketId, automatic: false }).pipe(Effect.map(Option.getOrThrow)),
      awaitIdle: Effect.suspend(() => Deferred.await(idle)),
    });
  }),
);
