import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import type * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as TicketPlanningRuntime from "./TicketPlanningRuntime.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

const projectId = ProjectId.make("repo:composed-policy");
const planningThreadId = ThreadId.make("thread:composed-planning");
const nativeThreadId = ThreadId.make("thread:composed-native");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const unused = Effect.die("Unexpected provider operation");
const snapshot = Schema.decodeUnknownSync(ServerProvider)({
  instanceId,
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-11T00:00:00Z",
  models: [],
});
const instance: ProviderInstance = {
  instanceId,
  driverKind: ProviderDriverKind.make("codex"),
  enabled: true,
  displayName: undefined,
  continuationIdentity: {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: "composed-policy",
  },
  snapshot: {
    getSnapshot: Effect.succeed(snapshot),
    refresh: unused,
    streamChanges: Stream.empty,
    applyUsageLimits: () => unused,
    resolveMaintenance: () => unused,
  },
  orchestrationAdapter: {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: () => unused,
  },
  textGeneration: {
    generateCommitMessage: () => unused,
    generatePrContent: () => unused,
    generateBranchName: () => unused,
    generateThreadTitle: () => unused,
    generateStructured: () => unused,
  },
};
const draft = {
  id: WorkbenchTicketId.make("composed-draft"),
  projectId: WorkbenchProjectId.make("composed-workspace"),
  threadId: planningThreadId,
  anchorProjectId: projectId,
  modelSelection,
  phase: "planning",
  revision: 1,
  fields: {
    title: "Plan a change",
    markdown: "## Goal\nInspect the repository",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [projectId],
    primaryT3ProjectId: projectId,
    localOnly: true,
    jiraSprintId: null,
  },
  planningRepositoryProjectIds: [projectId],
  workArea: null,
  createdAt: "2026-10-11T00:00:00Z",
  updatedAt: "2026-10-11T00:00:00Z",
} satisfies NonNullable<
  Effect.Success<ReturnType<WorkbenchStore["Service"]["getTicketDraftForThread"]>>
>;
const planningPolicyLayer = TicketPlanningRuntime.layerRuntimePolicyDecorator.pipe(
  Layer.provide(ProjectStore.layer),
  Layer.provide(
    Layer.mock(WorkbenchStore)({
      getTicketDraftForThread: (threadId) =>
        Effect.succeed(threadId === planningThreadId ? draft : null),
    }),
  ),
);

// Provide the decorator outside the complete native graph, as production composition does.
// The resolver inside that graph must consume it instead of installing a shadowing default.
const layerTest = Layer.mergeAll(
  RuntimeLayer.layer,
  RuntimeLayer.layerEventSink,
  ProjectStore.layer,
).pipe(
  Layer.provide(planningPolicyLayer),
  Layer.provide(McpSessionRegistryTestkit.layer),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(Layer.mock(CheckpointStore.CheckpointStore)({})),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-workbench-composed-policy-" })),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(
    Layer.mock(Providers.ProviderInstanceRegistry)({ getInstance: () => Effect.succeed(instance) }),
  ),
  Layer.provide(Layer.mock(GitWorkflow.GitWorkflowService)({ pruneWorktrees: () => Effect.void })),
  Layer.provide(
    Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeed(Option.none()) }),
  ),
  Layer.provide(
    Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
      resolveLink: () => unused,
    }),
  ),
  Layer.provide(NodeServices.layer),
);

it.effect(
  "native dispatch and turn execution consume the composed planning policy without changing native threads",
  () =>
    Effect.gen(function* () {
      const projects = yield* ProjectStore.ProjectStoreV2;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
      const policies = new Map<
        ThreadId,
        Effect.Success<ReturnType<RuntimePolicy.RuntimePolicyV2Shape["resolve"]>>
      >();
      // Stop at the external process boundary, after the actual turn consumer has resolved its policy.
      const openSpy = vi.spyOn(sessions, "open").mockImplementation((input) => {
        policies.set(input.threadId, input.runtimePolicy);
        return Effect.fail(
          new ProviderSessionManager.ProviderSessionOpenError({
            instanceId,
            providerSessionId: input.providerSessionId,
            cause: "Process launch intentionally excluded",
          }),
        );
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => openSpy.mockRestore()));
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* projects.apply({
        sequence: 0,
        eventId: EventId.make("seed:composed-policy"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: "Policy repository",
          workspaceRoot: process.cwd(),
          defaultModelSelection: modelSelection,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      for (const threadId of [planningThreadId, nativeThreadId]) {
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`create:${threadId}`),
          threadId,
          projectId,
          title: threadId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
        const dispatched = yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`dispatch:${threadId}`),
          threadId,
          messageId: MessageId.make(`message:${threadId}`),
          text: "Inspect the change",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        assert.equal(
          dispatched.storedEvents.some(({ event }) => event.type === "checkpoint-scope.created"),
          threadId === nativeThreadId,
        );
        yield* worker.drain();
      }
      const planning = policies.get(planningThreadId);
      assert.isDefined(planning);
      assert.equal(planning?.runtimeMode, "approval-required");
      assert.equal(planning?.interactionMode, "plan");
      assert.deepEqual(planning?.sandboxPolicy, {
        type: "readOnly",
        access: { type: "fullAccess" },
      });
      assert.equal(planning?.checkpoints, "disabled");
      assert.include(planning?.instructions ?? "", "workbench-ticket-draft");
      assert.equal(planning?.cwd, process.cwd());
      const native = policies.get(nativeThreadId);
      assert.isDefined(native);
      assert.equal(native?.runtimeMode, "full-access");
      assert.equal(native?.interactionMode, "default");
      assert.equal(native?.cwd, process.cwd());
      assert.isUndefined(native?.sandboxPolicy);
      assert.isUndefined(native?.checkpoints);
      assert.isUndefined(native?.instructions);
    }).pipe(Effect.provide(layerTest)),
);
