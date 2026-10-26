import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
import type { AnyRouter } from "@tanstack/react-router";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  toast: vi.fn(),
  settingsListeners: new Set<() => void>(),
}));
vi.mock(import("../../components/ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast as never } };
});
vi.mock(import("../../state/shell"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentShell: {
      ...actual.environmentShell,
      stateValueAtom: ((id: string) => shellAtom(id)) as never,
    },
  };
});
vi.mock(import("../../state/presentation"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentSummaries: {
      ...actual.environmentSummaries,
      // Read lazily: the factory runs before this module's own bindings exist.
      get environmentIdsAtom() {
        return environmentIdsAtom as never;
      },
    },
  };
});
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  subscribeClientSettings: ((listener: () => void) => {
    state.settingsListeners.add(listener);
    return () => state.settingsListeners.delete(listener);
  }) as never,
  getClientSettings: (() => ({
    notificationMode: "notifications",
    inAppNotificationsEnabled: true,
  })) as never,
}));
vi.mock(import("../../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: vi.fn(),
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: vi.fn(),
}));

import { startThreadNotifications } from "../../components/ThreadNotificationCoordinator";
import { threadNotificationTag } from "../../threadNotifications";

type NotificationPolicy = { readonly canNotify: (threadRef: ScopedThreadRef) => boolean };

const shellAtom = Atom.family((_id: string) => Atom.make<unknown>(null));
const environmentIdsAtom = Atom.make<ReadonlyArray<string>>([]);
const policyAtom = Atom.make<NotificationPolicy | null>(null);
const SUPPRESS_ONE: NotificationPolicy = {
  canNotify: ({ environmentId }) => environmentId !== "one",
};

class TestNotification extends EventTarget {
  static permission = "granted";
  static sent: TestNotification[] = [];
  close = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T07:00:00.000Z");

function shell(run: { readonly id: string; readonly completedAt?: string; readonly input?: true }) {
  return {
    status: "live",
    snapshot: Option.some({
      threads: [
        {
          id: "thread",
          projectId: "project",
          title: "Plan the ticket",
          providerInstanceId: "codex",
          modelSelection: { instanceId: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { rootThreadId: "thread", parentThreadId: null, relationshipToParent: null },
          forkedFrom: null,
          createdBy: "user",
          creationSource: "web",
          latestRunId: run.id,
          activeRunId: null,
          status: run.completedAt ? "completed" : "running",
          pendingRuntimeRequest: run.input
            ? { id: "request-1", kind: "user_input", createdAt: SHELL_NOW }
            : null,
          latestVisibleMessage: null,
          latestUserMessageAt: null,
          hasActionableProposedPlan: false,
          itemCount: 0,
          visibleItemCount: 0,
          createdAt: SHELL_NOW,
          updatedAt: SHELL_NOW,
          latestRunRequestedAt: SHELL_NOW,
          latestRunStartedAt: SHELL_NOW,
          latestRunCompletedAt: run.completedAt ? DateTime.makeUnsafe(run.completedAt) : undefined,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      ],
    }),
  };
}

// The mocked modules read `state`, so every test resets it before starting the service.
function setup({ focused = false }: { readonly focused?: boolean } = {}) {
  vi.clearAllMocks();
  state.settingsListeners.clear();
  TestNotification.sent = [];
  const stack = new AsyncDisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  registry.set(environmentIdsAtom, ["one", "two"]);
  for (const id of ["one", "two"]) registry.set(shellAtom(id), shell({ id: "run-1" }));
  stack.use(stubGlobal("Notification", TestNotification));
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => focused));
  stack.use(vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"));
  const router = {
    state: { matches: [{ params: {} }] },
    navigate: vi.fn(),
  } as unknown as AnyRouter;
  return {
    setPolicy: (policy: NotificationPolicy | null) => registry.set(policyAtom, policy),
    setShell: (id: string, value: unknown) => registry.set(shellAtom(id), value),
    start: () => {
      stack.defer(startThreadNotifications(registry, router, { notificationPolicy: policyAtom }));
    },
    presented: () => [
      ...state.toast.mock.calls.map(([toast]) => (toast as { title: string }).title),
      ...TestNotification.sent.map((sent) => sent.title),
    ],
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

describe("Workbench thread notification policy", () => {
  it.each([true, false])(
    "keeps suppressed threads silent and scopes the policy by environment, focused=%s",
    async (focused) => {
      await using app = setup({ focused });
      app.setPolicy(SUPPRESS_ONE);
      app.start();
      using _timers = fakeTimers();
      const completed = shell({ id: "run-1", completedAt: "2026-09-13T07:00:01.000Z" });
      app.setShell("one", completed);
      app.setShell("two", completed);
      await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
      app.setShell("one", shell({ id: "run-2", input: true }));
      expect(app.presented()).toEqual(["Thread completed"]);
      expect(TestNotification.sent.map((sent) => sent.options.tag)).toEqual(
        focused ? [] : [threadNotificationTag(EnvironmentId.make("two"), ThreadId.make("thread"))],
      );
    },
  );

  it("cancels a pending completion when the policy starts suppressing its thread", async () => {
    await using app = setup();
    app.start();
    using _timers = fakeTimers();
    app.setShell("one", shell({ id: "run-1", completedAt: "2026-09-13T07:00:01.000Z" }));
    app.setPolicy(SUPPRESS_ONE);
    await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
    expect(app.presented()).toEqual([]);
  });

  it("releases a thread without replaying what happened while it was suppressed", async () => {
    await using app = setup();
    app.setPolicy(SUPPRESS_ONE);
    app.start();
    app.setShell("one", shell({ id: "run-2", input: true }));
    app.setPolicy(null);
    expect(app.presented()).toEqual([]);
    app.setShell("one", shell({ id: "run-3", input: true }));
    expect(app.presented()).toEqual(["Input needed"]);
  });
});
