import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketDraft,
  WorkbenchTicketId,
  WorkbenchTicketKind,
} from "@t3tools/contracts";

import { getAssignmentsForTicket } from "./workbench.logic";
import {
  getTicketIssue,
  getTicketReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import { getConversationDraftTitle } from "./workbenchTicketDraft.logic";
import {
  getWorkbenchThreadExecutionStatus,
  type WorkbenchThreadExecutionStatus,
} from "./workbenchThreadStatus.logic";

export interface WorkbenchFloatingChatTicket {
  readonly id: WorkbenchTicketId;
  /** The first issue Reference label. */
  readonly key: string | null;
  readonly title: string;
  readonly kind: WorkbenchTicketKind;
}

export interface WorkbenchFloatingChatThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: WorkbenchThreadExecutionStatus | null;
  /** Null for a ticket draft that has no ticket yet. */
  readonly ticket: WorkbenchFloatingChatTicket | null;
  /** A generated summary of the Thread's latest finished run. */
  readonly recap: string | null;
}

const getWorkbenchFloatingChatTicketLabel = (ticket: WorkbenchFloatingChatTicket) =>
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
  referencesByTicket,
}: {
  readonly projectId: WorkbenchProjectId;
  /** Tickets in board order, before any board search or status filtering. */
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly drafts: ReadonlyArray<WorkbenchTicketDraft>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly recaps: ReadonlyMap<ThreadId, string>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
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
        ? {
            id: ticket.id,
            key: getTicketIssue(getTicketReferences(referencesByTicket, ticket.id))?.label ?? null,
            title: ticket.title,
            kind: ticket.kind,
          }
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

type WorkbenchStatusThread = Pick<WorkbenchFloatingChatThread, "threadId" | "status">;

export interface WorkbenchThreadStatusSection<Thread extends WorkbenchStatusThread> {
  readonly id: "attention" | "idle" | "settled";
  readonly label: string;
  readonly threads: ReadonlyArray<Thread>;
  /** Working Threads among the idle ones, so a collapsed section still shows activity. */
  readonly workingCount: number;
  readonly openByDefault: boolean;
}

/**
 * Threads by what they need from the user: waiting on them, then idle or working, then settled.
 * Needs attention starts open, as does the section holding the showing Thread; empty ones drop.
 */
export const getWorkbenchThreadStatusSections = <Thread extends WorkbenchStatusThread>({
  active,
  settled,
  showingThreadId,
}: {
  readonly active: ReadonlyArray<Thread>;
  readonly settled: ReadonlyArray<Thread>;
  readonly showingThreadId: ThreadId | null;
}): ReadonlyArray<WorkbenchThreadStatusSection<Thread>> => {
  const needsAttention = (thread: Thread) =>
    thread.status !== null && WORKBENCH_ATTENTION_KINDS.has(thread.status.kind);
  const idle = active.filter((thread) => !needsAttention(thread));
  const sections = [
    { id: "attention", label: "Needs attention", threads: active.filter(needsAttention) },
    { id: "idle", label: "Idle and working", threads: idle },
    { id: "settled", label: "Settled", threads: settled },
  ] as const;
  return sections
    .filter((section) => section.threads.length > 0)
    .map((section) => ({
      ...section,
      workingCount:
        section.id === "idle"
          ? idle.filter((thread) => thread.status?.kind === "working").length
          : 0,
      openByDefault:
        section.id === "attention" ||
        section.threads.some((thread) => thread.threadId === showingThreadId),
    }));
};

export interface WorkbenchFloatingChatPickerRow {
  readonly thread: WorkbenchFloatingChatThread;
  /** The row's ticket, named on the board where several tickets' Threads mix. */
  readonly ticketLabel: string | null;
  /** The Thread title, less a leading ticket title the row or chat already shows. */
  readonly title: string;
}

// Threads often start with their ticket's title; beside it only the rest tells them apart.
const titleUnderHeading = (title: string, ticketTitle: string) => {
  const match = title.startsWith(ticketTitle)
    ? /^[\s\-–—:·|]+(.+)$/.exec(title.slice(ticketTitle.length))
    : null;
  return match?.[1] ?? title;
};

/** The ticket chat names its ticket in the header; a board row names it by key, else title. */
export const getWorkbenchFloatingChatPickerRow = (
  thread: WorkbenchFloatingChatThread,
  board: boolean,
): WorkbenchFloatingChatPickerRow => {
  const { ticket } = thread;
  if (ticket === null) return { thread, ticketLabel: null, title: thread.title };
  const ticketLabel = board ? (ticket.key ?? ticket.title) : null;
  const keyShown = board && ticket.key !== null;
  return {
    thread,
    ticketLabel,
    title: keyShown ? thread.title : titleUnderHeading(thread.title, ticket.title),
  };
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
