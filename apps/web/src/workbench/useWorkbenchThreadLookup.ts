import type { EnvironmentId } from "@t3tools/contracts";

import { useMemo } from "react";
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
  const archivedEnvironmentIds = useMemo(
    () => (environmentId === null ? [] : [environmentId]),
    [environmentId],
  );
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const threadsById = useMemo(
    () =>
      new Map(
        allThreadShells
          .filter((thread) => thread.environmentId === environmentId)
          .map((thread) => [thread.id, thread]),
      ),
    [allThreadShells, environmentId],
  );
  const archivedThreadsById = useMemo(
    () =>
      new Map(
        archivedSnapshots.flatMap(({ environmentId: archivedEnvironmentId, snapshot }) =>
          snapshot.threads.map((thread) => [
            thread.id,
            { ...thread, environmentId: archivedEnvironmentId },
          ]),
        ),
      ),
    [archivedSnapshots],
  );
  const existingThreadIds = useMemo(
    () => new Set([...threadsById.keys(), ...archivedThreadsById.keys()]),
    [archivedThreadsById, threadsById],
  );
  const reservedThreadIds = useMemo(
    () => new Set(snapshot?.reservedThreadIds ?? []),
    [snapshot?.reservedThreadIds],
  );
  const assignmentsByTicket = useMemo(
    () =>
      getActiveAssignmentsByTicket({
        assignments: snapshot?.assignments ?? [],
        liveThreadIds: new Set(threadsById.keys()),
        archivedThreadIds: new Set(archivedThreadsById.keys()),
        workingThreadIds: new Set(
          [...threadsById.values()]
            .filter((thread) => resolveThreadStatusPill({ thread })?.label === "Working")
            .map((thread) => thread.id),
        ),
      }),
    [archivedThreadsById, snapshot?.assignments, threadsById],
  );
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
