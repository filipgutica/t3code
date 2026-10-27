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
import { getConversationDraftTitle } from "./workbenchTicketDraft.logic";
import {
  getWorkbenchThreadExecutionStatus,
  type WorkbenchThreadExecutionStatus,
} from "./workbenchThreadStatus.logic";

export interface WorkbenchFloatingChatTicket {
  readonly id: WorkbenchTicketId;
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
        ? {
            id: ticket.id,
            key: ticket.jiraIssue?.key ?? null,
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

/** Ticket drafts first, then one group per ticket in list order. */
const groupWorkbenchFloatingChatThreads = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) => {
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

export interface WorkbenchFloatingChatPickerRow {
  readonly thread: WorkbenchFloatingChatThread;
  /** The Thread title, less a leading ticket title its group already shows. */
  readonly title: string;
}

/** A plain list of Threads, or a collapsible group of drafts or of one ticket's Threads. */
export type WorkbenchFloatingChatPickerSection =
  | {
      readonly type: "rows";
      readonly id: string;
      readonly rows: ReadonlyArray<WorkbenchFloatingChatPickerRow>;
    }
  | {
      readonly type: "group";
      readonly id: string;
      readonly ticket: WorkbenchFloatingChatTicket | null;
      readonly rows: ReadonlyArray<WorkbenchFloatingChatPickerRow>;
    };

// Threads often start with their ticket's title; under its heading only the rest tells them apart.
const titleUnderHeading = (title: string, ticketTitle: string) => {
  const match = title.startsWith(ticketTitle)
    ? /^[\s\-–—:·|]+(.+)$/.exec(title.slice(ticketTitle.length))
    : null;
  return match?.[1] ?? title;
};

/**
 * The picker's layout. A list from one ticket, or with no tickets, is plain rows. Otherwise
 * drafts and each ticket are groups, so a ticket always opens to its Threads.
 */
export const getWorkbenchFloatingChatPickerSections = (
  threads: ReadonlyArray<WorkbenchFloatingChatThread>,
): ReadonlyArray<WorkbenchFloatingChatPickerSection> => {
  const groups = groupWorkbenchFloatingChatThreads(threads);
  const rows = (
    ticket: WorkbenchFloatingChatTicket | null,
    members: ReadonlyArray<WorkbenchFloatingChatThread>,
  ) =>
    members.map((thread) => ({
      thread,
      title: ticket ? titleUnderHeading(thread.title, ticket.title) : thread.title,
    }));
  const [onlyGroup] = groups;
  if (groups.length === 1 && onlyGroup !== undefined) {
    return [
      {
        type: "rows",
        id: onlyGroup.ticket?.id ?? "drafts",
        rows: rows(onlyGroup.ticket, onlyGroup.threads),
      },
    ];
  }
  return groups.map(({ ticket, threads: members }) => ({
    type: "group",
    id: ticket?.id ?? "drafts",
    ticket,
    rows: rows(ticket, members),
  }));
};

/**
 * Drafts start open as work in progress; a ticket's group starts open when it holds the
 * showing Thread or one waiting on the user.
 */
export const isWorkbenchFloatingChatGroupOpenByDefault = (
  { ticket, rows }: Extract<WorkbenchFloatingChatPickerSection, { type: "group" }>,
  selectedThreadId: ThreadId | null,
) =>
  ticket === null ||
  rows.some(
    ({ thread }) =>
      thread.threadId === selectedThreadId ||
      (thread.status !== null && WORKBENCH_ATTENTION_KINDS.has(thread.status.kind)),
  );

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
