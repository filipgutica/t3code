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
  WorkbenchTicketWorkspaceAttemptId,
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
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import type * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as Providers from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as TicketPlanningRuntime from "./TicketPlanningRuntime.ts";
import * as TicketDraftService from "./TicketDraftService.ts";
import { TicketWorkspaceService } from "@t3tools/workbench/TicketWorkspaceService";
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

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
    generateReviewGuide: () => unused,
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
const makeLayerTest = <A, E, R>(policies: Layer.Layer<A, E, R>) =>
  Layer.mergeAll(
    RuntimeLayer.layer,
    RuntimeLayer.layerEventSink,
    ProjectStore.layer,
    CommandReceiptStore.layer,
  ).pipe(
    Layer.provideMerge(policies),
    Layer.provide(McpSessionRegistryTestkit.layer),
    Layer.provide(McpProviderSessions.layer),
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(Layer.mock(CheckpointStore.CheckpointStore)({})),
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-workbench-composed-policy-" }),
    ),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(
      Layer.mock(Providers.ProviderInstanceRegistry)({
        getInstance: () => Effect.succeed(instance),
      }),
    ),
    Layer.provide(
      Layer.mock(GitWorkflow.GitWorkflowService)({
        pruneWorktrees: () => Effect.void,
        isRepository: () => Effect.succeed(true),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeed(Option.none()) }),
    ),
    Layer.provide(
      Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
        resolveLink: () => unused,
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
const layerTest = makeLayerTest(planningPolicyLayer);
const layerPersistedPlanningTest = makeLayerTest(
  TicketPlanningRuntime.layerRuntimePolicyDecorator.pipe(
    Layer.provideMerge(WorkbenchStoreLive),
    Layer.provide(ProjectStore.layer),
  ),
);

it.effect("uses native project enablement for planning creation, retries and turns", () =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* Providers.ProviderInstanceRegistry;
    const creatingDraft = { ...draft, phase: "creating" as const };
    const drafts = yield* TicketDraftService.TicketDraftService.pipe(
      Effect.provide(
        TicketDraftService.layer.pipe(
          Layer.provide(
            Layer.mock(WorkbenchStore)({
              beginTicketDraft: () => Effect.succeed(creatingDraft),
              transitionTicketDraft: () => Effect.succeed({ ...draft, phase: "draft" as const }),
            }),
          ),
          Layer.provide(Layer.mock(TicketWorkspaceService)({})),
          Layer.provide(Layer.mock(WorkbenchJiraService)({ createTicket: () => unused })),
        ),
      ),
    );
    const beginInput = {
      id: draft.id,
      projectId: draft.projectId,
      threadId: draft.threadId,
      modelSelection,
    };
    const setEnabled = (enabled: boolean) =>
      settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { providerInstances: { [instanceId]: { enabled } } },
        },
      });
    yield* setEnabled(false);
    const deniedCreation = yield* drafts.begin(beginInput).pipe(Effect.flip);
    assert.equal(deniedCreation.code, "ticket_draft_invalid");
    assert.isNull(yield* threads.getThreadShell(draft.threadId));
    yield* setEnabled(true);
    yield* drafts.begin(beginInput);
    const created = yield* threads.getThreadShell(draft.threadId);
    assert.equal(created?.projectId, projectId);
    yield* setEnabled(false);
    yield* settings.updateSettings({
      providerInstances: { [instanceId]: { driver: instance.driverKind, enabled: false } },
    });
    const disabledProvider = vi
      .spyOn(providers, "getInstance")
      .mockReturnValue(Effect.succeed({ ...instance, enabled: false }));
    yield* Effect.addFinalizer(() => Effect.sync(() => disabledProvider.mockRestore()));
    // Simulate retry after native create committed but the draft transition did not.
    yield* drafts.begin(beginInput);
    assert.deepEqual(yield* threads.getThreadShell(draft.threadId), created);
    const deniedTurn = yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("dispatch:disabled-planning"),
        threadId: draft.threadId,
        messageId: MessageId.make("message:disabled-planning"),
        text: "Inspect the change",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.flip);
    assert.equal(deniedTurn._tag, "ThreadManagementProviderInstanceDisabledError");
    assert.deepEqual((yield* threads.getThreadRecords(draft.threadId, ["runs"])).runs, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "Start work restores execution checkpoints in the same conversation without changing native defaults",
  () =>
    Effect.gen(function* () {
      const projects = yield* ProjectStore.ProjectStoreV2;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const store = yield* WorkbenchStore;
      const worktreePath = "/work-area/composed-policy";
      const branch = "workbench/composed-policy";
      const drafts = yield* TicketDraftService.TicketDraftService.pipe(
        Effect.provide(
          TicketDraftService.layer.pipe(
            Layer.provide(Layer.mock(WorkbenchJiraService)({ createTicket: store.createTicket })),
            Layer.provide(
              Layer.mock(TicketWorkspaceService)({
                // Exclude Git worktree creation, but persist preparation through the real store.
                prepare: ({ ticketId, requestedAt }) =>
                  Effect.gen(function* () {
                    const attemptId =
                      WorkbenchTicketWorkspaceAttemptId.make("composed-preparation");
                    yield* store.claimTicketWorkspace({
                      ticketId,
                      attemptId,
                      branchName: branch,
                      claimedAt: requestedAt,
                      repositories: [
                        {
                          projectId,
                          isPrimary: true,
                          sourcePath: process.cwd(),
                          worktreePath,
                        },
                      ],
                    });
                    yield* store.markTicketWorkspaceRepositoryReady({
                      ticketId,
                      attemptId,
                      projectId,
                      worktreePath,
                      branchName: branch,
                      updatedAt: requestedAt,
                    });
                    return yield* store.completeTicketWorkspace({
                      ticketId,
                      attemptId,
                      completedAt: requestedAt,
                    });
                  }),
              }),
            ),
          ),
        ),
      );
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
      yield* store.createProject({
        id: draft.projectId,
        title: "Policy workspace",
        linkedProjectIds: [projectId],
        createdAt: now,
      });
      const begun = yield* drafts.begin({
        id: draft.id,
        projectId: draft.projectId,
        threadId: planningThreadId,
        modelSelection,
      });
      const editable = yield* store.updateTicketDraft({
        id: begun.id,
        expectedRevision: begun.revision,
        fields: draft.fields,
      });
      for (const threadId of [planningThreadId, nativeThreadId]) {
        if (threadId === nativeThreadId)
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

      // The process boundary is excluded; native Stop makes the observed planning turn idle.
      yield* threads.dispatch({
        type: "thread.stop",
        commandId: CommandId.make("stop:composed-planning"),
        threadId: planningThreadId,
      });
      yield* worker.drain();
      const before = yield* threads.getThreadProjection(planningThreadId);
      assert.deepEqual(before.checkpointScopes, []);
      assert.include(
        before.messages.map((message) => message.id),
        MessageId.make(`message:${planningThreadId}`),
      );
      const promoted = yield* drafts.promote({
        id: editable.id,
        expectedRevision: editable.revision,
      });
      const assignments = (yield* store.getSnapshot).assignments;
      assert.lengthOf(assignments, 1);
      assert.equal(assignments[0]?.threadId, planningThreadId);
      assert.equal(assignments[0]?.ticketId, draft.id);
      const working = yield* drafts.startWork({
        id: promoted.id,
        expectedRevision: promoted.revision,
      });
      assert.equal(working.phase, "working");
      const after = yield* threads.getThreadProjection(planningThreadId);
      assert.equal(after.thread.id, before.thread.id);
      assert.equal(after.thread.projectId, projectId);
      assert.equal(after.thread.worktreePath, worktreePath);
      assert.equal(after.thread.branch, branch);
      assert.equal(after.thread.interactionMode, "default");
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual((yield* store.getSnapshot).assignments, assignments);

      const execution = yield* threads.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("dispatch:composed-execution"),
        threadId: planningThreadId,
        messageId: MessageId.make("message:composed-execution"),
        text: "Implement the approved ticket",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      assert.isTrue(
        execution.storedEvents.some(({ event }) => event.type === "checkpoint-scope.created"),
      );
      const executing = yield* threads.getThreadProjection(planningThreadId);
      assert.lengthOf(executing.checkpointScopes, 1);
      assert.equal(executing.checkpointScopes[0]?.cwd, worktreePath);
      assert.includeMembers(
        executing.messages.map((message) => message.id),
        before.messages.map((message) => message.id),
      );
      yield* worker.drain();
      const policy = policies.get(planningThreadId);
      assert.isDefined(policy);
      assert.equal(policy?.cwd, worktreePath);
      assert.equal(policy?.runtimeMode, "full-access");
      assert.equal(policy?.interactionMode, "default");
      assert.isUndefined(policy?.sandboxPolicy);
      assert.isUndefined(policy?.checkpoints);
      assert.include(policy?.instructions ?? "", "Start work has completed");
    }).pipe(Effect.provide(layerPersistedPlanningTest)),
);
