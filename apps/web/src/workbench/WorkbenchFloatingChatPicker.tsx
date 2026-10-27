import type { ThreadId } from "@t3tools/contracts";
import {
  ArchiveRestoreIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  FilePenLineIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import {
  Menu,
  MenuGroup,
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
  getWorkbenchFloatingChatPickerSections,
  getWorkbenchFloatingChatThreadLabel,
  isWorkbenchFloatingChatGroupOpenByDefault,
  type resolveWorkbenchFloatingChat,
  WORKBENCH_ATTENTION_KINDS,
  type WorkbenchFloatingChatPickerRow,
  type WorkbenchFloatingChatTicket,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { WorkbenchTicketKindIcon } from "./WorkbenchTicketMetadata";
import {
  WorkbenchThreadExecutionStatus,
  WorkbenchThreadExecutionStatusIcon,
} from "./WorkbenchThreadExecutionStatus";

type FloatingChat = ReturnType<typeof resolveWorkbenchFloatingChat>;

// Fewer Threads than this fit without scrolling, so a filter would only add noise.
const SEARCH_THRESHOLD = 8;

function ThreadStatusIcon({ thread }: { readonly thread: WorkbenchFloatingChatThread }) {
  return (
    <span className="mt-0.5 flex size-3.5 shrink-0 text-muted-foreground">
      {thread.status ? (
        <WorkbenchThreadExecutionStatusIcon status={thread.status.presentation} />
      ) : (
        <MessageSquareIcon aria-hidden className="size-3.5" />
      )}
    </span>
  );
}

function PickerThreadItem({
  thread,
  ticketPrefix = null,
  title,
  icon = <ThreadStatusIcon thread={thread} />,
  selected,
  onSelect,
}: {
  readonly thread: WorkbenchFloatingChatThread;
  readonly ticketPrefix?: string | null;
  readonly title: string;
  readonly icon?: ReactNode;
  readonly selected: boolean;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const status = thread.status;
  // Flex layout drops the spaces between these parts from the computed name.
  const name = [ticketPrefix, title, status?.presentation.label].filter(Boolean).join(" ");
  return (
    <MenuItem
      data-thread-id={thread.threadId}
      aria-label={name}
      aria-description={thread.recap ?? undefined}
      aria-current={selected || undefined}
      onClick={() => onSelect(thread.threadId)}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {ticketPrefix ? (
              <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
                {ticketPrefix}
              </span>
            ) : null}
            <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}>
              {title}
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
            {selected ? (
              <CheckIcon aria-hidden className="size-3.5 shrink-0 self-center text-foreground" />
            ) : null}
          </span>
          {thread.recap ? (
            <span className="truncate text-2xs text-muted-foreground">{thread.recap}</span>
          ) : null}
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
      {selected?.ticket?.key ? (
        <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
          {selected.ticket.key}
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

function PickerGroupHeader({
  ticket,
  count,
  open,
  onToggle,
}: {
  readonly ticket: WorkbenchFloatingChatTicket | null;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const title = ticket?.title ?? "Drafts";
  return (
    <MenuItem
      closeOnClick={false}
      aria-expanded={open}
      aria-label={[ticket?.key, title, `${count} ${count === 1 ? "Thread" : "Threads"}`]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
    >
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
      />
      {ticket ? (
        <WorkbenchTicketKindIcon kind={ticket.kind} />
      ) : (
        <FilePenLineIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {ticket?.key ? (
        <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
          {ticket.key}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{count}</span>
    </MenuItem>
  );
}

function PickerThreadSections({
  threads,
  selectedThreadId,
  openGroups,
  onToggleGroup,
  onSelect,
}: {
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly selectedThreadId: ThreadId | null;
  /** Group ids the user opened or closed; search passes null to show every group open. */
  readonly openGroups: ReadonlyMap<string, boolean> | null;
  readonly onToggleGroup: (id: string, open: boolean) => void;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const item = ({ thread, title }: WorkbenchFloatingChatPickerRow) => (
    <PickerThreadItem
      key={thread.threadId}
      thread={thread}
      title={title}
      selected={thread.threadId === selectedThreadId}
      onSelect={onSelect}
    />
  );
  return getWorkbenchFloatingChatPickerSections(threads).map((section) => {
    if (section.type === "rows")
      return <MenuGroup key={section.id}>{section.rows.map(item)}</MenuGroup>;
    if (section.type === "ticket") {
      const { ticket, row, prefix } = section;
      return (
        <PickerThreadItem
          key={section.id}
          thread={row.thread}
          ticketPrefix={prefix}
          title={row.title}
          icon={
            <span className="mt-0.5 flex shrink-0 gap-2">
              {/* Lines up with the chevron of group headings. */}
              <span className="size-3.5" />
              <WorkbenchTicketKindIcon kind={ticket.kind} />
            </span>
          }
          selected={row.thread.threadId === selectedThreadId}
          onSelect={onSelect}
        />
      );
    }
    const open =
      openGroups === null ||
      (openGroups.get(section.id) ??
        isWorkbenchFloatingChatGroupOpenByDefault(section, selectedThreadId));
    return (
      <MenuGroup key={section.id}>
        <PickerGroupHeader
          ticket={section.ticket}
          count={section.rows.length}
          open={open}
          onToggle={() => onToggleGroup(section.id, !open)}
        />
        {/* The rule ties a group's Threads to its heading. */}
        {open ? (
          <div className="ms-3.5 border-s border-muted-foreground/30 ps-1">
            {section.rows.map(item)}
          </div>
        ) : null}
      </MenuGroup>
    );
  });
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
  onSelect,
  onOpenThread,
}: {
  readonly chat: FloatingChat;
  /** Shown in the trigger when no Thread is selected. */
  readonly title: string;
  readonly listLabel: string;
  readonly onSelect: (threadId: ThreadId) => void;
  /** Opens an archived Thread on its route after restoring it. */
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Kept while the chat is mounted, so a group the user closed stays closed between opens.
  const [openGroups, setOpenGroups] = useState<ReadonlyMap<string, boolean>>(new Map());
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
        <MenuPopup ref={popupRef} align="start" className="w-96">
          {chat.active.length >= SEARCH_THRESHOLD ? (
            <MenuSearchInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search Threads"
              aria-label="Search Threads"
            />
          ) : null}
          {/* Only the list scrolls, so search and history stay in reach in a short window. */}
          <div className="max-h-[clamp(8rem,calc(var(--available-height)-7rem),20rem)] overflow-y-auto">
            {visible.length === 0 && chat.active.length > 0 ? (
              <MenuItem disabled>No Threads match</MenuItem>
            ) : null}
            <PickerThreadSections
              threads={visible}
              selectedThreadId={selected?.threadId ?? null}
              openGroups={query.trim() === "" ? openGroups : null}
              onToggleGroup={(id, next) =>
                setOpenGroups((current) => new Map(current).set(id, next))
              }
              onSelect={select}
            />
          </div>
          {chat.active.length > 0 && (chat.settled.length > 0 || chat.archived.length > 0) ? (
            <MenuSeparator />
          ) : null}
          <PickerHistory
            label="Settled"
            threads={chat.settled}
            icon={<CircleCheckIcon className="text-success" />}
            itemLabel={getWorkbenchFloatingChatThreadLabel}
            onSelect={select}
          />
          <PickerHistory
            label="Archived"
            threads={chat.archived}
            icon={<ArchiveRestoreIcon />}
            itemLabel={(thread) =>
              `Restore and open ${getWorkbenchFloatingChatThreadLabel(thread)}`
            }
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
