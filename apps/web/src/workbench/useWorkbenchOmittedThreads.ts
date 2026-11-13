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

import {
  getWorkbenchAssignmentEnvironmentId,
  getWorkbenchOmittedThreadIds,
  getWorkbenchOmittedThreadsStatus,
} from "./workbench.logic";

type OmittedThreadsStatus = "ready" | "pending" | "failed";
/** Assigned Thread ids grouped by the environment that owns them, in a stable order. */
type ThreadIdsByEnvironment = ReadonlyArray<readonly [EnvironmentId, ReadonlyArray<ThreadId>]>;

// A string result re-renders callers only when the omitted set changes, not on every shell delta.
const omittedThreadIdsAtom = Atom.family((key: string) => {
  const groups = JSON.parse(key) as ThreadIdsByEnvironment;
  return Atom.make((get) =>
    JSON.stringify(
      groups.flatMap(([environmentId, threadIds]) => {
        const omitted = getWorkbenchOmittedThreadIds({
          threadIds,
          shell: get(environmentSnapshotAtom(environmentId)),
        });
        return omitted.length === 0 ? [] : [[environmentId, omitted]];
      }),
    ),
  ).pipe(Atom.withLabel(`workbench-omitted-threads:${key}`));
});

const NO_REMOVALS: ReadonlyMap<ThreadId, number> = new Map();

// Encoded as a string for the same reason as the omitted ids above.
const omittedThreadsReadAtom = Atom.family((key: string) => {
  const groups = JSON.parse(key) as ThreadIdsByEnvironment;
  return Atom.make((get) => {
    const statuses: Array<[EnvironmentId, OmittedThreadsStatus]> = [];
    for (const [environmentId, threadIds] of groups) {
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
      statuses.push([
        environmentId,
        getWorkbenchOmittedThreadsStatus({
          threadIds,
          reads,
          mergedThreadIds: new Set(merged?.threads.map((thread) => thread.id)),
          removedAt: shellState?.removedAt ?? NO_REMOVALS,
        }),
      ]);
    }
    return JSON.stringify(statuses);
  }).pipe(Atom.withLabel(`workbench-omitted-threads-read:${key}`));
});

/**
 * Keeps assigned Threads the shell left out as older settled in the Thread rows, and reports
 * whether they have all been read and merged, so callers do not show one as deleted. Each
 * Assignment is read from its own environment; `status` is the host's. A failed read stays failed
 * until `retry` reads it again.
 */
export function useWorkbenchOmittedThreads(
  hostEnvironmentId: EnvironmentId | null,
  assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId" | "environmentId">>,
): {
  readonly status: OmittedThreadsStatus;
  readonly statusByEnvironment: ReadonlyMap<EnvironmentId, OmittedThreadsStatus>;
  readonly retry: () => void;
} {
  const assigned = new Map<EnvironmentId, Set<ThreadId>>();
  if (hostEnvironmentId !== null) {
    for (const assignment of assignments) {
      const environmentId = getWorkbenchAssignmentEnvironmentId(assignment, hostEnvironmentId);
      const threadIds = assigned.get(environmentId) ?? new Set();
      threadIds.add(assignment.threadId);
      assigned.set(environmentId, threadIds);
    }
  }
  const assignedKey = JSON.stringify(
    [...assigned]
      .map(([environmentId, threadIds]) => [environmentId, [...threadIds].toSorted()] as const)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
  const omittedKey = useAtomValue(omittedThreadIdsAtom(assignedKey));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds native Thread-family subscriptions for assigned records omitted from the shell and releases every lease on unmount
  useEffect(() => {
    const releases = (JSON.parse(omittedKey) as ThreadIdsByEnvironment).flatMap(
      ([environmentId, threadIds]) =>
        threadIds.map((threadId) => threadFamilies.mount(appAtomRegistry, environmentId, threadId)),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [omittedKey]);
  const statusByEnvironment = new Map(
    JSON.parse(useAtomValue(omittedThreadsReadAtom(omittedKey))) as Array<
      [EnvironmentId, OmittedThreadsStatus]
    >,
  );
  const retry = () => {
    for (const [environmentId, threadIds] of JSON.parse(omittedKey) as ThreadIdsByEnvironment) {
      for (const threadId of threadIds) {
        const read = appAtomRegistry.get(threadFamilies.familyAtom(environmentId, threadId));
        if (threadFamilyRead(read) === "failed") {
          threadFamilies.refresh(appAtomRegistry, environmentId, threadId);
        }
      }
    }
  };
  return {
    status:
      hostEnvironmentId === null
        ? "ready"
        : (statusByEnvironment.get(hostEnvironmentId) ?? "ready"),
    statusByEnvironment,
    retry,
  };
}
