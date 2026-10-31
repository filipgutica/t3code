import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import type { EnvironmentId, PullRequestRef, ThreadId } from "@t3tools/contracts";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { useLocation, useParams } from "@tanstack/react-router";
import {
  WorkbenchAttentionProvider,
  useWorkbenchAttentionData,
} from "./WorkbenchAttentionProvider";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import {
  type PullRequestDetailTab,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";

export interface WorkbenchLinkedPullRequestThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly onOpen?: () => void;
}

export interface WorkbenchPullRequestSelection {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly initialTab?: PullRequestDetailTab;
  readonly linkedThread?: WorkbenchLinkedPullRequestThread;
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
      <RenderErrorBoundary fallback={children}>
        <WorkbenchPullRequestPreview>{children}</WorkbenchPullRequestPreview>
      </RenderErrorBoundary>
    </WorkbenchAttentionProvider>
  );
}

function WorkbenchPullRequestPreview({ children }: { children: ReactNode }) {
  const { href } = useLocation();
  const { refreshAttention } = useWorkbenchAttentionData();
  const routeThreadRef = useParams({ strict: false, select: resolveThreadRouteRef });
  // On the Board or Ticket page, the panel of the Thread the floating chat shows.
  const shownThreadRef = useWorkbenchFloatingChatStore((state) => state.shownThread);
  const panelThreadRef = routeThreadRef ?? shownThreadRef;
  const dockedPullRequestKey = useRightPanelStore((state) => {
    const surface = selectActiveRightPanelSurface(state.byThreadKey, panelThreadRef);
    return surface?.kind === "pull-request" && panelThreadRef
      ? JSON.stringify([panelThreadRef.environmentId, panelThreadRef.threadId, surface.id])
      : null;
  });
  const previousDockedPullRequestKey = useRef(dockedPullRequestKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- invalidates native PR inspection when the routed native panel changes or closes, including actions outside the Workbench sheet
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
  if (openedHref !== href) {
    setOpenedHref(href);
    setSelection(null);
  }
  const openSelection = (next: WorkbenchPullRequestSelection) => {
    if (panelThreadRef) {
      setSelection(null);
      useRightPanelStore.getState().openPullRequest(panelThreadRef, {
        projectId: next.reference.projectId,
        repository: next.reference.repository,
        number: next.reference.number,
        ...(next.reference.host === undefined ? {} : { host: next.reference.host }),
        ...(next.initialTab === undefined ? {} : { detailTab: next.initialTab }),
        ...(panelThreadRef.environmentId === next.environmentId
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
  };
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
