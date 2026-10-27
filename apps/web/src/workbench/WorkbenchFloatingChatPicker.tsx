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
  title,
  selected,
  onSelect,
}: {
  readonly thread: WorkbenchFloatingChatThread;
  readonly title: string;
  readonly selected: boolean;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const status = thread.status;
  // Flex layout drops the spaces between these parts from the computed name.
  const name = [title, status?.presentation.label].filter(Boolean).join(" ");
  return (
    <MenuItem
      data-thread-id={thread.threadId}
      aria-label={name}
      aria-description={thread.recap ?? undefined}
      aria-current={selected || undefined}
      onClick={() => onSelect(thread.threadId)}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <ThreadStatusIcon thread={thread} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5">
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
              <CheckIcon aria-hidden className="size-3.5 shrink-0 self-center text-primary" />
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

/** A ticket's kind, or the draft mark for a Thread with no ticket yet. */
function PickerTicketIcon({ ticket }: { readonly ticket: WorkbenchFloatingChatTicket | null }) {
  return ticket ? (
    <WorkbenchTicketKindIcon kind={ticket.kind} />
  ) : (
    <FilePenLineIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
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
      {selected === null ? null : <PickerTicketIcon ticket={selected.ticket} />}
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
  current,
  onToggle,
}: {
  readonly ticket: WorkbenchFloatingChatTicket | null;
  readonly count: number;
  readonly open: boolean;
  /** Holds the showing Thread, so the heading still marks it while collapsed. */
  readonly current: boolean;
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
      <PickerTicketIcon ticket={ticket} />
      {ticket?.key ? (
        <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
          {ticket.key}
        </span>
      ) : null}
      <span className={cn("min-w-0 flex-1 truncate", current && "font-medium")}>{title}</span>
      <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{count}</span>
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
      />
    </MenuItem>
  );
}

function PickerThreadSections({
  threads,
  selectedThreadId,
  grouped,
  openGroups,
  searching,
  onToggleGroup,
  onSelect,
}: {
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** The board groups Threads under their tickets; the ticket chat lists them plainly. */
  readonly grouped: boolean;
  readonly selectedThreadId: ThreadId | null;
  /** Group ids the user opened or closed. */
  readonly openGroups: ReadonlyMap<string, boolean>;
  /** Search results start with every group open. */
  readonly searching: boolean;
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
  // The showing Thread's stretch of its group's rule is drawn in the accent colour.
  const groupedItem = (row: WorkbenchFloatingChatPickerRow) => (
    <div key={row.thread.threadId} className="relative">
      {row.thread.threadId === selectedThreadId ? (
        <span
          aria-hidden
          className="absolute inset-y-1 -start-[calc(0.5rem+2px)] w-[3px] rounded-full bg-primary"
        />
      ) : null}
      {item(row)}
    </div>
  );
  return getWorkbenchFloatingChatPickerSections(threads, grouped).map((section) => {
    if (section.type === "rows")
      return <MenuGroup key={section.id}>{section.rows.map(item)}</MenuGroup>;
    const open =
      openGroups.get(section.id) ??
      (searching || isWorkbenchFloatingChatGroupOpenByDefault(section, selectedThreadId));
    return (
      <MenuGroup key={section.id}>
        <PickerGroupHeader
          ticket={section.ticket}
          count={section.rows.length}
          open={open}
          current={section.rows.some(({ thread }) => thread.threadId === selectedThreadId)}
          onToggle={() => onToggleGroup(section.id, !open)}
        />
        {/* The rule ties a group's Threads to its heading. */}
        {open ? (
          <div className="ms-3.5 border-s border-muted-foreground/30 ps-2">
            {section.rows.map(groupedItem)}
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
 * The search query and which groups are open. Toggles outside search persist while the chat is
 * mounted; toggles in search results start from every group open and end with the search.
 */
function usePickerGroups() {
  const [query, setQuery] = useState("");
  const [browseGroups, setBrowseGroups] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [searchGroups, setSearchGroups] = useState<ReadonlyMap<string, boolean>>(new Map());
  const searching = query.trim() !== "";
  const set = (update: typeof setBrowseGroups, id: string, open: boolean) =>
    update((current) => new Map(current).set(id, open));
  return {
    query,
    searching,
    openGroups: searching ? searchGroups : browseGroups,
    changeQuery: (next: string) => {
      setQuery(next);
      setSearchGroups(new Map());
    },
    toggle: (id: string, open: boolean) =>
      set(searching ? setSearchGroups : setBrowseGroups, id, open),
    reveal: (thread: WorkbenchFloatingChatThread) =>
      set(setBrowseGroups, thread.ticket?.id ?? "drafts", true),
  };
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
  actions,
  grouped,
}: {
  readonly chat: FloatingChat;
  /** Shown in the trigger when no Thread is selected. */
  readonly title: string;
  readonly listLabel: string;
  readonly onSelect: (threadId: ThreadId) => void;
  /** Opens an archived Thread on its route after restoring it. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** New-Thread items, after the Threads as in a chat app's switcher. */
  readonly actions: ReactNode;
  readonly grouped: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups = usePickerGroups();
  const focusThreadIdRef = useRef<ThreadId | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { selected, waiting } = chat;
  const visible = filterWorkbenchFloatingChatThreads(chat.active, groups.query);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) groups.changeQuery("");
  };
  const openOnWaiting = () => {
    const target = waiting[0];
    focusThreadIdRef.current = target?.threadId ?? null;
    // A group the user collapsed must open so its waiting Thread mounts and can take focus.
    if (target) groups.reveal(target);
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
              value={groups.query}
              onChange={(event) => groups.changeQuery(event.currentTarget.value)}
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
              grouped={grouped}
              selectedThreadId={selected?.threadId ?? null}
              openGroups={groups.openGroups}
              searching={groups.searching}
              onToggleGroup={groups.toggle}
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
          <MenuSeparator />
          {actions}
        </MenuPopup>
      </Menu>
      <WaitingPill count={waiting.length} onClick={openOnWaiting} />
    </>
  );
}
