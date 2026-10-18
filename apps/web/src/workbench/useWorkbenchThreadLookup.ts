import type { EnvironmentId } from "@t3tools/contracts";

import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useThreadShells } from "../state/entities";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";

import { getActiveAssignmentsByTicket } from "./workbench.logic";

import type { WorkbenchSnapshot } from "@t3tools/contracts";

export function useWorkbenchThreadLookup({
  environmentId,
  snapshot,
}: {
  environmentId: EnvironmentId | null;
  snapshot: WorkbenchSnapshot | null;
}) {
  const allThreadShells = useThreadShells();
  const archivedEnvironmentIds = environmentId === null ? [] : [environmentId];
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const threadsById = new Map(
    allThreadShells
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => [thread.id, thread]),
  );
  const archivedThreadsById = new Map(
    archivedSnapshots.flatMap(({ environmentId: archivedEnvironmentId, snapshot }) =>
      snapshot.threads.map((thread) => [
        thread.id,
        presentThreadShell(archivedEnvironmentId, thread),
      ]),
    ),
  );
  const existingThreadIds = new Set([...threadsById.keys(), ...archivedThreadsById.keys()]);
  const reservedThreadIds = new Set(snapshot?.reservedThreadIds ?? []);
  const assignmentsByTicket = getActiveAssignmentsByTicket({
    assignments: snapshot?.assignments ?? [],
    liveThreadIds: new Set(threadsById.keys()),
    archivedThreadIds: new Set(archivedThreadsById.keys()),
    workingThreadIds: new Set(
      [...threadsById.values()]
        .filter((thread) => resolveThreadStatusPill({ thread })?.label === "Working")
        .map((thread) => thread.id),
    ),
  });
  const threadLookupReady = !archivedThreadsLoading && archivedThreadsError === null;
  return {
    threadsById,
    archivedThreadsById,
    existingThreadIds,
    reservedThreadIds,
    assignmentsByTicket,
    threadLookupReady,
    archivedThreadsError,
    refreshArchivedThreads,
  };
}
