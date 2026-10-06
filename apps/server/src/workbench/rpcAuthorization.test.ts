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

describe("Workbench RPC authorization", () => {
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
