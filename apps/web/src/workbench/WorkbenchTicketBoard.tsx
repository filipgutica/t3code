import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchJiraIssueLink,
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
  Layers3Icon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type UIEvent } from "react";

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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import type { Project } from "../types";
import {
  getWorkbenchTicketStatusMoves,
  getWorkbenchThreadPresentation,
  getWorkbenchTicketRepositoryProjectIds,
  groupWorkbenchTicketsByEpic,
  isWorkbenchTicketStatus,
  isWorkbenchThreadArchived,
  ticketsByStatus,
  WORKBENCH_TICKET_KIND_LABELS,
  WORKBENCH_TICKET_STATUSES,
  WORKBENCH_TICKET_STATUS_LABELS,
} from "./workbench.logic";
import { orderWorkbenchTicketLanesByJiraRank } from "./workbenchJira.logic";

const STATUS_DOT_CLASS: Record<WorkbenchTicketStatus, string> = {
  todo: "bg-muted-foreground/55",
  in_progress: "bg-info",
  ready_for_review: "bg-warning",
  done: "bg-success",
};

export function WorkbenchTicketBoard({
  projectId,
  tickets,
  epics,
  groupMode,
  jiraIssueLinksByTicketId,
  activeJiraTicketIds,
  jiraManagedTicketIds,
  selectedTicketId,
  repositoriesById,
  assignmentsByTicket,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  pending,
  pendingAction,
  onSelect,
  onSelectEpic,
  onMove,
  onOpenThread,
  onCreateTicket,
}: {
  readonly projectId: WorkbenchProjectId;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly groupMode: "none" | "epic";
  readonly jiraIssueLinksByTicketId: ReadonlyMap<WorkbenchTicketId, WorkbenchJiraIssueLink>;
  readonly activeJiraTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly jiraManagedTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly selectedTicketId: WorkbenchTicketId | null;
  readonly repositoriesById: ReadonlyMap<ProjectId, Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly pendingAction: string | null;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectEpic: (projectId: WorkbenchProjectId, epicId: WorkbenchEpic["id"]) => void;
  readonly onMove: (ticket: WorkbenchTicket, status: WorkbenchTicketStatus) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket) => void;
  readonly onCreateTicket: () => void;
}) {
  const groupedTickets = useMemo(() => ticketsByStatus(tickets), [tickets]);
  const swimlanes = useMemo(
    () =>
      groupMode === "epic"
        ? groupWorkbenchTicketsByEpic(tickets, epics)
        : [{ epic: null, tickets }],
    [epics, groupMode, tickets],
  );
  const epicsById = useMemo(() => new Map(epics.map((epic) => [epic.id, epic])), [epics]);
  const [visibleStatus, setVisibleStatus] = useState<WorkbenchTicketStatus>("todo");
  const boardScrollRef = useRef<HTMLDivElement>(null);

  const scrollToStatus = (status: WorkbenchTicketStatus) => {
    setVisibleStatus(status);
    boardScrollRef.current
      ?.querySelector<HTMLElement>(`[data-workbench-status="${status}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "start" });
  };

  const trackVisibleStatus = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    let nearestStatus = visibleStatus;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const column of viewport.querySelectorAll<HTMLElement>("[data-workbench-status]")) {
      const distance = Math.abs(column.offsetLeft - viewport.scrollLeft);
      const status = column.dataset.workbenchStatus;
      if (distance < nearestDistance && status && isWorkbenchTicketStatus(status)) {
        nearestDistance = distance;
        nearestStatus = status;
      }
    }
    if (nearestStatus !== visibleStatus) setVisibleStatus(nearestStatus);
  };

  return (
    <section
      aria-label="Ticket board"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <nav
        aria-label="Board columns"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-3 py-2 md:hidden"
      >
        {WORKBENCH_TICKET_STATUSES.map((status) => (
          <Button
            key={status}
            aria-current={visibleStatus === status ? "true" : undefined}
            className="shrink-0"
            onClick={() => scrollToStatus(status)}
            size="xs"
            variant={visibleStatus === status ? "secondary" : "ghost"}
          >
            {WORKBENCH_TICKET_STATUS_LABELS[status]}
            <span className="text-muted-foreground tabular-nums">
              {groupedTickets[status].length}
            </span>
          </Button>
        ))}
      </nav>
      <div
        ref={boardScrollRef}
        className="min-h-0 flex-1 overflow-auto p-3 sm:p-4"
        onScroll={trackVisibleStatus}
      >
        <div className={groupMode === "epic" ? "space-y-3" : "h-full"}>
          {swimlanes.map((swimlane) => {
            const laneTicketsByStatus = orderWorkbenchTicketLanesByJiraRank(
              ticketsByStatus(swimlane.tickets),
              jiraIssueLinksByTicketId,
              activeJiraTicketIds,
            );
            const laneKey = groupMode === "epic" ? (swimlane.epic?.id ?? "no-epic") : "all-tickets";
            return (
              <section
                key={laneKey}
                aria-label={
                  groupMode === "epic"
                    ? `${swimlane.epic?.title ?? "No Epic"} swimlane`
                    : "All Tickets"
                }
                className={
                  groupMode === "epic"
                    ? "min-w-max overflow-hidden rounded-xl border border-border/70 bg-muted/20"
                    : "h-full"
                }
              >
                {groupMode === "epic" ? (
                  <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
                    <Layers3Icon className="size-3.5 text-muted-foreground" />
                    {swimlane.epic ? (
                      <button
                        className="min-w-0 flex-1 truncate text-left text-sm font-semibold outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onSelectEpic(projectId, swimlane.epic!.id)}
                        type="button"
                      >
                        {swimlane.epic.title}
                      </button>
                    ) : (
                      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">No Epic</h2>
                    )}
                    <Badge size="sm" variant="secondary">
                      {swimlane.tickets.length}
                    </Badge>
                  </header>
                ) : null}
                <div
                  className={`flex min-w-max snap-x snap-mandatory gap-3 md:grid md:min-w-[52rem] md:grid-cols-4 md:snap-none ${
                    groupMode === "epic" ? "p-3" : "h-full"
                  }`}
                >
                  {WORKBENCH_TICKET_STATUSES.map((status) => (
                    <section
                      key={status}
                      aria-label={`${WORKBENCH_TICKET_STATUS_LABELS[status]} Tickets`}
                      data-workbench-status={status}
                      className={`flex w-[calc(100vw-2rem)] max-w-[22rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/35 md:w-auto md:max-w-none ${
                        groupMode === "epic" ? "min-h-40" : "h-full min-h-0"
                      }`}
                    >
                      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                          <h2 className="text-sm font-semibold">
                            {WORKBENCH_TICKET_STATUS_LABELS[status]}
                          </h2>
                        </div>
                        <Badge size="sm" variant="secondary">
                          {laneTicketsByStatus[status].length}
                        </Badge>
                      </header>
                      <div
                        className={`min-h-0 flex-1 space-y-2 p-2.5 ${
                          groupMode === "epic" ? "" : "overflow-y-auto"
                        }`}
                      >
                        {laneTicketsByStatus[status].map((ticket) => {
                          const assignment = assignmentsByTicket.get(ticket.id);
                          const nativeThread = assignment
                            ? threadsById.get(assignment.threadId)
                            : undefined;
                          const archivedThread =
                            assignment &&
                            isWorkbenchThreadArchived(
                              assignment.threadId,
                              threadsById,
                              archivedThreadsById,
                            )
                              ? archivedThreadsById.get(assignment.threadId)
                              : undefined;
                          const nativeStatus = nativeThread
                            ? resolveThreadStatusPill({ thread: nativeThread })
                            : null;
                          const nativeThreadFailed = nativeThread?.session?.status === "error";
                          const thread = getWorkbenchThreadPresentation(
                            assignment !== undefined,
                            nativeThread !== undefined,
                            nativeStatus?.label ?? (nativeThreadFailed ? "Failed" : null),
                            archivedThread !== undefined,
                            threadLookupReady,
                          );
                          const threadActionPending =
                            pendingAction === `start:${ticket.id}` ||
                            (assignment !== undefined &&
                              pendingAction === `restore:${assignment.threadId}`);
                          const repository = repositoriesById.get(ticket.primaryT3ProjectId);
                          const additionalRepositoryCount =
                            getWorkbenchTicketRepositoryProjectIds(ticket).length - 1;
                          const epic = ticket.epicId ? epicsById.get(ticket.epicId) : undefined;
                          const jiraIssueLink = jiraIssueLinksByTicketId.get(ticket.id);
                          const jiraOwnsStatus = jiraManagedTicketIds.has(ticket.id);
                          return (
                            <article
                              key={ticket.id}
                              className={`rounded-lg border bg-card p-3 shadow-xs/5 transition-colors hover:border-foreground/20 ${
                                selectedTicketId === ticket.id
                                  ? "border-primary/50 ring-2 ring-primary/15"
                                  : "border-border"
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                                  type="button"
                                  onClick={() => onSelect(projectId, ticket.id)}
                                >
                                  <h3 className="text-sm font-medium leading-snug">
                                    {ticket.title}
                                  </h3>
                                </button>
                                {jiraOwnsStatus && jiraIssueLink ? (
                                  <Badge
                                    size="sm"
                                    title="Board status is managed by Jira"
                                    variant="outline"
                                  >
                                    <span className="max-w-36 truncate">
                                      {jiraIssueLink.issue.key} ·{" "}
                                      {jiraIssueLink.issue.issueType.name}
                                    </span>
                                  </Badge>
                                ) : (
                                  <Menu>
                                    <MenuTrigger
                                      aria-label={`Move ${ticket.title} to another status`}
                                      render={
                                        <Button
                                          className="-mr-1 -mt-1 shrink-0"
                                          disabled={pending}
                                          size="icon-xs"
                                          variant="ghost"
                                        />
                                      }
                                    >
                                      <MoreHorizontalIcon />
                                    </MenuTrigger>
                                    <MenuPopup align="end" className="min-w-44">
                                      {getWorkbenchTicketStatusMoves(ticket.status).map(
                                        (nextStatus) => (
                                          <MenuItem
                                            key={nextStatus}
                                            onClick={() => onMove(ticket, nextStatus)}
                                          >
                                            <span
                                              aria-hidden
                                              className={`size-2 rounded-full ${STATUS_DOT_CLASS[nextStatus]}`}
                                            />
                                            Move to {WORKBENCH_TICKET_STATUS_LABELS[nextStatus]}
                                          </MenuItem>
                                        ),
                                      )}
                                    </MenuPopup>
                                  </Menu>
                                )}
                              </div>
                              <button
                                className="mt-3 block w-full text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                                type="button"
                                onClick={() => onSelect(projectId, ticket.id)}
                              >
                                <div className="space-y-1.5 text-xs text-muted-foreground">
                                  <div className="flex items-center gap-1.5">
                                    <Badge size="sm" variant="secondary">
                                      {WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}
                                    </Badge>
                                    {groupMode === "none" && epic ? (
                                      <Badge className="max-w-full" size="sm" variant="outline">
                                        <Layers3Icon />
                                        <span className="truncate">{epic.title}</span>
                                      </Badge>
                                    ) : null}
                                    {ticket.blocked ? (
                                      <Badge size="sm" variant="warning">
                                        <CircleAlertIcon /> Blocked
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <FolderGit2Icon className="size-3.5 shrink-0" />
                                    <span className="truncate">
                                      {repository?.title ?? "Repository unavailable"}
                                    </span>
                                    {additionalRepositoryCount > 0 ? (
                                      <span className="shrink-0">+{additionalRepositoryCount}</span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {thread.state === "linked" ? (
                                      <span
                                        aria-hidden
                                        className={`size-2 rounded-full ${
                                          nativeStatus?.dotClass ??
                                          (nativeThreadFailed
                                            ? "bg-destructive"
                                            : "bg-muted-foreground/60")
                                        }`}
                                      />
                                    ) : thread.state === "missing" ? (
                                      <CircleAlertIcon className="size-3.5 text-warning-foreground" />
                                    ) : (
                                      <BotIcon className="size-3.5" />
                                    )}
                                    <span
                                      className={
                                        nativeStatus?.colorClass ??
                                        (nativeThreadFailed ? "text-destructive" : undefined)
                                      }
                                    >
                                      {thread.stateLabel}
                                    </span>
                                    {assignment ? (
                                      <span className="text-muted-foreground/60">· Assigned</span>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                              <div className="mt-3">
                                <Button
                                  className="w-full"
                                  disabled={pending}
                                  onClick={() => onOpenThread(ticket)}
                                  size="xs"
                                  variant={thread.state === "unassigned" ? "default" : "outline"}
                                >
                                  {threadActionPending
                                    ? thread.pendingActionLabel
                                    : thread.actionLabel}
                                  <ArrowRightIcon />
                                </Button>
                              </div>
                            </article>
                          );
                        })}
                        {laneTicketsByStatus[status].length === 0 ? (
                          <p className="py-6 text-center text-xs text-muted-foreground">
                            No tickets
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {tickets.length === 0 && !(groupMode === "epic" && epics.length > 0) ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/45 p-6 backdrop-blur-[1px]">
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
