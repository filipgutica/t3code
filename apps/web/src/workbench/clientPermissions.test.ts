import { expect, it } from "@effect/vitest";
import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type ConnectionCatalogEntry,
  type NetworkStatus,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  IsoDateTime,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WORKBENCH_WS_METHODS,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { vi } from "vite-plus/test";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../../../../packages/client-runtime/src/rpc/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/rpc")>()),
  requestGuarded: () => Effect.sync(() => dispatch()),
}));

vi.mock("../../../../packages/client-runtime/src/state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));

const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("target");
const other = EnvironmentId.make("other");
const grant = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: allowed ? [AuthOrchestrationOperateScope] : [],
  permissions: allowed ? [AuthOrchestrationOperateScope] : [],
});
const runtime = Atom.runtime(
  Layer.effect(
    EnvironmentRegistry.EnvironmentRegistry,
    Effect.gen(function* () {
      const supervisor = {
        target: new PrimaryConnectionTarget({
          environmentId: env,
          label: "test",
          httpBaseUrl: "http://localhost:4000",
          wsBaseUrl: "ws://localhost:4000/ws",
        }),
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.die("unexpected connect"),
        disconnect: Effect.die("unexpected disconnect"),
        retryNow: Effect.die("unexpected retryNow"),
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"];
      return yield* EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.provide(
          Layer.mock(EnvironmentRegistry.EnvironmentRegistry, {
            entries: yield* SubscriptionRef.make<
              ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
            >(new Map()),
            networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
            run: (_id, effect) =>
              effect.pipe(
                Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
              ),
          }),
        ),
      );
    }),
  ),
);

it.effect("keeps Workbench workspace availability and dispatch aligned with operator policy", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      registry.mount(sessions(env));
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      registry.set(sessions(env), AsyncResult.success(grant(true)));
      registry.set(sessions(other), AsyncResult.success(grant(false)));
      dispatch.mockClear();
      const input = {
        id: WorkbenchProjectId.make("project"),
        ticketId: WorkbenchTicketId.make("ticket"),
        expectedRevision: 0,
        expectedTicketCount: 0,
        expectedEpicCount: 0,
        archivedAt: null,
        updatedAt: IsoDateTime.make("2026-10-18T00:00:00.000Z"),
        deletedAt: IsoDateTime.make("2026-10-18T00:00:00.000Z"),
        requestedAt: IsoDateTime.make("2026-10-18T00:00:00.000Z"),
        releasedAt: IsoDateTime.make("2026-10-18T00:00:00.000Z"),
      };
      for (const method of [
        WORKBENCH_WS_METHODS.workbenchArchiveProject,
        WORKBENCH_WS_METHODS.workbenchDeleteProject,
        WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace,
        WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace,
      ]) {
        const workspace = createEnvironmentRpcCommand(runtime, { label: method, tag: method });
        expect(registry.get(workspace.permissionAtom(env))).toBe(true);
        const allowed = yield* Effect.promise(() =>
          workspace.run(registry, { environmentId: env, input }),
        );
        expect(allowed._tag).toBe("Success");
        const dispatched = dispatch.mock.calls.length;
        expect(registry.get(workspace.permissionAtom(other))).toBe(false);
        const denied = yield* Effect.promise(() =>
          workspace.run(registry, { environmentId: other, input }),
        );
        expect(denied._tag).toBe("Failure");
        expect(
          AsyncResult.isFailure(denied) ? Cause.squash(denied.cause) : undefined,
        ).toMatchObject({
          requiredScope: AuthOrchestrationOperateScope,
        });
        expect(dispatch).toHaveBeenCalledTimes(dispatched);
        registry.set(sessions(env), AsyncResult.success({ ...grant(true), permissions: [] }));
        expect(registry.get(workspace.permissionAtom(env))).toBe(false);
        registry.set(sessions(env), AsyncResult.success(grant(true)));
      }
    }),
  ),
);
