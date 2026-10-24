import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import {
  ArchiveRestoreIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  EllipsisIcon,
  MessageCircleIcon,
  MinusIcon,
  PlusIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type WheelEvent,
} from "react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import "./WorkbenchFloatingChat.css";
import type {
  resolveWorkbenchFloatingChat,
  WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import {
  useWorkbenchFloatingChatStore,
  type WorkbenchFloatingChatFocusRequest,
} from "./workbenchFloatingChatState";
import { WorkbenchThreadExecutionStatusIcon } from "./WorkbenchThreadExecutionStatus";
import { WorkbenchTicketProposalHistory } from "./WorkbenchTicketProposal";
import {
  useWorkbenchFloatingChatSize,
  type WorkbenchFloatingChatResizeEdge,
} from "./useWorkbenchFloatingChatSize";

type FloatingChat = ReturnType<typeof resolveWorkbenchFloatingChat>;

export interface WorkbenchFloatingChatProps {
  readonly environmentId: EnvironmentId;
  /** Names the panel for assistive technology, such as the ticket key. */
  readonly label: string;
  readonly chat: FloatingChat;
  readonly onSelectThread: (threadId: ThreadId) => void;
  /** Opens the Thread route, restoring an archived Thread first. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onNewThread: () => void;
  readonly newThreadDisabled: boolean;
}

const tabLabel = (thread: WorkbenchFloatingChatThread) =>
  thread.status ? `${thread.title} (${thread.status.presentation.label})` : thread.title;

const statusIcon = (thread: WorkbenchFloatingChatThread) =>
  thread.status ? <WorkbenchThreadExecutionStatusIcon status={thread.status.presentation} /> : null;

const threadTitle = (thread: WorkbenchFloatingChatThread) => thread.title;
const restoreLabel = (thread: WorkbenchFloatingChatThread) => `Restore and open ${thread.title}`;
const settledIcon = () => <CircleCheckIcon className="text-success" />;
const archivedIcon = () => <ArchiveRestoreIcon />;

const TAB_KEY_STEPS: Partial<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

/** An icon button that names itself in a tooltip; `render` swaps the button, such as for a menu. */
function FloatingChatAction({
  label,
  render,
  children,
}: {
  readonly label: string;
  readonly render: ReactElement;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

// A mouse wheel scrolls vertically; turn it sideways so every tab is reachable without a trackpad.
const scrollTabsSideways = (event: WheelEvent<HTMLDivElement>) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
    event.currentTarget.scrollLeft += event.deltaY;
};

function FloatingChatLauncher({
  label,
  attentionCount,
  buttonRef,
  onRestore,
}: {
  readonly label: string;
  readonly attentionCount: number;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onRestore: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={buttonRef}
            type="button"
            aria-label={
              attentionCount > 0
                ? `Show ${label} chat, ${attentionCount} waiting on you`
                : `Show ${label} chat`
            }
            className="absolute right-4 bottom-4 z-20 grid size-11 place-items-center rounded-full border border-border/80 bg-popover/92 text-foreground shadow-lg/20 backdrop-blur-xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onClick={onRestore}
          />
        }
      >
        <MessageCircleIcon aria-hidden className="size-4.5" />
        {attentionCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full border-2 border-background bg-warning px-1 text-3xs leading-none font-semibold text-warning-foreground"
          >
            {attentionCount}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>Ticket chat</TooltipPopup>
    </Tooltip>
  );
}

function FloatingChatTabs({
  tabs,
  selectedThreadId,
  onSelect,
}: {
  readonly tabs: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly selectedThreadId: ThreadId | null;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Keeps the selected tab in view, such as a Thread opened from elsewhere, without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-thread-id="${selectedThreadId}"]`);
    if (!list || !tab) return;
    const end = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
    list.scrollLeft = Math.min(Math.max(list.scrollLeft, end), tab.offsetLeft);
  }, [selectedThreadId]);
  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = TAB_KEY_STEPS[event.key];
    const thread = step ? tabs[step(index, tabs.length)] : undefined;
    if (!thread) return;
    event.preventDefault();
    onSelect(thread.threadId);
    event.currentTarget.parentElement
      ?.querySelector<HTMLElement>(`[data-thread-id="${thread.threadId}"]`)
      ?.focus();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Ticket Threads"
      className="relative flex min-w-0 flex-1 gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onWheel={scrollTabsSideways}
    >
      {tabs.map((thread, index) => {
        const isSelected = thread.threadId === selectedThreadId;
        return (
          <Tooltip key={thread.threadId}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  data-thread-id={thread.threadId}
                  aria-selected={isSelected}
                  aria-label={tabLabel(thread)}
                  tabIndex={isSelected ? 0 : -1}
                  className={cn(
                    "flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                    isSelected && "bg-secondary font-medium text-foreground",
                  )}
                  onClick={() => onSelect(thread.threadId)}
                  onKeyDown={(event) => selectByKey(event, index)}
                />
              }
            >
              {statusIcon(thread)}
              <span className="truncate">{thread.title}</span>
            </TooltipTrigger>
            <TooltipPopup>{tabLabel(thread)}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

function FloatingChatMenuGroup({
  label,
  threads,
  icon,
  itemLabel = threadTitle,
  onSelect,
}: {
  readonly label: string;
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly icon: (thread: WorkbenchFloatingChatThread) => ReactNode;
  readonly itemLabel?: (thread: WorkbenchFloatingChatThread) => string;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  if (threads.length === 0) return null;
  return (
    <MenuGroup>
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {threads.map((thread) => (
        <MenuItem key={thread.threadId} onClick={() => onSelect(thread.threadId)}>
          {icon(thread)}
          <span className="truncate">{itemLabel(thread)}</span>
        </MenuItem>
      ))}
    </MenuGroup>
  );
}

function FloatingChatMenu({
  chat,
  onSelect,
  onOpenThread,
}: {
  readonly chat: FloatingChat;
  readonly onSelect: (threadId: ThreadId) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  if (chat.settled.length === 0 && chat.archived.length === 0) return null;
  return (
    <Menu>
      <FloatingChatAction
        label="Settled and archived Threads"
        render={
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Settled and archived Threads" />
            }
          />
        }
      >
        <EllipsisIcon />
      </FloatingChatAction>
      <MenuPopup align="end" className="min-w-56 max-w-80">
        <FloatingChatMenuGroup
          label="Settled"
          threads={chat.settled}
          icon={settledIcon}
          onSelect={onSelect}
        />
        {chat.settled.length > 0 && chat.archived.length > 0 ? <MenuSeparator /> : null}
        <FloatingChatMenuGroup
          label="Archived"
          threads={chat.archived}
          icon={archivedIcon}
          itemLabel={restoreLabel}
          onSelect={onOpenThread}
        />
      </MenuPopup>
    </Menu>
  );
}

function FloatingChatEmpty({
  label,
  hasHistory,
  disabled,
  onNewThread,
}: {
  readonly label: string;
  readonly hasHistory: boolean;
  readonly disabled: boolean;
  readonly onNewThread: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        {hasHistory
          ? `No active Threads on ${label}. Settled and archived Threads are in the menu above.`
          : `No Threads on ${label} yet. A Thread works in this ticket's workspace.`}
      </p>
      <Button size="sm" disabled={disabled} onClick={onNewThread}>
        <PlusIcon />
        Start Thread
      </Button>
    </div>
  );
}

/** Looks like the composer but only expands the panel, so the real composer mounts on demand. */
function FloatingChatPlaceholder({
  title,
  onExpand,
}: {
  readonly title: string;
  readonly onExpand: () => void;
}) {
  return (
    <button
      type="button"
      className="m-2 flex h-11 items-center gap-2 rounded-3xl border border-border bg-background ps-4 pe-2 text-left text-sm text-muted-foreground hover:border-ring/60 focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onExpand}
    >
      <span className="min-w-0 flex-1 truncate">Message {title}…</span>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground opacity-40"
      >
        <ArrowUpIcon className="size-4" />
      </span>
    </button>
  );
}

// The embed hides the right panel, so a file, diff, or pull request the user opens from the
// timeline continues in the full Thread, where the right panel shows it.
function useOpenThreadOnPanelAction(threadRef: ScopedThreadRef, onOpen: () => void) {
  const threadKey = scopedThreadKey(threadRef);
  const open = useEffectEvent(onOpen);
  useEffect(() => {
    let revision = useRightPanelStore.getState().userActionRevisionByThreadKey[threadKey];
    return useRightPanelStore.subscribe((state) => {
      const next = state.userActionRevisionByThreadKey[threadKey];
      if (next === revision) return;
      revision = next;
      if (state.byThreadKey[threadKey]?.isOpen) open();
    });
  }, [threadKey]);
}

function FloatingChatThread({
  environmentId,
  thread,
  composerFocusRequest,
  onOpenThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: WorkbenchFloatingChatThread;
  readonly composerFocusRequest: number | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const threadRef = scopeThreadRef(environmentId, thread.threadId);
  useOpenThreadOnPanelAction(threadRef, () => onOpenThread(thread.threadId));
  return (
    <div role="tabpanel" aria-label={thread.title} className="flex min-h-0 flex-1 flex-col">
      <WorkbenchTicketProposalHistory threadRef={threadRef}>
        <ChatView
          key={thread.threadId}
          environmentId={environmentId}
          threadId={thread.threadId}
          routeKind="server"
          hideHeader
          embedded={{ composerFocusRequest }}
        />
      </WorkbenchTicketProposalHistory>
    </div>
  );
}

function FloatingChatBody({
  environmentId,
  label,
  selected,
  hasHistory,
  expanded,
  composerFocusRequest,
  onExpand,
  onOpenThread,
  onNewThread,
  newThreadDisabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly selected: WorkbenchFloatingChatThread | null;
  readonly hasHistory: boolean;
  readonly expanded: boolean;
  readonly composerFocusRequest: number | null;
  readonly onExpand: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onNewThread: () => void;
  readonly newThreadDisabled: boolean;
}) {
  if (selected === null) {
    return (
      <FloatingChatEmpty
        label={label}
        hasHistory={hasHistory}
        disabled={newThreadDisabled}
        onNewThread={onNewThread}
      />
    );
  }
  if (!expanded) return <FloatingChatPlaceholder title={selected.title} onExpand={onExpand} />;
  return (
    <FloatingChatThread
      environmentId={environmentId}
      thread={selected}
      composerFocusRequest={composerFocusRequest}
      onOpenThread={onOpenThread}
    />
  );
}

function FloatingChatToggle({
  expanded,
  buttonRef,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onToggle: () => void;
}) {
  const label = expanded ? "Collapse ticket chat" : "Expand ticket chat";
  return (
    <FloatingChatAction
      label={label}
      render={
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-expanded={expanded}
          onClick={onToggle}
        />
      }
    >
      {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
    </FloatingChatAction>
  );
}

const RESIZE_HANDLES: ReadonlyArray<{
  readonly edge: WorkbenchFloatingChatResizeEdge;
  readonly className: string;
  /** Height only changes while the conversation is expanded. */
  readonly expandedOnly: boolean;
}> = [
  { edge: "left", className: "inset-y-4 left-0 w-1.5 cursor-ew-resize", expandedOnly: false },
  { edge: "top", className: "inset-x-4 top-0 h-1.5 cursor-ns-resize", expandedOnly: true },
  { edge: "top-left", className: "top-0 left-0 size-4 cursor-nwse-resize", expandedOnly: true },
];

/** The panel, resizable from its left edge, top edge, and top-left corner. */
function FloatingChatFrame({
  label,
  expanded,
  children,
}: {
  readonly label: string;
  readonly expanded: boolean;
  readonly children: ReactNode;
}) {
  const { size, handlers } = useWorkbenchFloatingChatSize();
  const height = expanded ? size.height : null;
  return (
    <section
      data-workbench-floating-chat=""
      aria-label={`${label} chat`}
      className={cn(
        "absolute right-4 bottom-4 z-20 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover/92 shadow-lg/20 backdrop-blur-xl",
        expanded && height === null && "h-[min(540px,70vh)]",
      )}
      style={{ width: size.width, height: height ?? undefined }}
    >
      {RESIZE_HANDLES.filter((handle) => expanded || !handle.expandedOnly).map((handle) => (
        <div
          key={handle.edge}
          aria-hidden
          data-resize-edge={handle.edge}
          className={cn("absolute z-10 touch-none select-none", handle.className)}
          {...handlers(handle.edge)}
        />
      ))}
      {children}
    </section>
  );
}

// An explicit expand focuses one composer once: the requested Thread's, or the one showing.
// A requested Thread can get its tab after the request, such as a Thread created moments ago.
// Switching tabs, collapsing, or opening another ticket leaves focus where the user put it.
function useComposerFocusRequest(
  request: WorkbenchFloatingChatFocusRequest,
  selectedThreadId: ThreadId | null,
) {
  const [focus, setFocus] = useState<{
    requestId: number;
    threadId: ThreadId | null;
    shown: boolean;
  }>({ requestId: request.id, threadId: null, shown: false });
  if (focus.requestId !== request.id) {
    const threadId = request.threadId ?? selectedThreadId;
    setFocus({ requestId: request.id, threadId, shown: threadId === selectedThreadId });
  } else if (focus.threadId !== null && focus.shown !== (focus.threadId === selectedThreadId)) {
    // The Thread appeared, or the selection moved away from it, by the user or because
    // another Thread became primary.
    setFocus(focus.shown ? { ...focus, threadId: null } : { ...focus, shown: true });
  }
  return {
    requestFor: (threadId: ThreadId | null) =>
      threadId !== null && focus.shown && focus.threadId === threadId ? focus.requestId : null,
    release: () => setFocus((current) => ({ ...current, threadId: null })),
  };
}

export function WorkbenchFloatingChat(props: WorkbenchFloatingChatProps) {
  const { environmentId, label, chat, onOpenThread, onNewThread, newThreadDisabled } = props;
  const { mode, focusRequest, setAvailable, expand, collapse, minimize, restore } =
    useWorkbenchFloatingChatStore();
  const hasThread = chat.selectedThreadId !== null;
  useEffect(() => {
    if (!hasThread) return;
    setAvailable(true);
    return () => setAvailable(false);
  }, [hasThread, setAvailable]);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Set by the control that changes the mode, so focus moves only after a user action.
  const pendingFocusRef = useRef(false);
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    (mode === "launcher" ? launcherRef : expandButtonRef).current?.focus();
  }, [mode]);

  const composerFocus = useComposerFocusRequest(focusRequest, chat.selectedThreadId);
  const selectThread = (threadId: ThreadId) => {
    composerFocus.release();
    props.onSelectThread(threadId);
  };
  const changeMode = (change: () => void) => {
    composerFocus.release();
    pendingFocusRef.current = true;
    change();
  };

  if (mode === "launcher") {
    return (
      <FloatingChatLauncher
        label={label}
        attentionCount={chat.attentionCount}
        buttonRef={launcherRef}
        onRestore={() => changeMode(restore)}
      />
    );
  }

  const selected = chat.tabs.find((thread) => thread.threadId === chat.selectedThreadId) ?? null;
  const expanded = mode === "expanded" && selected !== null;
  return (
    <FloatingChatFrame label={label} expanded={expanded}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {selected === null ? (
          <>
            <span className="min-w-0 flex-1 truncate ps-2 text-xs font-medium">Ticket chat</span>
            <FloatingChatMenu chat={chat} onSelect={selectThread} onOpenThread={onOpenThread} />
          </>
        ) : (
          <>
            <FloatingChatTabs
              tabs={chat.tabs}
              selectedThreadId={selected.threadId}
              onSelect={selectThread}
            />
            <FloatingChatAction
              label="New Thread"
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New Thread"
                  disabled={newThreadDisabled}
                  onClick={onNewThread}
                />
              }
            >
              <PlusIcon />
            </FloatingChatAction>
            <FloatingChatMenu chat={chat} onSelect={selectThread} onOpenThread={onOpenThread} />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
            <FloatingChatAction
              label="Open full Thread"
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open full Thread"
                  onClick={() => onOpenThread(selected.threadId)}
                />
              }
            >
              <SquareArrowOutUpRightIcon />
            </FloatingChatAction>
            <FloatingChatToggle
              expanded={expanded}
              buttonRef={expandButtonRef}
              onToggle={expanded ? () => changeMode(collapse) : () => expand()}
            />
          </>
        )}
        <FloatingChatAction
          label="Minimize ticket chat"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Minimize ticket chat"
              onClick={() => changeMode(minimize)}
            />
          }
        >
          <MinusIcon />
        </FloatingChatAction>
      </div>
      <FloatingChatBody
        environmentId={environmentId}
        label={label}
        selected={selected}
        hasHistory={chat.settled.length > 0 || chat.archived.length > 0}
        expanded={expanded}
        composerFocusRequest={composerFocus.requestFor(selected?.threadId ?? null)}
        onExpand={() => expand()}
        onOpenThread={onOpenThread}
        onNewThread={onNewThread}
        newThreadDisabled={newThreadDisabled}
      />
    </FloatingChatFrame>
  );
}
