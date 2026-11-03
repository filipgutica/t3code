import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  FilePenLineIcon,
  MessageCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SquareArrowOutUpRightIcon,
  SquareMenuIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { PopoverCreateHandle } from "../components/ui/popover";
import { Separator } from "../components/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStableCallback } from "../hooks/useStableCallback";
import { ChangeRequestLinkOpenProvider } from "../lib/openPullRequestLink";
import { cn } from "../lib/utils";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { useRightPanelStore } from "../rightPanelStore";
import { useThreadShell } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { ComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "../components/chat/ChatComposer";
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
import {
  useWorkbenchPageHosts,
  useWorkbenchThreadPanel,
  type WorkbenchPageHosts,
} from "./WorkbenchPagePanel";
import { useOpenWorkbenchPullRequest } from "./WorkbenchPullRequestPreview";
import { WorkbenchTicketIcon } from "./WorkbenchTicketMetadata";
import { useWorkbenchThreadSettlement } from "./useWorkbenchThreadSettlement";
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
  /** Startup or recovery before a draft has a native Thread shell. */
  readonly draftStart?: ReactNode;
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
  readonly row?: ReactNode;
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
  overPanel,
  onRestore,
}: {
  readonly copy: ChatCopy;
  readonly label: string;
  readonly attentionCount: number;
  readonly overPanel: boolean;
  readonly onRestore: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
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
  hosts,
  threadDetails,
  onOpenThread,
  planning,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: WorkbenchFloatingChatThread;
  readonly hidden: boolean;
  readonly composerFocusRequest: number | null;
  readonly hosts: WorkbenchPageHosts;
  readonly threadDetails: FloatingChatThreadDetails;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly planning: WorkbenchFloatingChatPlanning | undefined;
}) {
  const openThread = () => onOpenThread(thread.threadId);
  const openPullRequest = useOpenWorkbenchPullRequest();
  // The page's composer handle belongs to native chats; a hidden floating composer can't take
  // focus, so the command palette returns focus to its opener instead.
  const composerHandle = useRef<ChatComposerHandle | null>(null);
  const planningThread = planning?.threadIds.has(thread.threadId) === true;
  // Pull request links open in the page's preview, so the user stays on the Board or Ticket.
  const conversation = (
    <ChangeRequestLinkOpenProvider value={openPullRequest}>
      <ComposerHandleContext value={composerHandle}>
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
            ...hosts,
            threadDetails,
            conversationHidden: hidden,
          }}
        />
      </ComposerHandleContext>
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
 * The conversation stays mounted, hidden, while its Thread's panel is open or the page shows its
 * terminal and toggles, so collapsing the chat keeps them; hidden, it does not mark the Thread
 * read. Otherwise only an expanded chat mounts it.
 */
function FloatingChatBody({
  chatProps,
  copy,
  selected,
  hasHistory,
  expanded,
  mounted,
  composerFocusRequest,
  hosts,
  threadDetails,
  onExpand,
}: {
  readonly chatProps: WorkbenchFloatingChatProps;
  readonly copy: ChatCopy;
  readonly selected: WorkbenchFloatingChatThread | null;
  readonly hasHistory: boolean;
  readonly expanded: boolean;
  readonly mounted: boolean;
  readonly composerFocusRequest: number | null;
  readonly hosts: WorkbenchPageHosts;
  readonly threadDetails: FloatingChatThreadDetails;
  readonly onExpand: () => void;
}) {
  const {
    environmentId,
    label,
    draftStart,
    onOpenThread,
    onNewThread,
    newThreadDisabled,
    planning,
  } = chatProps;
  if (draftStart) return <div hidden={!expanded}>{draftStart}</div>;
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
          hosts={hosts}
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
  onToggle,
}: {
  readonly copy: ChatCopy;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const chatName = copy.title.toLowerCase();
  const label = expanded ? `Collapse ${chatName}` : `Expand ${chatName}`;
  return (
    <FloatingChatAction
      label={label}
      render={
        <Button
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
          <WorkbenchTicketIcon />
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

/** Settling moves the chat to the ticket's next Thread; a settled Thread offers Un-settle. */
function FloatingChatSettleAction({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement } =
    useWorkbenchThreadSettlement(environmentId);
  if (!shell || !supportsSettlement) return null;
  const label = shell.settledOverride === "settled" ? "Un-settle Thread" : "Settle Thread";
  return (
    <FloatingChatAction
      label={label}
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={!canOperate || settlementPendingThreadId !== null}
          onClick={() => void toggleThreadSettlement(shell)}
        />
      }
    >
      {shell.settledOverride === "settled" ? <RotateCcwIcon /> : <CheckIcon />}
    </FloatingChatAction>
  );
}

/**
 * Thread details and Open full Thread. Details open once the menu has closed, so the menu's
 * focus return to its trigger doesn't count as focus leaving the details popover.
 */
function FloatingChatThreadMenu({
  environmentId,
  threadId,
  detailsAvailable,
  onOpenThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** False while the conversation, which renders the details, is collapsed. */
  readonly detailsAvailable: boolean;
  readonly onOpenThread: () => void;
}) {
  const detailsRequestedRef = useRef(false);
  const openRequestedDetails = (open: boolean) => {
    if (open || !detailsRequestedRef.current) return;
    detailsRequestedRef.current = false;
    useRightPanelStore
      .getState()
      .setThreadPanelOpen(scopeThreadRef(environmentId, threadId), "popover", true);
  };
  return (
    <Menu onOpenChangeComplete={openRequestedDetails}>
      <FloatingChatAction label="Thread actions" render={<span className="flex shrink-0" />}>
        <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Thread actions" />}>
          <EllipsisIcon />
        </MenuTrigger>
      </FloatingChatAction>
      <MenuPopup align="end">
        {detailsAvailable ? (
          <MenuItem onClick={() => (detailsRequestedRef.current = true)}>
            <SquareMenuIcon />
            <MenuItemLabel>Thread details</MenuItemLabel>
          </MenuItem>
        ) : null}
        <MenuItem onClick={onOpenThread}>
          <SquareArrowOutUpRightIcon />
          <MenuItemLabel>Open full Thread</MenuItemLabel>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The chat's layout around the showing Thread's page panel. Publishes the Thread so page pull
 * request links open in its panel. Narrow windows show the panel as the native sheet, which
 * hides the chat behind its launcher.
 */
function useFloatingChatLayout(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  mode: WorkbenchFloatingChatMode,
  /** The page shows the Thread's terminal and toggles, which the mounted conversation renders. */
  keepMounted: boolean,
  hasDraftStart: boolean,
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
  const expanded =
    closeSheet === null && mode === "expanded" && (threadId !== null || hasDraftStart);
  return {
    expanded,
    mounted: expanded || open || keepMounted,
    maximized,
    closeSheet,
  };
}

// What the chat opened on the page: its conversation, its Thread's terminal, and the header toggles.
// Controls that open a Ticket leave the decision to the Ticket chat's Board handoff.
const CHAT_OWNED_SELECTOR =
  "[data-workbench-floating-chat],[data-workbench-terminal-host],[data-workbench-chat-controls],[data-workbench-opens-ticket]";

const isPageClickOutsideChat = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("[data-workbench-page-column]") !== null &&
  target.closest(CHAT_OWNED_SELECTOR) === null;

/**
 * A click on the page collapses the expanded chat. Portaled popovers, menus, dialogs, and the side
 * panel sit outside the page column. A press that starts in the chat, such as a resize, never counts.
 */
function useCollapseOnPageClick(expanded: boolean, releaseComposerFocus: () => void) {
  const collapseStable = useStableCallback(() => {
    releaseComposerFocus();
    useWorkbenchFloatingChatStore.getState().collapse();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a document listener for page clicks outside the chat, held while the chat is expanded
  useEffect(() => {
    if (!expanded) return;
    let pressedOutside = false;
    const onPointerDown = (event: PointerEvent) => {
      pressedOutside = isPageClickOutsideChat(event.target);
    };
    const onClick = (event: MouseEvent) => {
      if (pressedOutside && isPageClickOutsideChat(event.target)) collapseStable();
      pressedOutside = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [expanded, collapseStable]);
}

/** The Thread menu and the chat's actions. */
function FloatingChatHeader({
  chatProps,
  copy,
  hasHistory,
  expanded,
  detailsAnchorRef,
  onSelect,
  onToggle,
}: {
  readonly chatProps: WorkbenchFloatingChatProps;
  readonly copy: ChatCopy;
  readonly hasHistory: boolean;
  readonly expanded: boolean;
  readonly detailsAnchorRef: Ref<HTMLDivElement>;
  readonly onSelect: (threadId: ThreadId) => void;
  readonly onToggle: () => void;
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
        <>
          <FloatingChatSettleAction
            environmentId={chatProps.environmentId}
            threadId={selected.threadId}
          />
          <FloatingChatThreadMenu
            environmentId={chatProps.environmentId}
            threadId={selected.threadId}
            // The hidden conversation measures 0px, which would strip the details card.
            detailsAvailable={expanded}
            onOpenThread={() => onOpenThread(selected.threadId)}
          />
          <Separator orientation="vertical" className="h-4 mx-1" />
        </>
      )}
      {selected !== null || chatProps.draftStart ? (
        <FloatingChatToggle copy={copy} expanded={expanded} onToggle={onToggle} />
      ) : null}
    </div>
  );
}

/**
 * A Ticket opened from the Board keeps the chat on the Board's Thread, in the same mode, when the
 * Ticket has that Thread; otherwise an expanded chat collapses. The Board records its Thread in a
 * layout cleanup, which runs after the Ticket chat's first render but before its layout effect, so
 * the Ticket chat shows nothing until then and never mounts, or marks read, the wrong Thread.
 */
function useBoardTicketHandoff({
  kind,
  environmentId,
  chat,
  onSelectThread,
}: WorkbenchFloatingChatProps) {
  const [ready, setReady] = useState(kind === "board");
  const recordBoardThread = useStableCallback(() => {
    const threadId = chat.selected?.threadId ?? null;
    useWorkbenchFloatingChatStore.getState().setBoardHandoff({
      thread: threadId === null ? null : scopeThreadRef(environmentId, threadId),
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the Board chat's Thread as it unmounts, for the Ticket chat that replaces it
  useLayoutEffect(
    () => (kind === "board" ? recordBoardThread : undefined),
    [kind, recordBoardThread],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the Board's handoff once, before the Ticket chat first paints
  useLayoutEffect(() => {
    if (ready) return;
    const { boardHandoff, mode, setBoardHandoff, collapse } =
      useWorkbenchFloatingChatStore.getState();
    if (boardHandoff !== null) {
      setBoardHandoff(null);
      const { thread } = boardHandoff;
      if (
        thread?.environmentId === environmentId &&
        [...chat.active, ...chat.settled].some(
          (candidate) => candidate.threadId === thread.threadId,
        )
      )
        onSelectThread(thread.threadId);
      else if (mode === "expanded") collapse();
    }
    // oxlint-disable-next-line react/set-state-in-effect -- the Board's handoff exists only after this chat's first commit
    setReady(true);
  }, [ready, environmentId, chat.active, chat.settled, onSelectThread]);
  return ready;
}

export function WorkbenchFloatingChat(props: WorkbenchFloatingChatProps) {
  return useBoardTicketHandoff(props) ? <FloatingChatPanel {...props} /> : null;
}

const isBoardPlanningThread = ({ kind, chat, planning }: WorkbenchFloatingChatProps) =>
  kind === "board" &&
  chat.selected !== null &&
  planning?.threadIds.has(chat.selected.threadId) === true;

function FloatingChatPanel(props: WorkbenchFloatingChatProps) {
  const { environmentId, label, chat } = props;
  const copy = CHAT_COPY[props.kind];
  const { mode, focusRequest, expand, collapse } = useWorkbenchFloatingChatStore();

  const { selected } = chat;
  const selectedThreadId = selected?.threadId ?? null;
  const composerFocus = useComposerFocusRequest(focusRequest, selectedThreadId);
  const selectThread = (threadId: ThreadId) => {
    composerFocus.release();
    props.onSelectThread(threadId);
  };
  const collapseChat = () => {
    composerFocus.release();
    collapse();
  };
  const pageHosts = useWorkbenchPageHosts();
  const boardDraftShown = isBoardPlanningThread(props);
  const hosts = boardDraftShown
    ? { ...pageHosts, terminalHost: null, controlsHost: null }
    : pageHosts;
  const { expanded, mounted, maximized, closeSheet } = useFloatingChatLayout(
    environmentId,
    selectedThreadId,
    mode,
    hosts.controlsHost !== null || boardDraftShown,
    Boolean(props.draftStart),
  );
  useCollapseOnPageClick(expanded, composerFocus.release);
  const [detailsHandle] = useState(PopoverCreateHandle);
  const detailsAnchorRef = useRef<HTMLDivElement>(null);
  const threadDetails = { anchor: detailsAnchorRef, handle: detailsHandle };
  const hasHistory = chat.settled.length > 0 || chat.archived.length > 0;
  return (
    <>
      {closeSheet ? (
        <FloatingChatLauncher
          copy={copy}
          label={label}
          attentionCount={chat.attentionCount}
          overPanel={maximized}
          onRestore={closeSheet}
        />
      ) : null}
      <FloatingChatFrame
        label={label}
        expanded={expanded}
        hidden={closeSheet !== null}
        overPanel={maximized}
      >
        <FloatingChatHeader
          chatProps={props}
          copy={copy}
          hasHistory={hasHistory}
          expanded={expanded}
          detailsAnchorRef={detailsAnchorRef}
          onSelect={selectThread}
          onToggle={expanded ? collapseChat : () => expand()}
        />
        <FloatingChatBody
          chatProps={props}
          copy={copy}
          selected={selected}
          hasHistory={hasHistory}
          expanded={expanded}
          mounted={mounted}
          composerFocusRequest={composerFocus.requestFor(selectedThreadId)}
          hosts={hosts}
          threadDetails={threadDetails}
          onExpand={() => expand()}
        />
      </FloatingChatFrame>
    </>
  );
}
