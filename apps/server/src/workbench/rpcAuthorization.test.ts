import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  WORKBENCH_WS_METHODS,
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

const reference = {
  ticketId: WorkbenchTicketId.make("scope-ticket"),
  url: "https://github.com/acme/web/issues/61",
  title: null,
  addedByThreadId: null,
  createdAt: "2026-10-25T00:00:00.000Z",
};

describe("Workbench RPC authorization", () => {
  it.effect("requires operate scope to add a Reference", () =>
    Effect.gen(function* () {
      const method = WORKBENCH_WS_METHODS.workbenchAddReference;
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof method> => tag !== method,
        ),
      );
      let mutations = 0;
      const handlers = group.toLayerHandler(method, () =>
        Effect.sync(() => {
          mutations++;
          return reference;
        }),
      );
      const input = { ticketId: reference.ticketId, url: reference.url };
      const reader = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      expect(yield* reader[method](input).pipe(Effect.flip)).toMatchObject({
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(mutations).toBe(0);
      const operator = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationOperateScope])),
        ),
      );
      expect(yield* operator[method](input)).toEqual(reference);
      expect(mutations).toBe(1);
    }).pipe(Effect.scoped),
  );
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

  it.effect("allows archived Ticket reads with read scope and rejects callers without it", () =>
    Effect.gen(function* () {
      const method = WORKBENCH_WS_METHODS.workbenchGetTicket;
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof method> => tag !== method,
        ),
      );
      let reads = 0;
      const handlers = group.toLayerHandler(method, () =>
        Effect.sync(() => {
          reads++;
          return null;
        }),
      );
      const denied = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, rpcScopeAuthorizationLayer([]))),
      );
      expect(
        yield* denied[method]({ ticketId: WorkbenchTicketId.make("archived") }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationReadScope,
      });
      expect(reads).toBe(0);
      const reader = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.merge(handlers, rpcScopeAuthorizationLayer([AuthOrchestrationReadScope])),
        ),
      );
      expect(yield* reader[method]({ ticketId: WorkbenchTicketId.make("archived") })).toBeNull();
      expect(reads).toBe(1);
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
});
