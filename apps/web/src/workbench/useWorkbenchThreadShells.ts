import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useThreadShells } from "../state/entities";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { getWorkbenchReachableThreads } from "./workbench.logic";

/** This client's Thread shells that show a Board their current state. */
export function useWorkbenchThreadShells(hostEnvironmentId: EnvironmentId | null) {
  const threads = useThreadShells();
  const liveEnvironmentIds = useAtomValue(liveShellEnvironmentIdsAtom);
  return getWorkbenchReachableThreads({ hostEnvironmentId, liveEnvironmentIds, threads });
}
