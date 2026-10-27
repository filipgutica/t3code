import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketDraft,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { getAssignmentsForTicket } from "./workbench.logic";
import { getConversationDraftTitle } from "./workbenchTicketDraft.logic";
import {
  getWorkbenchThreadExecutionStatus,
  type WorkbenchThreadExecutionStatus,
} from "./workbenchThreadStatus.logic";

export interface WorkbenchFloatingChatTicket {
  readonly id: WorkbenchTicketId;
  readonly key: string | null;
  readonly title: string;
}

export interface WorkbenchFloatingChatThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: WorkbenchThreadExecutionStatus | null;
  /** The board groups Threads by ticket; null for ticket drafts and in a ticket's own chat. */
  readonly ticket: WorkbenchFloatingChatTicket | null;
  /** A generated summary of the Thread's latest finished run. */
  readonly recap: string | null;
}

export const getWorkbenchFloatingChatTicketLabel = (ticket: WorkbenchFloatingChatTicket) =>
  ticket.key ? `${ticket.key} · ${ticket.title}` : ticket.title;

/** Names a Thread outside its ticket group, where the title alone can repeat across tickets. */
export const getWorkbenchFloatingChatThreadLabel = (thread: WorkbenchFloatingChatThread) =>
  thread.ticket ? `${thread.ticket.key ?? thread.ticket.title} · ${thread.title}` : thread.title;

export const getWorkbenchBoardChatThreads = ({
  projectId,
  tickets,
  assignments,
  drafts,
  threadsById,
  archivedThreadsById,
  recaps,
}: {
  readonly projectId: WorkbenchProjectId;
  /** Tickets in board order, before any board search or status filtering. */
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly drafts: ReadonlyArray<WorkbenchTicketDraft>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly recaps: ReadonlyMap<ThreadId, string>;
}) => {
  const boardTickets = tickets.filter((ticket) => ticket.projectId === projectId);
  const ticketsById = new Map(boardTickets.map((ticket) => [ticket.id, ticket]));
  const active: WorkbenchFloatingChatThread[] = [];
  const settled: WorkbenchFloatingChatThread[] = [];
  const archived: WorkbenchFloatingChatThread[] = [];
  const seen = new Set<ThreadId>();
  const addThread = (
    threadId: ThreadId,
    ticket: WorkbenchTicket | undefined,
    title: (thread: EnvironmentThreadShell) => string = (thread) => thread.title,
  ) => {
    if (seen.has(threadId)) return;
    const live = threadsById.get(threadId);
    const thread = live ?? archivedThreadsById.get(threadId);
    if (!thread) return;
    seen.add(threadId);
    const entry: WorkbenchFloatingChatThread = {
      threadId,
      title: title(thread),
      status: getWorkbenchThreadExecutionStatus(thread),
      ticket: ticket
        ? { id: ticket.id, key: ticket.jiraIssue?.key ?? null, title: ticket.title }
        : null,
      recap: recaps.get(threadId) ?? null,
    };
    if (!live) archived.push(entry);
    else if (thread.settledOverride === "settled") settled.push(entry);
    else active.push(entry);
  };

  for (const draft of drafts) {
    if (draft.projectId !== projectId || draft.phase === "working") continue;
    const ticket = ticketsById.get(draft.id);
    addThread(
      draft.threadId,
      ticket,
      ticket ? undefined : (thread) => getConversationDraftTitle(draft, thread.title),
    );
  }
  for (const ticket of boardTickets) {
    for (const assignment of getAssignmentsForTicket(assignments, ticket.id)) {
      const thread =
        threadsById.get(assignment.threadId) ?? archivedThreadsById.get(assignment.threadId);
      if (assignment.supersededAt !== null && thread?.settledOverride !== "settled") continue;
      addThread(assignment.threadId, ticket);
    }
  }
  return { active, settled, archived };
};

export const WORKBENCH_ATTENTION_KINDS: ReadonlySet<WorkbenchThreadExecutionStatus["kind"]> =
  new Set(["approval", "input", "failed"]);

export function resolveWorkbenchFloatingChat({
  active,
  archived,
  settled,
  primaryThreadId,
  explicitThreadId,
}: {
  /** Live Threads of the ticket's active Assignments, in ticket order. */
  readonly active: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Active Assignments whose Thread is archived; they open on the Thread route after restore. */
  readonly archived: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Live settled Threads. */
  readonly settled: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly primaryThreadId: ThreadId | null;
  readonly explicitThreadId: ThreadId | null;
}) {
  const findIn = (threads: ReadonlyArray<WorkbenchFloatingChatThread>, threadId: ThreadId | null) =>
    threads.find((thread) => thread.threadId === threadId);
  // A Thread the user picked stays selected even when another Thread becomes the primary one.
  const selected =
    findIn(active, explicitThreadId) ??
    findIn(settled, explicitThreadId) ??
    findIn(active, primaryThreadId) ??
    active[0] ??
    null;
  const waiting = active.filter(
    (thread) => thread.status !== null && WORKBENCH_ATTENTION_KINDS.has(thread.status.kind),
  );
  return {
    selected,
    active,
    settled,
    archived,
    /** Every active Thread waiting on the user, for the minimized launcher. */
    attentionCount: waiting.length,
    /** Waiting Threads other than the one showing, in list order, for the header pill. */
    waiting: waiting.filter((thread) => thread !== selected),
  };
}

/** Ticket drafts first, then one group per ticket in list order. */
export const groupWorkbenchFloatingChatThreads = (
  threads: ReadonlyArray<WorkbenchFloatingChatThread>,
) => {
  const groups = new Map<
    WorkbenchTicketId | null,
    { ticket: WorkbenchFloatingChatTicket | null; threads: WorkbenchFloatingChatThread[] }
  >();
  for (const thread of threads) {
    const key = thread.ticket?.id ?? null;
    const group = groups.get(key) ?? { ticket: thread.ticket, threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  const drafts = groups.get(null);
  groups.delete(null);
  return drafts ? [drafts, ...groups.values()] : [...groups.values()];
};

export const filterWorkbenchFloatingChatThreads = (
  threads: ReadonlyArray<WorkbenchFloatingChatThread>,
  query: string,
) => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return threads;
  return threads.filter((thread) =>
    [
      thread.title,
      thread.ticket ? getWorkbenchFloatingChatTicketLabel(thread.ticket) : "",
      thread.recap ?? "",
    ].some((text) => text.toLowerCase().includes(needle)),
  );
};
