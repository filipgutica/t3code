import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from "react";

export interface WorkbenchPullRequestSelection {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
}

const WorkbenchPullRequestSheet = lazy(() =>
  import("./WorkbenchPullRequestSheet").then((module) => ({
    default: module.WorkbenchPullRequestSheet,
  })),
);
const OpenWorkbenchPullRequestContext = createContext<
  ((selection: WorkbenchPullRequestSelection) => void) | undefined
>(undefined);

export const useOpenWorkbenchPullRequest = () => useContext(OpenWorkbenchPullRequestContext);

/** Owns the preview above transient sidebar menus and the selected ticket. */
export function WorkbenchPullRequestPreviewProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<WorkbenchPullRequestSelection | null>(null);
  return (
    <OpenWorkbenchPullRequestContext value={setSelection}>
      {children}
      {selection ? (
        <ChangeRequestLinkOpenProvider value={setSelection}>
          <Suspense fallback={null}>
            <WorkbenchPullRequestSheet
              selection={selection}
              onSelect={setSelection}
              onClose={() => setSelection(null)}
            />
          </Suspense>
        </ChangeRequestLinkOpenProvider>
      ) : null}
    </OpenWorkbenchPullRequestContext>
  );
}
