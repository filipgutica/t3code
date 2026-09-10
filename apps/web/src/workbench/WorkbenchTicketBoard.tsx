import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchJiraIssueLink,
  WorkbenchJiraBoardColumn,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import {
  ArrowRightIcon,
  BotIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  LayoutDashboardIcon,
  Layers3Icon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { ToggleGroup, Toggle } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { MenuItem } from "../components/ui/menu";
import {
  WorkbenchTicketStatusMenu,
  type WorkbenchJiraTransitionSelection,
} from "./WorkbenchTicketStatusMenu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  getVisibleWorkbenchAssignments,
  getWorkbenchAgentPresentation,
  getWorkbenchTicketAgentPresentation,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  groupWorkbenchTicketsByEpic,
  isWorkbenchThreadArchived,
  WORKBENCH_TICKET_KIND_LABELS,
} from "./workbench.logic";
import { getWorkbenchBoardColumns, orderWorkbenchTicketsByJiraRank } from "./workbenchJira.logic";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";

const STATUS_DOT_CLASS: Record<WorkbenchTicketStatus, string> = {
  todo: "bg-muted-foreground/55",
  in_progress: "bg-info",
  done: "bg-success",
};

export function WorkbenchTicketBoard({
  environmentId,
  projectId,
  mirrorColumns,
  tickets,
  epics,
  groupMode,
  jiraIssueLinksByTicketId,
  activeJiraTicketIds,
  selectedTicketId,
  repositoriesById,
  assignmentsByTicket,
  assignments,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  pending,
  pendingAction,
  onSelect,
  onSelectEpic,
  onMove,
  onJiraTransition,
  onRegenerateSummary,
  onOpenThread,
  onCreateTicket,
}: {
  readonly environmentId: EnvironmentId;
  readonly onJiraTransition: (selection: WorkbenchJiraTransitionSelection) => void;
  readonly projectId: WorkbenchProjectId;
  readonly mirrorColumns: ReadonlyArray<WorkbenchJiraBoardColumn> | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly groupMode: "none" | "epic";
  readonly jiraIssueLinksByTicketId: ReadonlyMap<WorkbenchTicketId, WorkbenchJiraIssueLink>;
  readonly activeJiraTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly selectedTicketId: WorkbenchTicketId | null;
  readonly repositoriesById: ReadonlyMap<ProjectId, Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly pendingAction: string | null;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectEpic: (projectId: WorkbenchProjectId, epicId: WorkbenchEpic["id"]) => void;
  readonly onMove: (ticket: WorkbenchTicket, status: WorkbenchTicketStatus) => void;
  readonly onRegenerateSummary: (ticket: WorkbenchTicket) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  readonly onCreateTicket: () => void;
}) {
  const agentStatesByTicket = useMemo(() => {
    const states = new Map<
      WorkbenchTicketId,
      Array<Parameters<typeof getWorkbenchAgentPresentation>[0]>
    >();
    const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    for (const assignment of assignments) {
      if (assignment.supersededAt !== null) continue;
      const thread = threadsById.get(assignment.threadId);
      if (!thread) continue;
      const group = states.get(assignment.ticketId) ?? [];
      group.push({
        nativeLabel: resolveThreadStatusPill({ thread })?.label,
        sessionStatus: thread.session?.status,
        turnState: thread.latestTurn?.state,
        settledOverride: thread.settledOverride,
        ticketStatus: ticketsById.get(assignment.ticketId)?.status,
      });
      states.set(assignment.ticketId, group);
    }
    return new Map(
      [...states].map(([ticketId, threads]) => [
        ticketId,
        getWorkbenchTicketAgentPresentation(threads),
      ]),
    );
  }, [assignments, threadsById, tickets]);
  const threadCounts = useMemo(() => {
    const counts = new Map<WorkbenchTicketId, number>();
    for (const assignment of getVisibleWorkbenchAssignments(
      assignments,
      new Set(threadsById.keys()),
      new Set(archivedThreadsById.keys()),
      true,
    )) {
      if (assignment.supersededAt === null) {
        counts.set(assignment.ticketId, (counts.get(assignment.ticketId) ?? 0) + 1);
      }
    }
    return counts;
  }, [assignments, threadsById, archivedThreadsById]);
  const columns = useMemo(
    () =>
      getWorkbenchBoardColumns({ tickets, mirrorColumns, issueLinks: jiraIssueLinksByTicketId }),
    [tickets, mirrorColumns, jiraIssueLinksByTicketId],
  );
  const swimlanes = useMemo(
    () =>
      groupMode === "epic"
        ? groupWorkbenchTicketsByEpic(tickets, epics)
        : [{ epic: null, tickets }],
    [epics, groupMode, tickets],
  );
  const epicsById = useMemo(() => new Map(epics.map((epic) => [epic.id, epic])), [epics]);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const visibleColumnId = columns.some((column) => column.id === selectedColumnId)
    ? selectedColumnId
    : columns[0]?.id;
  const boardStyle: CSSProperties & { "--board-column-count": number } = {
    "--board-column-count": columns.length,
  };

  return (
    <section
      aria-label="Ticket board"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="shrink-0 overflow-x-auto border-b border-border/60 px-3 py-2 md:hidden">
        <ToggleGroup
          aria-label="Board columns"
          value={visibleColumnId ? [visibleColumnId] : []}
          onValueChange={(value) => {
            const nextColumnId = value[0];
            if (typeof nextColumnId === "string") setSelectedColumnId(nextColumnId);
          }}
        >
          {columns.map((column) => (
            <Toggle key={column.id} value={column.id} className="shrink-0">
              {column.title}
              <span className="text-muted-foreground tabular-nums">{column.tickets.length}</span>
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4">
        <div
          style={boardStyle}
          className="flex min-w-0 flex-col gap-3 md:min-w-[calc(var(--board-column-count)*18rem+(var(--board-column-count)-1)*0.75rem)]"
        >
          <div className="sticky top-0 z-10 hidden grid-flow-col auto-cols-[minmax(18rem,1fr)] gap-3 border-b border-border/60 bg-background pb-2 md:grid">
            {columns.map((column) => (
              <div key={column.id} className="flex min-w-0 items-center gap-2 px-2 py-2">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_CLASS[column.status])}
                />
                <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">{column.title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {column.tickets.length}
                </span>
              </div>
            ))}
          </div>
          {swimlanes.map((swimlane) => {
            const laneTicketIds = new Set(swimlane.tickets.map((ticket) => ticket.id));
            const laneKey = groupMode === "epic" ? (swimlane.epic?.id ?? "no-epic") : "all-tickets";
            return (
              <Collapsible
                key={laneKey}
                defaultOpen
                render={
                  <section
                    aria-label={
                      groupMode === "epic"
                        ? `${swimlane.epic?.title ?? "No Epic"} swimlane`
                        : "All Tickets"
                    }
                  />
                }
                className="min-w-0"
              >
                {groupMode === "epic" ? (
                  <header className="mb-2 flex items-center gap-2 border-b border-border/40 py-1">
                    <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronDownIcon className="size-3.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none" />
                      <Layers3Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <h3 className="min-w-0 truncate text-sm font-semibold">
                        {swimlane.epic?.title ?? "No Epic"}
                      </h3>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {swimlane.tickets.length}
                      </span>
                    </CollapsibleTrigger>
                    {swimlane.epic ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onSelectEpic(projectId, swimlane.epic!.id)}
                      >
                        View Epic <ArrowRightIcon data-icon="inline-end" />
                      </Button>
                    ) : null}
                  </header>
                ) : null}
                <CollapsiblePanel className="transition-none">
                  <div className="grid min-w-0 grid-cols-1 gap-3 md:auto-cols-[minmax(18rem,1fr)] md:grid-flow-col md:grid-cols-none">
                    {columns.map((column) => {
                      const laneTickets = orderWorkbenchTicketsByJiraRank(
                        column.tickets.filter((ticket) => laneTicketIds.has(ticket.id)),
                        jiraIssueLinksByTicketId,
                        activeJiraTicketIds,
                      );
                      return (
                        <section
                          key={column.id}
                          aria-label={`${column.title} Tickets`}
                          data-workbench-status={column.id}
                          className={cn(
                            "min-w-0 flex-col rounded-lg bg-muted/20 md:flex",
                            column.id === visibleColumnId ? "flex" : "hidden",
                          )}
                        >
                          <div className="flex min-h-0 flex-1 flex-col gap-2 p-1.5">
                            {laneTickets.map((ticket) => {
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
                              const nativeStatus = agentStatesByTicket.get(ticket.id) ?? null;
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
                              const summary = getWorkbenchTicketSummaryPresentation(
                                ticket.generatedSummary,
                              );
                              return (
                                <article
                                  key={ticket.id}
                                  className={`w-full min-w-0 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20 ${
                                    selectedTicketId === ticket.id
                                      ? "border-primary/50 ring-2 ring-primary/15"
                                      : "border-border/60"
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <button
                                      className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                                      type="button"
                                      onClick={() => onSelect(projectId, ticket.id)}
                                    >
                                      <Tooltip>
                                        <TooltipTrigger
                                          render={
                                            <h3 className="line-clamp-3 min-w-0 break-words text-sm font-medium leading-snug" />
                                          }
                                        >
                                          {ticket.title}
                                        </TooltipTrigger>
                                        <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
                                          {ticket.title}
                                        </TooltipPopup>
                                      </Tooltip>
                                    </button>
                                    <div className="flex min-w-0 shrink-0 items-center gap-1">
                                      <WorkbenchTicketStatusMenu
                                        key={`${environmentId}:${ticket.id}:${jiraIssueLink?.issue.remoteUpdatedAt ?? "local"}`}
                                        environmentId={environmentId}
                                        ticket={ticket}
                                        jiraIssueLink={jiraIssueLink ?? null}
                                        disabled={pending || ticket.archivedAt != null}
                                        onStatusChange={(status) => onMove(ticket, status)}
                                        onJiraTransition={onJiraTransition}
                                        trigger={
                                          <Button
                                            className="-mr-1 -mt-1 shrink-0"
                                            size="icon-xs"
                                            variant="ghost"
                                          >
                                            <MoreHorizontalIcon />
                                          </Button>
                                        }
                                      >
                                        <MenuItem
                                          disabled={
                                            pending ||
                                            ticket.archivedAt != null ||
                                            ticket.generatedSummary?.status === "pending"
                                          }
                                          onClick={() => onRegenerateSummary(ticket)}
                                        >
                                          {getWorkbenchTicketSummaryActionLabel(
                                            ticket.generatedSummary,
                                          )}
                                        </MenuItem>
                                      </WorkbenchTicketStatusMenu>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      {jiraIssueLink ? (
                                        <Badge
                                          aria-label={`Open Jira issue ${jiraIssueLink.issue.key}`}
                                          render={
                                            <a
                                              href={jiraIssueLink.issue.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            />
                                          }
                                          size="sm"
                                          title={`Jira issue ${jiraIssueLink.issue.key}`}
                                          variant="outline"
                                        >
                                          <WorkbenchJiraIcon className="size-3" />
                                          <span>{jiraIssueLink.issue.key}</span>
                                        </Badge>
                                      ) : null}
                                      <Badge size="sm" variant="secondary">
                                        {WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}
                                      </Badge>
                                      {groupMode === "none" && epic ? (
                                        <Badge
                                          className="min-w-0 max-w-full"
                                          size="sm"
                                          variant="outline"
                                        >
                                          <Layers3Icon />
                                          <span className="truncate">{epic.title}</span>
                                        </Badge>
                                      ) : null}
                                      {jiraIssueLink?.issue.flagged ? (
                                        <Badge size="sm" variant="warning">
                                          <CircleAlertIcon /> Jira flagged
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <button
                                            type="button"
                                            onClick={() => onSelect(projectId, ticket.id)}
                                            aria-label={`Ticket summary: ${summary.text}`}
                                            className="line-clamp-2 break-words text-left text-xs text-muted-foreground outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                                            tabIndex={0}
                                          />
                                        }
                                      >
                                        {summary.text}
                                      </TooltipTrigger>
                                      <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
                                        {summary.text}
                                      </TooltipPopup>
                                    </Tooltip>
                                    {summary.statusLabel ? (
                                      <p
                                        className="text-[11px] text-muted-foreground"
                                        role="status"
                                      >
                                        {summary.statusLabel}
                                      </p>
                                    ) : null}
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <span
                                            tabIndex={0}
                                            className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                          />
                                        }
                                      >
                                        <FolderGit2Icon className="size-3.5 shrink-0" />
                                        <span className="truncate">
                                          {repository?.title ?? "Repository unavailable"}
                                        </span>
                                        {additionalRepositoryCount > 0 ? (
                                          <span className="shrink-0">
                                            +{additionalRepositoryCount}
                                          </span>
                                        ) : null}
                                      </TooltipTrigger>
                                      <TooltipPopup>
                                        {getWorkbenchTicketRepositoryProjectIds(ticket)
                                          .map(
                                            (id) =>
                                              repositoriesById.get(id)?.title ??
                                              "Repository unavailable",
                                          )
                                          .join(", ")}
                                      </TooltipPopup>
                                    </Tooltip>
                                  </div>
                                  <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                      {thread.state === "linked" || thread.state === "archived" ? (
                                        <span
                                          aria-hidden
                                          className={`size-2 rounded-full ${
                                            nativeStatus?.dotClass ??
                                            (nativeThreadFailed
                                              ? "bg-destructive"
                                              : "bg-muted-foreground/60")
                                          }`}
                                        />
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
                                      {(threadCounts.get(ticket.id) ?? 0) > 1 ? (
                                        <span className="text-muted-foreground/60">
                                          · {threadCounts.get(ticket.id)} Threads
                                        </span>
                                      ) : null}
                                    </div>
                                    <Button
                                      disabled={pending}
                                      onClick={() => onOpenThread(ticket, assignment?.threadId)}
                                      size="xs"
                                      variant={
                                        thread.state === "unassigned" || thread.state === "missing"
                                          ? "default"
                                          : "ghost"
                                      }
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
                            {laneTickets.length === 0 ? (
                              <p
                                className={cn(
                                  "py-3 text-center text-xs text-muted-foreground",
                                  groupMode === "epic" && "md:sr-only",
                                )}
                              >
                                No tickets in {column.title}
                              </p>
                            ) : null}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
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
