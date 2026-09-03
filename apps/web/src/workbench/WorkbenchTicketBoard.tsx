import type {
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import {
  ArrowRightIcon,
  BotIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  LayoutDashboardIcon,
  LinkIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  ticketsByStatus,
  WORKBENCH_TICKET_STATUSES,
  WORKBENCH_TICKET_STATUS_LABELS,
} from "./workbench.logic";

const STATUS_DOT_CLASS: Record<WorkbenchTicketStatus, string> = {
  todo: "bg-muted-foreground/55",
  in_progress: "bg-info",
  ready_for_review: "bg-warning",
  done: "bg-success",
};

export function WorkbenchTicketBoard({
  projectId,
  tickets,
  selectedTicketId,
  repositoriesById,
  assignmentsByTicket,
  existingThreadIds,
  pending,
  onSelect,
  onOpenThread,
  onCreateTicket,
}: {
  readonly projectId: WorkbenchProjectId;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly selectedTicketId: WorkbenchTicketId | null;
  readonly repositoriesById: ReadonlyMap<ProjectId, Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly pending: boolean;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket) => void;
  readonly onCreateTicket: () => void;
}) {
  const groupedTickets = useMemo(() => ticketsByStatus(tickets), [tickets]);

  return (
    <section aria-label="Ticket board" className="relative min-h-0 flex-1 overflow-hidden">
      <div className="h-full overflow-x-auto overflow-y-hidden p-3 sm:p-4">
        <div className="flex h-full min-w-max snap-x snap-mandatory gap-3 md:grid md:min-w-[52rem] md:grid-cols-4 md:snap-none">
          {WORKBENCH_TICKET_STATUSES.map((status) => (
            <section
              key={status}
              aria-labelledby={`workbench-column-${status}`}
              className="flex h-full min-h-0 w-[calc(100vw-2rem)] max-w-[22rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/35 md:w-auto md:max-w-none"
            >
              <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                  <h2 id={`workbench-column-${status}`} className="text-sm font-semibold">
                    {WORKBENCH_TICKET_STATUS_LABELS[status]}
                  </h2>
                </div>
                <Badge size="sm" variant="secondary">
                  {groupedTickets[status].length}
                </Badge>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
                {groupedTickets[status].map((ticket) => {
                  const assignment = assignmentsByTicket.get(ticket.id);
                  const threadExists = assignment
                    ? existingThreadIds.has(assignment.threadId)
                    : false;
                  const thread = getWorkbenchThreadPresentation(
                    assignment !== undefined,
                    threadExists,
                  );
                  const repository = repositoriesById.get(ticket.primaryT3ProjectId);
                  return (
                    <article
                      key={ticket.id}
                      className={`rounded-lg border bg-card p-3 shadow-xs/5 transition-colors hover:border-foreground/20 ${
                        selectedTicketId === ticket.id
                          ? "border-primary/50 ring-2 ring-primary/15"
                          : "border-border"
                      }`}
                    >
                      <button
                        className="block w-full text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                        type="button"
                        onClick={() => onSelect(projectId, ticket.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium leading-snug">{ticket.title}</h3>
                          {ticket.blocked ? (
                            <Badge variant="warning">
                              <CircleAlertIcon /> Blocked
                            </Badge>
                          ) : null}
                        </div>
                        {ticket.markdown ? (
                          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {ticket.markdown}
                          </p>
                        ) : null}
                        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <FolderGit2Icon className="size-3.5 shrink-0" />
                            <span className="truncate">
                              {repository?.title ?? "Repository unavailable"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {thread.state === "linked" ? (
                              <LinkIcon className="size-3.5 text-success-foreground" />
                            ) : thread.state === "missing" ? (
                              <CircleAlertIcon className="size-3.5 text-warning-foreground" />
                            ) : (
                              <BotIcon className="size-3.5" />
                            )}
                            <span>{thread.stateLabel}</span>
                          </div>
                        </div>
                      </button>
                      <Button
                        className="mt-3 w-full"
                        disabled={pending}
                        onClick={() => onOpenThread(ticket)}
                        size="xs"
                        variant={thread.state === "unassigned" ? "default" : "outline"}
                      >
                        {thread.actionLabel}
                        <ArrowRightIcon />
                      </Button>
                    </article>
                  );
                })}
                {groupedTickets[status].length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No tickets</p>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/45 p-6 backdrop-blur-[1px]">
          <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg/10">
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayoutDashboardIcon />
                </EmptyMedia>
                <EmptyTitle>Plan the first piece of work</EmptyTitle>
                <EmptyDescription>
                  Tickets keep delivery context, status, and the native Agent Thread connected.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onCreateTicket}>
                  <PlusIcon /> Create Ticket
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        </div>
      ) : null}
    </section>
  );
}
