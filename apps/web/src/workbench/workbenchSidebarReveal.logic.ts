export type WorkbenchSidebarRevealReason = "destination" | "filter" | "reset" | null;

export function getWorkbenchSidebarRevealDecision({
  reason,
  fullyVisible,
  userScrolling,
}: {
  reason: WorkbenchSidebarRevealReason;
  fullyVisible: boolean;
  userScrolling: boolean;
}) {
  const reveal = reason !== null && !userScrolling;
  return {
    scroll: reveal && !fullyVisible,
    pulse: reveal && reason === "filter",
  };
}

export interface WorkbenchSidebarRevealSnapshot {
  readonly activeKey: string | null;
  readonly onlyActionable: boolean;
  readonly isSearching: boolean;
  readonly navigation: object | null;
  readonly scrollTop: number;
}

export function getWorkbenchSidebarRevealReason({
  previous,
  next,
}: {
  previous: WorkbenchSidebarRevealSnapshot | null;
  next: WorkbenchSidebarRevealSnapshot;
}): WorkbenchSidebarRevealReason {
  if (!previous) return "destination";
  if (previous.onlyActionable !== next.onlyActionable) return "filter";
  if (previous.activeKey !== next.activeKey) return "destination";
  if (previous.navigation !== next.navigation) return "reset";
  if (previous.isSearching && !next.isSearching) return "reset";
  if (previous.scrollTop > 0 && next.scrollTop === 0) return "reset";
  return null;
}
