import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArchiveRestoreIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePenLineIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useId, useRef, useState, type ReactElement, type ReactNode } from "react";

import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { resolveThreadPullRequestBadgePresentation } from "../components/ThreadStatusIndicators";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSearchInput,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { cn } from "../lib/utils";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import {
  filterWorkbenchFloatingChatThreads,
  getWorkbenchFloatingChatPickerRow,
  getWorkbenchFloatingChatThreadLabel,
  getWorkbenchThreadStatusSections,
  type resolveWorkbenchFloatingChat,
  WORKBENCH_ATTENTION_KINDS,
  type WorkbenchFloatingChatPickerRow,
  type WorkbenchFloatingChatTicket,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchSidebarThreadRowData } from "./WorkbenchSidebarThreadRow.logic";
import { WorkbenchTicketKindIcon } from "./WorkbenchTicketMetadata";
import {
  WorkbenchThreadExecutionStatus,
  WorkbenchThreadExecutionStatusIcon,
} from "./WorkbenchThreadExecutionStatus";

type FloatingChat = ReturnType<typeof resolveWorkbenchFloatingChat>;

// Fewer Threads than this fit without scrolling, so a filter would only add noise.
const SEARCH_THRESHOLD = 8;

/** The sidebar's hover preview beside a picker row. Its content, and data, mount only while shown. */
function PickerRowPreview({
  preview,
  children,
}: {
  readonly preview: ReactNode;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup align="start" side="right" variant="glass" className="text-left">
        {preview}
      </TooltipPopup>
    </Tooltip>
  );
}

function PickerThreadPreview({
  environmentId,
  thread,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: WorkbenchFloatingChatThread;
}) {
  const data = useWorkbenchSidebarThreadRowData({
    thread: { environmentId },
    threadRef: scopeThreadRef(environmentId, thread.threadId),
  });
  return (
    <WorkbenchSidebarThreadPreview
      thread={thread}
      shell={data.shell}
      project={data.project}
      environment={data.environment}
      providerEntry={data.providerEntry}
      pullRequests={data.pullRequests}
    />
  );
}

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
  environmentId,
  row: { thread, ticketLabel, title },
  selected,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly row: WorkbenchFloatingChatPickerRow;
  readonly selected: boolean;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const status = thread.status;
  // Flex layout drops the spaces between these parts from the computed name.
  const name = [ticketLabel, title, status?.presentation.label].filter(Boolean).join(" ");
  return (
    <PickerRowPreview
      preview={<PickerThreadPreview environmentId={environmentId} thread={thread} />}
    >
      <MenuRadioItem
        value={thread.threadId}
        data-thread-id={thread.threadId}
        aria-label={name}
        aria-description={thread.recap ?? undefined}
        onClick={() => onSelect(thread.threadId)}
      >
        <span className="flex min-w-0 flex-1 items-start gap-2">
          <ThreadStatusIcon thread={thread} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-1.5">
              {ticketLabel ? (
                <span className="max-w-28 shrink-0 truncate text-2xs text-muted-foreground">
                  {ticketLabel}
                </span>
              ) : null}
              <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}>
                {title}
              </span>
              {status ? (
                <span
                  className={cn(
                    "shrink-0 text-2xs",
                    status.presentation.className,
                    WORKBENCH_ATTENTION_KINDS.has(status.kind) && "font-medium",
                  )}
                >
                  {status.presentation.label}
                </span>
              ) : null}
            </span>
            {thread.recap ? (
              <span className="truncate text-2xs text-muted-foreground">{thread.recap}</span>
            ) : null}
          </span>
        </span>
      </MenuRadioItem>
    </PickerRowPreview>
  );
}

/** Archived Threads, restored on their own route when chosen. */
function PickerArchived({
  environmentId,
  threads,
  separated,
  onRestore,
}: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Other Threads are listed above, so a rule sets these apart. */
  readonly separated: boolean;
  readonly onRestore: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  if (threads.length === 0) return null;
  return (
    <MenuGroup>
      {separated ? <MenuSeparator /> : null}
      <MenuItem closeOnClick={false} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ArchiveRestoreIcon />
        <span className="min-w-0 flex-1 truncate">Archived</span>
        <span className="text-2xs text-muted-foreground tabular-nums">{threads.length}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
        />
      </MenuItem>
      {/* Bounded on its own, since the Thread list's height leaves room only for this heading. */}
      {open ? (
        <div className="ms-3.5 max-h-40 overflow-y-auto border-s border-muted-foreground/30 ps-2">
          {threads.map((thread) => (
            <PickerRowPreview
              key={thread.threadId}
              preview={<PickerThreadPreview environmentId={environmentId} thread={thread} />}
            >
              <MenuItem onClick={() => onRestore(thread.threadId)}>
                <span className="truncate">
                  Restore and open {getWorkbenchFloatingChatThreadLabel(thread)}
                </span>
              </MenuItem>
            </PickerRowPreview>
          ))}
        </div>
      ) : null}
    </MenuGroup>
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

/**
 * The showing Thread's PR and provider, as on its native sidebar row; icons only inside the
 * trigger. The trigger's own label hides its content, so the text also goes in a description.
 */
function PickerTriggerThreadContext({
  environmentId,
  threadId,
  descriptionId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly descriptionId: string;
}) {
  const data = useWorkbenchSidebarThreadRowData({
    thread: { environmentId },
    threadRef: scopeThreadRef(environmentId, threadId),
  });
  const pullRequest = resolveThreadPullRequestBadgePresentation({
    badge: data.pullRequestBadge,
    number: data.currentPullRequest?.number,
    url: data.currentPullRequest?.url,
    status: data.pullRequestIndicator,
  });
  return (
    <>
      <span id={descriptionId} className="sr-only">
        {[pullRequest?.label, data.providerEntry?.displayName].filter(Boolean).join(", ")}
      </span>
      {pullRequest ? (
        <span
          aria-hidden
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums",
            pullRequest.toneClassName,
          )}
        >
          <pullRequest.Icon aria-hidden className="size-3 shrink-0" />
          {pullRequest.text}
        </span>
      ) : null}
      {data.providerEntry ? (
        <ProviderInstanceIcon
          driverKind={data.providerEntry.driverKind}
          displayName={data.providerEntry.displayName}
          className="size-3.5 shrink-0 opacity-75"
          iconClassName="size-3.5"
        />
      ) : null}
    </>
  );
}

function PickerTriggerContent({
  environmentId,
  selected,
  title,
  descriptionId,
}: {
  readonly environmentId: EnvironmentId;
  readonly descriptionId: string;
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
      {selected === null ? null : (
        <PickerTriggerThreadContext
          environmentId={environmentId}
          threadId={selected.threadId}
          descriptionId={descriptionId}
        />
      )}
      <ChevronDownIcon aria-hidden className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

function PickerSectionHeader({
  label,
  count,
  hint,
  open,
  onToggle,
}: {
  readonly label: string;
  readonly count: number;
  /** Shown at the end of the heading, such as how many collapsed Threads are working. */
  readonly hint: string | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <MenuItem
      closeOnClick={false}
      aria-expanded={open}
      aria-label={[label, `${count} ${count === 1 ? "Thread" : "Threads"}`, hint]
        .filter(Boolean)
        .join(", ")}
      onClick={onToggle}
    >
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
      />
      <span className="min-w-0 truncate text-xs font-medium">{label}</span>
      <span className="text-2xs text-muted-foreground tabular-nums">{count}</span>
      {hint ? (
        <span className="ms-auto shrink-0 text-2xs text-muted-foreground">{hint}</span>
      ) : null}
    </MenuItem>
  );
}

interface PickerSectionLayout {
  readonly id: string;
  readonly label: string;
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly hint: string | null;
  readonly openByDefault: boolean;
}

/** The board lists drafts first, as work in progress; then Threads go by status. */
const getPickerSections = ({
  active,
  settled,
  showingThreadId,
  board,
}: {
  readonly active: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly settled: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly showingThreadId: ThreadId | null;
  readonly board: boolean;
}): ReadonlyArray<PickerSectionLayout> => {
  const drafts = board ? active.filter((thread) => thread.ticket === null) : [];
  const statusSections = getWorkbenchThreadStatusSections({
    active: active.filter((thread) => !drafts.includes(thread)),
    settled,
    showingThreadId,
  }).map((section) => ({
    ...section,
    hint: section.workingCount > 0 ? `${section.workingCount} working` : null,
  }));
  return drafts.length > 0
    ? [
        { id: "drafts", label: "Drafts", threads: drafts, hint: null, openByDefault: true },
        ...statusSections,
      ]
    : statusSections;
};

function PickerThreadSections({
  environmentId,
  sections,
  board,
  selectedThreadId,
  openGroups,
  searching,
  onToggleGroup,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly sections: ReadonlyArray<PickerSectionLayout>;
  /** Board rows name their ticket; the ticket chat's header already does. */
  readonly board: boolean;
  readonly selectedThreadId: ThreadId | null;
  /** Section ids the user opened or closed. */
  readonly openGroups: ReadonlyMap<string, boolean>;
  /** Search results start with every section open. */
  readonly searching: boolean;
  readonly onToggleGroup: (id: string, open: boolean) => void;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  return (
    <MenuRadioGroup value={selectedThreadId}>
      {sections.map((section) => {
        const open = openGroups.get(section.id) ?? (searching || section.openByDefault);
        return (
          <MenuGroup key={section.id}>
            <PickerSectionHeader
              label={section.label}
              count={section.threads.length}
              hint={section.hint}
              open={open}
              onToggle={() => onToggleGroup(section.id, !open)}
            />
            {open
              ? section.threads.map((thread) => (
                  <PickerThreadItem
                    key={thread.threadId}
                    environmentId={environmentId}
                    row={getWorkbenchFloatingChatPickerRow(thread, board)}
                    selected={thread.threadId === selectedThreadId}
                    onSelect={onSelect}
                  />
                ))
              : null}
          </MenuGroup>
        );
      })}
    </MenuRadioGroup>
  );
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
      {count} {count === 1 ? "needs" : "need"} you
    </Badge>
  );
}

/**
 * The search query, the sections it leaves, and which are open. Toggles outside search persist
 * while the chat is mounted; toggles in search results start from every section open and end
 * with the search.
 */
function usePickerSections(chat: FloatingChat, board: boolean) {
  const [query, setQuery] = useState("");
  const [browseGroups, setBrowseGroups] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [searchGroups, setSearchGroups] = useState<ReadonlyMap<string, boolean>>(new Map());
  const searching = query.trim() !== "";
  const set = (update: typeof setBrowseGroups, id: string, open: boolean) =>
    update((current) => new Map(current).set(id, open));
  const sectionsFor = (filter: string) =>
    getPickerSections({
      active: filterWorkbenchFloatingChatThreads(chat.active, filter),
      settled: filterWorkbenchFloatingChatThreads(chat.settled, filter),
      showingThreadId: chat.selected?.threadId ?? null,
      board,
    });
  return {
    query,
    searching,
    sections: sectionsFor(query),
    openGroups: searching ? searchGroups : browseGroups,
    changeQuery: (next: string) => {
      setQuery(next);
      setSearchGroups(new Map());
    },
    toggle: (id: string, open: boolean) =>
      set(searching ? setSearchGroups : setBrowseGroups, id, open),
    /** Opens a section the user collapsed so the Thread it holds is in the list. */
    reveal: (threadId: ThreadId) => {
      const section = sectionsFor("").find((candidate) =>
        candidate.threads.some((thread) => thread.threadId === threadId),
      );
      if (section) set(setBrowseGroups, section.id, true);
    },
  };
}

/**
 * The floating chat's Thread switcher: the showing Thread in full, and a menu of the board's
 * or ticket's Threads with their recaps. The pill opens it on the first Thread waiting on you.
 */
export function WorkbenchFloatingChatPicker({
  environmentId,
  chat,
  title,
  listLabel,
  onSelect,
  onOpenThread,
  actions,
  grouped,
}: {
  readonly environmentId: EnvironmentId;
  readonly chat: FloatingChat;
  /** Shown in the trigger when no Thread is selected. */
  readonly title: string;
  readonly listLabel: string;
  readonly onSelect: (threadId: ThreadId) => void;
  /** Opens an archived Thread on its route after restoring it. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** New-Thread items, after the Threads as in a chat app's switcher. */
  readonly actions: ReactNode;
  /** The board's picker, whose rows name their ticket. */
  readonly grouped: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups = usePickerSections(chat, grouped);
  const focusThreadIdRef = useRef<ThreadId | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const { selected, waiting } = chat;
  const threadCount = chat.active.length + chat.settled.length;
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) groups.changeQuery("");
    else if (selected) groups.reveal(selected.threadId);
  };
  const openOnWaiting = () => {
    const target = waiting[0];
    focusThreadIdRef.current = target?.threadId ?? null;
    if (target) groups.reveal(target.threadId);
    changeOpen(true);
  };
  const row = (threadId: ThreadId | undefined) =>
    popupRef.current?.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
  // Focuses the waiting Thread the pill asked for, or scrolls to the showing Thread.
  const revealOnOpen = (isOpen: boolean) => {
    const waitingThreadId = focusThreadIdRef.current;
    focusThreadIdRef.current = null;
    if (!isOpen) return;
    if (waitingThreadId !== null) return row(waitingThreadId)?.focus();
    const showing = row(selected?.threadId);
    // Keyboard opening focuses the first item, which centring could scroll out of view; the
    // search field keeps its focus.
    if (document.activeElement?.getAttribute("role")?.startsWith("menuitem"))
      showing?.focus({ preventScroll: true });
    showing?.scrollIntoView({ block: "center" });
  };
  const select = (threadId: ThreadId) => {
    changeOpen(false);
    onSelect(threadId);
  };

  return (
    <>
      <Menu open={open} onOpenChange={changeOpen} onOpenChangeComplete={revealOnOpen}>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={selected ? `${listLabel}: ${selected.title}` : listLabel}
              aria-describedby={selected ? descriptionId : undefined}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-accent"
            />
          }
        >
          <PickerTriggerContent
            environmentId={environmentId}
            selected={selected}
            title={title}
            descriptionId={descriptionId}
          />
        </MenuTrigger>
        <MenuPopup ref={popupRef} align="start" className="w-96">
          {threadCount >= SEARCH_THRESHOLD ? (
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
            {groups.sections.length === 0 && threadCount > 0 ? (
              <MenuItem disabled>No Threads match</MenuItem>
            ) : null}
            <PickerThreadSections
              environmentId={environmentId}
              sections={groups.sections}
              board={grouped}
              selectedThreadId={selected?.threadId ?? null}
              openGroups={groups.openGroups}
              searching={groups.searching}
              onToggleGroup={groups.toggle}
              onSelect={select}
            />
          </div>
          <PickerArchived
            environmentId={environmentId}
            threads={chat.archived}
            separated={threadCount > 0}
            onRestore={(threadId) => {
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
