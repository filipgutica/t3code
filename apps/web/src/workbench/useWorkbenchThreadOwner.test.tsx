import {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { useWorkbenchThreadOwner } from "./useWorkbenchThreadOwner";

const state = vi.hoisted(() => ({
  connected: [] as string[],
  snapshots: new Map<string, unknown>(),
  preparations: new Map<string, unknown>(),
  snapshotReads: new Set<string>(),
}));
vi.mock("../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentSummaries: { connectedEnvironmentIdsAtom: Atom.make(() => state.connected) },
  };
});
vi.mock("./state", async () => {
  const { Atom } = await import("effect/reactivity");
  const atoms = new Map<string, unknown>();
  const atomFor = (key: string, read: () => unknown) => {
    if (!atoms.has(key)) atoms.set(key, Atom.make(read));
    return atoms.get(key);
  };
  return {
    workbenchEnvironment: {
      snapshot: ({ environmentId }: { environmentId: string }) =>
        atomFor(`snapshot:${environmentId}`, () => {
          state.snapshotReads.add(environmentId);
          return state.snapshots.get(environmentId);
        }),
      ticketPreparations: ({ environmentId }: { environmentId: string }) =>
        atomFor(`preparations:${environmentId}`, () => state.preparations.get(environmentId)),
    },
  };
});

const host = EnvironmentId.make("owner-host");
const otherHost = EnvironmentId.make("owner-other-host");
const remote = EnvironmentId.make("owner-remote");
const threadId = ThreadId.make("remote-thread");
const ticketId = WorkbenchTicketId.make("ticket");
const boardId = WorkbenchProjectId.make("board");
// Only the fields the owner walk reads.
const hostSnapshot = {
  projects: [{ id: boardId }],
  tickets: [{ id: ticketId, projectId: boardId }],
  assignments: [{ threadId, ticketId, environmentId: remote }],
} as unknown as WorkbenchSnapshot;
const unassigned = { ...hostSnapshot, assignments: [] };
const stockServer = AsyncResult.failure(Cause.fail("unsupported"));
const workbench = AsyncResult.success([]);
const pending = AsyncResult.initial(true);

it("resolves a remote Thread route to the Board host that assigns it", async () => {
  const observe = vi.fn<(owner: EnvironmentId | null) => void>();
  function Owner({ environmentId }: { environmentId: EnvironmentId }) {
    observe(useWorkbenchThreadOwner({ environmentId, threadId }));
    return null;
  }
  const ownerWith = async ({
    thread = remote,
    environments,
  }: {
    thread?: EnvironmentId;
    /** Each connected environment's preparation index and snapshot. */
    environments: ReadonlyArray<[EnvironmentId, unknown, unknown]>;
  }) => {
    state.connected = environments.map(([id]) => id);
    state.preparations = new Map(environments.map(([id, preparations]) => [id, preparations]));
    state.snapshots = new Map(environments.map(([id, , snapshot]) => [id, snapshot]));
    state.snapshotReads = new Set();
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <RegistryContext.Provider value={AtomRegistry.make()}>
            <Owner environmentId={thread} />
          </RegistryContext.Provider>,
        );
      });
      return observe.mock.lastCall?.[0];
    } finally {
      await act(() => renderer?.unmount());
    }
  };

  // The Thread's own machine runs a stock server, which is never asked for a snapshot.
  expect(
    await ownerWith({
      environments: [
        [remote, stockServer, stockServer],
        [host, workbench, AsyncResult.success(hostSnapshot)],
      ],
    }),
  ).toBe(host);
  expect(state.snapshotReads).toEqual(new Set([host]));
  // Neither a machine still connecting nor another Workbench still loading delays the host.
  expect(
    await ownerWith({
      environments: [
        [remote, pending, pending],
        [otherHost, workbench, pending],
        [host, workbench, AsyncResult.success(hostSnapshot)],
      ],
    }),
  ).toBe(host);
  // No connected Workbench assigns it, and its own machine has no Workbench to own the route.
  expect(
    await ownerWith({
      environments: [
        [remote, stockServer, stockServer],
        [host, workbench, AsyncResult.success(unassigned)],
      ],
    }),
  ).toBeNull();
  expect(state.snapshotReads).toEqual(new Set([host]));
  // An unassigned Thread on a Workbench host stays with that host.
  expect(
    await ownerWith({
      thread: host,
      environments: [[host, workbench, AsyncResult.success(unassigned)]],
    }),
  ).toBe(host);
});
