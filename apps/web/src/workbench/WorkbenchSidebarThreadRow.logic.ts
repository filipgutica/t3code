import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveThreadCurrentPullRequestLink,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadStatusPill,
} from "../components/Sidebar.logic";
import {
  linkedPullRequestSnapshotStatus,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
} from "../components/ThreadStatusIndicators";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { useRightPanelStore } from "../rightPanelStore";
import { useEnvironment } from "../state/environments";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import { useProject, useThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";
import { toastManager } from "../components/ui/toast";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import {
  resolveWorkbenchSidebarRepositoryLabel,
  resolveWorkbenchSidebarThreadPullRequests,
} from "./workbenchSidebarThread.logic";
import { filterWorkbenchThreadActionMenuItems } from "./workbenchThreadActionMenu";

type ThreadShell = ReturnType<typeof useThreadShell>;
type ThreadProject = ReturnType<typeof useProject>;
type ThreadEnvironment = ReturnType<typeof useEnvironment>;
type ThreadRef = ReturnType<typeof scopeThreadRef>;
type CurrentPullRequest = ReturnType<typeof resolveThreadCurrentPullRequestLink>;

export interface WorkbenchSidebarThreadRowData {
  shell: ThreadShell;
  project: ThreadProject;
  environment: ThreadEnvironment;
  providerEntry: ProviderInstanceEntry | null;
  lastVisitedAt: string | undefined;
  status: ReturnType<typeof resolveThreadStatusPill>;
  failed: boolean;
  unread: boolean;
  snoozed: boolean;
  pullRequests: ReturnType<typeof resolveWorkbenchSidebarThreadPullRequests>;
  pullRequestBadge: ReturnType<typeof resolveThreadPullRequestBadge>;
  currentPullRequest: CurrentPullRequest;
  pullRequestIndicator: ReturnType<typeof prStatusIndicator>;
  repositoryLabel: string | null;
}

function resolveProviderEntry(
  shell: ThreadShell,
  providers: ReturnType<typeof deriveProviderInstanceEntries>,
) {
  if (shell === null) return null;
  return (
    providers.find(
      (entry) =>
        entry.instanceId === (shell.session?.providerInstanceId ?? shell.modelSelection.instanceId),
    ) ?? null
  );
}

function resolveRepositoryLabel(project: ThreadProject) {
  return resolveWorkbenchSidebarRepositoryLabel(
    project ? { title: project.title, repositoryIdentity: project.repositoryIdentity } : null,
  );
}

function resolveThreadActivityState(shell: ThreadShell, lastVisitedAt: string | undefined) {
  if (shell === null) {
    return { status: null, failed: false, unread: false, snoozed: false };
  }
  return {
    status: resolveThreadStatusPill({ thread: { ...shell, lastVisitedAt } }),
    failed: resolveSidebarThreadStatus(shell) === "failed",
    unread: hasUnseenCompletion({ ...shell, lastVisitedAt }),
    snoozed: effectiveSnoozed(shell, { now: new Date().toISOString() }),
  };
}

function resolveThreadPullRequestState(
  pullRequests: ReturnType<typeof resolveWorkbenchSidebarThreadPullRequests>,
) {
  const pullRequestBadge = resolveThreadPullRequestBadge(pullRequests);
  const currentPullRequest = resolveThreadCurrentPullRequestLink(
    visibleThreadPullRequests(pullRequests),
  );
  const pullRequestStatus = currentPullRequest?.snapshot
    ? linkedPullRequestSnapshotStatus(currentPullRequest)
    : null;
  return {
    pullRequestBadge,
    currentPullRequest,
    pullRequestIndicator: prStatusIndicator(
      pullRequestStatus?.pr ?? null,
      pullRequestStatus?.sourceControlProvider,
    ),
  };
}

export function useWorkbenchSidebarThreadRowData({
  thread,
  threadRef,
}: {
  thread: WorkbenchSidebarThread;
  threadRef: ThreadRef;
}): WorkbenchSidebarThreadRowData {
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const environment = useEnvironment(thread.environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(thread.environmentId));
  const providerEntry = useMemo(
    () => resolveProviderEntry(shell, deriveProviderInstanceEntries(providers ?? [])),
    [providers, shell],
  );
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const activityState = resolveThreadActivityState(shell, lastVisitedAt);
  const pullRequests = useMemo(
    () => (shell ? resolveWorkbenchSidebarThreadPullRequests(shell) : []),
    [shell],
  );
  const pullRequestState = resolveThreadPullRequestState(pullRequests);

  return {
    shell,
    project,
    environment,
    providerEntry,
    lastVisitedAt,
    ...activityState,
    pullRequests,
    ...pullRequestState,
    repositoryLabel: resolveRepositoryLabel(project),
  };
}

export function useWorkbenchSidebarThreadRename(thread: WorkbenchSidebarThread) {
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const renameCommitted = useRef(false);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });

  const startRename = useCallback(() => {
    renameCommitted.current = false;
    setRenameTitle(thread.title);
  }, [thread.title]);

  const cancelRename = useCallback(() => {
    renameCommitted.current = true;
    setRenameTitle(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renameCommitted.current || renameTitle === null) return;
    renameCommitted.current = true;
    setRenameTitle(null);
    const title = renameTitle.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (title === thread.title) return;
    void updateMetadata({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const description = error instanceof Error ? error.message : "An error occurred.";
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description,
        });
      }
    });
  }, [renameTitle, thread.environmentId, thread.id, thread.title, updateMetadata]);

  return { renameTitle, setRenameTitle, startRename, cancelRename, commitRename };
}

export function useWorkbenchSidebarThreadInteraction({
  thread,
  threadRef,
  projectCwd,
  isActive,
  onOpenThread,
  startRename,
  currentPullRequest,
}: {
  thread: WorkbenchSidebarThread;
  threadRef: ThreadRef;
  projectCwd: string | null;
  isActive: boolean;
  onOpenThread: (thread: WorkbenchSidebarThread) => void;
  startRename: () => void;
  currentPullRequest: CurrentPullRequest;
}) {
  const openPrLink = useOpenPrLink(threadRef);
  const { openMenu } = useThreadActionMenu({
    threadRef,
    projectCwd,
    onStartRename: startRename,
    filterMenuItems: filterWorkbenchThreadActionMenuItems,
  });
  const handleOpenPullRequest = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const url = currentPullRequest?.url;
      if (!url) return;
      const openedInRightPanel = openPrLink(event, url, threadRef);
      if (openedInRightPanel && !isActive) onOpenThread(thread);
    },
    [currentPullRequest?.url, isActive, onOpenThread, openPrLink, thread, threadRef],
  );
  const handleOpenPullRequestStack = useCallback(() => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!isActive) onOpenThread(thread);
  }, [isActive, onOpenThread, thread, threadRef]);

  return { openMenu, handleOpenPullRequest, handleOpenPullRequestStack };
}
