import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, WorkbenchTicketPreparation } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import type { ThreadPresentationPolicy } from "../hostIntegrations";
import { appAtomRegistry } from "../rpc/atomRegistry";
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
}).pipe(Atom.withEquality(Equal.equals));

export const useWorkbenchTicketPreparations = () => useAtomValue(preparationIndexAtom);

const isUnfinishedTicketPreparation = (preparation: WorkbenchTicketPreparation) =>
  preparation.phase !== "working";

const isUnsavedTicketPreparation = (
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

/** Saved planning is hidden from native lists but can still notify; unsaved drafts cannot. */
export function createWorkbenchThreadPresentationPolicy(
  index: ReadonlyMap<string, WorkbenchTicketPreparation>,
): ThreadPresentationPolicy | null {
  if (index.size === 0) return null;
  return {
    isVisible: (threadRef) => {
      const preparation = index.get(scopedThreadKey(threadRef));
      return preparation === undefined || !isUnfinishedTicketPreparation(preparation);
    },
    canNotify: ({ environmentId, threadId }) =>
      !isUnsavedTicketPreparation(index, environmentId, threadId),
  };
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
