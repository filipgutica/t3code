import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ScopedProjectRef,
  ThreadId,
  WorkbenchTicketPreparation,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useThreadShells, useThreadShellsForProjectRefs } from "../state/entities";
import { useConnectedEnvironmentIds } from "../state/environments";
import { environmentSummaries } from "../state/presentation";
import { workbenchEnvironment } from "./state";
import { subscribeToWorkbenchRefresh } from "./workbenchRefresh";

const preparationIndexAtom = Atom.make((get) => {
  const index = new Map<string, WorkbenchTicketPreparation>();
  for (const environmentId of get(environmentSummaries.connectedEnvironmentIdsAtom)) {
    const result = get(workbenchEnvironment.ticketPreparations({ environmentId, input: {} }));
    const preparations = Option.getOrElse(AsyncResult.value(result), () => []);
    for (const preparation of preparations) {
      index.set(scopedThreadKey(scopeThreadRef(environmentId, preparation.threadId)), preparation);
    }
  }
  return index;
});

export const useWorkbenchTicketPreparations = () => useAtomValue(preparationIndexAtom);

const isUnfinishedTicketPreparation = (preparation: WorkbenchTicketPreparation) =>
  preparation.phase !== "working";

export const isUnsavedTicketPreparation = (
  index: ReadonlyMap<string, WorkbenchTicketPreparation>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
) => {
  const preparation = index.get(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  return (
    preparation !== undefined &&
    (preparation.ticketId === null ||
      preparation.phase === "creating" ||
      preparation.phase === "draft" ||
      preparation.phase === "promoting" ||
      preparation.phase === "discarding")
  );
};

export const filterTicketPreparationThreads = <
  T extends Pick<EnvironmentThreadShell, "id" | "environmentId">,
>(
  threads: ReadonlyArray<T>,
  index: ReadonlyMap<string, WorkbenchTicketPreparation>,
) =>
  index.size === 0
    ? threads
    : threads.filter((thread) => {
        const preparation = index.get(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        );
        return preparation === undefined || !isUnfinishedTicketPreparation(preparation);
      });

/** Native lists keep their own ordering and state; preparation appears after Start work. */
export function useWorkbenchVisibleThreadShells() {
  const threads = useThreadShells();
  const index = useWorkbenchTicketPreparations();
  return useMemo(() => filterTicketPreparationThreads(threads, index), [threads, index]);
}

export function useWorkbenchVisibleProjectThreadShells(refs: ReadonlyArray<ScopedProjectRef>) {
  const threads = useThreadShellsForProjectRefs(refs);
  const index = useWorkbenchTicketPreparations();
  return useMemo(() => filterTicketPreparationThreads(threads, index), [threads, index]);
}

/** One shared observer refreshes the compact index while the client is visible and online. */
export function useWorkbenchTicketPreparationRefresh() {
  const environmentIds = useConnectedEnvironmentIds();
  useEffect(
    () =>
      subscribeToWorkbenchRefresh({
        target: window,
        intervalMs: 15_000,
        refresh: () => {
          for (const environmentId of environmentIds) {
            const query = workbenchEnvironment.ticketPreparations({ environmentId, input: {} });
            // Older hosts can lack this optional overlay RPC. Reconnect revalidates it;
            // don't repeatedly request an unsupported method while connected.
            if (appAtomRegistry.get(query)._tag === "Success") appAtomRegistry.refresh(query);
          }
        },
      }),
    [environmentIds],
  );
}
