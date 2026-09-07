import {
  ProjectId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { TicketSummaryHost } from "./TicketSummaryHost.ts";
import { TicketSummaryService, TicketSummaryServiceLive } from "./TicketSummaryService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const projectId = ProjectId.make("summary-project");
const workspaceId = WorkbenchProjectId.make("summary-workspace");
const ticketId = WorkbenchTicketId.make("summary-ticket");
const createdAt = "2026-09-07T10:00:00.000Z";

const storeLayer = WorkbenchStoreLive.pipe(
  Layer.provide(
    Layer.succeed(WorkbenchNativeAccess, {
      findProject: (id) => Effect.succeed(Option.some({ id })),
      findThread: () => Effect.succeed(Option.none()),
    }),
  ),
  Layer.provide(NodeSqliteClient.layerMemory()),
);

const testLayer = (host: TicketSummaryHost["Service"]) =>
  TicketSummaryServiceLive.pipe(
    Layer.provide(Layer.succeed(TicketSummaryHost, host)),
    Layer.provideMerge(storeLayer),
  );

const createTicket = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Summary workspace",
    linkedProjectIds: [projectId],
    createdAt,
  });
  return yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Validate requests",
    kind: "bug",
    markdown: "Reject invalid dimensions before querying the provider.",
    primaryT3ProjectId: projectId,
    createdAt,
  });
});

describe("TicketSummaryService", () => {
  it.effect("records an unexpected generator failure instead of leaving the summary pending", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const service = yield* TicketSummaryService;
        yield* createTicket;
        yield* Deferred.await(started);
        yield* service.awaitIdle;
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary?.status).toBe("error");
      }).pipe(
        Effect.provide(
          testLayer({
            generate: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.die("Unexpected provider failure")),
              ),
          }),
        ),
      );
    }),
  );

  it.effect("resumes pending tickets that predate the worker with a fresh request", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const service = yield* TicketSummaryService;
      yield* service.awaitIdle;
      expect((yield* store.getSnapshot).tickets[0]?.generatedSummary?.text).toBe(
        "A saved summary.",
      );
      expect(
        Option.isNone(
          yield* store.completeTicketSummary({
            ticketId,
            requestId: "interrupted-request",
            summary: "An obsolete result.",
          }),
        ),
      ).toBe(true);
    }).pipe(
      Effect.provide(
        TicketSummaryServiceLive.pipe(
          Layer.provide(
            Layer.effect(
              TicketSummaryHost,
              createTicket.pipe(
                Effect.andThen(
                  Effect.gen(function* () {
                    const store = yield* WorkbenchStore;
                    yield* store.requestTicketSummary({
                      ticketId,
                      requestId: "interrupted-request",
                    });
                  }),
                ),
                Effect.as({
                  generate: () => Effect.succeed("A saved summary."),
                }),
              ),
            ),
          ),
          Layer.provideMerge(storeLayer),
        ),
      ),
    ),
  );

  it.effect("automatically stores a summary without changing the ticket content revision", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const service = yield* TicketSummaryService;
        const original = yield* createTicket;
        yield* Deferred.await(started);
        yield* service.awaitIdle;
        const ticket = (yield* store.getSnapshot).tickets[0];
        expect(ticket?.generatedSummary).toEqual({
          text: "Validate dimensions before querying the provider.",
          status: "ready",
          stale: false,
          error: null,
        });
        expect(ticket?.title).toBe(original.title);
        expect(ticket?.markdown).toBe(original.markdown);
        expect(ticket?.revision).toBe(original.revision);
        expect(ticket?.updatedAt).toBe(original.updatedAt);
      }).pipe(
        Effect.provide(
          testLayer({
            generate: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.as("Validate dimensions before querying the provider."),
              ),
          }),
        ),
      );
    }),
  );

  it.effect("replaces an in-flight request when saved content changes", () =>
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      let calls = 0;
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const service = yield* TicketSummaryService;
        yield* createTicket;
        yield* Deferred.await(firstStarted);
        yield* store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          title: "Validate requests",
          markdown: "Show a clear error for invalid dimensions.",
          updatedAt: "2026-09-07T10:01:00.000Z",
        });
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);
        yield* service.awaitIdle;
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary?.text).toBe(
          "Show a clear error for invalid dimensions.",
        );
        expect(calls).toBe(2);
      }).pipe(
        Effect.provide(
          testLayer({
            generate: (ticket) =>
              Effect.gen(function* () {
                calls += 1;
                if (calls === 1) {
                  yield* Deferred.succeed(firstStarted, undefined);
                  yield* Deferred.await(releaseFirst);
                } else {
                  yield* Deferred.succeed(secondStarted, undefined);
                }
                return ticket.markdown;
              }),
          }),
        ),
      );
    }),
  );

  it.effect("keeps the previous summary after failure and supports an explicit retry", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let calls = 0;
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const service = yield* TicketSummaryService;
        yield* createTicket;
        yield* Deferred.await(started);
        yield* service.awaitIdle;
        yield* service.regenerate({ ticketId });
        yield* service.awaitIdle;
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual({
          text: "First summary.",
          status: "error",
          stale: false,
          error: "The selected model is unavailable.",
        });
        yield* service.regenerate({ ticketId });
        yield* service.awaitIdle;
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary?.text).toBe(
          "Retried summary.",
        );
        expect(calls).toBe(3);
      }).pipe(
        Effect.provide(
          testLayer({
            generate: () =>
              Effect.gen(function* () {
                calls += 1;
                yield* Deferred.succeed(started, undefined);
                if (calls === 2)
                  return yield* new WorkbenchOperationError({
                    code: "ticket_summary_generation_failed",
                    message: "The selected model is unavailable.",
                  });
                return calls === 1 ? "First summary." : "Retried summary.";
              }),
          }),
        ),
      );
    }),
  );
});
