import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentSummaries } from "../state/presentation";
import { workbenchEnvironment } from "./state";
import { getWorkbenchContextForThread } from "./workbench.logic";

const NO_THREAD = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.withLabel("workbench-thread-host:none"),
);

/**
 * The Workbench host that owns a Thread route: the connected host whose Ticket assigns the Thread,
 * else the Thread's own environment when it runs Workbench, else null. Hosts come from the
 * preparation index those environments already answer; a stock server fails that read and is
 * never asked for a snapshot. Each host is checked without waiting on another still loading.
 */
const threadHostAtom = Atom.family((key: string) =>
  Atom.make((get): EnvironmentId | null => {
    const threadRef = parseScopedThreadKey(key);
    if (threadRef === null) return null;
    const hosts = get(environmentSummaries.connectedEnvironmentIdsAtom).filter((environmentId) =>
      Option.isSome(
        AsyncResult.value(
          get(workbenchEnvironment.ticketPreparations({ environmentId, input: {} })),
        ),
      ),
    );
    const ownIsHost = hosts.includes(threadRef.environmentId);
    for (const hostEnvironmentId of ownIsHost
      ? [threadRef.environmentId, ...hosts.filter((id) => id !== threadRef.environmentId)]
      : hosts) {
      const snapshot = Option.getOrNull(
        AsyncResult.value(
          get(workbenchEnvironment.snapshot({ environmentId: hostEnvironmentId, input: {} })),
        ),
      );
      if (getWorkbenchContextForThread(snapshot, hostEnvironmentId, threadRef) !== null) {
        return hostEnvironmentId;
      }
    }
    return ownIsHost ? threadRef.environmentId : null;
  }).pipe(Atom.withLabel(`workbench-thread-host:${key}`)),
);

export const useWorkbenchThreadOwner = (threadRef: ScopedThreadRef | null) =>
  useAtomValue(threadRef === null ? NO_THREAD : threadHostAtom(scopedThreadKey(threadRef)));
