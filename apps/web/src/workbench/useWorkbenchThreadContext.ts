import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { environmentSummaries } from "../state/presentation";
import { workbenchEnvironment } from "./state";
import { getWorkbenchContextForThread } from "./workbench.logic";

const threadContextAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const [threadEnvironmentId, threadId] = JSON.parse(key) as [
      EnvironmentId | null,
      ThreadId | null,
    ];
    if (threadEnvironmentId === null || threadId === null) return null;
    for (const environmentId of get(environmentSummaries.connectedEnvironmentIdsAtom)) {
      const result = get(workbenchEnvironment.snapshot({ environmentId, input: {} }));
      // Workbench is optional on connected upstream servers; failed reads have no context.
      const snapshot = Option.getOrNull(AsyncResult.value(result));
      if (!snapshot || result._tag !== "Success") continue;
      const assignments = snapshot.assignments.filter(
        (assignment) =>
          assignment.threadId === threadId &&
          (assignment.environmentId ?? environmentId) === threadEnvironmentId,
      );
      const context = getWorkbenchContextForThread({ ...snapshot, assignments }, threadId);
      if (context) return { environmentId, snapshot, context };
    }
    return null;
  }),
);

/** Resolves a native Thread's Ticket on the Board host, including client-linked remote Threads. */
export function useWorkbenchThreadContext(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
) {
  return useAtomValue(threadContextAtom(JSON.stringify([environmentId, threadId])));
}
