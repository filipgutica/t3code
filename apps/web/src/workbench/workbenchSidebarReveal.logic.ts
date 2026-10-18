export type WorkbenchSidebarRevealReason = "destination" | "filter" | "reset" | null;

export function getWorkbenchSidebarRevealDecision({
  reason,
  fullyVisible,
  userScrolling,
  selectedInSidebar,
}: {
  reason: WorkbenchSidebarRevealReason;
  fullyVisible: boolean;
  userScrolling: boolean;
  selectedInSidebar: boolean;
}) {
  const reveal = reason !== null && !userScrolling;
  return {
    scroll: reveal && !fullyVisible,
    // A row the user just picked in the sidebar is already where they are looking.
    pulse: reveal && (reason === "filter" || (reason === "destination" && !selectedInSidebar)),
  };
}

export interface WorkbenchSidebarRevealSnapshot {
  readonly activeKey: string | null;
  readonly onlyActionable: boolean;
  readonly isSearching: boolean;
  readonly navigation: object | null;
}

export function getWorkbenchSidebarRevealReason({
  previous,
  next,
}: {
  previous: WorkbenchSidebarRevealSnapshot | null;
  next: WorkbenchSidebarRevealSnapshot;
}): WorkbenchSidebarRevealReason {
  if (!previous) return "reset";
  if (previous.onlyActionable !== next.onlyActionable) return "filter";
  if (previous.activeKey !== next.activeKey) return "destination";
  if (previous.navigation !== next.navigation) return "reset";
  if (previous.isSearching && !next.isSearching) return "reset";
  return null;
}

/** Identifies the sidebar destination, or null when nothing is selected. */
export function getWorkbenchSidebarActiveKey(ids: ReadonlyArray<string | null | undefined>) {
  return ids.some(Boolean) ? JSON.stringify(ids) : null;
}
