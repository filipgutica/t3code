import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerSettings from "../../serverSettings.ts";
import * as CheckpointService from "../../orchestration-v2/CheckpointService.ts";
import * as TurnItemPositionStore from "../../orchestration-v2/TurnItemPositionStore.ts";
import type { PendingOrchestrationEffectV2 } from "../../orchestration-v2/EffectOutbox.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProviderEventIngestor from "../../orchestration-v2/ProviderEventIngestor.ts";
import * as McpAppModelContext from "../../mcpApps/McpAppModelContext.ts";
import * as RunExecutionService from "../../orchestration-v2/RunExecutionService.ts";
import * as RunFinalizationService from "../../orchestration-v2/RunFinalizationService.ts";

const driver = ProviderDriverKind.make("codex");

type TerminalStatus = "completed" | "interrupted" | "cancelled" | "failed";

function scenarioIds(key: string) {
  return {
    threadId: ThreadId.make(`thread:${key}`),
    runId: RunId.make(`run:${key}`),
    attemptId: RunAttemptId.make(`attempt:${key}`),
    providerThreadId: ProviderThreadId.make(`provider-thread:${key}`),
    rootProviderTurnId: ProviderTurnId.make(`provider-turn:${key}`),
    rootNodeId: NodeId.make(`node:${key}`),
  };
}

function rootTerminalEvent(
  ids: ReturnType<typeof scenarioIds>,
  status: TerminalStatus,
): ProviderAdapter.ProviderAdapterV2Event {
  const common = {
    type: "turn.terminal" as const,
    driver,
    providerThreadId: ids.providerThreadId,
    providerTurnId: ids.rootProviderTurnId,
    runOrdinal: 1,
    threadDisposition: "reusable" as const,
  };
  return status === "failed"
    ? {
        ...common,
        status,
        failureItemOrdinal: 101,
        failure: {
          class: "provider_error",
          message: "Provider failed",
          code: null,
          retryable: null,
        },
      }
    : { ...common, status, failure: null };
}

// Workbench planning runs start without a checkpoint scope.
function captureCheckpointFreeRootRun(status: TerminalStatus) {
  return Effect.gen(function* () {
    const key = `checkpoint-free:${status}`;
    const ids = scenarioIds(key);
    const providerInstanceId = ProviderInstanceId.make("codex");
    const observed = yield* Ref.make<ReadonlyArray<string>>([]);
    const submittedEffects = yield* Ref.make<ReadonlyArray<PendingOrchestrationEffectV2>>([]);
    const committedEffects = yield* Ref.make<ReadonlyArray<PendingOrchestrationEffectV2>>([]);
    const baselineCaptures = yield* Ref.make(0);
    const ingestionDone = yield* Deferred.make<void>();
    const observeRuns = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
      Ref.update(observed, (current) => [
        ...current,
        ...events.flatMap((event) =>
          event.type === "run.updated" ? [`run:${event.payload.status}`] : [],
        ),
      ]);
    const layerTest = RunExecutionService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          McpAppModelContext.layerEmpty,
          Layer.mock(CheckpointService.CheckpointServiceV2)({
            captureBaseline: () => Ref.update(baselineCaptures, (count) => count + 1),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            write: () => Effect.succeed([]),
            writeWithEffects: (payload) =>
              Effect.gen(function* () {
                yield* Ref.update(submittedEffects, (current) => [...current, ...payload.effects]);
                yield* Ref.update(committedEffects, (current) => [...current, ...payload.effects]);
                yield* observeRuns(payload.events);
                return [];
              }),
            writeIfRunCurrent: (payload) =>
              Effect.gen(function* () {
                const effects = payload.effects ?? [];
                yield* Ref.update(submittedEffects, (current) => [...current, ...effects]);
                yield* Ref.update(committedEffects, (current) => [...current, ...effects]);
                yield* observeRuns(payload.events);
                return { committed: true, storedEvents: [] };
              }),
          }),
          IdAllocator.layer,
          Layer.mock(TurnItemPositionStore.TurnItemPositionStoreV2)({
            allocate: () => Effect.succeed(1),
          }),
          Layer.mock(ProviderEventIngestor.ProviderEventIngestorV2)({
            ingestNormalized: () => Effect.succeed([]),
          }),
          ServerSettings.layerTest(),
          Layer.succeed(RunFinalizationService.RunFinalizationObserver, {
            refresh: () => Effect.void,
            refreshAfterTurn: () =>
              Ref.update(observed, (current) => [...current, "pull-requests-refreshed"]),
          }),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      const runExecution = yield* RunExecutionService.RunExecutionServiceV2;
      yield* runExecution.startRootRun({
        commandId: CommandId.make(`command:${key}`),
        appThread: { id: ids.threadId } as OrchestrationV2AppThread,
        providerSessionId: ProviderSessionId.make(`session:${key}`),
        session: {
          events: Stream.empty,
          subscribeEvents: Effect.succeed({
            events: Stream.make(rootTerminalEvent(ids, status)),
            close: Deferred.succeed(ingestionDone, undefined),
          }),
          startTurn: () => Effect.void,
        } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime,
        run: {
          id: ids.runId,
          threadId: ids.threadId,
          ordinal: 1,
          providerInstanceId,
        } as OrchestrationV2Run,
        rootNode: {
          id: ids.rootNodeId,
          providerTurnId: ids.rootProviderTurnId,
        } as OrchestrationV2ExecutionNode,
        checkpointScope: null,
        providerThread: {
          id: ids.providerThreadId,
          driver,
        } as OrchestrationV2ProviderThread,
        attempt: {
          id: ids.attemptId,
          providerTurnId: ids.rootProviderTurnId,
        } as OrchestrationV2RunAttempt,
        attemptId: ids.attemptId,
        providerTurnOrdinal: 1,
        shouldFinalizeRun: () => Effect.succeed(true),
        message: {
          messageId: MessageId.make(`message:${key}`),
          text: "checkpoint-free planning",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
        },
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
        runtimePolicy: {
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
          approvalPolicy: "never",
          sandboxPolicy: {
            type: "readOnly",
            access: { type: "fullAccess" },
            networkAccess: false,
          },
        },
      });
    }).pipe(Effect.provide(layerTest));

    yield* Deferred.await(ingestionDone);
    return {
      observed: yield* Ref.get(observed),
      submittedEffects: yield* Ref.get(submittedEffects),
      committedEffects: yield* Ref.get(committedEffects),
      baselineCaptures: yield* Ref.get(baselineCaptures),
    };
  });
}

it.effect.each(["completed", "interrupted", "cancelled", "failed"] as const)(
  "finalizes checkpoint-free planning runs as %s without repository checkpoint effects",
  (status) =>
    Effect.gen(function* () {
      const result = yield* captureCheckpointFreeRootRun(status);
      assert.deepEqual(result.observed, [`run:${status}`, "pull-requests-refreshed"]);
      assert.equal(result.baselineCaptures, 0);
      assert.deepEqual(result.submittedEffects, []);
      assert.deepEqual(result.committedEffects, []);
    }),
);
