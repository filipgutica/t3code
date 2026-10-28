import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { useEffect } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { WorkbenchFloatingChat } from "./WorkbenchFloatingChat";
import {
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
  type WorkbenchFloatingChatTicket,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { getWorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";
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

const chatThreads = (
  assignments: ReadonlyArray<WorkbenchAssignment>,
  threadsById: ThreadsById,
  recaps: ReadonlyMap<ThreadId, string>,
  ticket: WorkbenchFloatingChatTicket,
): WorkbenchFloatingChatThread[] =>
  assignments.flatMap(({ threadId }) => {
    const thread = threadsById.get(threadId);
    return thread
      ? [
          {
            threadId,
            title: thread.title,
            status: getWorkbenchThreadExecutionStatus(thread),
            ticket,
            recap: recaps.get(threadId) ?? null,
          },
        ]
      : [];
  });

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
}

/** The ticket's Threads in the floating chat. Narrow screens keep the header's Open thread. */
export function WorkbenchTicketFloatingChat({
  enabled,
  ...props
}: WorkbenchTicketFloatingChatProps) {
  const narrow = useMediaQuery("max-sm");
  if (!enabled || narrow) return null;
  return <TicketFloatingChat {...props} />;
}

function TicketFloatingChat(props: Omit<WorkbenchTicketFloatingChatProps, "enabled">) {
  const { ticket, onNewThread, environmentId } = props;
  const ticketId = ticket.id;
  const pageChatKey = `${environmentId}:ticket:${ticketId}`;
  const explicitThreadId = useWorkbenchFloatingChatStore(
    (state) => state.pickedThreads[pageChatKey] ?? null,
  );
  const setExplicitThreadId = (threadId: ThreadId) =>
    useWorkbenchFloatingChatStore.getState().pickThread(pageChatKey, threadId);
  useEffect(() => {
    const { setPageChat, pickThread, expand } = useWorkbenchFloatingChatStore.getState();
    setPageChat({
      environmentId,
      kind: "ticket",
      ticketId,
      showThread: (threadId) => {
        pickThread(pageChatKey, threadId);
        expand(threadId);
      },
    });
    return () => setPageChat(null);
  }, [environmentId, ticketId, pageChatKey]);
  const recaps = useWorkbenchThreadRecaps(environmentId);
  const chatTicket = {
    id: ticketId,
    key: props.ticketKey ?? null,
    title: ticket.title,
    kind: ticket.kind,
  };
  const chat = resolveWorkbenchFloatingChat({
    active: chatThreads(props.activeAssignments, props.threadsById, recaps, chatTicket),
    archived: chatThreads(props.activeAssignments, props.archivedThreadsById, recaps, chatTicket),
    settled: chatThreads(props.settledAssignments, props.threadsById, recaps, chatTicket),
    primaryThreadId: props.primaryAssignment?.threadId ?? null,
    explicitThreadId,
  });
  return (
    <WorkbenchFloatingChat
      environmentId={props.environmentId}
      kind="ticket"
      label={props.ticketKey ?? ticket.title}
      chat={chat}
      onSelectThread={setExplicitThreadId}
      onOpenThread={props.onOpenThread}
      onNewThread={() => onNewThread(ticket)}
      // The same conditions that disable Create Thread in the ticket's Threads panel.
      newThreadDisabled={props.pending || props.threadMutationsDisabled || props.isArchived}
    />
  );
}
