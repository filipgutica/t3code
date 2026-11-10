import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketDraft,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { getAssignmentsForTicket, isWorkbenchHostAssignment } from "./workbench.logic";
import {
  getTicketIssue,
  getTicketReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import { getConversationDraftTitle } from "./workbenchTicketDraft.logic";
import {
  getWorkbenchThreadExecutionStatus,
  hasWorkbenchUnreadReply,
  type WorkbenchThreadExecutionStatus,
} from "./workbenchThreadStatus.logic";

export interface WorkbenchFloatingChatTicket {
  readonly id: WorkbenchTicketId;
  /** The first issue Reference label. */
  readonly key: string | null;
  readonly title: string;
}

export interface WorkbenchFloatingChatThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: WorkbenchThreadExecutionStatus | null;
  /** A finished reply the user has not opened. */
  readonly unread: boolean;
  readonly planning?: boolean;
  /** Null for a ticket draft that has no ticket yet. */
  readonly ticket: WorkbenchFloatingChatTicket | null;
  /** A generated summary of the Thread's latest finished run. */
  readonly recap: string | null;
  /** When the Thread was last settled; null while it never was. */
  readonly settledAt: string | null;
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
  localVisits,
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
  readonly localVisits: Readonly<Record<string, string>>;
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
      planning: drafts.some(
        (draft) =>
          draft.threadId === threadId && (draft.phase === "planning" || draft.phase === "starting"),
      ),
      status: getWorkbenchThreadExecutionStatus(thread),
      unread: hasWorkbenchUnreadReply(thread, localVisits),
      ticket: ticket
        ? {
            id: ticket.id,
            key: getTicketIssue(getTicketReferences(referencesByTicket, ticket.id))?.label ?? null,
            title: ticket.title,
          }
        : null,
      recap: recaps.get(threadId) ?? null,
      settledAt: thread.settledAt ?? null,
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
  const hostAssignments = assignments.filter(isWorkbenchHostAssignment);
  for (const ticket of boardTickets) {
    for (const assignment of getAssignmentsForTicket(hostAssignments, ticket.id)) {
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

/** The Thread the user picked in a page chat, and when it was settled as of the pick. */
export interface WorkbenchFloatingChatPick {
  readonly threadId: ThreadId;
  readonly settledAt: string | null;
}

export function resolveWorkbenchFloatingChat({
  active,
  archived,
  settled,
  primaryThreadId,
  pick,
}: {
  /** Live Threads of the ticket's active Assignments, in ticket order. */
  readonly active: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Active Assignments whose Thread is archived; they open on the Thread route after restore. */
  readonly archived: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Live settled Threads. */
  readonly settled: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly primaryThreadId: ThreadId | null;
  readonly pick: WorkbenchFloatingChatPick | null;
}) {
  const findIn = (threads: ReadonlyArray<WorkbenchFloatingChatThread>, threadId: ThreadId | null) =>
    threads.find((thread) => thread.threadId === threadId);
  const pickedThreadId = pick?.threadId ?? null;
  const pickedSettled = findIn(settled, pickedThreadId);
  // Settling the showing Thread moves on to the next one of its ticket; unsettling brings it back.
  const settledSincePick =
    pickedSettled !== undefined && pickedSettled.settledAt !== (pick?.settledAt ?? null);
  // A Thread the user picked stays selected even when another Thread becomes the primary one.
  const selected =
    findIn(active, pickedThreadId) ??
    (settledSincePick
      ? active.find((thread) => thread.ticket?.id === pickedSettled.ticket?.id)
      : pickedSettled) ??
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

type WorkbenchStatusThread = Pick<WorkbenchFloatingChatThread, "threadId" | "status" | "unread"> & {
  /** On a machine this client cannot reach, so its status is unknown rather than idle. */
  readonly offline?: boolean;
};

type WorkbenchThreadSectionId = "unread" | "idle" | "working" | "offline" | "settled";

// Like an inbox: anything that needs the user is unread until they act on it.
const SECTION_BY_STATUS = {
  approval: "unread",
  input: "unread",
  request: "unread",
  failed: "unread",
  limited: "unread",
  working: "working",
  waiting: "working",
} as const satisfies Record<WorkbenchThreadExecutionStatus["kind"], WorkbenchThreadSectionId>;

const SECTION_LABELS = {
  unread: "Unread",
  idle: "Idle",
  working: "Working",
  offline: "Offline",
  settled: "Settled",
} as const satisfies Record<WorkbenchThreadSectionId, string>;

export interface WorkbenchThreadStatusSection<Thread extends WorkbenchStatusThread> {
  readonly id: WorkbenchThreadSectionId;
  readonly label: string;
  readonly threads: ReadonlyArray<Thread>;
  readonly openByDefault: boolean;
}

/**
 * Threads as an inbox: unread replies and requests, then idle, working, offline, and settled
 * Threads. Unread, Idle, and Offline start open, as does the section holding the showing Thread;
 * empty ones drop.
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
  const sectionOf = (thread: Thread): WorkbenchThreadSectionId =>
    thread.offline
      ? "offline"
      : thread.status
        ? SECTION_BY_STATUS[thread.status.kind]
        : thread.unread
          ? "unread"
          : "idle";
  const threadsIn = (id: WorkbenchThreadSectionId) =>
    id === "settled" ? settled : active.filter((thread) => sectionOf(thread) === id);
  return (["unread", "idle", "working", "offline", "settled"] as const).flatMap((id) => {
    const threads = threadsIn(id);
    if (threads.length === 0) return [];
    return [
      {
        id,
        label: SECTION_LABELS[id],
        threads,
        openByDefault:
          id === "unread" ||
          id === "idle" ||
          id === "offline" ||
          threads.some((thread) => thread.threadId === showingThreadId),
      },
    ];
  });
};

export interface WorkbenchFloatingChatPickerRow {
  readonly thread: WorkbenchFloatingChatThread;
  /** The row's ticket, named on the board where several tickets' Threads mix. */
  readonly ticketLabel: string | null;
  /** The Thread title, less a leading ticket title the row or chat already shows. */
  readonly title: string;
}

// Threads often start with their ticket's title; beside it only the rest tells them apart.
export const titleUnderHeading = (title: string, ticketTitle: string) => {
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
  const keyShown = board && ticket.key !== null;
  const title = keyShown ? thread.title : titleUnderHeading(thread.title, ticket.title);
  // Without a key, a Thread named just like its ticket already names it.
  const ticketLabel = board ? (ticket.key ?? (title === ticket.title ? null : ticket.title)) : null;
  return { thread, ticketLabel, title };
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
