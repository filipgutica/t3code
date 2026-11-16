import type { EnvironmentId } from "@t3tools/contracts";

import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useConnectedEnvironmentIds } from "../state/environments";
import { useThreadShells } from "../state/entities";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";

import { useWorkbenchOmittedThreads } from "./useWorkbenchOmittedThreads";
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
  const connectedIds = useConnectedEnvironmentIds();
  const remoteEnvironmentIds = [
    ...new Set([
      ...(snapshot?.assignments.flatMap((assignment) =>
        assignment.environmentId ? [assignment.environmentId] : [],
      ) ?? []),
      ...(snapshot?.projects.flatMap(
        (board) => board.remoteProjects?.map((remote) => remote.environmentId) ?? [],
      ) ?? []),
    ]),
  ].filter((id) => connectedIds.includes(id));
  const archivedEnvironmentIds = [
    ...(environmentId === null ? [] : [environmentId]),
    ...remoteEnvironmentIds,
  ];
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const omittedThreads = useWorkbenchOmittedThreads(
    environmentId,
    snapshot?.assignments ?? [],
    remoteEnvironmentIds,
  );
  const threadsById = new Map(
    allThreadShells
      .filter((thread) => archivedEnvironmentIds.includes(thread.environmentId))
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
    threadLookupError,
    refreshArchivedThreads,
    refreshThreadLookup: () => {
      refreshArchivedThreads();
      omittedThreads.retry();
    },
  };
}
