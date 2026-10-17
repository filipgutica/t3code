import { useMemo, type ComponentType, type ReactNode } from "react";
import { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";

import {
  HostIntegrationsContext,
  ThreadPresentationPolicyContext,
  type CommandPaletteContributionsProps,
  type HostIntegrations,
  type ThreadPresentationPolicy,
} from "../hostIntegrations";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
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
import { isWorkbenchTicketReviewComment } from "./workbenchTicketContext";
import { workbenchOutdatedServerDescriptor } from "./workbenchOutdatedServerDescriptor";

function WorkbenchCommandPaletteContributions({
  children,
  ...input
}: CommandPaletteContributionsProps) {
  const actions = useWorkbenchCommandPaletteActions(input);
  return children(actions);
}

function containWorkbenchSlot<Props extends object>(Slot: ComponentType<Props>) {
  return function WorkbenchSlot(props: Props) {
    return (
      <RenderErrorBoundary fallback={null}>
        <Slot {...props} />
      </RenderErrorBoundary>
    );
  };
}

const WORKBENCH_HOST_INTEGRATIONS: HostIntegrations = {
  SidebarContent: containWorkbenchSlot(WorkbenchSidebarSlot),
  SidebarUtility: containWorkbenchSlot(WorkbenchSidebarUtilityItem),
  ThreadRouteContent: containWorkbenchSlot(WorkbenchThreadPreparationGate),
  ThreadBreadcrumb: containWorkbenchSlot(WorkbenchThreadBreadcrumb),
  PendingReviewAttachments: containWorkbenchSlot(WorkbenchComposerPendingReviewComments),
  CommandPaletteContributions: containWorkbenchSlot(WorkbenchCommandPaletteContributions),
  isReviewCommentReferenceHidden: isWorkbenchTicketReviewComment,
  reviewCommentTitle: resolveWorkbenchReviewCommentTitle,
  ...(import.meta.env.VITE_T3CODE_WORKBENCH_BUILD
    ? {
        // Workbench release versions do not identify upstream t3 releases on npm.
        allowNpmServerUpdates: false,
        outdatedServerDescriptor: workbenchOutdatedServerDescriptor,
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

// Without a readable preparation index, no Thread can safely be classified as native.
// Keep the shell usable but hide lists and suppress notifications until a remount.
const FAILED_PRESENTATION_POLICY: ThreadPresentationPolicy = {
  isVisible: () => false,
  canNotify: () => false,
};

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
  const content = (
    <RenderErrorBoundary fallback={children}>
      <WorkbenchPullRequestPreviewProvider>{children}</WorkbenchPullRequestPreviewProvider>
    </RenderErrorBoundary>
  );
  return (
    <HostIntegrationsContext value={WORKBENCH_HOST_INTEGRATIONS}>
      <RenderErrorBoundary
        fallback={
          <ThreadPresentationPolicyContext value={FAILED_PRESENTATION_POLICY}>
            {content}
          </ThreadPresentationPolicyContext>
        }
      >
        <WorkbenchThreadPresentation refreshPreparations={refreshPreparations}>
          {content}
        </WorkbenchThreadPresentation>
      </RenderErrorBoundary>
    </HostIntegrationsContext>
  );
}
