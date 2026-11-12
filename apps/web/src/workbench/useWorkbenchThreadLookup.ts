import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";

import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useConnectedEnvironmentIds } from "../state/environments";
import { orchestrationEnvironment } from "../state/orchestration";
import { liveShellEnvironmentIdsAtom } from "../state/shell";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";

import { useWorkbenchOmittedThreads } from "./useWorkbenchOmittedThreads";
import { useWorkbenchThreadShells } from "./useWorkbenchThreadShells";
import {
  getActiveAssignmentsByTicket,
  getWorkbenchStartedThreadsById,
  type WorkbenchThreadLookupState,
} from "./workbench.logic";

import type { WorkbenchSnapshot } from "@t3tools/contracts";

/**
 * The machines whose archived page is a settled, successful read. The query keeps its last page
 * while it reloads and after a reload fails, so a page alone cannot prove a Thread is gone.
 */
const settledArchiveEnvironmentIdsAtom = Atom.family((key: string) =>
  Atom.make(
    (get) =>
      new Set(
        (JSON.parse(key) as ReadonlyArray<EnvironmentId>).filter((environmentId) => {
          const result = get(
            orchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} }),
          );
          return AsyncResult.isSuccess(result) && !result.waiting;
        }),
      ),
  ).pipe(Atom.withLabel(`workbench-settled-archives:${key}`)),
);

/**
 * Finds each assigned Thread in the environment that owns it. `threadLookupReady` covers the
 * host; each remote environment reports its own state, so an offline machine never makes a host
 * Thread look unchecked, and its own Threads never look deleted.
 */
export function useWorkbenchThreadLookup({
  environmentId,
  snapshot,
}: {
  environmentId: EnvironmentId | null;
  snapshot: WorkbenchSnapshot | null;
}) {
  const assignments = snapshot?.assignments ?? [];
  const remoteEnvironmentIds = [
    ...new Set(assignments.flatMap(({ environmentId: remote }) => (remote ? [remote] : []))),
  ];
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const liveEnvironmentIds = useAtomValue(liveShellEnvironmentIdsAtom);
  const threadShells = useWorkbenchThreadShells(environmentId);
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshHostArchivedThreads,
  } = useArchivedThreadSnapshots(environmentId === null ? [] : [environmentId]);
  // Read apart from the host's, so a failing machine degrades only its own Threads.
  const remoteArchived = useArchivedThreadSnapshots(remoteEnvironmentIds);
  const settledArchiveEnvironmentIds = useAtomValue(
    settledArchiveEnvironmentIdsAtom(JSON.stringify(remoteEnvironmentIds)),
  );
  const omittedThreads = useWorkbenchOmittedThreads(environmentId, assignments);
  const refreshArchivedThreads = () => {
    refreshHostArchivedThreads();
    remoteArchived.refresh();
  };
  const threadsById = getWorkbenchStartedThreadsById({
    hostEnvironmentId: environmentId,
    assignments,
    threads: threadShells,
  });
  const archivedThreadsById = getWorkbenchStartedThreadsById({
    hostEnvironmentId: environmentId,
    assignments,
    threads: [...archivedSnapshots, ...remoteArchived.snapshots].flatMap(
      ({ environmentId: archivedEnvironmentId, snapshot: archived }) =>
        archived.threads.map((thread) => presentThreadShell(archivedEnvironmentId, thread)),
    ),
  });
  const remoteEnvironmentStates = new Map(
    remoteEnvironmentIds.map((remote): [EnvironmentId, WorkbenchThreadLookupState] => [
      remote,
      !connectedEnvironmentIds.includes(remote)
        ? "offline"
        : liveEnvironmentIds.has(remote) &&
            settledArchiveEnvironmentIds.has(remote) &&
            (omittedThreads.statusByEnvironment.get(remote) ?? "ready") === "ready"
          ? "ready"
          : "checking",
    ]),
  );
  const existingThreadIds = new Set([...threadsById.keys(), ...archivedThreadsById.keys()]);
  const reservedThreadIds = new Set(snapshot?.reservedThreadIds ?? []);
  const assignmentsByTicket = getActiveAssignmentsByTicket({
    assignments,
    liveThreadIds: new Set(threadsById.keys()),
    archivedThreadIds: new Set(archivedThreadsById.keys()),
    workingThreadIds: new Set(
      [...threadsById.values()]
        .filter((thread) => resolveThreadStatusPill({ thread })?.label === "Working")
        .map((thread) => thread.id),
    ),
  });
  const threadLookupError =
    archivedThreadsError ??
    (omittedThreads.status === "failed" ? "Could not load some older settled Threads." : null);
  const threadLookupReady =
    omittedThreads.status === "ready" && !archivedThreadsLoading && archivedThreadsError === null;
  return {
    threadsById,
    archivedThreadsById,
    existingThreadIds,
    reservedThreadIds,
    assignmentsByTicket,
    threadLookupReady,
    remoteEnvironmentStates,
    liveEnvironmentIds,
    threadLookupError,
    refreshArchivedThreads,
    refreshThreadLookup: () => {
      refreshArchivedThreads();
      omittedThreads.retry();
    },
  };
}
