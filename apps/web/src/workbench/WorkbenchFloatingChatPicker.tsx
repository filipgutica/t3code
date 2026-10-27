import type { ThreadId } from "@t3tools/contracts";
import { ArchiveRestoreIcon, CheckIcon, ChevronDownIcon, CircleCheckIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../components/ui/menu";
import { cn } from "../lib/utils";
import {
  filterWorkbenchFloatingChatThreads,
  getWorkbenchFloatingChatTicketLabel,
  groupWorkbenchFloatingChatThreads,
  type resolveWorkbenchFloatingChat,
  WORKBENCH_ATTENTION_KINDS,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import {
  WorkbenchThreadExecutionStatus,
  WorkbenchThreadExecutionStatusIcon,
} from "./WorkbenchThreadExecutionStatus";

type FloatingChat = ReturnType<typeof resolveWorkbenchFloatingChat>;

// Fewer Threads than this fit without scrolling, so a filter would only add noise.
const SEARCH_THRESHOLD = 8;

function PickerThreadItem({
  thread,
  selected,
  onSelect,
}: {
  readonly thread: WorkbenchFloatingChatThread;
  readonly selected: boolean;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const status = thread.status;
  return (
    <MenuItem
      data-thread-id={thread.threadId}
      aria-current={selected || undefined}
      onClick={() => onSelect(thread.threadId)}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className="mt-0.5 flex size-3.5 shrink-0">
          {status ? <WorkbenchThreadExecutionStatusIcon status={status.presentation} /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}>
              {thread.title}
            </span>
            {status ? (
              <span
                className={cn(
                  "shrink-0 text-2xs",
                  WORKBENCH_ATTENTION_KINDS.has(status.kind)
                    ? cn("font-medium", status.presentation.className)
                    : "text-muted-foreground",
                )}
              >
                {status.presentation.label}
              </span>
            ) : null}
          </span>
          {thread.recap ? (
            <span className="line-clamp-2 text-2xs text-muted-foreground">{thread.recap}</span>
          ) : null}
        </span>
        <span className="mt-0.5 flex size-3.5 shrink-0">
          {selected ? <CheckIcon aria-hidden className="size-3.5 text-foreground" /> : null}
        </span>
      </span>
    </MenuItem>
  );
}

function PickerHistory({
  label,
  threads,
  icon,
  itemLabel,
  onSelect,
}: {
  readonly label: string;
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly icon: ReactNode;
  readonly itemLabel: (thread: WorkbenchFloatingChatThread) => string;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  if (threads.length === 0) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-2xs text-muted-foreground tabular-nums">{threads.length}</span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-80">
        {threads.map((thread) => (
          <MenuItem key={thread.threadId} onClick={() => onSelect(thread.threadId)}>
            <span className="truncate">{itemLabel(thread)}</span>
          </MenuItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

function PickerTriggerContent({
  selected,
  title,
}: {
  readonly selected: WorkbenchFloatingChatThread | null;
  readonly title: string;
}) {
  return (
    <>
      {selected?.ticket ? (
        <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
          {selected.ticket.key ?? selected.ticket.title}
        </span>
      ) : null}
      <span className="min-w-0 truncate text-xs font-medium">{selected?.title ?? title}</span>
      {selected?.status ? (
        <WorkbenchThreadExecutionStatus
          compact
          status={selected.status.presentation}
          startedAt={selected.status.startedAt}
        />
      ) : null}
      <ChevronDownIcon aria-hidden className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

function PickerThreadGroups({
  threads,
  selectedThreadId,
  ungroupedLabel,
  onSelect,
}: {
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly selectedThreadId: ThreadId | null;
  readonly ungroupedLabel: string;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  return groupWorkbenchFloatingChatThreads(threads).map((group) => (
    <MenuGroup key={group.ticket?.id ?? "ungrouped"}>
      <MenuGroupLabel>
        <span className="block truncate">
          {group.ticket ? getWorkbenchFloatingChatTicketLabel(group.ticket) : ungroupedLabel}
        </span>
      </MenuGroupLabel>
      {group.threads.map((thread) => (
        <PickerThreadItem
          key={thread.threadId}
          thread={thread}
          selected={thread.threadId === selectedThreadId}
          onSelect={onSelect}
        />
      ))}
    </MenuGroup>
  ));
}

function WaitingPill({ count, onClick }: { readonly count: number; readonly onClick: () => void }) {
  if (count === 0) return null;
  return (
    <Badge
      variant="warning"
      size="lg"
      render={
        <button
          type="button"
          aria-label={`${count} other ${count === 1 ? "Thread needs" : "Threads need"} you`}
          onClick={onClick}
        />
      }
    >
      {count} need you
    </Badge>
  );
}

/**
 * The floating chat's Thread switcher: the showing Thread in full, and a menu of the board's
 * or ticket's Threads with their recaps. The pill opens it on the first Thread waiting on you.
 */
export function WorkbenchFloatingChatPicker({
  chat,
  title,
  listLabel,
  ungroupedLabel,
  onSelect,
  onOpenThread,
}: {
  readonly chat: FloatingChat;
  /** Shown in the trigger when no Thread is selected. */
  readonly title: string;
  readonly listLabel: string;
  /** Names Threads without a ticket: drafts on the board, every Thread in a ticket's chat. */
  readonly ungroupedLabel: string;
  readonly onSelect: (threadId: ThreadId) => void;
  /** Opens an archived Thread on its route after restoring it. */
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const focusThreadIdRef = useRef<ThreadId | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { selected, waiting } = chat;
  const visible = filterWorkbenchFloatingChatThreads(chat.active, query);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const openOnWaiting = () => {
    focusThreadIdRef.current = waiting[0]?.threadId ?? null;
    changeOpen(true);
  };
  const focusWaiting = (isOpen: boolean) => {
    const threadId = focusThreadIdRef.current;
    focusThreadIdRef.current = null;
    if (!isOpen || threadId === null) return;
    popupRef.current?.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`)?.focus();
  };
  const select = (threadId: ThreadId) => {
    changeOpen(false);
    onSelect(threadId);
  };

  return (
    <>
      <Menu open={open} onOpenChange={changeOpen} onOpenChangeComplete={focusWaiting}>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={selected ? `${listLabel}: ${selected.title}` : listLabel}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-accent"
            />
          }
        >
          <PickerTriggerContent selected={selected} title={title} />
        </MenuTrigger>
        <MenuPopup ref={popupRef} align="start" className="w-100">
          {chat.active.length >= SEARCH_THRESHOLD ? (
            <MenuSearchInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search Threads"
              aria-label="Search Threads"
            />
          ) : null}
          {visible.length === 0 && chat.active.length > 0 ? (
            <MenuItem disabled>No Threads match</MenuItem>
          ) : null}
          <PickerThreadGroups
            threads={visible}
            selectedThreadId={selected?.threadId ?? null}
            ungroupedLabel={ungroupedLabel}
            onSelect={select}
          />
          {chat.active.length > 0 && (chat.settled.length > 0 || chat.archived.length > 0) ? (
            <MenuSeparator />
          ) : null}
          <PickerHistory
            label="Settled"
            threads={chat.settled}
            icon={<CircleCheckIcon className="text-success" />}
            itemLabel={(thread) => thread.title}
            onSelect={select}
          />
          <PickerHistory
            label="Archived"
            threads={chat.archived}
            icon={<ArchiveRestoreIcon />}
            itemLabel={(thread) => `Restore and open ${thread.title}`}
            onSelect={(threadId) => {
              changeOpen(false);
              onOpenThread(threadId);
            }}
          />
        </MenuPopup>
      </Menu>
      <WaitingPill count={waiting.length} onClick={openOnWaiting} />
    </>
  );
}
