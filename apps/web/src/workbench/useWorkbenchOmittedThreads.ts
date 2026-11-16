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

const omittedGroupsAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const groups = JSON.parse(key) as Array<[EnvironmentId, ThreadId[]]>;
    return JSON.stringify(
      groups.map(([environmentId, threadIds]) => [
        environmentId,
        JSON.parse(
          get(omittedThreadIdsAtom(JSON.stringify([environmentId, threadIds]))),
        ) as ThreadId[],
      ]),
    );
  }),
);

const omittedGroupsStatusAtom = Atom.family((key: string) =>
  Atom.make((get): OmittedThreadsStatus => {
    const groups = JSON.parse(key) as Array<[EnvironmentId, ThreadId[]]>;
    const statuses = groups.map((group) => get(omittedThreadsReadAtom(JSON.stringify(group))));
    return statuses.includes("failed")
      ? "failed"
      : statuses.includes("pending")
        ? "pending"
        : "ready";
  }),
);

/** Holds native family subscriptions only for connected Assignment environments. */
export function useWorkbenchOmittedThreads(
  environmentId: EnvironmentId | null,
  assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId" | "environmentId">>,
  connectedRemoteEnvironmentIds: ReadonlyArray<EnvironmentId> = [],
): { readonly status: OmittedThreadsStatus; readonly retry: () => void } {
  const environments = [
    ...new Set([...(environmentId ? [environmentId] : []), ...connectedRemoteEnvironmentIds]),
  ];
  const assignedKey = JSON.stringify(
    environments.map((id) => [
      id,
      [
        ...new Set(
          assignments
            .filter((assignment) => (assignment.environmentId ?? environmentId) === id)
            .map((assignment) => assignment.threadId),
        ),
      ].toSorted(),
    ]),
  );
  const omittedKey = useAtomValue(omittedGroupsAtom(assignedKey));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds native Thread-family subscriptions for assigned records omitted from connected shells
  useEffect(() => {
    const groups = JSON.parse(omittedKey) as Array<[EnvironmentId, ThreadId[]]>;
    const releases = groups.flatMap(([id, threadIds]) =>
      threadIds.map((threadId) => threadFamilies.mount(appAtomRegistry, id, threadId)),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [omittedKey]);
  const status = useAtomValue(omittedGroupsStatusAtom(omittedKey));
  const retry = () => {
    const groups = JSON.parse(omittedKey) as Array<[EnvironmentId, ThreadId[]]>;
    for (const [id, threadIds] of groups) {
      for (const threadId of threadIds) {
        if (
          threadFamilyRead(appAtomRegistry.get(threadFamilies.familyAtom(id, threadId))) ===
          "failed"
        ) {
          threadFamilies.refresh(appAtomRegistry, id, threadId);
        }
      }
    }
  };
  return { status, retry };
}
