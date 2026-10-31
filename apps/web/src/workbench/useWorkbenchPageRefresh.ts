import { useEffect } from "react";
import { subscribeToWorkbenchRefresh } from "./workbenchRefresh";

const WORKBENCH_REFRESH_INTERVAL_MS = 15_000;

export function useWorkbenchPageRefresh(refreshWorkbenchSnapshot: () => unknown) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the Board's visibility-aware refresh timer and browser focus/online listeners
  useEffect(() => {
    const refresh = () => refreshWorkbenchSnapshot();
    return subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: WORKBENCH_REFRESH_INTERVAL_MS,
    });
  }, [refreshWorkbenchSnapshot]);
}
