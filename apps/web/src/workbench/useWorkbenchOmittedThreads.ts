import { useAtomValue } from "@effect/atom-react";
import { threadFamilyRead } from "@t3tools/client-runtime/state/threads";
import type {
  EnvironmentId,
  OrchestrationV2ThreadFamily,
  ThreadId,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentShell, environmentSnapshotAtom } from "../state/shell";
import { threadFamilies } from "../state/threads";

import { areWorkbenchOmittedThreadsRead, getWorkbenchOmittedThreadIds } from "./workbench.logic";

const NO_OMITTED_THREADS = Atom.make("[]").pipe(Atom.withLabel("workbench-omitted-threads:none"));

// A string result re-renders callers only when the omitted set changes, not on every shell delta.
const omittedThreadIdsAtom = Atom.family((key: string) => {
  const [environmentId, threadIds] = JSON.parse(key) as [EnvironmentId, ThreadId[]];
  return Atom.make((get) =>
    JSON.stringify(
      getWorkbenchOmittedThreadIds({
        threadIds,
        shell: get(environmentSnapshotAtom(environmentId)),
      }),
    ),
  ).pipe(Atom.withLabel(`workbench-omitted-threads:${key}`));
});

const NO_REMOVALS: ReadonlyMap<ThreadId, number> = new Map();

const omittedThreadsReadAtom = Atom.family((key: string) => {
  const [environmentId, threadIds] = JSON.parse(key) as [EnvironmentId | null, ThreadId[]];
  return Atom.make((get) => {
    if (environmentId === null || threadIds.length === 0) return true;
    const reads = new Map<ThreadId, OrchestrationV2ThreadFamily>();
    for (const threadId of threadIds) {
      const read = get(threadFamilies.familyAtom(environmentId, threadId));
      const family = Option.getOrNull(AsyncResult.value(read));
      if (threadFamilyRead(read) === "settled" && family !== null) reads.set(threadId, family);
    }
    const shellState = Option.getOrNull(
      AsyncResult.value(get(environmentShell.stateAtom(environmentId))),
    );
    const merged = get(threadFamilies.snapshotAtom(environmentId));
    return areWorkbenchOmittedThreadsRead({
      threadIds,
      reads,
      mergedThreadIds: new Set(merged?.threads.map((thread) => thread.id)),
      removedAt: shellState?.removedAt ?? NO_REMOVALS,
    });
  }).pipe(Atom.withLabel(`workbench-omitted-threads-read:${key}`));
});

/**
 * Keeps assigned Threads the shell left out as older settled in the Thread rows, and reports
 * whether they have all been read and merged, so callers do not show one as deleted.
 */
export function useWorkbenchOmittedThreads(
  environmentId: EnvironmentId | null,
  assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId">>,
): boolean {
  const assignedKey = JSON.stringify([
    environmentId,
    [...new Set(assignments.map((assignment) => assignment.threadId))].toSorted(),
  ]);
  const omittedThreadIds = useAtomValue(
    environmentId === null ? NO_OMITTED_THREADS : omittedThreadIdsAtom(assignedKey),
  );
  const omittedKey = `[${JSON.stringify(environmentId)},${omittedThreadIds}]`;
  useEffect(() => {
    const [mountedEnvironmentId, threadIds] = JSON.parse(omittedKey) as [
      EnvironmentId | null,
      ThreadId[],
    ];
    if (mountedEnvironmentId === null) return;
    const releases = threadIds.map((threadId) =>
      threadFamilies.mount(appAtomRegistry, mountedEnvironmentId, threadId),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [omittedKey]);
  return useAtomValue(omittedThreadsReadAtom(omittedKey));
}
