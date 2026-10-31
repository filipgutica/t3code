import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { workbenchEnvironment } from "./state";
import { useWorkbenchBoardViewStore } from "./workbenchBoardViewState";
import { useWorkbenchDraftStore } from "./workbenchDraftStore";

export const idleWorkbenchSnapshotReconciliation = Atom.make(undefined);

/** One mounted owner reconciles native projections and local saves in either arrival order. */
export const workbenchSnapshotReconciliation = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const snapshot = workbenchEnvironment.snapshot({ environmentId, input: {} });
    const reconcile = () => {
      const data = Option.getOrNull(AsyncResult.value(get.registry.get(snapshot)));
      if (data === null) return;
      useWorkbenchDraftStore.getState().reconcileSavedDrafts(environmentId, data.tickets);
      useWorkbenchBoardViewStore.getState().reconcileRepositories(environmentId, data.projects);
    };
    get.addFinalizer(useWorkbenchDraftStore.subscribe(reconcile));
    get.addFinalizer(useWorkbenchBoardViewStore.subscribe(reconcile));
    get.subscribe(snapshot, reconcile, { immediate: true });
  }).pipe(Atom.withLabel(`workbench-snapshot-reconciliation:${environmentId}`)),
);
