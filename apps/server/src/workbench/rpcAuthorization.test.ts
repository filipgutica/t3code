import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  WORKBENCH_WS_METHODS,
  WorkbenchTicketDraft,
  ModelSelection,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  ProjectId,
  WorkbenchTicketId,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import {
  RPC_REQUIRED_SCOPES,
  layer as rpcScopeAuthorizationLayer,
} from "../auth/RpcAuthorization.ts";

describe("Workbench RPC authorization", () => {
  it.effect("allows preparation index reads with read scope and rejects callers without it", () =>
    Effect.gen(function* () {
      const method = WORKBENCH_WS_METHODS.workbenchGetTicketPreparations;
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof method> => tag !== method,
        ),
      );
      let reads = 0;
      const handlers = group.toLayerHandler(method, () =>
        Effect.sync(() => {
          reads++;
          return [];
        }),
      );
      const denied = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, rpcScopeAuthorizationLayer([]))),
      );
      expect(yield* denied[method]({}).pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationReadScope,
      });
      expect(reads).toBe(0);
      const reader = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      expect(yield* reader[method]({})).toEqual([]);
      expect(reads).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    WORKBENCH_WS_METHODS.workbenchArchiveProject,
    WORKBENCH_WS_METHODS.workbenchDeleteProject,
  ] as const)("requires operate scope for %s", (method) =>
    Effect.gen(function* () {
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof method> =>
            tag !== WORKBENCH_WS_METHODS.workbenchArchiveProject &&
            tag !== WORKBENCH_WS_METHODS.workbenchDeleteProject,
        ),
      );
      let mutations = 0;
      const project = {
        id: WorkbenchProjectId.make("scope-workspace"),
        title: "Workspace",
        linkedProjectIds: [ProjectId.make("scope-native-project")],
        createdAt: "2026-10-03T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
        archivedAt: "2026-10-03T00:00:00.000Z",
        revision: 1,
      };
      const handlers = Layer.merge(
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchArchiveProject, () =>
          Effect.sync(() => {
            mutations += 1;
            return project;
          }),
        ),
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchDeleteProject, () =>
          Effect.sync(() => {
            mutations += 1;
          }),
        ),
      );
      const readOnly = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      const input = {
        id: project.id,
        expectedRevision: 0,
        archivedAt: project.archivedAt,
        updatedAt: project.updatedAt,
        deletedAt: project.updatedAt,
        expectedTicketCount: 0,
        expectedEpicCount: 0,
      };
      expect(yield* readOnly[method](input).pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(mutations).toBe(0);
      const operator = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationOperateScope])),
        ),
      );
      yield* operator[method](input);
      expect(mutations).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("enforces mutation scopes after merging native RPCs", () =>
    Effect.gen(function* () {
      const method = WORKBENCH_WS_METHODS.workbenchDeleteTicket;
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof method> => tag !== method,
        ),
      );
      let mutations = 0;
      const handlers = group.toLayerHandler(method, () =>
        Effect.sync(() => {
          mutations += 1;
        }),
      );
      const readOnly = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      const input = {
        ticketId: WorkbenchTicketId.make("scope-test-ticket"),
        expectedRevision: 0,
        deletedAt: "2026-10-03T00:00:00.000Z",
      };

      expect(yield* readOnly[method](input).pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(mutations).toBe(0);

      const operator = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationOperateScope])),
        ),
      );
      yield* operator[method](input);
      expect(mutations).toBe(1);
    }).pipe(Effect.scoped),
  );
  it.effect.each([
    WORKBENCH_WS_METHODS.workbenchBeginTicketDraft,
    WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft,
    WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft,
    WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft,
    WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork,
  ] as const)("guards ticket preparation mutation %s at the RPC boundary", (method) =>
    Effect.gen(function* () {
      const methods = [
        WORKBENCH_WS_METHODS.workbenchBeginTicketDraft,
        WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft,
        WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft,
        WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft,
        WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork,
      ] as const;
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, (typeof methods)[number]> =>
            !methods.some((value) => value === tag),
        ),
      );
      const draft = WorkbenchTicketDraft.make({
        id: WorkbenchTicketId.make("authorized-draft"),
        projectId: WorkbenchProjectId.make("authorized-workspace"),
        threadId: ThreadId.make("authorized-thread"),
        anchorProjectId: ProjectId.make("authorized-repo"),
        modelSelection: ModelSelection.make({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
        }),
        phase: "draft",
        revision: 0,
        fields: {
          title: "",
          markdown: "",
          kind: "story",
          epicId: null,
          repositoryProjectIds: [],
          primaryT3ProjectId: null,
          localOnly: true,
          jiraSprintId: null,
        },
        createdAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
      });
      let mutations = 0;
      const mutate = () =>
        Effect.sync(() => {
          mutations++;
          return draft;
        });
      const handlers = Layer.mergeAll(
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchBeginTicketDraft, mutate),
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft, mutate),
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft, mutate),
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork, mutate),
        group.toLayerHandler(WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft, () =>
          Effect.sync(() => {
            mutations++;
          }),
        ),
      );
      const input = { ...draft, expectedRevision: 0 };
      const readOnly = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      expect(yield* readOnly[method](input).pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(mutations).toBe(0);
      const operator = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationOperateScope])),
        ),
      );
      yield* operator[method](input);
      expect(mutations).toBe(1);
    }).pipe(Effect.scoped),
  );
});
