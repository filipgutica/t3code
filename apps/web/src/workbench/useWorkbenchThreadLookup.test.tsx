import {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { makeThreadFixture } from "../test-fixtures";
import { useWorkbenchOmittedThreads } from "./useWorkbenchOmittedThreads";
import { useWorkbenchThreadLookup } from "./useWorkbenchThreadLookup";

const state = vi.hoisted(() => ({
  threads: [] as ReturnType<typeof makeThreadFixture>[],
  connected: [] as string[],
  live: new Set<string>(),
  archives: new Map<string, unknown>(),
}));
vi.mock("../state/entities", () => ({ useThreadShells: () => state.threads }));
vi.mock("../state/environments", () => ({ useConnectedEnvironmentIds: () => state.connected }));
vi.mock("../state/shell", async () => {
  const { Atom } = await import("effect/reactivity");
  return { liveShellEnvironmentIdsAtom: Atom.make(() => state.live) };
});
vi.mock("../lib/archivedThreadsState", () => ({ useArchivedThreadSnapshots: vi.fn() }));
vi.mock("../state/orchestration", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    orchestrationEnvironment: {
      archivedShellSnapshot: ({ environmentId }: { environmentId: string }) =>
        Atom.make(() => state.archives.get(environmentId) ?? AsyncResult.initial(true)),
    },
  };
});
vi.mock("./useWorkbenchOmittedThreads", () => ({ useWorkbenchOmittedThreads: vi.fn() }));

it("waits for omitted Threads, reports failed reads, and retries them", async () => {
  const retry = vi.fn();
  const refreshArchivedThreads = vi.fn();
  // The host's archive; the remote read is empty without remote Assignments.
  vi.mocked(useArchivedThreadSnapshots).mockImplementation((environmentIds) => ({
    snapshots: [],
    error: null,
    isLoading: false,
    refresh: environmentIds.length > 0 ? refreshArchivedThreads : vi.fn(),
  }));
  vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({
    status: "pending",
    statusByEnvironment: new Map(),
    retry,
  });
  const observe = vi.fn<(lookup: ReturnType<typeof useWorkbenchThreadLookup>) => void>();
  function Harness() {
    observe(
      useWorkbenchThreadLookup({
        environmentId: EnvironmentId.make("lookup-environment"),
        snapshot: null,
      }),
    );
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<Harness />);
    });
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadLookupReady: false, threadLookupError: null }),
    );

    vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({
      status: "failed",
      statusByEnvironment: new Map(),
      retry,
    });
    await act(() => renderer?.update(<Harness />));
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadLookupReady: false,
        threadLookupError: "Could not load some older settled Threads.",
      }),
    );
    observe.mock.lastCall?.[0].refreshThreadLookup();
    expect(retry).toHaveBeenCalledOnce();
    expect(refreshArchivedThreads).toHaveBeenCalledOnce();

    vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({
      status: "ready",
      statusByEnvironment: new Map(),
      retry,
    });
    await act(() => renderer?.update(<Harness />));
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadLookupReady: true, threadLookupError: null }),
    );
  } finally {
    await act(() => renderer?.unmount());
  }
});

it("reads a remote Thread from its own machine and reports that machine's state", async () => {
  const host = EnvironmentId.make("host-environment");
  const remote = EnvironmentId.make("remote-environment");
  const remoteThreadId = ThreadId.make("remote-thread");
  const assignment = {
    id: WorkbenchAssignmentId.make("remote-assignment"),
    ticketId: WorkbenchTicketId.make("ticket"),
    threadId: remoteThreadId,
    environmentId: remote,
    projectId: makeThreadFixture().projectId,
    createdAt: "2026-11-01T00:00:00.000Z",
    supersededAt: null,
  };
  const snapshot = {
    projects: [],
    tickets: [],
    assignments: [assignment],
    references: [],
    threadRecaps: [],
    ticketWorkspaces: [],
    reservedThreadIds: [],
  } satisfies WorkbenchSnapshot;
  const remoteThread = makeThreadFixture({ id: remoteThreadId, environmentId: remote });
  state.threads = [remoteThread, makeThreadFixture({ id: remoteThreadId, environmentId: host })];
  vi.mocked(useArchivedThreadSnapshots).mockImplementation((environmentIds) => ({
    snapshots: environmentIds.map((environmentId) => ({
      environmentId,
      snapshot: { threads: [], snapshotSequence: 0 } as never,
    })),
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  }));
  vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({
    status: "ready",
    statusByEnvironment: new Map(),
    retry: vi.fn(),
  });
  const observe = vi.fn<(lookup: ReturnType<typeof useWorkbenchThreadLookup>) => void>();
  function Lookup() {
    observe(useWorkbenchThreadLookup({ environmentId: host, snapshot }));
    return null;
  }
  // The live-shell atom reads `state.live` once per registry.
  let registry = AtomRegistry.make();
  const Harness = () => (
    <RegistryContext.Provider value={registry}>
      <Lookup />
    </RegistryContext.Provider>
  );

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<Harness />);
    });
    // Not saved or not connected on this client: the Thread cannot be checked.
    expect(observe.mock.lastCall?.[0].remoteEnvironmentStates.get(remote)).toBe("offline");

    state.connected = [host, remote];
    await act(() => renderer?.update(<Harness />));
    expect(observe.mock.lastCall?.[0].remoteEnvironmentStates.get(remote)).toBe("checking");

    const archivePage = { threads: [], snapshotSequence: 0 };
    const remoteStateWith = async (archive: unknown) => {
      state.archives = new Map([[remote, archive]]);
      registry = AtomRegistry.make();
      await act(() => renderer?.update(<Harness />));
      return observe.mock.lastCall?.[0].remoteEnvironmentStates.get(remote);
    };
    state.live = new Set([remote]);
    expect(await remoteStateWith(AsyncResult.success(archivePage))).toBe("ready");
    const lookup = observe.mock.lastCall?.[0];
    expect(lookup?.threadsById.get(remoteThreadId)).toBe(remoteThread);
    expect(lookup?.threadLookupReady).toBe(true);
    // A cached archive page proves nothing while it reloads or after its reload failed.
    expect(await remoteStateWith(AsyncResult.success(archivePage, { waiting: true }))).toBe(
      "checking",
    );
    expect(
      await remoteStateWith(
        AsyncResult.failure(Cause.fail("offline"), {
          previousSuccess: Option.some(AsyncResult.success(archivePage)),
        }),
      ),
    ).toBe("checking");
  } finally {
    await act(() => renderer?.unmount());
  }
});
