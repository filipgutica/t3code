import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ClockIcon, MessageSquareIcon, PinIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  ThreadPullRequestBadgeControl,
  ThreadStatusLabel,
} from "../components/ThreadStatusIndicators";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { Input } from "../components/ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import {
  useWorkbenchSidebarThreadInteraction,
  useWorkbenchSidebarThreadRename,
  useWorkbenchSidebarThreadRowData,
  type WorkbenchSidebarThreadRowData,
} from "./WorkbenchSidebarThreadRow.logic";

function WorkbenchSidebarThreadRenameInput({
  thread,
  renameTitle,
  setRenameTitle,
  commitRename,
  cancelRename,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly renameTitle: string;
  readonly setRenameTitle: Dispatch<SetStateAction<string | null>>;
  readonly commitRename: () => void;
  readonly cancelRename: () => void;
}) {
  return (
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
          cancelRename();
        }
      }}
    />
  );
}

function WorkbenchSidebarThreadTitle({
  thread,
  data,
  isActive,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly isActive: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={`min-w-0 flex-1 truncate ${data.unread || isActive ? "font-medium text-sidebar-foreground" : "text-sidebar-muted-foreground/75"}`}
      >
        {thread.title}
      </span>
      {data.shell?.pinnedAt ? <PinIcon aria-label="Pinned" className="size-3 shrink-0" /> : null}
      {data.snoozed ? <ClockIcon aria-label="Snoozed" className="size-3 shrink-0" /> : null}
      {data.failed ? (
        <span className="text-[10px] text-red-600 dark:text-red-300">Failed</span>
      ) : data.status ? (
        <ThreadStatusLabel status={{ ...data.status, pulse: false }} />
      ) : null}
    </span>
  );
}

function WorkbenchSidebarThreadNavigation({
  thread,
  isActive,
  onOpenThread,
  data,
  openMenu,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly isActive: boolean;
  readonly onOpenThread: (thread: WorkbenchSidebarThread) => void;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly openMenu: (position: { x: number; y: number }) => void;
}) {
  return (
    <SidebarMenuButton
      aria-label={thread.title}
      aria-current={isActive ? "page" : undefined}
      className="h-auto min-h-12 min-w-0 flex-1 items-stretch"
      isActive={isActive}
      onClick={() => onOpenThread(thread)}
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
            environment={data.environment}
            project={data.project}
            providerEntry={data.providerEntry}
            pullRequests={data.pullRequests}
            shell={data.shell}
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
      {data.providerEntry ? (
        <ProviderInstanceIcon
          driverKind={data.providerEntry.driverKind}
          displayName={data.providerEntry.displayName}
          className={`mt-0.5 size-4 ${isActive ? "" : "opacity-75"}`}
          iconClassName="size-4"
        />
      ) : (
        <MessageSquareIcon className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <WorkbenchSidebarThreadTitle data={data} isActive={isActive} thread={thread} />
        <span
          className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground/80 ${data.pullRequestBadge ? "pe-14" : ""}`}
        >
          <span className="min-w-0 flex-1 truncate">{data.repositoryLabel ?? "Workspace"}</span>
        </span>
      </span>
    </SidebarMenuButton>
  );
}

function WorkbenchSidebarThreadPrBadge({
  data,
  onOpenPullRequest,
  onOpenPullRequestStack,
}: {
  readonly data: WorkbenchSidebarThreadRowData;
  readonly onOpenPullRequest: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  readonly onOpenPullRequestStack: () => void;
}) {
  if (!data.pullRequestBadge) return null;
  return (
    <span className="absolute end-2 bottom-2 z-10 flex items-center">
      <ThreadPullRequestBadgeControl
        variant="underline"
        badge={data.pullRequestBadge}
        number={data.currentPullRequest?.number}
        url={data.currentPullRequest?.url}
        status={data.pullRequestIndicator}
        onOpenStack={onOpenPullRequestStack}
        onOpenPullRequest={onOpenPullRequest}
      />
    </span>
  );
}

function WorkbenchSidebarThreadRowView({
  thread,
  isActive,
  onOpenThread,
  data,
  openMenu,
  onOpenPullRequest,
  onOpenPullRequestStack,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly isActive: boolean;
  readonly onOpenThread: (thread: WorkbenchSidebarThread) => void;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly openMenu: (position: { x: number; y: number }) => void;
  readonly onOpenPullRequest: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  readonly onOpenPullRequestStack: () => void;
}) {
  return (
    <div
      className={`workbench-sidebar-item-row relative flex min-w-0 items-center rounded-lg ${isActive ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <WorkbenchSidebarThreadNavigation
        data={data}
        isActive={isActive}
        onOpenThread={onOpenThread}
        openMenu={openMenu}
        thread={thread}
      />
      <WorkbenchSidebarThreadPrBadge
        data={data}
        onOpenPullRequest={onOpenPullRequest}
        onOpenPullRequestStack={onOpenPullRequestStack}
      />
    </div>
  );
}

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
  const data = useWorkbenchSidebarThreadRowData({ thread, threadRef });
  const rename = useWorkbenchSidebarThreadRename(thread);
  const interaction = useWorkbenchSidebarThreadInteraction({
    currentPullRequest: data.currentPullRequest,
    isActive,
    onOpenThread,
    projectCwd: data.project?.workspaceRoot ?? null,
    startRename: rename.startRename,
    thread,
    threadRef,
  });

  return (
    <SidebarMenuItem>
      {rename.renameTitle !== null ? (
        <WorkbenchSidebarThreadRenameInput
          cancelRename={rename.cancelRename}
          commitRename={rename.commitRename}
          renameTitle={rename.renameTitle}
          setRenameTitle={rename.setRenameTitle}
          thread={thread}
        />
      ) : (
        <WorkbenchSidebarThreadRowView
          data={data}
          isActive={isActive}
          onOpenPullRequest={interaction.handleOpenPullRequest}
          onOpenPullRequestStack={interaction.handleOpenPullRequestStack}
          onOpenThread={onOpenThread}
          openMenu={interaction.openMenu}
          thread={thread}
        />
      )}
    </SidebarMenuItem>
  );
}
