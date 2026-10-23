import { WorkbenchThreadExecutionStatus } from "./WorkbenchThreadExecutionStatus";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { WorkbenchTicketId } from "@t3tools/contracts";
import {
  AlarmClockOffIcon,
  CheckIcon,
  FolderGit2Icon,
  MessageSquareIcon,
  PinIcon,
  PinOffIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";

import {
  ThreadPullRequestBadgeControl,
  resolveThreadPullRequestBadgePresentation,
} from "../components/ThreadStatusIndicators";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { InlineButton } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarMenuItem } from "../components/ui/sidebar";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import { WorkbenchSidebarQuickAction } from "./WorkbenchSidebarRowActions";
import { WorkbenchSidebarRowNavigation } from "./WorkbenchSidebarRowNavigation";
import { WorkbenchThreadAttentionBadge } from "./WorkbenchTicketAttention";
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
  isActive,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly isActive: boolean;
}) {
  return (
    <span data-workbench-sidebar-title="">
      <MessageSquareIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
      <span
        className={`min-w-0 flex-1 truncate ${isActive ? "font-medium text-sidebar-foreground" : "font-normal text-sidebar-foreground/85"}`}
      >
        {thread.title}
      </span>
    </span>
  );
}

function WorkbenchSidebarThreadMetadata({
  data,
}: {
  readonly data: WorkbenchSidebarThreadRowData;
}) {
  const branch = data.shell?.branch;
  const context = branch || data.repositoryLabel || "Workspace";
  const middle = Math.ceil(context.length / 2);
  return (
    <span data-workbench-sidebar-metadata-label="">
      <span data-workbench-sidebar-metadata-icon="" aria-hidden>
        {data.project ? (
          <ProjectFavicon project={data.project} className="size-3.5" />
        ) : (
          <FolderGit2Icon className="size-3" />
        )}
      </span>
      <span data-workbench-sidebar-branch="">
        <span data-workbench-sidebar-branch-prefix="">
          {branch ? context.slice(0, middle) : context}
        </span>
        {branch ? (
          <span data-workbench-sidebar-branch-suffix="">
            <span>{context.slice(middle)}</span>
          </span>
        ) : null}
      </span>
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
    <WorkbenchSidebarRowNavigation
      label={`${thread.title}${data.failed ? ", failed" : ""}${data.shell?.pinnedAt ? ", pinned" : ""}${data.snoozed ? ", snoozed" : ""}`}
      isActive={isActive}
      onSelect={() => onOpenThread(thread)}
      openMenu={openMenu}
      preview={
        <WorkbenchSidebarThreadPreview
          environment={data.environment}
          project={data.project}
          providerEntry={data.providerEntry}
          pullRequests={data.pullRequests}
          shell={data.shell}
          thread={thread}
        />
      }
    >
      <WorkbenchSidebarThreadTitle isActive={isActive} thread={thread} />
      <WorkbenchSidebarThreadMetadata data={data} />
    </WorkbenchSidebarRowNavigation>
  );
}

/** Native's pin indicator: hover reveals Unpin when the user can operate the Thread. */
function WorkbenchSidebarThreadPinIndicator({
  onUnpin,
}: {
  readonly onUnpin: (() => void) | null;
}) {
  if (!onUnpin) {
    return (
      <PinIcon
        aria-label="Pinned"
        role="img"
        className="size-3 shrink-0 text-muted-foreground/65"
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Unpin thread"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnpin();
            }}
            className="group/unpin inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <PinIcon
          aria-hidden
          className="size-3 shrink-0 group-hover/unpin:hidden group-focus-visible/unpin:hidden"
        />
        <PinOffIcon
          aria-hidden
          className="hidden size-3 shrink-0 group-hover/unpin:block group-focus-visible/unpin:block"
        />
      </TooltipTrigger>
      <TooltipPopup>Unpin thread</TooltipPopup>
    </Tooltip>
  );
}

function WorkbenchSidebarThreadPrBadge({
  thread,
  data,
  onOpenPullRequest,
  onOpenPullRequestStack,
}: {
  readonly data: WorkbenchSidebarThreadRowData;
  readonly onOpenPullRequest: (event: MouseEvent<HTMLElement>) => void;
  readonly onOpenPullRequestStack: () => void;
  readonly thread: WorkbenchSidebarThread;
}) {
  const [chooserOpen, setChooserOpen] = useState(false);
  if (!data.pullRequestBadge) return null;
  const pullRequests = visibleThreadPullRequests(data.pullRequests);
  const presentation = resolveThreadPullRequestBadgePresentation({
    badge: data.pullRequestBadge,
    number: data.currentPullRequest?.number,
    url: data.currentPullRequest?.url,
    status: data.pullRequestIndicator,
  });
  if (pullRequests.length > 1 && presentation) {
    return (
      <span data-workbench-sidebar-pr-control="" className="flex shrink-0 items-center">
        <Popover open={chooserOpen} onOpenChange={setChooserOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={`inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-xs tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-ring ${presentation.toneClassName}`}
                aria-label={`Show linked pull requests for ${thread.title}: ${presentation.label}`}
              />
            }
          >
            <presentation.Icon aria-hidden className="size-3 shrink-0" />
            {presentation.text}
          </PopoverTrigger>
          <PopoverPopup
            side="right"
            align="start"
            className="w-72 max-h-[min(32rem,80vh)] overflow-y-auto"
            aria-label={`Linked pull requests for ${thread.title}`}
          >
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">Linked from Thread</p>
              {pullRequests.map((pullRequest) => (
                <WorkbenchPullRequestLink
                  key={pullRequest.url}
                  environmentId={thread.environmentId}
                  linkedThread={{ threadId: thread.id, title: thread.title }}
                  onSelect={() => setChooserOpen(false)}
                  pullRequest={{
                    ...pullRequest,
                    ...(data.shell ? { projectId: data.shell.projectId } : {}),
                    ...(pullRequest.snapshot
                      ? {
                          title: pullRequest.snapshot.title,
                          state: pullRequest.snapshot.state,
                          isDraft: pullRequest.snapshot.isDraft,
                        }
                      : {}),
                  }}
                />
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      </span>
    );
  }
  return (
    <span data-workbench-sidebar-pr-control="" className="flex shrink-0 items-center">
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={data.pullRequestBadge}
        pullRequests={data.pullRequests}
        number={data.currentPullRequest?.number}
        url={data.currentPullRequest?.url}
        status={data.pullRequestIndicator}
        onOpenList={onOpenPullRequestStack}
        onOpenPullRequest={onOpenPullRequest}
      />
    </span>
  );
}

function WorkbenchSidebarThreadMetadataControls({
  thread,
  isActive,
  data,
  actions,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly isActive: boolean;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly actions: ReturnType<typeof useWorkbenchSidebarThreadInteraction>;
}) {
  return (
    <span data-workbench-sidebar-metadata-controls="">
      {data.shell?.pinnedAt ? (
        <WorkbenchSidebarThreadPinIndicator onUnpin={actions.canUnpin ? actions.unpin : null} />
      ) : null}
      <WorkbenchSidebarThreadPrBadge
        thread={thread}
        data={data}
        onOpenPullRequest={actions.handleOpenPullRequest}
        onOpenPullRequestStack={actions.handleOpenPullRequestStack}
      />
      <span data-workbench-sidebar-provider-end="">
        {data.providerEntry ? (
          <ProviderInstanceIcon
            driverKind={data.providerEntry.driverKind}
            displayName={data.providerEntry.displayName}
            className={`size-3.5 ${isActive ? "" : "opacity-75"}`}
            iconClassName="size-3.5"
          />
        ) : null}
      </span>
    </span>
  );
}

type WorkbenchSidebarThreadSlotProps = {
  readonly thread: WorkbenchSidebarThread;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly actions: ReturnType<typeof useWorkbenchSidebarThreadInteraction>;
};

function WorkbenchSidebarThreadSlotStatus({ data }: Pick<WorkbenchSidebarThreadSlotProps, "data">) {
  if (data.wakeLabel !== null) {
    return (
      <span data-workbench-sidebar-native-status="" className="text-info-foreground tabular-nums">
        {data.wakeLabel}
      </span>
    );
  }
  if (!data.status) return null;
  return (
    <span data-workbench-sidebar-native-status="">
      <WorkbenchThreadExecutionStatus
        compact
        status={data.status.presentation}
        startedAt={data.status.startedAt}
      />
    </span>
  );
}

function WorkbenchSidebarThreadSlotAction({
  thread,
  data,
  actions,
}: WorkbenchSidebarThreadSlotProps) {
  if (data.wakeLabel !== null) {
    return (
      <WorkbenchSidebarQuickAction
        label={`Wake thread now: ${thread.title}`}
        Icon={AlarmClockOffIcon}
        onSelect={actions.wake}
      />
    );
  }
  return (
    <WorkbenchSidebarQuickAction
      label={`${actions.isSettled ? "Unsettle" : "Settle"}: ${thread.title}`}
      Icon={actions.isSettled ? RotateCcwIcon : CheckIcon}
      onSelect={actions.toggleSettlement}
      disabled={actions.settlementBusy}
    />
  );
}

/** Like native, a snoozed row shows its wake time and offers Wake instead of Settle on hover. */
function WorkbenchSidebarThreadStatusSlot({
  ticketId,
  ...props
}: WorkbenchSidebarThreadSlotProps & { readonly ticketId: WorkbenchTicketId }) {
  const { thread, data, actions } = props;
  const hasAction = data.wakeLabel !== null ? actions.canWake : actions.canToggleSettlement;
  return (
    <span data-workbench-sidebar-slot={hasAction ? "actions" : ""}>
      <WorkbenchThreadAttentionBadge
        environmentId={thread.environmentId}
        ticketId={ticketId}
        threadId={thread.id}
        threadTitle={thread.title}
        nativeStatusKind={data.status?.kind ?? null}
        nativeStatus={<WorkbenchSidebarThreadSlotStatus data={data} />}
        side="right"
      />
      {hasAction ? (
        <span data-workbench-sidebar-quick-actions="">
          <WorkbenchSidebarThreadSlotAction {...props} />
        </span>
      ) : null}
    </span>
  );
}

function WorkbenchSidebarThreadRowView({
  thread,
  ticketId,
  isActive,
  onOpenThread,
  data,
  actions,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly ticketId: WorkbenchTicketId;
  readonly isActive: boolean;
  readonly onOpenThread: (thread: WorkbenchSidebarThread) => void;
  readonly data: WorkbenchSidebarThreadRowData;
  readonly actions: ReturnType<typeof useWorkbenchSidebarThreadInteraction>;
}) {
  return (
    <div
      data-workbench-sidebar-item-row=""
      data-workbench-sidebar-thread-id={thread.id}
      data-workbench-sidebar-owner-ticket-id={ticketId}
      data-workbench-sidebar-surface=""
      data-active={isActive || undefined}
      data-workbench-sidebar-detail-row="thread"
      onContextMenu={(event) => {
        event.preventDefault();
        actions.openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <WorkbenchSidebarThreadNavigation
        data={data}
        isActive={isActive}
        onOpenThread={onOpenThread}
        openMenu={actions.openMenu}
        thread={thread}
      />
      <WorkbenchSidebarThreadStatusSlot
        actions={actions}
        data={data}
        thread={thread}
        ticketId={ticketId}
      />
      <WorkbenchSidebarThreadMetadataControls
        actions={actions}
        data={data}
        isActive={isActive}
        thread={thread}
      />
    </div>
  );
}

/** Native thread behavior, presented inside the Workbench ticket hierarchy. */
export function WorkbenchSidebarThreadRow({
  thread,
  ticketId,
  isActive,
  onOpenThread,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly ticketId: WorkbenchTicketId;
  readonly isActive: boolean;
  readonly onOpenThread: (thread: WorkbenchSidebarThread) => void;
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const data = useWorkbenchSidebarThreadRowData({ thread, threadRef });
  const rename = useWorkbenchSidebarThreadRename(thread);
  const interaction = useWorkbenchSidebarThreadInteraction({
    currentPullRequest: data.currentPullRequest,
    shell: data.shell,
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
          ticketId={ticketId}
          onOpenThread={onOpenThread}
          actions={interaction}
          thread={thread}
        />
      )}
    </SidebarMenuItem>
  );
}
