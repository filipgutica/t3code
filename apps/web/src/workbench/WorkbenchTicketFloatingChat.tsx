import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { useUiStateStore } from "../uiStateStore";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { useRefreshOnThreadActivity } from "./useWorkbenchTicketConversation";
import { WorkbenchFloatingChat, type WorkbenchFloatingChatPlanning } from "./WorkbenchFloatingChat";
import {
  getWorkbenchOfflineChatThreads,
  getWorkbenchTicketChatThreads,
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { useWorkbenchRemoteRefs } from "./WorkbenchRemoteRefs";
import { useWorkbenchThreadRecaps } from "./useWorkbenchThreadRecaps";

type ThreadsById = ReadonlyMap<ThreadId, EnvironmentThreadShell>;

/** Bottom padding that keeps the ticket's last content reachable above the floating chat. */
export const getWorkbenchFloatingChatInset = (enabled: boolean) =>
  enabled
    ? {
        // One scroll container below 64rem; each column scrolls on its own from there.
        form: "pb-32 @min-[64rem]/ticket:pb-6",
        column: "@min-[64rem]/ticket:pb-32",
      }
    : { form: undefined, column: undefined };

interface WorkbenchTicketFloatingChatProps {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly ticketKey: string | undefined;
  readonly activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  readonly settledAssignments: ReadonlyArray<WorkbenchAssignment>;
  readonly primaryAssignment: WorkbenchAssignment | undefined;
  readonly threadsById: ThreadsById;
  readonly archivedThreadsById: ThreadsById;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onNewThread: (ticket: WorkbenchTicket) => void;
  readonly pending: boolean;
  readonly threadMutationsDisabled: boolean;
  readonly isArchived: boolean;
  readonly planning: WorkbenchFloatingChatPlanning | undefined;
}

/** The ticket's Threads in the floating chat. Narrow screens open Threads on their own page. */
export function WorkbenchTicketFloatingChat({
  enabled,
  ...props
}: WorkbenchTicketFloatingChatProps) {
  const narrow = useMediaQuery("max-sm");
  if (!enabled || (narrow && !props.planning)) return null;
  return <TicketFloatingChat {...props} />;
}

function TicketFloatingChat(props: Omit<WorkbenchTicketFloatingChatProps, "enabled">) {
  const { ticket, onNewThread, environmentId } = props;
  const ticketId = ticket.id;
  const pageChatKey = `${environmentId}:ticket:${ticketId}`;
  const pick = useWorkbenchFloatingChatStore((state) => state.pickedThreads[pageChatKey] ?? null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the mounted Ticket chat as the target for imperative show-Thread actions and removes the registration on unmount
  useEffect(() => {
    const { setPageChat, pickThread, expand } = useWorkbenchFloatingChatStore.getState();
    setPageChat({
      environmentId,
      kind: "ticket",
      ticketId,
      showThread: (threadId) => {
        pickThread(pageChatKey, scopeThreadRef(environmentId, threadId));
        expand(threadId);
      },
    });
    return () => setPageChat(null);
  }, [environmentId, ticketId, pageChatKey]);
  const recaps = useWorkbenchThreadRecaps(environmentId);
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const remoteRefs = useWorkbenchRemoteRefs();
  const resolved = resolveWorkbenchFloatingChat({
    ...getWorkbenchTicketChatThreads({
      ticket: { id: ticketId, key: props.ticketKey ?? null, title: ticket.title },
      activeAssignments: props.activeAssignments,
      settledAssignments: props.settledAssignments,
      threadsById: props.threadsById,
      archivedThreadsById: props.archivedThreadsById,
      offlineThreads: getWorkbenchOfflineChatThreads({
        assignments: props.activeAssignments,
        remoteRefs,
      }),
      recaps,
      localVisits,
    }),
    primaryThreadId: props.primaryAssignment?.threadId ?? null,
    pick,
  });
  const setExplicitThreadId = (threadId: ThreadId) => {
    const threadEnvironmentId =
      (props.threadsById.get(threadId) ?? props.archivedThreadsById.get(threadId))?.environmentId ??
      environmentId;
    useWorkbenchFloatingChatStore
      .getState()
      .pickThread(pageChatKey, scopeThreadRef(threadEnvironmentId, threadId));
  };
  const snapshot = useEnvironmentQuery(workbenchEnvironment.snapshot({ environmentId, input: {} }));
  const markPlanning = (thread: WorkbenchFloatingChatThread) => ({
    ...thread,
    planning: props.planning?.threadIds.has(thread.threadId) === true,
  });
  const chat = {
    ...resolved,
    active: resolved.active.map(markPlanning),
    settled: resolved.settled.map(markPlanning),
    selected: resolved.selected ? markPlanning(resolved.selected) : null,
  };
  useRefreshOnThreadActivity(
    chat.selected ? scopeThreadRef(chat.selected.environmentId, chat.selected.threadId) : null,
    snapshot.refresh,
  );
  return (
    <WorkbenchFloatingChat
      kind="ticket"
      label={props.ticketKey ?? ticket.title}
      chat={chat}
      onSelectThread={setExplicitThreadId}
      onOpenThread={props.onOpenThread}
      onNewThread={() => onNewThread(ticket)}
      // The same conditions that disable Create Thread in the ticket's Threads panel.
      newThreadDisabled={props.pending || props.threadMutationsDisabled || props.isArchived}
      planning={props.planning}
    />
  );
}
