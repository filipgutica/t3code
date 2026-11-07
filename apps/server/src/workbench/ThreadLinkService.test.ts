import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ThreadLinkHost } from "@t3tools/workbench/ThreadLinkHost";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { hostLayer } from "./ThreadLinkService.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Linking a Thread starts no provider session"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerNative = Layer.mergeAll(
  ProjectStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "workbench-thread-link" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);
const layerTest = hostLayer.pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(Orchestrator.OrchestratorV2, (orchestrator) =>
        Layer.mock(ThreadManagementService)({ dispatch: orchestrator.dispatch }),
      ),
    ),
  ),
  Layer.provideMerge(layerNative),
  Layer.provideMerge(NodeCrypto.layer),
);

const sourceProjectId = ProjectId.make("project:link-source");
const targetProjectId = ProjectId.make("project:link-target");
const sourceThreadId = ThreadId.make("thread:link-source");
const from = { projectId: sourceProjectId, branch: "feature/draft", worktreePath: "/elsewhere" };
const to = { projectId: targetProjectId, branch: "t3/ticket", worktreePath: "/worktrees/target" };

/** A source Thread with a finished turn in another worktree, and the Ticket's target Project. */
const seed = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const now = yield* DateTime.now;
  yield* projects.apply({
    sequence: 0,
    eventId: EventId.make("project:link-target"),
    aggregateKind: "project",
    aggregateId: targetProjectId,
    occurredAt: DateTime.formatIso(now),
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId: targetProjectId,
      title: "Target repository",
      workspaceRoot: "/target-repo",
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: DateTime.formatIso(now),
      updatedAt: DateTime.formatIso(now),
    },
  });
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("link-source-create"),
    threadId: sourceThreadId,
    projectId: sourceProjectId,
    title: "Draft the fix",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: from.branch,
    worktreePath: from.worktreePath,
    createdBy: "user",
    creationSource: "web",
  });
  const runId = RunId.make("link-source-run");
  const messageId = MessageId.make("link-source-message");
  yield* eventSink.write({
    events: [
      {
        id: EventId.make("link-source-message"),
        type: "message.updated",
        threadId: sourceThreadId,
        occurredAt: now,
        payload: {
          id: messageId,
          threadId: sourceThreadId,
          runId,
          nodeId: null,
          role: "user",
          createdBy: "user",
          creationSource: "web",
          text: "Fix the invitation expiry.",
          attachments: [],
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        id: EventId.make("link-source-run"),
        type: "run.created",
        threadId: sourceThreadId,
        runId,
        occurredAt: now,
        payload: {
          id: runId,
          threadId: sourceThreadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: messageId,
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed",
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          // `latest_stable` forks start from the latest completed run with a checkpoint.
          checkpointId: CheckpointId.make("link-source-checkpoint"),
          contextHandoffId: null,
        },
      },
    ],
  });
  return orchestrator;
});

it.effect("forks a Thread with history and moves the fork into the Ticket worktree", () =>
  Effect.gen(function* () {
    const orchestrator = yield* seed;
    const host = yield* ThreadLinkHost;
    // The source projection gains the fork's outgoing context transfer; the Thread itself stays.
    const sourceState = Effect.map(
      orchestrator.getThreadProjection(sourceThreadId),
      ({ thread, messages, runs }) => ({ thread, messages, runs }),
    );
    const sourceBefore = yield* sourceState;

    const forkId = yield* host.forkThread(sourceThreadId);
    const fork = yield* orchestrator.getThreadShell(forkId);
    assert.deepInclude(fork, from);

    // A stale expected binding is refused instead of moving the fork.
    const stale = yield* Effect.flip(
      host.rebindThread({ threadId: forkId, from: { ...from, worktreePath: "/moved" }, to }),
    );
    assert.equal(stale._tag, "WorkbenchOperationError");

    // The fork's first turn reads the source's context through this transfer, so the move keeps it.
    const forkTransfers = Effect.map(
      orchestrator.getThreadProjection(forkId),
      ({ contextTransfers }) => contextTransfers,
    );
    const transfersBefore = yield* forkTransfers;
    assert.lengthOf(transfersBefore, 1);
    yield* host.rebindThread({ threadId: forkId, from, to });
    assert.deepInclude(yield* orchestrator.getThreadShell(forkId), to);
    assert.deepEqual(yield* forkTransfers, transfersBefore);
    assert.deepEqual(yield* sourceState, sourceBefore);

    yield* host.deleteThread(forkId);
    assert.isNotNull((yield* orchestrator.getThreadShell(forkId))?.deletedAt);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses to move a fork that has already received a message", () =>
  Effect.gen(function* () {
    const orchestrator = yield* seed;
    const eventSink = yield* EventSink.EventSinkV2;
    const host = yield* ThreadLinkHost;
    const forkId = yield* host.forkThread(sourceThreadId);
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("link-fork-message"),
          type: "message.updated",
          threadId: forkId,
          occurredAt: now,
          payload: {
            id: MessageId.make("link-fork-message"),
            threadId: forkId,
            runId: null,
            nodeId: null,
            role: "user",
            createdBy: "user",
            creationSource: "web",
            text: "Keep going here.",
            attachments: [],
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
    const refused = yield* Effect.flip(host.rebindThread({ threadId: forkId, from, to }));
    assert.equal(refused._tag, "WorkbenchOperationError");
    assert.deepInclude(yield* orchestrator.getThreadShell(forkId), from);
  }).pipe(Effect.provide(layerTest)),
);
