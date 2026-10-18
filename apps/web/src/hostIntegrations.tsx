import type {
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import type { AsyncResult, Atom } from "effect/reactivity";
import type { CodexAuthHandoff } from "@t3tools/shared/codexAuthHandoff";
import { createContext, useContext, type ComponentType, type ReactNode } from "react";

import type { CommandPaletteActionItem } from "./components/CommandPalette.logic";
import type { ReviewCommentContext } from "./reviewCommentContext";

interface SidebarContentProps {
  readonly pathname: string;
  readonly isElectron: boolean;
  readonly children: ReactNode;
}

interface SidebarUtilityProps {
  readonly render: (props: {
    readonly icon: ReactNode;
    readonly label: string;
    readonly onClick: () => void;
  }) => ReactNode;
}

interface ThreadRouteContentProps {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}

interface ThreadBreadcrumbProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

interface PendingReviewAttachmentsProps {
  readonly comments: ReadonlyArray<ReviewCommentContext>;
  readonly onRemove: (commentId: string) => void;
  readonly className?: string;
}

export interface CommandPaletteContributionsProps {
  readonly thread:
    | { readonly environmentId: EnvironmentId; readonly id: ThreadId }
    | null
    | undefined;
  readonly draftEnvironmentId: EnvironmentId | undefined;
  readonly children: (actions: ReadonlyArray<CommandPaletteActionItem>) => ReactNode;
}

export interface DesktopReleaseLinks {
  readonly releaseUrl: (version: string) => string;
  readonly historyUrl: string;
}

/** Current application composition slots. Native consumers work without an overlay. */
export interface HostIntegrations {
  readonly SidebarContent?: ComponentType<SidebarContentProps>;
  readonly SidebarUtility?: ComponentType<SidebarUtilityProps>;
  readonly ThreadRouteContent?: ComponentType<ThreadRouteContentProps>;
  readonly ThreadBreadcrumb?: ComponentType<ThreadBreadcrumbProps>;
  readonly PendingReviewAttachments?: ComponentType<PendingReviewAttachmentsProps>;
  readonly CommandPaletteContributions?: ComponentType<CommandPaletteContributionsProps>;
  readonly isSidebarUtilityPage?: (pathname: string) => boolean;
  readonly isReviewCommentReferenceHidden?: (comment: ReviewCommentContext) => boolean;
  readonly reviewCommentTitle?: (comment: ReviewCommentContext) => string | null;
  readonly desktopReleaseLinks?: DesktopReleaseLinks;
  /** Whether update actions can target npm-managed servers. Native hosts default to true. */
  readonly allowNpmServerUpdates?: boolean;
  /** includeSsh requires an explicit check because opening a tunnel can start a remote server. */
  readonly outdatedServerDescriptor?: (
    environmentId: EnvironmentId,
    includeSsh?: boolean,
  ) => Atom.Atom<AsyncResult.AsyncResult<ExecutionEnvironmentDescriptor | null, unknown>>;
  readonly codexAuthHandoffUrl?: (input: CodexAuthHandoff, development: boolean) => string;
}

const NATIVE_HOST_INTEGRATIONS: HostIntegrations = {};
export const HostIntegrationsContext = createContext<HostIntegrations>(NATIVE_HOST_INTEGRATIONS);
export const useHostIntegrations = () => useContext(HostIntegrationsContext);

// Keep changing list policy separate from stable component slots: preparation refreshes
// should update lists and notifications, not the full application shell or conversation.
export interface ThreadPresentationPolicy {
  readonly isVisible: (threadRef: ScopedThreadRef) => boolean;
  readonly canNotify: (threadRef: ScopedThreadRef) => boolean;
}

export const ThreadPresentationPolicyContext = createContext<ThreadPresentationPolicy | null>(null);
export const useThreadPresentationPolicy = () => useContext(ThreadPresentationPolicyContext);

export function filterVisibleThreads<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: ReadonlyArray<T>, policy: ThreadPresentationPolicy | null): ReadonlyArray<T> {
  return policy === null
    ? threads
    : threads.filter((thread) =>
        policy.isVisible({ environmentId: thread.environmentId, threadId: thread.id }),
      );
}

/** Native projections retain ordering and records; overlays decide only visibility. */
export function useVisibleThreads<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: ReadonlyArray<T>) {
  const policy = useThreadPresentationPolicy();
  return filterVisibleThreads(threads, policy);
}

export function HostSidebarContent(props: SidebarContentProps) {
  const Slot = useHostIntegrations().SidebarContent;
  return Slot ? <Slot {...props} /> : props.children;
}

export function HostSidebarUtility(props: SidebarUtilityProps) {
  const Slot = useHostIntegrations().SidebarUtility;
  return Slot ? <Slot {...props} /> : null;
}

export function HostThreadRouteContent(props: ThreadRouteContentProps) {
  const Slot = useHostIntegrations().ThreadRouteContent;
  return Slot ? <Slot {...props} /> : props.children;
}

export function HostThreadBreadcrumb(props: ThreadBreadcrumbProps) {
  const Slot = useHostIntegrations().ThreadBreadcrumb;
  return Slot ? <Slot {...props} /> : null;
}

export function HostPendingReviewAttachments(props: PendingReviewAttachmentsProps) {
  const Slot = useHostIntegrations().PendingReviewAttachments;
  return Slot ? <Slot {...props} /> : null;
}

const NO_COMMAND_ACTIONS: ReadonlyArray<CommandPaletteActionItem> = [];
export function HostCommandPaletteContributions(props: CommandPaletteContributionsProps) {
  const Slot = useHostIntegrations().CommandPaletteContributions;
  return Slot ? <Slot {...props} /> : props.children(NO_COMMAND_ACTIONS);
}
