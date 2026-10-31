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

import { getWorkbenchOmittedThreadIds, getWorkbenchOmittedThreadsStatus } from "./workbench.logic";

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

type OmittedThreadsStatus = "ready" | "pending" | "failed";

const omittedThreadsReadAtom = Atom.family((key: string) => {
  const [environmentId, threadIds] = JSON.parse(key) as [EnvironmentId | null, ThreadId[]];
  return Atom.make((get): OmittedThreadsStatus => {
    if (environmentId === null || threadIds.length === 0) return "ready";
    const reads = new Map<ThreadId, OrchestrationV2ThreadFamily | "failed">();
    for (const threadId of threadIds) {
      const read = get(threadFamilies.familyAtom(environmentId, threadId));
      const family = Option.getOrNull(AsyncResult.value(read));
      const status = threadFamilyRead(read);
      if (status === "failed") reads.set(threadId, "failed");
      else if (status === "settled" && family !== null) reads.set(threadId, family);
    }
    const shellState = Option.getOrNull(
      AsyncResult.value(get(environmentShell.stateAtom(environmentId))),
    );
    const merged = get(threadFamilies.snapshotAtom(environmentId));
    return getWorkbenchOmittedThreadsStatus({
      threadIds,
      reads,
      mergedThreadIds: new Set(merged?.threads.map((thread) => thread.id)),
      removedAt: shellState?.removedAt ?? NO_REMOVALS,
    });
  }).pipe(Atom.withLabel(`workbench-omitted-threads-read:${key}`));
});

/**
 * Keeps assigned Threads the shell left out as older settled in the Thread rows, and reports
 * whether they have all been read and merged, so callers do not show one as deleted. A failed
 * read stays failed until `retry` reads it again.
 */
export function useWorkbenchOmittedThreads(
  environmentId: EnvironmentId | null,
  assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId">>,
): { readonly status: OmittedThreadsStatus; readonly retry: () => void } {
  const assignedKey = JSON.stringify([
    environmentId,
    [...new Set(assignments.map((assignment) => assignment.threadId))].toSorted(),
  ]);
  const omittedThreadIds = useAtomValue(
    environmentId === null ? NO_OMITTED_THREADS : omittedThreadIdsAtom(assignedKey),
  );
  const omittedKey = `[${JSON.stringify(environmentId)},${omittedThreadIds}]`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds native Thread-family subscriptions for assigned records omitted from the shell and releases every lease on unmount
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
  const status = useAtomValue(omittedThreadsReadAtom(omittedKey));
  const retry = () => {
    const [retryEnvironmentId, threadIds] = JSON.parse(omittedKey) as [
      EnvironmentId | null,
      ThreadId[],
    ];
    if (retryEnvironmentId === null) return;
    for (const threadId of threadIds) {
      const read = appAtomRegistry.get(threadFamilies.familyAtom(retryEnvironmentId, threadId));
      if (threadFamilyRead(read) === "failed") {
        threadFamilies.refresh(appAtomRegistry, retryEnvironmentId, threadId);
      }
    }
  };
  return { status, retry };
}
