import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilePenLineIcon,
  MessageCircleIcon,
  MinusIcon,
  PlusIcon,
  SquareArrowOutUpRightIcon,
  SquareMenuIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { MenuItem, MenuItemLabel } from "../components/ui/menu";
import { PopoverCreateHandle, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import { cn } from "../lib/utils";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
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
  type WorkbenchFloatingChatMode,
} from "./workbenchFloatingChatState";
import { WorkbenchFloatingChatPicker } from "./WorkbenchFloatingChatPicker";
import { useWorkbenchPanelHost, useWorkbenchThreadPanel } from "./WorkbenchPagePanel";
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
  overPanel,
  onRestore,
}: {
  readonly copy: ChatCopy;
  readonly label: string;
  readonly attentionCount: number;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly overPanel: boolean;
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
            className={cn(
              "absolute right-4 bottom-4 z-20 grid size-11 place-items-center rounded-full border border-border/80 bg-popover/92 text-foreground shadow-lg/20 backdrop-blur-xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              overPanel && "pointer-events-auto visible",
            )}
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

/** The Thread details popover's handle, anchored to the chat header as on Thread pages. */
interface FloatingChatThreadDetails {
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly handle: ReturnType<typeof PopoverCreateHandle>;
}

function FloatingChatThread({
  environmentId,
  thread,
  hidden,
  composerFocusRequest,
  panelHost,
  threadDetails,
  onOpenThread,
  planning,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: WorkbenchFloatingChatThread;
  readonly hidden: boolean;
  readonly composerFocusRequest: number | null;
  readonly panelHost: HTMLElement | null;
  readonly threadDetails: FloatingChatThreadDetails;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly planning: WorkbenchFloatingChatPlanning | undefined;
}) {
  const openThread = () => onOpenThread(thread.threadId);
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
        workbenchEmbed={{
          composerFocusRequest,
          openThread,
          panelHost,
          threadDetails,
          conversationHidden: hidden,
        }}
      />
    </ChangeRequestLinkOpenProvider>
  );
  return (
    <div
      role="region"
      aria-label={thread.title}
      className={cn("flex min-h-0 flex-1 flex-col", hidden && "hidden")}
    >
      {planning && planningThread ? planning.render(thread.threadId, conversation) : conversation}
    </div>
  );
}

/**
 * The conversation stays mounted, hidden, while its Thread's panel is open, so collapsing the
 * chat keeps the panel; hidden, it does not mark the Thread read. Otherwise only an expanded chat
 * mounts it.
 */
function FloatingChatBody({
  environmentId,
  copy,
  label,
  selected,
  hasHistory,
  expanded,
  mounted,
  composerFocusRequest,
  panelHost,
  threadDetails,
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
  readonly mounted: boolean;
  readonly composerFocusRequest: number | null;
  readonly panelHost: HTMLElement | null;
  readonly threadDetails: FloatingChatThreadDetails;
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
  return (
    <>
      {expanded ? null : <FloatingChatPlaceholder title={selected.title} onExpand={onExpand} />}
      {mounted ? (
        <FloatingChatThread
          environmentId={environmentId}
          thread={selected}
          hidden={!expanded}
          composerFocusRequest={composerFocusRequest}
          panelHost={panelHost}
          threadDetails={threadDetails}
          onOpenThread={onOpenThread}
          planning={planning}
        />
      ) : null}
    </>
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
  hidden,
  overPanel,
  children,
}: {
  readonly label: string;
  readonly expanded: boolean;
  readonly hidden: boolean;
  /** Shows the chat over a maximized panel, which the invisible page column sits above. */
  readonly overPanel: boolean;
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
        hidden && "hidden",
        overPanel && "pointer-events-auto visible",
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
  detailsHandle,
  toggleRef,
  onOpenThread,
  onToggle,
}: {
  readonly copy: ChatCopy;
  readonly expanded: boolean;
  /** Null while the conversation, which renders the details, is collapsed. */
  readonly detailsHandle: FloatingChatThreadDetails["handle"] | null;
  readonly toggleRef: Ref<HTMLButtonElement>;
  readonly onOpenThread: () => void;
  readonly onToggle: () => void;
}) {
  return (
    <>
      {detailsHandle ? (
        <FloatingChatAction label="Thread details" render={<span className="flex shrink-0" />}>
          <PopoverTrigger
            handle={detailsHandle}
            render={<Button variant="ghost" size="icon-sm" aria-label="Thread details" />}
          >
            <SquareMenuIcon />
          </PopoverTrigger>
        </FloatingChatAction>
      ) : null}
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

/**
 * The chat's layout around the showing Thread's page panel. Publishes the Thread so page pull
 * request links open in its panel. Narrow windows show the panel as the native sheet, which
 * minimizes the chat.
 */
function useFloatingChatLayout(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  mode: WorkbenchFloatingChatMode,
) {
  const threadRef = threadId === null ? null : scopeThreadRef(environmentId, threadId);
  const { open, maximized } = useWorkbenchThreadPanel(threadRef);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the showing Thread to the page's pull request opener and clears it when the chat leaves
  useEffect(() => {
    if (threadId === null) return;
    const { setShownThread } = useWorkbenchFloatingChatStore.getState();
    setShownThread(scopeThreadRef(environmentId, threadId));
    return () => setShownThread(null);
  }, [environmentId, threadId]);
  const sheetLayout = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  /** Closes the open sheet, which brings the chat back; null while no sheet is open. */
  const closeSheet =
    sheetLayout && open && !maximized && threadRef
      ? () => useRightPanelStore.getState().close(threadRef)
      : null;
  const launcher = mode === "launcher" || closeSheet !== null;
  const expanded = !launcher && mode === "expanded" && threadId !== null;
  return { launcher, expanded, mounted: expanded || open, maximized, closeSheet };
}

/** The Thread menu and the chat's actions. */
function FloatingChatHeader({
  chatProps,
  copy,
  hasHistory,
  expanded,
  detailsHandle,
  detailsAnchorRef,
  toggleRef,
  onSelect,
  onToggle,
  onMinimize,
}: {
  readonly chatProps: WorkbenchFloatingChatProps;
  readonly copy: ChatCopy;
  readonly hasHistory: boolean;
  readonly expanded: boolean;
  readonly detailsHandle: FloatingChatThreadDetails["handle"];
  readonly detailsAnchorRef: Ref<HTMLDivElement>;
  readonly toggleRef: Ref<HTMLButtonElement>;
  readonly onSelect: (threadId: ThreadId) => void;
  readonly onToggle: () => void;
  readonly onMinimize: () => void;
}) {
  const { chat, onOpenThread } = chatProps;
  const { selected } = chat;
  return (
    <div
      ref={detailsAnchorRef}
      className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2"
    >
      {selected === null && !hasHistory ? (
        <span className="min-w-0 flex-1 truncate ps-2 text-xs font-medium">{copy.title}</span>
      ) : (
        <WorkbenchFloatingChatPicker
          environmentId={chatProps.environmentId}
          chat={chat}
          grouped={chatProps.kind === "board"}
          title={copy.title}
          listLabel={copy.threads}
          onSelect={onSelect}
          onOpenThread={onOpenThread}
          actions={
            <NewThreadItems
              kind={chatProps.kind}
              copy={copy}
              newThreadDisabled={chatProps.newThreadDisabled}
              ticketThread={chatProps.ticketThread}
              onNewThread={chatProps.onNewThread}
            />
          }
        />
      )}
      {selected === null ? null : (
        <FloatingChatThreadActions
          copy={copy}
          expanded={expanded}
          // The hidden conversation measures 0px, which would strip the details card.
          detailsHandle={expanded ? detailsHandle : null}
          toggleRef={toggleRef}
          onOpenThread={() => onOpenThread(selected.threadId)}
          onToggle={onToggle}
        />
      )}
      <FloatingChatAction
        label={`Minimize ${copy.title.toLowerCase()}`}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Minimize ${copy.title.toLowerCase()}`}
            onClick={onMinimize}
          />
        }
      >
        <MinusIcon />
      </FloatingChatAction>
    </div>
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
  const { launcher, expanded, mounted, maximized, closeSheet } = useFloatingChatLayout(
    environmentId,
    selectedThreadId,
    mode,
  );
  const panelHost = useWorkbenchPanelHost();
  const [detailsHandle] = useState(PopoverCreateHandle);
  const detailsAnchorRef = useRef<HTMLDivElement>(null);
  const threadDetails = { anchor: detailsAnchorRef, handle: detailsHandle };
  const hasHistory = chat.settled.length > 0 || chat.archived.length > 0;
  return (
    <>
      {launcher ? (
        <FloatingChatLauncher
          copy={copy}
          label={label}
          attentionCount={chat.attentionCount}
          buttonRef={launcherRef}
          overPanel={maximized}
          onRestore={closeSheet ?? (() => changeMode(restore))}
        />
      ) : null}
      <FloatingChatFrame label={label} expanded={expanded} hidden={launcher} overPanel={maximized}>
        <FloatingChatHeader
          chatProps={props}
          copy={copy}
          hasHistory={hasHistory}
          expanded={expanded}
          detailsHandle={detailsHandle}
          detailsAnchorRef={detailsAnchorRef}
          toggleRef={expandButtonRef}
          onSelect={selectThread}
          onToggle={expanded ? () => changeMode(collapse) : () => expand()}
          onMinimize={() => changeMode(minimize)}
        />
        <FloatingChatBody
          environmentId={environmentId}
          copy={copy}
          label={label}
          selected={selected}
          hasHistory={hasHistory}
          expanded={expanded}
          mounted={mounted}
          composerFocusRequest={composerFocus.requestFor(selectedThreadId)}
          panelHost={panelHost}
          threadDetails={threadDetails}
          onExpand={() => expand()}
          onOpenThread={onOpenThread}
          onNewThread={onNewThread}
          newThreadDisabled={newThreadDisabled}
          planning={props.planning}
        />
      </FloatingChatFrame>
    </>
  );
}
