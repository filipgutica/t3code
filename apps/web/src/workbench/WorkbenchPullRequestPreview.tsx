import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import type { EnvironmentId, PullRequestRef, ThreadId } from "@t3tools/contracts";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { useLocation, useParams } from "@tanstack/react-router";
import type { PullRequestDetailFocus } from "../components/pullRequest/PullRequestDetailPanel";
import {
  WorkbenchAttentionProvider,
  useWorkbenchAttentionData,
} from "./WorkbenchAttentionProvider";
import { resolveThreadRouteRef } from "../threadRoutes";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";

export interface WorkbenchLinkedPullRequestThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly onOpen?: () => void;
}

export interface WorkbenchPullRequestSelection {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly linkedThread?: WorkbenchLinkedPullRequestThread;
  readonly focus?: PullRequestDetailFocus;
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
  return (
    <WorkbenchAttentionProvider>
      <WorkbenchPullRequestPreview>{children}</WorkbenchPullRequestPreview>
    </WorkbenchAttentionProvider>
  );
}

function WorkbenchPullRequestPreview({ children }: { children: ReactNode }) {
  const { href } = useLocation();
  const { refreshAttention } = useWorkbenchAttentionData();
  const routeThreadRef = useParams({ strict: false, select: resolveThreadRouteRef });
  const dockedPullRequestKey = useRightPanelStore((state) => {
    const surface = selectActiveRightPanelSurface(state.byThreadKey, routeThreadRef);
    return surface?.kind === "pull-request" && routeThreadRef
      ? JSON.stringify([routeThreadRef.environmentId, routeThreadRef.threadId, surface.id])
      : null;
  });
  const previousDockedPullRequestKey = useRef(dockedPullRequestKey);
  useEffect(() => {
    if (
      previousDockedPullRequestKey.current !== null &&
      previousDockedPullRequestKey.current !== dockedPullRequestKey
    ) {
      refreshAttention();
    }
    previousDockedPullRequestKey.current = dockedPullRequestKey;
  }, [dockedPullRequestKey, refreshAttention]);
  const [selection, setSelection] = useState<WorkbenchPullRequestSelection | null>(null);
  const [openedHref, setOpenedHref] = useState(href);
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = selection !== null;
    if (wasOpen.current && !open) refreshAttention();
    wasOpen.current = open;
  }, [selection, refreshAttention]);
  if (openedHref !== href) {
    setOpenedHref(href);
    setSelection(null);
  }
  const openSelection = useCallback(
    (next: WorkbenchPullRequestSelection) => {
      // Focused attention destinations retain the sheet's focus and close-refresh lifecycle.
      if (routeThreadRef && next.focus === undefined) {
        setSelection(null);
        useRightPanelStore.getState().openPullRequest(routeThreadRef, {
          projectId: next.reference.projectId,
          repository: next.reference.repository,
          number: next.reference.number,
          ...(next.reference.host === undefined ? {} : { host: next.reference.host }),
          ...(routeThreadRef.environmentId === next.environmentId
            ? {}
            : { environmentId: next.environmentId }),
        });
        return;
      }
      setSelection((current) => ({
        ...next,
        ...(next.linkedThread
          ? {}
          : current?.linkedThread &&
              current.environmentId === next.environmentId &&
              current.reference.projectId === next.reference.projectId &&
              current.reference.host?.toLowerCase() === next.reference.host?.toLowerCase() &&
              current.reference.repository.toLowerCase() ===
                next.reference.repository.toLowerCase() &&
              current.reference.number === next.reference.number
            ? { linkedThread: current.linkedThread }
            : {}),
      }));
    },
    [routeThreadRef],
  );
  return (
    <OpenWorkbenchPullRequestContext value={openSelection}>
      {children}
      {selection ? (
        <ChangeRequestLinkOpenProvider value={openSelection}>
          <Suspense fallback={null}>
            <WorkbenchPullRequestSheet
              selection={selection}
              onSelect={openSelection}
              onClose={() => {
                setSelection(null);
              }}
            />
          </Suspense>
        </ChangeRequestLinkOpenProvider>
      ) : null}
    </OpenWorkbenchPullRequestContext>
  );
}
