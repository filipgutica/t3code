import { useMemo, type ReactNode } from "react";
import { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";

import {
  HostIntegrationsContext,
  ThreadPresentationPolicyContext,
  type CommandPaletteContributionsProps,
  type HostIntegrations,
} from "../hostIntegrations";
import { WorkbenchComposerPendingReviewComments } from "./WorkbenchComposerPendingReviewComments";
import { WorkbenchPullRequestPreviewProvider } from "./WorkbenchPullRequestPreview";
import { WorkbenchSidebarSlot } from "./WorkbenchSidebarSlot";
import { WorkbenchSidebarUtilityItem } from "./WorkbenchSidebarUtilityItem";
import { WorkbenchThreadBreadcrumb } from "./WorkbenchThreadBreadcrumb";
import { WorkbenchThreadPreparationGate } from "./WorkbenchThreadPreparationGate";
import {
  getWorkbenchDesktopUpdateReleaseHistoryUrl,
  getWorkbenchDesktopUpdateReleaseUrl,
} from "./desktopUpdateRelease";
import { useWorkbenchCommandPaletteActions } from "./useWorkbenchCommandPaletteActions";
import {
  createWorkbenchThreadPresentationPolicy,
  useWorkbenchTicketPreparations,
  useWorkbenchTicketPreparationRefresh,
} from "./useWorkbenchTicketPreparations";
import { resolveWorkbenchReviewCommentTitle } from "./workbenchComposerTitle";
import { isWorkbenchSidebarPage } from "./workbenchNavigation";
import { isWorkbenchTicketReviewComment } from "./workbenchTicketContext";

function WorkbenchCommandPaletteContributions({
  children,
  ...input
}: CommandPaletteContributionsProps) {
  const actions = useWorkbenchCommandPaletteActions(input);
  return children(actions);
}

const WORKBENCH_HOST_INTEGRATIONS: HostIntegrations = {
  SidebarContent: WorkbenchSidebarSlot,
  SidebarUtility: WorkbenchSidebarUtilityItem,
  ThreadRouteContent: WorkbenchThreadPreparationGate,
  ThreadBreadcrumb: WorkbenchThreadBreadcrumb,
  PendingReviewAttachments: WorkbenchComposerPendingReviewComments,
  CommandPaletteContributions: WorkbenchCommandPaletteContributions,
  isSidebarUtilityPage: isWorkbenchSidebarPage,
  isReviewCommentReferenceHidden: isWorkbenchTicketReviewComment,
  reviewCommentTitle: resolveWorkbenchReviewCommentTitle,
  ...(import.meta.env.VITE_T3CODE_WORKBENCH_BUILD
    ? {
        codexAuthHandoffUrl: (input, development) =>
          codexAuthHandoffUrl(input, development, "t3code-workbench"),
        desktopReleaseLinks: {
          releaseUrl: getWorkbenchDesktopUpdateReleaseUrl,
          historyUrl: getWorkbenchDesktopUpdateReleaseHistoryUrl(),
        },
      }
    : {}),
};

function WorkbenchPreparationRefresh() {
  useWorkbenchTicketPreparationRefresh();
  return null;
}

function WorkbenchThreadPresentation({
  children,
  refreshPreparations,
}: {
  readonly children: ReactNode;
  readonly refreshPreparations: boolean;
}) {
  const preparations = useWorkbenchTicketPreparations();
  const policy = useMemo(
    () => createWorkbenchThreadPresentationPolicy(preparations),
    [preparations],
  );
  return (
    <ThreadPresentationPolicyContext value={policy}>
      {refreshPreparations ? <WorkbenchPreparationRefresh /> : null}
      {children}
    </ThreadPresentationPolicyContext>
  );
}

/** Installs the overlay once; native components consume only the host's typed slots. */
export function WorkbenchHostProvider({
  children,
  refreshPreparations = true,
}: {
  readonly children: ReactNode;
  readonly refreshPreparations?: boolean;
}) {
  return (
    <HostIntegrationsContext value={WORKBENCH_HOST_INTEGRATIONS}>
      <WorkbenchThreadPresentation refreshPreparations={refreshPreparations}>
        <WorkbenchPullRequestPreviewProvider>{children}</WorkbenchPullRequestPreviewProvider>
      </WorkbenchThreadPresentation>
    </HostIntegrationsContext>
  );
}
