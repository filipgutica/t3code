import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { ClockIcon, MessageSquareIcon, MoreHorizontalIcon, PinIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadStatusPill,
} from "../components/Sidebar.logic";
import { ThreadStatusLabel } from "../components/ThreadStatusIndicators";
import { Input } from "../components/ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import { useProject, useThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";

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
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
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
            className={`h-9 min-w-0 flex-1 gap-2 rounded-md px-2.5 text-sm ${unread ? "font-medium text-sidebar-foreground" : "text-sidebar-muted-foreground/75"}`}
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
            size="sm"
            tooltip={{ children: thread.title, hidden: false }}
          >
            <MessageSquareIcon />
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            {shell?.pinnedAt ? <PinIcon aria-label="Pinned" className="size-3 shrink-0" /> : null}
            {snoozed ? <ClockIcon aria-label="Snoozed" className="size-3 shrink-0" /> : null}
            {failed ? (
              <span className="text-[10px] text-red-600 dark:text-red-300">Failed</span>
            ) : status ? (
              <ThreadStatusLabel status={{ ...status, pulse: false }} />
            ) : null}
          </SidebarMenuButton>
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
