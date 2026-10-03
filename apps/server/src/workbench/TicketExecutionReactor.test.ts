import {
  CommandId,
  EventId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2StoredEvent,
  type WorkbenchSnapshot,
  WorkbenchProjectId,
  WorkbenchAssignmentId,
  ProjectId,
  WorkbenchTicketId,
  ThreadId,
  RunId,
  NodeId,
  MessageId,
  ProviderInstanceId,
  OrchestrationV2ThreadShell,
  WorkbenchOperationError,
  WorkbenchJiraOperationError,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { EventSinkV2, layer as eventSinkLayer } from "../orchestration-v2/EventSink.ts";
import { layer as eventStoreLayer } from "../orchestration-v2/EventStore.ts";
import {
  ProjectionStoreV2,
  layer as projectionLayer,
} from "../orchestration-v2/ProjectionStore.ts";
import {
  CommandReceiptStoreV2,
  layer as receiptsLayer,
} from "../orchestration-v2/CommandReceiptStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ServerActivation } from "../serverActivation.ts";
import { layer as runtimeLayer } from "./OrchestrationReactor.ts";
import { seedNativeThread } from "./testing/nativeThreads.ts";
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { TicketExecutionReactor, layer } from "./TicketExecutionReactor.ts";

const THREAD_ID = ThreadId.make("execution-reactor-thread");
const TICKET_ID = WorkbenchTicketId.make("execution-reactor-ticket");
const PROJECT_ID = WorkbenchProjectId.make("execution-reactor-project");
const RUN_ONE = RunId.make("execution-reactor-turn-1");
const RUN_TWO = RunId.make("execution-reactor-turn-2");
const NOW = "2026-09-08T10:00:00.000Z";

const rootShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({
  id: THREAD_ID,
  projectId: "t3-project",
  title: "Execution",
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "default" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: DateTime.makeUnsafe(NOW),
  updatedAt: DateTime.makeUnsafe(NOW),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  createdBy: "user",
  creationSource: "web",
});

const runEvent = (
  sequence: number,
  runId: RunId,
): OrchestrationV2StoredEvent & {
  event: Extract<OrchestrationV2DomainEvent, { type: "run.updated" }>;
} => ({
  sequence,
  commandId: CommandId.make(`execution-reactor-command-${sequence}`),
  event: {
    id: EventId.make(`execution-reactor-event-${sequence}`),
    threadId: THREAD_ID,
    type: "run.updated",
    occurredAt: DateTime.makeUnsafe(NOW),
    payload: {
      id: runId,
      threadId: THREAD_ID,
      ordinal: runId === RUN_ONE ? 1 : 2,
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
      providerThreadId: null,
      userMessageId: MessageId.make(`user-${runId}`),
      rootNodeId: NodeId.make(`root-${runId}`),
      activeAttemptId: null,
      status: "running",
      requestedAt: DateTime.makeUnsafe(NOW),
      startedAt: DateTime.makeUnsafe(NOW),
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    },
  },
});

const shellSnapshot = Effect.succeed({
  schemaVersion: 1,
  snapshotSequence: 0,
  threads: [rootShell],
  archivedThreads: [],
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

const committedFailure = ({
  commandId,
  threadId,
  commandType,
  acceptedAt,
}: Parameters<EventSinkV2["Service"]["commitCommand"]>[0]) => ({
  receipt: {
    commandId,
    threadId,
    commandType,
    acceptedAt,
    resultSequence: 0,
    status: "accepted" as const,
    error: null,
  },
  storedEvents: [],
  committed: true,
  cancelledEffectCount: 0,
});

const emptyJira = {
  startTicketExecution: () => Effect.die("unexpected Jira execution"),
} satisfies Partial<WorkbenchJiraService["Service"]>;

describe("TicketExecutionReactor", () => {
  effectIt.effect("catches activation events and preserves a native failure item on replay", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const stores = Layer.mergeAll(eventStoreLayer, projectionLayer, receiptsLayer).pipe(
        Layer.provideMerge(SqlitePersistenceMemory),
      );
      const persistence = eventSinkLayer.pipe(Layer.provideMerge(stores));
      const execution = layer.pipe(
        Layer.provide(
          Layer.mock(WorkbenchStore)({
            getSnapshot: Effect.succeed(snapshot),
            startTicketExecution: () =>
              Ref.updateAndGet(starts, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  Effect.fail(
                    new WorkbenchOperationError({
                      code: "persistence_failed",
                      message: `transition failure ${count}`,
                    }),
                  ),
                ),
              ),
          }),
        ),
        Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
        Layer.provide(
          Layer.mock(OrchestratorV2)({
            getShellSnapshot: () => shellSnapshot,
            getThreadShell: () => Effect.succeed(rootShell),
          }),
        ),
      );
      const runtime = runtimeLayer.pipe(Layer.provideMerge(execution));
      yield* Effect.gen(function* () {
        const sink = yield* EventSinkV2;
        const projections = yield* ProjectionStoreV2;
        const receipts = yield* CommandReceiptStoreV2;
        yield* seedNativeThread({
          threadId: THREAD_ID,
          projectId: "t3-project",
          createdAt: NOW,
        });
        const activation = yield* Deferred.make<void>();
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          // The native run starts after layer construction while the overlay is parked.
          const stored = yield* sink.write({ events: [runEvent(1, RUN_ONE).event] });
          expect(yield* Ref.get(starts)).toBe(0);
          yield* Deferred.succeed(activation, undefined);
          yield* reactor.drainThrough(stored[0]!.sequence);
        }).pipe(
          Effect.provide(runtime),
          Effect.provideService(ServerActivation, Deferred.await(activation)),
          Effect.scoped,
        );
        const original = (yield* projections.getThreadProjection(THREAD_ID)).turnItems;
        expect(original).toHaveLength(1);
        expect(original[0]?.type).toBe("error");
        if (original[0]?.type === "error") {
          expect(original[0].failure.message).toContain("transition failure 1");
          expect(original[0].runId).toBe(RUN_ONE);
        }
        const commandId = CommandId.make(`workbench:ticket-execution-failed:${RUN_ONE}`);
        const originalReceipt = yield* receipts.getByCommandId(commandId);
        expect(Option.isSome(originalReceipt)).toBe(true);
        // A restarted subscriber replays the same run with a different failure.
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.drainThrough(1);
        }).pipe(Effect.provide(runtime), Effect.scoped);
        expect(yield* Ref.get(starts)).toBe(2);
        expect((yield* projections.getThreadProjection(THREAD_ID)).turnItems).toEqual(original);
        expect(yield* receipts.getByCommandId(commandId)).toEqual(originalReceipt);
        expect(yield* sink.readByCommandId({ commandId }).pipe(Stream.runCollect)).toHaveLength(1);
      }).pipe(Effect.provide(persistence), Effect.scoped);
    }),
  );

  effectIt.effect(
    "ignores events without active execution and tickets outside active todo work",
    () =>
      Effect.gen(function* () {
        const running = runEvent(1, RUN_ONE);
        const ticket = snapshot.tickets[0]!;
        const assignment = snapshot.assignments[0]!;
        const cases = [
          {
            snapshot,
            event: {
              ...running,
              event: {
                ...running.event,
                payload: { ...running.event.payload, status: "starting" as const },
              },
            },
          },
          {
            snapshot,
            event: {
              ...running,
              event: {
                ...running.event,
                payload: { ...running.event.payload, status: "queued" as const },
              },
            },
          },
          {
            snapshot,
            event: {
              ...running,
              event: { ...running.event, payload: { ...running.event.payload, startedAt: null } },
            },
          },
          {
            snapshot,
            event: { ...running, event: { ...running.event, nodeId: NodeId.make("child-node") } },
          },
          { snapshot, event: running, child: true },
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
          const events = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
          const starts = yield* Ref.make(0);
          const warnings = yield* Ref.make(0);
          yield* Effect.gen(function* () {
            const reactor = yield* TicketExecutionReactor;
            yield* reactor.start();
            yield* Queue.offer(events, testCase.event);
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
                  Layer.mock(EventSinkV2)({
                    stream: () => Stream.fromQueue(events),
                    commitCommand: (input) =>
                      Ref.update(warnings, (n) => n + 1).pipe(Effect.as(committedFailure(input))),
                  }),
                ),
                Layer.provide(
                  Layer.mock(OrchestratorV2)({
                    getShellSnapshot: () => shellSnapshot,
                    getThreadShell: () =>
                      Effect.succeed(
                        "child" in testCase
                          ? {
                              ...rootShell,
                              lineage: {
                                ...rootShell.lineage,
                                parentThreadId: ThreadId.make("parent"),
                                relationshipToParent: "subagent" as const,
                              },
                            }
                          : rootShell,
                      ),
                    streamStoredEventsFrom: () => Stream.fromQueue(events),
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
      const events = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
      const transitioned = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        yield* Queue.offer(events, runEvent(1, RUN_ONE));
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
              Layer.mock(EventSinkV2)({
                stream: () => Stream.fromQueue(events),
                commitCommand: (input) => Effect.succeed(committedFailure(input)),
              }),
            ),
            Layer.provide(
              Layer.mock(OrchestratorV2)({
                getShellSnapshot: () => shellSnapshot,
                getThreadShell: () => Effect.succeed(rootShell),
                streamStoredEventsFrom: () => Stream.fromQueue(events),
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
      const domainEvents = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
      const starts = yield* Ref.make(0);
      const recorded = yield* Ref.make<ReadonlyArray<OrchestrationV2DomainEvent>>([]);
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
        getShellSnapshot: () => shellSnapshot,
        getThreadShell: () => Effect.succeed(rootShell),
        streamStoredEventsFrom: () => Stream.fromQueue(domainEvents),
      } satisfies Partial<OrchestratorV2["Service"]>;
      const testLayer = layer.pipe(
        Layer.provide(Layer.mock(WorkbenchStore)(workbench)),
        Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
        Layer.provide(Layer.mock(OrchestratorV2)(engine)),
        Layer.provide(
          Layer.mock(EventSinkV2)({
            stream: () => Stream.fromQueue(domainEvents),
            commitCommand: (input) =>
              Ref.update(recorded, (old) => [...old, ...input.events]).pipe(
                Effect.as(committedFailure(input)),
              ),
          }),
        ),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* Queue.offer(domainEvents, runEvent(1, RUN_ONE));
          yield* reactor.drainThrough(1);

          const failedCommands = yield* Ref.get(recorded);
          expect(yield* Ref.get(starts)).toBe(1);
          expect(failedCommands).toHaveLength(1);
          const failureCommand = failedCommands[0];
          expect(failureCommand?.type).toBe("turn-item.updated");
          if (failureCommand?.type === "turn-item.updated") {
            expect(failureCommand.payload.type).toBe("error");
            expect(failureCommand.payload.runId).toBe(RUN_ONE);
          }

          yield* Queue.offer(domainEvents, runEvent(2, RUN_TWO));
          yield* reactor.drainThrough(2);
          expect(yield* Ref.get(starts)).toBe(2);
          expect(yield* Ref.get(recorded)).toHaveLength(1);
        }),
      ).pipe(Effect.provide(testLayer));
    }),
  );

  effectIt.effect("does not process repeated running events for the same turn", () =>
    Effect.gen(function* () {
      const domainEvents = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
      const starts = yield* Ref.make(0);
      const workbench = {
        getSnapshot: Effect.succeed(snapshot),
        startTicketExecution: () =>
          Ref.update(starts, (value) => value + 1).pipe(
            Effect.as({ ticket: snapshot.tickets[0]!, changed: true }),
          ),
      } satisfies Partial<WorkbenchStore["Service"]>;
      const engine = {
        getShellSnapshot: () => shellSnapshot,
        getThreadShell: () => Effect.succeed(rootShell),
        streamStoredEventsFrom: () => Stream.fromQueue(domainEvents),
      } satisfies Partial<OrchestratorV2["Service"]>;
      const testLayer = layer.pipe(
        Layer.provide(Layer.mock(WorkbenchStore)(workbench)),
        Layer.provide(Layer.mock(WorkbenchJiraService)(emptyJira)),
        Layer.provide(Layer.mock(OrchestratorV2)(engine)),
        Layer.provide(
          Layer.mock(EventSinkV2)({
            stream: () => Stream.fromQueue(domainEvents),
            commitCommand: (input) => Effect.succeed(committedFailure(input)),
          }),
        ),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* Queue.offer(domainEvents, runEvent(3, RUN_ONE));
          yield* Queue.offer(domainEvents, runEvent(4, RUN_ONE));
          yield* reactor.drainThrough(4);
          expect(yield* Ref.get(starts)).toBe(1);
        }),
      ).pipe(Effect.provide(testLayer));
    }),
  );
});
