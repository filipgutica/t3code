import { useMemo, type ComponentType, type ReactNode } from "react";
import { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";

import {
  HostIntegrationsContext,
  ThreadPresentationPolicyContext,
  type CommandPaletteContributionsProps,
  type HostIntegrations,
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

function containWorkbenchSlot<Props extends object>(
  Slot: ComponentType<Props>,
  fallback: (props: Props) => ReactNode = () => null,
) {
  return function WorkbenchSlot(props: Props) {
    return (
      <RenderErrorBoundary fallback={fallback(props)}>
        <Slot {...props} />
      </RenderErrorBoundary>
    );
  };
}

const WORKBENCH_HOST_INTEGRATIONS: HostIntegrations = {
  SidebarContent: containWorkbenchSlot(WorkbenchSidebarSlot, (props) => props.children),
  SidebarUtility: containWorkbenchSlot(WorkbenchSidebarUtilityItem),
  ThreadRouteContent: containWorkbenchSlot(
    WorkbenchThreadPreparationGate,
    (props) => props.children,
  ),
  ThreadBreadcrumb: containWorkbenchSlot(WorkbenchThreadBreadcrumb),
  PendingReviewAttachments: containWorkbenchSlot(WorkbenchComposerPendingReviewComments),
  CommandPaletteContributions: containWorkbenchSlot(WorkbenchCommandPaletteContributions, (props) =>
    props.children([]),
  ),
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
      <RenderErrorBoundary fallback={content}>
        <WorkbenchThreadPresentation refreshPreparations={refreshPreparations}>
          {content}
        </WorkbenchThreadPresentation>
      </RenderErrorBoundary>
    </HostIntegrationsContext>
  );
}
