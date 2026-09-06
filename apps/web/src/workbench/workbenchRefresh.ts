export interface WorkbenchRefreshTarget {
  readonly setInterval: (handler: () => void, timeout: number) => number;
  readonly clearInterval: (id: number) => void;
  readonly document?: {
    readonly visibilityState: DocumentVisibilityState;
    readonly addEventListener: (type: "visibilitychange", handler: () => void) => void;
    readonly removeEventListener: (type: "visibilitychange", handler: () => void) => void;
  };
  readonly navigator?: { readonly onLine: boolean };
  readonly addEventListener: (type: "focus" | "online", handler: () => void) => void;
  readonly removeEventListener: (type: "focus" | "online", handler: () => void) => void;
}

export interface WorkbenchRefreshOptions {
  readonly target: WorkbenchRefreshTarget;
  readonly refresh: () => void;
  readonly intervalMs: number;
}

export function subscribeToWorkbenchRefresh({
  target,
  refresh,
  intervalMs,
}: WorkbenchRefreshOptions): () => void {
  const canRefresh = () =>
    target.document?.visibilityState !== "hidden" && (target.navigator?.onLine ?? true);
  const refreshIfAvailable = () => {
    if (canRefresh()) refresh();
  };
  const intervalId = target.setInterval(refreshIfAvailable, intervalMs);
  const onFocus = () => refreshIfAvailable();
  const onOnline = () => refreshIfAvailable();
  const onVisibilityChange = () => refreshIfAvailable();
  target.addEventListener("focus", onFocus);
  target.addEventListener("online", onOnline);
  target.document?.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    target.clearInterval(intervalId);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("online", onOnline);
    target.document?.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
