import {
  CommandId,
  CorrelationId,
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type WorkbenchSnapshot,
  WorkbenchProjectId,
  WorkbenchAssignmentId,
  ProjectId,
  WorkbenchTicketId,
  ThreadId,
  TurnId,
  WorkbenchOperationError,
  WorkbenchJiraOperationError,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { TicketExecutionReactor, layer } from "./TicketExecutionReactor.ts";

const THREAD_ID = ThreadId.make("execution-reactor-thread");
const TICKET_ID = WorkbenchTicketId.make("execution-reactor-ticket");
const PROJECT_ID = WorkbenchProjectId.make("execution-reactor-project");
const TURN_ONE = TurnId.make("execution-reactor-turn-1");
const TURN_TWO = TurnId.make("execution-reactor-turn-2");
const NOW = "2026-09-08T10:00:00.000Z";

const sessionEvent = (
  sequence: number,
  turnId: TurnId,
): Extract<OrchestrationEvent, { type: "thread.session-set" }> => ({
  sequence,
  eventId: EventId.make(`execution-reactor-event-${sequence}`),
  aggregateKind: "thread",
  aggregateId: THREAD_ID,
  type: "thread.session-set",
  occurredAt: NOW,
  commandId: CommandId.make(`execution-reactor-command-${sequence}`),
  causationEventId: null,
  correlationId: CorrelationId.make(`execution-reactor-command-${sequence}`),
  metadata: {},
  payload: {
    threadId: THREAD_ID,
    session: {
      threadId: THREAD_ID,
      status: "running",
      providerName: "test",
      runtimeMode: "full-access",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: NOW,
    },
  },
});

const snapshot: WorkbenchSnapshot = {
  projects: [],
  epics: [],
  tickets: [
    {
      id: TICKET_ID,
      projectId: PROJECT_ID,
      epicId: null,
      title: "Execution ticket",
      kind: "story",
      markdown: "Run the linked Thread.",
      primaryT3ProjectId: ProjectId.make("t3-project"),
      repositoryProjectIds: [ProjectId.make("t3-project")],
      status: "todo",
      blocked: false,
      revision: 0,
      generatedSummary: { text: null, status: "pending", stale: false, error: null },
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  assignments: [
    {
      id: WorkbenchAssignmentId.make("execution-reactor-assignment"),
      ticketId: TICKET_ID,
      threadId: THREAD_ID,
      createdAt: NOW,
      supersededAt: null,
    },
  ],
  reservedThreadIds: [],
  ticketWorkspaces: [],
};

const emptyJira = {
  startTicketExecution: () => Effect.die("unexpected Jira execution"),
} satisfies Partial<WorkbenchJiraService["Service"]>;

describe("TicketExecutionReactor", () => {
  effectIt.effect(
    "ignores events without active execution and tickets outside active todo work",
    () =>
      Effect.gen(function* () {
        const running = sessionEvent(1, TURN_ONE);
        const ticket = snapshot.tickets[0]!;
        const assignment = snapshot.assignments[0]!;
        const cases = [
          {
            snapshot,
            event: {
              ...running,
              payload: {
                ...running.payload,
                session: { ...running.payload.session, status: "starting" as const },
              },
            },
          },
          {
            snapshot,
            event: {
              ...running,
              payload: {
                ...running.payload,
                session: { ...running.payload.session, status: "ready" as const },
              },
            },
          },
          {
            snapshot,
            event: {
              ...running,
              payload: {
                ...running.payload,
                session: { ...running.payload.session, activeTurnId: null },
              },
            },
          },
          { snapshot: { ...snapshot, assignments: [] }, event: running },
          {
            snapshot: { ...snapshot, assignments: [{ ...assignment, supersededAt: NOW }] },
            event: running,
          },
          { snapshot: { ...snapshot, tickets: [{ ...ticket, archivedAt: NOW }] }, event: running },
          {
            snapshot: { ...snapshot, tickets: [{ ...ticket, status: "done" as const }] },
            event: running,
          },
          {
            snapshot: { ...snapshot, tickets: [{ ...ticket, status: "in_progress" as const }] },
            event: running,
          },
        ];
        for (const testCase of cases) {
          const events = yield* PubSub.unbounded<OrchestrationEvent>();
          const starts = yield* Ref.make(0);
          const warnings = yield* Ref.make(0);
          yield* Effect.gen(function* () {
            const reactor = yield* TicketExecutionReactor;
            yield* reactor.start();
            yield* PubSub.publish(events, testCase.event);
            yield* reactor.drainThrough(1);
            expect(yield* Ref.get(starts)).toBe(0);
            expect(yield* Ref.get(warnings)).toBe(0);
          }).pipe(
            Effect.provide(
              layer.pipe(
                Layer.provide(
                  Layer.mock(WorkbenchStore)({
                    getSnapshot: Effect.succeed(testCase.snapshot),
                    startTicketExecution: () =>
                      Ref.update(starts, (n) => n + 1).pipe(Effect.as({ ticket, changed: true })),
                  }),
                ),
                Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
                Layer.provide(
                  Layer.mock(OrchestrationEngineService)({
                    latestSequence: Effect.succeed(0),
                    subscribeDomainEvents: PubSub.subscribe(events).pipe(
                      Effect.map(Stream.fromSubscription),
                    ),
                    dispatch: () =>
                      Ref.update(warnings, (n) => n + 1).pipe(Effect.as({ sequence: 2 })),
                  }),
                ),
              ),
            ),
            Effect.scoped,
          );
        }
      }),
  );

  effectIt.effect("uses persisted Jira ownership instead of guessing from the ticket ID", () =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const transitioned = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        yield* PubSub.publish(events, sessionEvent(1, TURN_ONE));
        yield* reactor.drainThrough(1);
        expect(yield* Ref.get(transitioned)).toEqual([TICKET_ID]);
      }).pipe(
        Effect.provide(
          layer.pipe(
            Layer.provide(
              Layer.mock(WorkbenchStore)({
                getSnapshot: Effect.succeed(snapshot),
                startTicketExecution: () =>
                  Effect.fail(
                    new WorkbenchOperationError({
                      code: "jira_managed_ticket",
                      message: "Jira owns this ticket.",
                    }),
                  ),
              }),
            ),
            Layer.provide(
              Layer.mock(WorkbenchJiraService)({
                startTicketExecution: ({ ticketId }) =>
                  Ref.update(transitioned, (ids) => [...ids, ticketId]).pipe(
                    Effect.andThen(
                      Effect.fail(
                        new WorkbenchJiraOperationError({
                          code: "request_failed",
                          message: "Test finished after observing routing.",
                        }),
                      ),
                    ),
                  ),
              }),
            ),
            Layer.provide(
              Layer.mock(OrchestrationEngineService)({
                latestSequence: Effect.succeed(0),
                subscribeDomainEvents: PubSub.subscribe(events).pipe(
                  Effect.map(Stream.fromSubscription),
                ),
                dispatch: () => Effect.succeed({ sequence: 2 }),
              }),
            ),
          ),
        ),
        Effect.scoped,
      );
    }),
  );

  effectIt.effect("reports a failed transition and retries on the next turn", () =>
    Effect.gen(function* () {
      const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const starts = yield* Ref.make(0);
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const workbench = {
        getSnapshot: Effect.succeed(snapshot),
        startTicketExecution: () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(starts, (value) => value + 1);
            if (count === 1) {
              return yield* new WorkbenchOperationError({
                code: "persistence_failed",
                message: "test transition failed",
              });
            }
            return { ticket: snapshot.tickets[0]!, changed: true };
          }),
      } satisfies Partial<WorkbenchStore["Service"]>;
      const engine = {
        latestSequence: Effect.succeed(0),
        subscribeDomainEvents: PubSub.subscribe(domainEvents).pipe(
          Effect.map(Stream.fromSubscription),
        ),
        dispatch: (command: OrchestrationCommand) =>
          Ref.update(commands, (recorded) => [...recorded, command]).pipe(
            Effect.as({ sequence: 100 }),
          ),
      } satisfies Partial<OrchestrationEngineService["Service"]>;
      const testLayer = layer.pipe(
        Layer.provide(Layer.mock(WorkbenchStore)(workbench)),
        Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
        Layer.provide(Layer.mock(OrchestrationEngineService)(engine)),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* PubSub.publish(domainEvents, sessionEvent(1, TURN_ONE));
          yield* reactor.drainThrough(1);

          const failedCommands = yield* Ref.get(commands);
          expect(yield* Ref.get(starts)).toBe(1);
          expect(failedCommands).toHaveLength(1);
          const failureCommand = failedCommands[0];
          expect(failureCommand?.type).toBe("thread.activity.append");
          if (failureCommand?.type === "thread.activity.append") {
            expect(failureCommand.activity.tone).toBe("error");
          }

          yield* PubSub.publish(domainEvents, sessionEvent(2, TURN_TWO));
          yield* reactor.drainThrough(2);
          expect(yield* Ref.get(starts)).toBe(2);
          expect(yield* Ref.get(commands)).toHaveLength(1);
        }),
      ).pipe(Effect.provide(testLayer));
    }),
  );

  effectIt.effect("does not process repeated running events for the same turn", () =>
    Effect.gen(function* () {
      const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const starts = yield* Ref.make(0);
      const workbench = {
        getSnapshot: Effect.succeed(snapshot),
        startTicketExecution: () =>
          Ref.update(starts, (value) => value + 1).pipe(
            Effect.as({ ticket: snapshot.tickets[0]!, changed: true }),
          ),
      } satisfies Partial<WorkbenchStore["Service"]>;
      const engine = {
        latestSequence: Effect.succeed(0),
        subscribeDomainEvents: PubSub.subscribe(domainEvents).pipe(
          Effect.map(Stream.fromSubscription),
        ),
        dispatch: () => Effect.succeed({ sequence: 100 }),
      } satisfies Partial<OrchestrationEngineService["Service"]>;
      const testLayer = layer.pipe(
        Layer.provide(Layer.mock(WorkbenchStore)(workbench)),
        Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
        Layer.provide(Layer.mock(OrchestrationEngineService)(engine)),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* PubSub.publish(domainEvents, sessionEvent(3, TURN_ONE));
          yield* PubSub.publish(domainEvents, sessionEvent(4, TURN_ONE));
          yield* reactor.drainThrough(4);
          expect(yield* Ref.get(starts)).toBe(1);
        }),
      ).pipe(Effect.provide(testLayer));
    }),
  );
});
