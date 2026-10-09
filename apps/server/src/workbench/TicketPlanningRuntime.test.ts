import { assert, it } from "@effect/vitest";
import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type OrchestrationV2AppThread,
  ProviderDriverKind,
  type WorkbenchTicketDraft,
  WorkbenchOperationError,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as Providers from "../provider/ProviderInstanceRegistry.ts";
import * as TicketPlanningRuntime from "./TicketPlanningRuntime.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

const first = ProjectId.make("repo:first");
const second = ProjectId.make("repo:second");
const threadId = ThreadId.make("thread:planning");
const instanceId = ProviderInstanceId.make("custom-agent");
const modelSelection = ModelSelection.make({ instanceId, model: "custom-model" });
const now = DateTime.makeUnsafe("2026-10-09T12:00:00Z");
const thread: OrchestrationV2AppThread = {
  id: threadId,
  projectId: first,
  title: "Prepare ticket",
  createdBy: "user",
  creationSource: "web",
  providerInstanceId: instanceId,
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  worktreePath: null,
  branch: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  settledAt: null,
  settledOverride: null,
  lastVisitedAt: null,
};
const draft = (phase: WorkbenchTicketDraft["phase"]) => ({
  id: WorkbenchTicketId.make("draft"),
  projectId: WorkbenchProjectId.make("tools"),
  threadId,
  anchorProjectId: first,
  modelSelection,
  phase,
  revision: 1,
  fields: {
    title: "Explain failures",
    markdown: "## Goal\nExplain worktree failures",
    kind: "story" as const,
    epicId: null,
    repositoryProjectIds: [second],
    primaryT3ProjectId: second,
    localOnly: true,
    jiraSprintId: null,
  },
  createdAt: DateTime.formatIso(now),
  updatedAt: DateTime.formatIso(now),
  planningRepositoryProjectIds: [first, second],
  workArea:
    phase === "working"
      ? {
          ticketId: WorkbenchTicketId.make("draft"),
          attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
          status: "ready" as const,
          branchName: "ticket/approved",
          errorMessage: null,
          repositories: [first, second].map((projectId) => ({
            projectId,
            isPrimary: projectId === second,
            sourcePath: `/repo/${projectId}`,
            worktreePath: `/work-area/${projectId}`,
            branchName: "ticket/approved",
            status: "ready" as const,
            errorMessage: null,
            createdAt: DateTime.formatIso(now),
            updatedAt: DateTime.formatIso(now),
          })),
          createdAt: DateTime.formatIso(now),
          updatedAt: DateTime.formatIso(now),
        }
      : null,
});
const unused = Effect.die("Unexpected provider operation");
const instance = (driverKind: ProviderDriverKind): ProviderInstance => ({
  instanceId,
  driverKind,
  enabled: true,
  displayName: undefined,
  continuationIdentity: { driverKind, continuationKey: "test" },
  snapshot: {
    getSnapshot: unused,
    refresh: unused,
    streamChanges: Stream.empty,
    applyUsageLimits: () => unused,
    resolveMaintenance: () => unused,
  },
  orchestrationAdapter: {
    instanceId,
    driver: driverKind,
    getCapabilities: () => unused,
    planSelectionTransition: () => unused,
    openSession: () => unused,
  },
  textGeneration: {
    generateCommitMessage: () => unused,
    generatePrContent: () => unused,
    generateBranchName: () => unused,
    generateThreadTitle: () => unused,
    generateStructured: () => unused,
  },
});
const basePolicy = {
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/repo/first",
} as const;
const policyLayer = (
  phase: WorkbenchTicketDraft["phase"] | null,
  driver = "codex",
  missingRepository = false,
) =>
  TicketPlanningRuntime.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimePolicy.RuntimePolicyV2, { resolve: () => Effect.succeed(basePolicy) }),
        Layer.mock(WorkbenchStore)({
          getTicketDraftForThread: () => Effect.succeed(phase === null ? null : draft(phase)),
        }),
        Layer.mock(Providers.ProviderInstanceRegistry)({
          getInstance: () => Effect.succeed(instance(ProviderDriverKind.make(driver))),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          list: () =>
            Effect.succeed(
              (missingRepository ? [first] : [first, second]).map((projectId) => ({
                projectId,
                title: projectId,
                workspaceRoot: `/repo/${projectId}`,
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                createdAt: DateTime.formatIso(now),
                updatedAt: DateTime.formatIso(now),
                deletedAt: null,
              })),
            ),
        }),
      ),
    ),
  );
const resolve = Effect.flatMap(RuntimePolicy.RuntimePolicyV2, (policy) =>
  policy.resolve({ thread, modelSelection }),
);

it.effect.each(["codex", "claudeAgent"] as const)(
  "enforces read-only cross-repository planning for %s, including custom instances",
  (driver) =>
    resolve.pipe(
      Effect.map((policy) => {
        assert.equal(policy.runtimeMode, "approval-required");
        assert.equal(policy.interactionMode, "plan");
        assert.equal(policy.approvalPolicy, "never");
        assert.deepEqual(policy.sandboxPolicy, {
          type: "readOnly",
          access: { type: "fullAccess" },
        });
        assert.equal(policy.checkpoints, "disabled");
        assert.include(policy.instructions ?? "", "/repo/repo:first");
        assert.include(policy.instructions ?? "", "/repo/repo:second");
        assert.include(policy.instructions ?? "", "workbench-ticket-draft");
      }),
      Effect.provide(policyLayer("draft", driver)),
    ),
);
it.effect("leaves ordinary native Threads unchanged", () =>
  resolve.pipe(
    Effect.map((policy) => assert.deepEqual(policy, basePolicy)),
    Effect.provide(policyLayer(null)),
  ),
);
it.effect("continues saved ticket planning with read-only restrictions", () =>
  resolve.pipe(
    Effect.map((policy) => {
      assert.equal(policy.checkpoints, "disabled");
      assert.include(policy.instructions ?? "", "ticket is already saved");
    }),
    Effect.provide(policyLayer("planning")),
  ),
);
it.effect(
  "restores the native policy and supersedes planning instructions only after Start work",
  () =>
    resolve.pipe(
      Effect.map((policy) => {
        assert.equal(policy.runtimeMode, "full-access");
        assert.equal(policy.interactionMode, "default");
        assert.isUndefined(policy.checkpoints);
        assert.isUndefined(policy.sandboxPolicy);
        assert.include(policy.instructions ?? "", "Start work has completed");
        assert.include(policy.instructions ?? "", "Explain failures");
        assert.include(policy.instructions ?? "", "/work-area/repo:first");
        assert.include(policy.instructions ?? "", "/work-area/repo:second");
        assert.include(policy.instructions ?? "", "ticket/approved");
      }),
      Effect.provide(policyLayer("working")),
    ),
);
it.effect.each(["promoting", "starting", "discarding"] as const)(
  "rejects new turns while %s",
  (phase) =>
    Effect.result(resolve).pipe(
      Effect.map((result) => {
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result))
          assert.equal(result.failure._tag, "RuntimePolicyResolveError");
      }),
      Effect.provide(policyLayer(phase)),
    ),
);
it.effect.each([
  ["cursor", false],
  ["codex", true],
] as const)("fails closed for unavailable provider or repository (%s, %s)", ([driver, missing]) =>
  Effect.result(resolve).pipe(
    Effect.map((result) => assert.isTrue(Result.isFailure(result))),
    Effect.provide(policyLayer("draft", driver, missing)),
  ),
);
it.effect.each(["draft", "planning", "starting", "working"] as const)(
  "MCP mutations require completed Start work (%s)",
  (phase) =>
    Effect.result(TicketPlanningRuntime.assertMcpWritesAllowed(threadId)).pipe(
      Effect.map((result) => {
        assert.equal(Result.isSuccess(result), phase === "working");
        if (Result.isFailure(result)) assert.equal(result.failure.code, "capability_denied");
      }),
      Effect.provide(
        Layer.mock(WorkbenchStore)({ getTicketDraftForThread: () => Effect.succeed(draft(phase)) }),
      ),
    ),
);
it.effect("refuses MCP mutations when planning ownership cannot be read", () =>
  Effect.result(TicketPlanningRuntime.assertMcpWritesAllowed(threadId)).pipe(
    Effect.map((result) => {
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.equal(result.failure.code, "capability_denied");
    }),
    Effect.provide(
      Layer.mock(WorkbenchStore)({
        getTicketDraftForThread: () =>
          Effect.fail(
            new WorkbenchOperationError({ code: "persistence_failed", message: "Unavailable" }),
          ),
      }),
    ),
  ),
);
