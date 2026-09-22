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
import { ClockIcon, MessageSquareIcon, MoreHorizontalIcon, PinIcon } from "lucide-react";
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
  ThreadPullRequestBadgeControl,
  ThreadStatusLabel,
} from "../components/ThreadStatusIndicators";
import { Input } from "../components/ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { useRightPanelStore } from "../rightPanelStore";
import { useEnvironment } from "../state/environments";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import { useProject, useThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import {
  resolveWorkbenchSidebarRepositoryLabel,
  resolveWorkbenchSidebarThreadPullRequests,
} from "./workbenchSidebarThread.logic";
import { filterWorkbenchThreadActionMenuItems } from "./workbenchThreadActionMenu";

/** Native thread behavior, presented inside the Workbench ticket hierarchy. */
export function WorkbenchSidebarThreadRow({
  thread,
  isActive,
  onOpenThread,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly isActive: boolean;
  readonly onOpenThread: (thread: WorkbenchSidebarThread) => void;
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const environment = useEnvironment(thread.environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(thread.environmentId));
  const providerEntry = useMemo<ProviderInstanceEntry | null>(() => {
    if (shell === null) return null;
    return (
      deriveProviderInstanceEntries(providers ?? []).find(
        (entry) =>
          entry.instanceId ===
          (shell.session?.providerInstanceId ?? shell.modelSelection.instanceId),
      ) ?? null
    );
  }, [providers, shell]);
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const openPrLink = useOpenPrLink(threadRef);
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const renameCommitted = useRef(false);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const startRename = useCallback(() => {
    renameCommitted.current = false;
    setRenameTitle(thread.title);
  }, [thread.title]);
  const { openMenu } = useThreadActionMenu({
    threadRef,
    projectCwd: project?.workspaceRoot ?? null,
    onStartRename: startRename,
    filterMenuItems: filterWorkbenchThreadActionMenuItems,
  });
  const commitRename = () => {
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
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };
  const status = shell ? resolveThreadStatusPill({ thread: { ...shell, lastVisitedAt } }) : null;
  const failed = shell !== null && resolveSidebarThreadStatus(shell) === "failed";
  const unread = shell !== null && hasUnseenCompletion({ ...shell, lastVisitedAt });
  const snoozed = shell !== null && effectiveSnoozed(shell, { now: new Date().toISOString() });
  const pullRequests = useMemo(
    () => (shell ? resolveWorkbenchSidebarThreadPullRequests(shell) : []),
    [shell],
  );
  const pullRequestBadge = resolveThreadPullRequestBadge(pullRequests);
  const currentPullRequest = resolveThreadCurrentPullRequestLink(
    visibleThreadPullRequests(pullRequests),
  );
  const pullRequestStatus = currentPullRequest?.snapshot
    ? linkedPullRequestSnapshotStatus(currentPullRequest)
    : null;
  const pullRequestIndicator = prStatusIndicator(
    pullRequestStatus?.pr ?? null,
    pullRequestStatus?.sourceControlProvider,
  );
  const repositoryLabel = resolveWorkbenchSidebarRepositoryLabel(
    project ? { title: project.title, repositoryIdentity: project.repositoryIdentity } : null,
  );
  const handleOpenPullRequest = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
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
  return (
    <SidebarMenuItem className="group/thread-row">
      {renameTitle !== null ? (
        <Input
          aria-label={`Rename Thread ${thread.title}`}
          autoFocus
          value={renameTitle}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setRenameTitle(event.currentTarget.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              renameCommitted.current = true;
              setRenameTitle(null);
            }
          }}
        />
      ) : (
        <div className="flex min-w-0 items-center">
          <SidebarMenuButton
            aria-label={thread.title}
            aria-current={isActive ? "page" : undefined}
            className="h-auto min-h-12 min-w-0 flex-1 items-stretch"
            isActive={isActive}
            onClick={() => onOpenThread(thread)}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu({ x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                openMenu({ x: bounds.left, y: bounds.bottom });
              }
            }}
            size="lg"
            tooltip={{
              align: "start",
              children: (
                <WorkbenchSidebarThreadPreview
                  environment={environment}
                  project={project}
                  providerEntry={providerEntry}
                  pullRequests={pullRequests}
                  shell={shell}
                  thread={thread}
                />
              ),
              hidden: false,
              side: "right",
              sideOffset: 4,
              variant: "glass",
              className: "max-w-80 whitespace-normal [&_[data-slot=tooltip-viewport]]:p-0",
            }}
          >
            <MessageSquareIcon className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`min-w-0 flex-1 truncate ${unread ? "font-medium text-sidebar-foreground" : "text-sidebar-muted-foreground/75"}`}
                >
                  {thread.title}
                </span>
                {shell?.pinnedAt ? (
                  <PinIcon aria-label="Pinned" className="size-3 shrink-0" />
                ) : null}
                {snoozed ? <ClockIcon aria-label="Snoozed" className="size-3 shrink-0" /> : null}
                {failed ? (
                  <span className="text-[10px] text-red-600 dark:text-red-300">Failed</span>
                ) : status ? (
                  <ThreadStatusLabel status={{ ...status, pulse: false }} />
                ) : null}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground/60">
                <span className="min-w-0 flex-1 truncate">{repositoryLabel ?? "Workspace"}</span>
              </span>
            </span>
          </SidebarMenuButton>
          {pullRequestBadge ? (
            <span className="flex shrink-0 self-stretch items-end pb-2">
              <ThreadPullRequestBadgeControl
                variant="underline"
                badge={pullRequestBadge}
                number={currentPullRequest?.number}
                url={currentPullRequest?.url}
                status={pullRequestIndicator}
                onOpenStack={handleOpenPullRequestStack}
                onOpenPullRequest={handleOpenPullRequest}
              />
            </span>
          ) : null}
          <button
            aria-label={`Actions for Thread ${thread.title}`}
            className="size-6 shrink-0 rounded text-sidebar-muted-foreground opacity-0 hover:bg-sidebar-row-hover focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/thread-row:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              openMenu({ x: bounds.left, y: bounds.bottom });
            }}
            type="button"
          >
            <MoreHorizontalIcon className="mx-auto size-4" />
          </button>
        </div>
      )}
    </SidebarMenuItem>
  );
}
