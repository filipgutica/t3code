import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

/** Recaps of each Thread's latest finished run, from the page's shared snapshot query. */
export function useWorkbenchThreadRecaps(
  environmentId: EnvironmentId,
): ReadonlyMap<ThreadId, string> {
  const { data } = useEnvironmentQuery(workbenchEnvironment.snapshot({ environmentId, input: {} }));
  return new Map((data?.threadRecaps ?? []).map((recap) => [recap.threadId, recap.text]));
}
