import {
  EnvironmentId,
  type WorkbenchJiraGetTicketTransitionsResult,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";

import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type ConnectionCatalogEntry,
  type ConnectionRegistration,
  type NetworkStatus,
  type PlatformConnectionRegistration,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type * as RpcSession from "@t3tools/client-runtime/rpc";

const testModules = vi.hoisted(() => ({
  connectionRuntime: null as unknown,
  request: vi.fn(),
}));

vi.mock("../connection/runtime", () => ({
  get connectionAtomRuntime() {
    return testModules.connectionRuntime;
  },
}));

vi.mock("@t3tools/client-runtime/rpc", () => ({
  request: testModules.request,
}));

type WorkbenchEnvironment = (typeof import("./state"))["workbenchEnvironment"];

const connectionState: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};

class JiraRefreshError extends Schema.TaggedError<JiraRefreshError>()("JiraRefreshError", {
  message: Schema.String,
}) {}

const connectionSession = {
  get client(): RpcSession.RpcSession["client"] {
    throw new Error("The mocked Jira request should not read the RPC client.");
  },
  initialConfig: Effect.never,
  subscribeServerConfig: () => Stream.empty,
  ready: Effect.void,
  probe: Effect.void,
  closed: Effect.never,
} satisfies RpcSession.RpcSession;

function makeTestRuntime() {
  return Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(connectionState);
    const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
      Option.some(connectionSession),
    );
    const supervisor = EnvironmentSupervisor.of({
      target: new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make("jira-transition-cache-runtime"),
        label: "Jira transition cache test",
        httpBaseUrl: "https://jira-transition-cache.example.test",
        wsBaseUrl: "wss://jira-transition-cache.example.test",
      }),
      state,
      session,
      prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor["Service"]);
    const registry: EnvironmentRegistry["Service"] = {
      entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
        new Map(),
      ),
      networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
      start: Effect.void,
      register: (_registration: ConnectionRegistration) => Effect.void,
      registerPlatform: (_registration) => Effect.void,
      reconcilePlatform: (_registrations: ReadonlyArray<PlatformConnectionRegistration>) =>
        Effect.void,
      remove: (_environmentId: EnvironmentId) => Effect.void,
      removeRelayEnvironments: () => Effect.void,
      retryNow: (_environmentId: EnvironmentId) => Effect.void,
      state: (_environmentId: EnvironmentId) => Effect.succeed(connectionState),
      stateChanges: (_environmentId: EnvironmentId) => SubscriptionRef.changes(state),
      run: (_environmentId, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor, supervisor),
      runStream: (_environmentId, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor, supervisor),
      followStream: (_environmentId, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    };

    return Atom.runtime(Layer.succeed(EnvironmentRegistry, registry));
  });
}

function transitionResult(remoteUpdatedAt: string, transitionName: string) {
  return {
    remoteUpdatedAt,
    transitions: [
      {
        id: "transition-1",
        name: transitionName,
        to: { id: "status-1", name: "In progress" },
        unavailableReason: null,
      },
    ],
  } satisfies WorkbenchJiraGetTicketTransitionsResult;
}

function target(
  workbenchEnvironment: WorkbenchEnvironment,
  environmentId: EnvironmentId,
  ticketId: WorkbenchTicketId,
  remoteUpdatedAt: string,
) {
  return workbenchEnvironment.jiraGetTicketTransitions({
    environmentId,
    input: { ticketId, remoteUpdatedAt },
  });
}

let workbenchEnvironment: WorkbenchEnvironment | undefined;
let nextId = 0;

function getWorkbenchEnvironment() {
  if (workbenchEnvironment !== undefined) return Effect.succeed(workbenchEnvironment);
  return Effect.gen(function* () {
    testModules.connectionRuntime = yield* makeTestRuntime();
    const state = yield* Effect.promise(() => import("./state"));
    workbenchEnvironment = state.workbenchEnvironment;
    return workbenchEnvironment;
  });
}

beforeEach(() => {
  testModules.request.mockReset();
});

describe("Workbench Jira transition query cache", () => {
  it.effect("reuses fresh rows after remounting while isolating query keys", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const environment = yield* getWorkbenchEnvironment();
        const id = ++nextId;
        const environmentId = EnvironmentId.make(`jira-cache-environment-${id}`);
        const otherEnvironmentId = EnvironmentId.make(`jira-cache-other-environment-${id}`);
        const ticketId = WorkbenchTicketId.make(`jira-cache-ticket-${id}`);
        const otherTicketId = WorkbenchTicketId.make(`jira-cache-other-ticket-${id}`);
        const revision = "2026-09-10T01:00:00.000Z";
        const otherRevision = "2026-09-10T02:00:00.000Z";
        const rows = transitionResult(revision, "Start work");
        testModules.request.mockImplementation((_tag, input: { ticketId: WorkbenchTicketId }) =>
          Effect.succeed(
            input.ticketId === ticketId ? rows : transitionResult(otherRevision, "Other"),
          ),
        );

        const atom = target(environment, environmentId, ticketId, revision);
        expect(atom).toBe(target(environment, environmentId, ticketId, revision));
        expect(atom).not.toBe(target(environment, environmentId, ticketId, otherRevision));
        expect(atom).not.toBe(target(environment, environmentId, otherTicketId, revision));
        expect(atom).not.toBe(target(environment, otherEnvironmentId, ticketId, revision));

        const registry = AtomRegistry.make();
        const unmount = registry.mount(atom);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unmount();
            registry.dispose();
          }),
        );

        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          rows,
        );
        unmount();
        registry.mount(atom);
        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          rows,
        );
        expect(testModules.request).toHaveBeenCalledOnce();
        expect(testModules.request).toHaveBeenCalledWith("workbench.jira.tickets.transitions", {
          ticketId,
        });

        const revisionResult = target(environment, environmentId, ticketId, otherRevision);
        const otherTicketResult = target(environment, environmentId, otherTicketId, revision);
        const otherEnvironmentResult = target(environment, otherEnvironmentId, ticketId, revision);
        for (const query of [revisionResult, otherTicketResult, otherEnvironmentResult]) {
          const queryUnmount = registry.mount(query);
          yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true });
          queryUnmount();
        }
        expect(testModules.request).toHaveBeenCalledTimes(4);
      }),
    ),
  );

  it.effect("revalidates stale rows after remount while keeping them visible", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const environment = yield* getWorkbenchEnvironment();
        const id = ++nextId;
        const environmentId = EnvironmentId.make(`jira-stale-environment-${id}`);
        const ticketId = WorkbenchTicketId.make(`jira-stale-ticket-${id}`);
        const revision = "2026-09-10T03:00:00.000Z";
        const first = transitionResult(revision, "Start work");
        const updated = transitionResult(revision, "Continue work");
        let resolveRefresh!: (value: WorkbenchJiraGetTicketTransitionsResult) => void;
        const refresh = new Promise<WorkbenchJiraGetTicketTransitionsResult>((resolve) => {
          resolveRefresh = resolve;
        });
        testModules.request
          .mockReturnValueOnce(Effect.succeed(first))
          .mockReturnValueOnce(Effect.promise(() => refresh));

        const atom = target(environment, environmentId, ticketId, revision);
        const registry = AtomRegistry.make();
        let unmount = registry.mount(atom);
        let dateNowSpy: ReturnType<typeof vi.spyOn> | undefined;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unmount();
            registry.dispose();
            dateNowSpy?.mockRestore();
          }),
        );
        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          first,
        );

        const cached = registry.get(atom);
        if (cached._tag !== "Success")
          return yield* Effect.die("Expected cached Jira transitions.");
        unmount();
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        const staleNow = cached.timestamp + 30_001;
        dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(staleNow);
        unmount = registry.mount(atom);
        yield* Effect.yieldNow;
        expect(testModules.request).toHaveBeenCalledTimes(2);
        expect(registry.get(atom)).toMatchObject({
          _tag: "Success",
          value: first,
          waiting: true,
        });

        resolveRefresh(updated);
        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          updated,
        );
        dateNowSpy.mockRestore();
      }),
    ),
  );

  it.effect("retains rows through a failed refresh and retries the same query", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const environment = yield* getWorkbenchEnvironment();
        const id = ++nextId;
        const environmentId = EnvironmentId.make(`jira-retry-environment-${id}`);
        const ticketId = WorkbenchTicketId.make(`jira-retry-ticket-${id}`);
        const revision = "2026-09-10T04:00:00.000Z";
        const first = transitionResult(revision, "Start work");
        const recovered = transitionResult(revision, "Continue work");
        const expectedError = new JiraRefreshError({
          message: "Jira is temporarily unavailable.",
        });
        testModules.request
          .mockReturnValueOnce(Effect.succeed(first))
          .mockReturnValueOnce(Effect.fail(expectedError))
          .mockReturnValueOnce(Effect.succeed(recovered));

        const atom = target(environment, environmentId, ticketId, revision);
        const registry = AtomRegistry.make();
        const unmount = registry.mount(atom);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unmount();
            registry.dispose();
          }),
        );
        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          first,
        );

        registry.refresh(atom);
        yield* Effect.yieldNow;
        const failed = registry.get(atom);
        expect(AsyncResult.isFailure(failed)).toBe(true);
        expect(AsyncResult.value(failed)).toEqual(Option.some(first));

        registry.refresh(atom);
        expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
          recovered,
        );
        expect(testModules.request).toHaveBeenCalledTimes(3);
      }),
    ),
  );
});
