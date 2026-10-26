import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadFamilies } from "../state/threads";
import { useWorkbenchOmittedThreads } from "./useWorkbenchOmittedThreads";

const state = vi.hoisted(() => ({
  shell: null as { threads: { id: string }[]; olderSettled?: object } | null,
  reads: new Map<string, AsyncResult.AsyncResult<unknown, unknown>>(),
  mergedThreadIds: [] as string[],
  release: vi.fn(),
}));
vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});
vi.mock("../state/shell", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const shellAtom = Atom.make(() => state.shell);
  const shellStateAtom = Atom.make(() => AsyncResult.success({ removedAt: new Map() }));
  return {
    environmentSnapshotAtom: () => shellAtom,
    environmentShell: { stateAtom: () => shellStateAtom },
  };
});
vi.mock("../state/threads", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const familyAtom = Atom.family((threadId: string) =>
    Atom.make(() => state.reads.get(threadId) ?? AsyncResult.initial(true)),
  );
  const snapshotAtom = Atom.make(() => ({
    threads: state.mergedThreadIds.map((id) => ({ id })),
  }));
  return {
    threadFamilies: {
      familyAtom: (_environmentId: string, threadId: string) => familyAtom(threadId),
      snapshotAtom: () => snapshotAtom,
      mount: vi.fn(() => state.release),
      refresh: vi.fn(),
    },
  };
});

const environmentId = EnvironmentId.make("environment-local");
const kept = ThreadId.make("thread-kept");
const omitted = ThreadId.make("thread-omitted");
const failed = ThreadId.make("thread-failed");
const olderSettled = { before: "2026-10-01T00:00:00.000Z", asOfSequence: 1, counts: [] };

let renderer: ReactTestRenderer | null = null;
let result: ReturnType<typeof useWorkbenchOmittedThreads>;

function Harness({ threadIds }: { readonly threadIds: ReadonlyArray<ThreadId> }) {
  const value = useWorkbenchOmittedThreads(
    environmentId,
    threadIds.map((threadId) => ({ threadId })),
  );
  useLayoutEffect(() => {
    result = value;
  });
  return null;
}

async function render(threadIds: ReadonlyArray<ThreadId>) {
  await act(async () => {
    renderer = create(
      <RegistryContext.Provider value={appAtomRegistry}>
        <Harness threadIds={threadIds} />
      </RegistryContext.Provider>,
    );
  });
}

async function settle(threadId: ThreadId, read: AsyncResult.AsyncResult<unknown, unknown>) {
  state.reads.set(threadId, read);
  await act(async () =>
    appAtomRegistry.refresh(threadFamilies.familyAtom(environmentId, threadId)),
  );
}

beforeEach(() => {
  state.shell = { threads: [{ id: kept }], olderSettled };
  state.reads.clear();
  state.mergedThreadIds = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
});

it("reads only the omitted assigned Thread and is ready once its row merges", async () => {
  await render([kept, omitted]);
  expect(threadFamilies.mount).toHaveBeenCalledExactlyOnceWith(
    appAtomRegistry,
    environmentId,
    omitted,
  );
  expect(result.status).toBe("pending");

  await settle(omitted, AsyncResult.success({ snapshotSequence: 1, threads: [{ id: omitted }] }));
  // A settled read whose row is not merged yet would still show the Thread as deleted.
  expect(result.status).toBe("pending");

  state.mergedThreadIds = [omitted];
  await act(async () => appAtomRegistry.refresh(threadFamilies.snapshotAtom(environmentId)));
  expect(result.status).toBe("ready");

  await act(() => renderer?.unmount());
  renderer = null;
  expect(state.release).toHaveBeenCalledOnce();
});

it("reports a failed read and retries only the failed Thread", async () => {
  await render([omitted, failed]);
  await settle(failed, AsyncResult.failure(Cause.fail(new Error("offline"))));
  expect(result.status).toBe("failed");

  result.retry();
  expect(threadFamilies.refresh).toHaveBeenCalledExactlyOnceWith(
    appAtomRegistry,
    environmentId,
    failed,
  );
});

it("reads nothing when the shell omitted no Threads", async () => {
  state.shell = { threads: [{ id: kept }] };
  await render([kept, omitted]);
  expect(threadFamilies.mount).not.toHaveBeenCalled();
  expect(result.status).toBe("ready");
});
