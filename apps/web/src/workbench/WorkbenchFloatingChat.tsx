import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilePenLineIcon,
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
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { MenuItem, MenuItemLabel } from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import "./WorkbenchFloatingChat.css";
import type {
  resolveWorkbenchFloatingChat,
  WorkbenchFloatingChatThread,
  WorkbenchFloatingChatTicket,
} from "./workbenchFloatingChat.logic";
import {
  useWorkbenchFloatingChatStore,
  type WorkbenchFloatingChatFocusRequest,
} from "./workbenchFloatingChatState";
import { WorkbenchFloatingChatPicker } from "./WorkbenchFloatingChatPicker";
import { useOpenWorkbenchPullRequest } from "./WorkbenchPullRequestPreview";
import { WorkbenchTicketKindIcon } from "./WorkbenchTicketMetadata";
import {
  useWorkbenchFloatingChatSize,
  type WorkbenchFloatingChatResizeEdge,
} from "./useWorkbenchFloatingChatSize";

type FloatingChat = ReturnType<typeof resolveWorkbenchFloatingChat>;

/** The page the chat belongs to; the board's New Thread starts a ticket draft. */
type WorkbenchFloatingChatKind = "ticket" | "board";

const CHAT_COPY = {
  ticket: {
    title: "Ticket chat",
    threads: "Ticket Threads",
    newThread: "New Thread",
    startThread: "Start Thread",
    emptyHint: "A Thread works in this ticket's workspace.",
  },
  board: {
    title: "Board chat",
    threads: "Board Threads",
    newThread: "New ticket draft",
    startThread: "Draft a ticket",
    emptyHint: "A ticket draft starts a planning Thread here.",
  },
} satisfies Record<WorkbenchFloatingChatKind, Record<string, string>>;
type ChatCopy = (typeof CHAT_COPY)[WorkbenchFloatingChatKind];

export interface WorkbenchFloatingChatProps {
  readonly environmentId: EnvironmentId;
  readonly kind: WorkbenchFloatingChatKind;
  /** Names the panel for assistive technology, such as the ticket key. */
  readonly label: string;
  readonly chat: FloatingChat;
  readonly onSelectThread: (threadId: ThreadId) => void;
  /** Opens the Thread route, restoring an archived Thread first. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onNewThread: () => void;
  readonly newThreadDisabled: boolean;
  /** The board's new Thread on the showing Thread's ticket; null when it has none. */
  readonly ticketThread?: WorkbenchFloatingChatTicketThread | null;
  readonly planning?: WorkbenchFloatingChatPlanning | undefined;
}

export interface WorkbenchFloatingChatTicketThread {
  readonly ticket: WorkbenchFloatingChatTicket;
  readonly disabled: boolean;
  readonly onStart: () => void;
}

/**
 * Ticket draft Threads stay read-only until work starts, and `render` replaces the ticket
 * proposal history around their conversation with the draft's own proposals and actions.
 */
export interface WorkbenchFloatingChatPlanning {
  readonly threadIds: ReadonlySet<ThreadId>;
  readonly render: (threadId: ThreadId, conversation: ReactNode) => ReactNode;
}

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

function FloatingChatLauncher({
  copy,
  label,
  attentionCount,
  buttonRef,
  onRestore,
}: {
  readonly copy: ChatCopy;
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
      <TooltipPopup>{copy.title}</TooltipPopup>
    </Tooltip>
  );
}

function FloatingChatEmpty({
  copy,
  label,
  hasHistory,
  disabled,
  onNewThread,
}: {
  readonly copy: ChatCopy;
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
          : `No Threads on ${label} yet. ${copy.emptyHint}`}
      </p>
      <Button size="sm" disabled={disabled} onClick={onNewThread}>
        <PlusIcon />
        {copy.startThread}
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

// The embed hides the right panel, so a file or diff the user opens from the timeline
// continues in the full Thread, where the right panel shows it.
function useOpenThreadOnPanelAction(threadRef: ScopedThreadRef, onOpen: () => void) {
  const threadKey = scopedThreadKey(threadRef);
  const open = useEffectEvent(onOpen);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to native panel actions so an embedded conversation can open its full Thread, then releases the subscription
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
  planning,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: WorkbenchFloatingChatThread;
  readonly composerFocusRequest: number | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly planning: WorkbenchFloatingChatPlanning | undefined;
}) {
  const threadRef = scopeThreadRef(environmentId, thread.threadId);
  const openThread = () => onOpenThread(thread.threadId);
  useOpenThreadOnPanelAction(threadRef, openThread);
  const openPullRequest = useOpenWorkbenchPullRequest();
  const planningThread = planning?.threadIds.has(thread.threadId) === true;
  // Pull request links open in the page's preview, so the user stays on the Board or Ticket.
  const conversation = (
    <ChangeRequestLinkOpenProvider value={openPullRequest}>
      <ChatView
        key={thread.threadId}
        environmentId={environmentId}
        threadId={thread.threadId}
        routeKind="server"
        hideHeader
        readOnlyPlanning={planningThread}
        workbenchEmbed={{ composerFocusRequest, openThread }}
      />
    </ChangeRequestLinkOpenProvider>
  );
  return (
    <div role="region" aria-label={thread.title} className="flex min-h-0 flex-1 flex-col">
      {planning && planningThread ? planning.render(thread.threadId, conversation) : conversation}
    </div>
  );
}

function FloatingChatBody({
  environmentId,
  copy,
  label,
  selected,
  hasHistory,
  expanded,
  composerFocusRequest,
  onExpand,
  onOpenThread,
  onNewThread,
  newThreadDisabled,
  planning,
}: {
  readonly environmentId: EnvironmentId;
  readonly copy: ChatCopy;
  readonly label: string;
  readonly selected: WorkbenchFloatingChatThread | null;
  readonly hasHistory: boolean;
  readonly expanded: boolean;
  readonly composerFocusRequest: number | null;
  readonly onExpand: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onNewThread: () => void;
  readonly newThreadDisabled: boolean;
  readonly planning: WorkbenchFloatingChatPlanning | undefined;
}) {
  if (selected === null) {
    return (
      <FloatingChatEmpty
        copy={copy}
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
      planning={planning}
    />
  );
}

function FloatingChatToggle({
  copy,
  expanded,
  buttonRef,
  onToggle,
}: {
  readonly copy: ChatCopy;
  readonly expanded: boolean;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onToggle: () => void;
}) {
  const chatName = copy.title.toLowerCase();
  const label = expanded ? `Collapse ${chatName}` : `Expand ${chatName}`;
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
        "absolute right-4 bottom-4 z-20 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col rounded-2xl border border-border/80 bg-popover/92 shadow-lg/20 backdrop-blur-xl",
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
      <div data-workbench-floating-chat-content="" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </section>
  );
}

// An explicit expand focuses one composer once: the requested Thread's, or the one showing.
// A requested Thread can appear after the request, such as a Thread created moments ago.
// Switching Threads, collapsing, or opening another ticket leaves focus where the user put it.
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

/** The Thread menu's last items: a new Thread, or on the board, its ticket's Thread or a draft. */
function NewThreadItems({
  kind,
  copy,
  newThreadDisabled,
  ticketThread,
  onNewThread,
}: {
  readonly kind: WorkbenchFloatingChatKind;
  readonly copy: ChatCopy;
  readonly newThreadDisabled: boolean;
  readonly ticketThread: WorkbenchFloatingChatProps["ticketThread"];
  readonly onNewThread: () => void;
}) {
  return (
    <>
      {ticketThread ? (
        <MenuItem disabled={ticketThread.disabled} onClick={ticketThread.onStart}>
          <WorkbenchTicketKindIcon kind={ticketThread.ticket.kind} />
          <MenuItemLabel>
            New Thread on {ticketThread.ticket.key ?? ticketThread.ticket.title}
          </MenuItemLabel>
        </MenuItem>
      ) : null}
      <MenuItem disabled={newThreadDisabled} onClick={onNewThread}>
        {kind === "board" ? <FilePenLineIcon /> : <PlusIcon />}
        <MenuItemLabel>{copy.newThread}</MenuItemLabel>
      </MenuItem>
    </>
  );
}

function FloatingChatThreadActions({
  copy,
  expanded,
  toggleRef,
  onOpenThread,
  onToggle,
}: {
  readonly copy: ChatCopy;
  readonly expanded: boolean;
  readonly toggleRef: Ref<HTMLButtonElement>;
  readonly onOpenThread: () => void;
  readonly onToggle: () => void;
}) {
  return (
    <>
      <FloatingChatAction
        label="Open full Thread"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open full Thread"
            onClick={onOpenThread}
          />
        }
      >
        <SquareArrowOutUpRightIcon />
      </FloatingChatAction>
      <FloatingChatToggle
        copy={copy}
        expanded={expanded}
        buttonRef={toggleRef}
        onToggle={onToggle}
      />
    </>
  );
}

export function WorkbenchFloatingChat(props: WorkbenchFloatingChatProps) {
  const { environmentId, label, chat, onOpenThread, onNewThread, newThreadDisabled } = props;
  const copy = CHAT_COPY[props.kind];
  const { mode, focusRequest, expand, collapse, minimize, restore } =
    useWorkbenchFloatingChatStore();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Set by the control that changes the mode, so focus moves only after a user action.
  const pendingFocusRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the newly mounted chat control after the requested expand/minimize DOM change commits
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    (mode === "launcher" ? launcherRef : expandButtonRef).current?.focus();
  }, [mode]);

  const { selected } = chat;
  const selectedThreadId = selected?.threadId ?? null;
  const composerFocus = useComposerFocusRequest(focusRequest, selectedThreadId);
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
        copy={copy}
        label={label}
        attentionCount={chat.attentionCount}
        buttonRef={launcherRef}
        onRestore={() => changeMode(restore)}
      />
    );
  }

  const expanded = mode === "expanded" && selected !== null;
  const hasHistory = chat.settled.length > 0 || chat.archived.length > 0;
  return (
    <FloatingChatFrame label={label} expanded={expanded}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {selected === null && !hasHistory ? (
          <span className="min-w-0 flex-1 truncate ps-2 text-xs font-medium">{copy.title}</span>
        ) : (
          <WorkbenchFloatingChatPicker
            environmentId={environmentId}
            chat={chat}
            grouped={props.kind === "board"}
            title={copy.title}
            listLabel={copy.threads}
            onSelect={selectThread}
            onOpenThread={onOpenThread}
            actions={
              <NewThreadItems
                kind={props.kind}
                copy={copy}
                newThreadDisabled={newThreadDisabled}
                ticketThread={props.ticketThread}
                onNewThread={onNewThread}
              />
            }
          />
        )}
        {selected === null ? null : (
          <FloatingChatThreadActions
            copy={copy}
            expanded={expanded}
            toggleRef={expandButtonRef}
            onOpenThread={() => onOpenThread(selected.threadId)}
            onToggle={expanded ? () => changeMode(collapse) : () => expand()}
          />
        )}
        <FloatingChatAction
          label={`Minimize ${copy.title.toLowerCase()}`}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Minimize ${copy.title.toLowerCase()}`}
              onClick={() => changeMode(minimize)}
            />
          }
        >
          <MinusIcon />
        </FloatingChatAction>
      </div>
      <FloatingChatBody
        environmentId={environmentId}
        copy={copy}
        label={label}
        selected={selected}
        hasHistory={hasHistory}
        expanded={expanded}
        composerFocusRequest={composerFocus.requestFor(selectedThreadId)}
        onExpand={() => expand()}
        onOpenThread={onOpenThread}
        onNewThread={onNewThread}
        newThreadDisabled={newThreadDisabled}
        planning={props.planning}
      />
    </FloatingChatFrame>
  );
}
