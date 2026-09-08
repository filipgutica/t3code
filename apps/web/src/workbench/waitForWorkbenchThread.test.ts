import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadShells } from "../state/threads";
import { waitForWorkbenchThread } from "./waitForWorkbenchThread";

vi.mock("../state/threads", () => ({
  environmentThreadShells: { threadShellAtom: vi.fn() },
}));

const threadRef = scopeThreadRef(
  EnvironmentId.make("ticket-environment"),
  ThreadId.make("ticket-thread"),
);
const shell: EnvironmentThreadShell = {
  ...OrchestrationThreadShell.make({
    id: threadRef.threadId,
    projectId: ProjectId.make("ticket-project"),
    title: "Ticket Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    branch: "workbench/ticket",
    worktreePath: "/worktrees/ticket",
    latestTurn: null,
    session: null,
    createdAt: "2026-09-08T04:00:00.000Z",
    updatedAt: "2026-09-08T04:00:00.000Z",
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }),
  environmentId: threadRef.environmentId,
};
const shellAtom = Atom.make<EnvironmentThreadShell | null>(null);
const otherShellAtom = Atom.make<EnvironmentThreadShell | null>(null);

beforeEach(() => {
  vi.useFakeTimers();
  appAtomRegistry.set(shellAtom, null);
  appAtomRegistry.set(otherShellAtom, null);
  vi.mocked(environmentThreadShells.threadShellAtom).mockImplementation((ref) =>
    scopedThreadKey(ref) === scopedThreadKey(threadRef) ? shellAtom : otherShellAtom,
  );
});
afterEach(() => vi.useRealTimers());

describe("waitForWorkbenchThread", () => {
  it("resolves immediately when the created thread is already visible", async () => {
    appAtomRegistry.set(shellAtom, shell);
    await expect(waitForWorkbenchThread(threadRef)).resolves.toBeUndefined();
  });

  it("waits for the scoped thread event without requiring a first turn", async () => {
    let ready = false;
    const waiting = waitForWorkbenchThread(threadRef).then(() => {
      ready = true;
    });
    appAtomRegistry.set(otherShellAtom, { ...shell, environmentId: EnvironmentId.make("other") });
    await Promise.resolve();
    expect(ready).toBe(false);
    appAtomRegistry.set(shellAtom, shell);
    await waiting;
    expect(ready).toBe(true);
  });

  it("reports a missing client update instead of waiting forever", async () => {
    const waiting = waitForWorkbenchThread(threadRef);
    const rejected = expect(waiting).rejects.toThrow("has not appeared in this client");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
  });
});
