import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  type ThreadId,
  type WorkbenchProject,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BlocksIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  LayoutDashboardIcon,
  PlusIcon,
  RefreshCwIcon,
  TicketIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { SidebarChromeFooter } from "../components/sidebar/SidebarChrome";
import { Button } from "../components/ui/button";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useThreadDetail, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import {
  getWorkbenchSidebarExpansionDefaults,
  getWorkbenchSidebarTicketGroups,
  reduceWorkbenchSidebarExpansion,
  type WorkbenchSidebarExpansion,
  type WorkbenchSidebarTicket,
  type WorkbenchSidebarTicketGroup,
  type WorkbenchSidebarTicketSections,
} from "./workbenchSidebar.logic";

const isEnvironmentId = Schema.is(EnvironmentId);
const isWorkbenchProjectId = Schema.is(WorkbenchProjectId);
const isWorkbenchTicketId = Schema.is(WorkbenchTicketId);
const isWorkbenchEpicId = Schema.is(WorkbenchEpicId);

export function WorkbenchSidebar({
  context,
}: {
  readonly context?:
    | {
        readonly environmentId: EnvironmentId;
        readonly threadId: ThreadId;
        readonly workspaceId: WorkbenchProjectId;
        readonly ticketId: WorkbenchTicketId;
      }
    | undefined;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const search = useSearch({
    strict: false,
    select: (value) => ({
      environmentId: isEnvironmentId(value.environmentId) ? value.environmentId : undefined,
      workbenchProjectId: isWorkbenchProjectId(value.workbenchProjectId)
        ? value.workbenchProjectId
        : undefined,
      ticketId: isWorkbenchTicketId(value.ticketId) ? value.ticketId : undefined,
      epicId: isWorkbenchEpicId(value.epicId) ? value.epicId : undefined,
    }),
  });
  const selectedWorkspaceId = context?.workspaceId ?? search.workbenchProjectId;
  const selectedTicketId = context?.ticketId ?? search.ticketId;
  const selectedEpicId = context ? undefined : search.epicId;
  const selectedEnvironmentId = context?.environmentId ?? search.environmentId;
  const environmentId = selectedEnvironmentId ?? primaryEnvironmentId;
  const { isMobile, setOpenMobile } = useSidebar();
  const threadShells = useThreadShells();
  const currentThread = useThreadDetail(
    context &&
      !threadShells.some(
        (thread) =>
          thread.environmentId === context.environmentId && thread.id === context.threadId,
      )
      ? scopeThreadRef(context.environmentId, context.threadId)
      : null,
  );
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const snapshot = query.data;
  const selectedTicket = snapshot?.tickets.find((ticket) => ticket.id === selectedTicketId);
  const selectedTicketStatus = selectedTicket?.status;
  const selectedTicketIsDone =
    selectedTicketStatus === "done" && selectedTicket?.archivedAt == null;
  const ticketGroupsByWorkspace = useMemo(
    () =>
      getWorkbenchSidebarTicketGroups({
        environmentId,
        tickets: snapshot?.tickets ?? [],
        assignments: snapshot?.assignments ?? [],
        threads:
          currentThread &&
          !threadShells.some(
            (thread) =>
              thread.environmentId === currentThread.environmentId &&
              thread.id === currentThread.id,
          )
            ? [...threadShells, currentThread]
            : threadShells,
        selectedTicketId,
        selectedThreadId: context?.threadId,
      }),
    [
      environmentId,
      selectedTicketId,
      context?.threadId,
      currentThread,
      snapshot?.assignments,
      snapshot?.tickets,
      threadShells,
    ],
  );
  const ticketCountsByWorkspace = useMemo(() => {
    const counts = new Map<WorkbenchProjectId, number>();
    for (const ticket of snapshot?.tickets ?? []) {
      if (ticket.archivedAt != null) continue;
      counts.set(ticket.projectId, (counts.get(ticket.projectId) ?? 0) + 1);
    }
    return counts;
  }, [snapshot?.tickets]);
  const archivedTickets = useMemo(
    () =>
      (snapshot?.tickets ?? []).filter(
        (ticket) =>
          ticket.projectId === selectedWorkspaceId &&
          ticket.archivedAt != null &&
          ticket.id !== selectedTicketId,
      ),
    [selectedTicketId, selectedWorkspaceId, snapshot?.tickets],
  );

  const selectWorkspace = (projectId: WorkbenchProjectId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: {
        ...(environmentId ? { environmentId } : {}),
        workbenchProjectId: projectId,
      },
      replace: true,
    });
  };
  const selectTicket = (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: {
        ...(environmentId ? { environmentId } : {}),
        workbenchProjectId: projectId,
        ticketId,
      },
      replace: true,
    });
  };
  const openThread = (thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId }) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
      search: { workbench: true },
    });
  };
  const leaveWorkbench = () => {
    if (isMobile) setOpenMobile(false);
    void (context
      ? navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: context.environmentId, threadId: context.threadId },
          search: {},
        })
      : navigate({ to: "/", search: {} }));
  };
  const addWorkspace = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: {
        ...(environmentId ? { environmentId } : {}),
        ...(selectedWorkspaceId ? { workbenchProjectId: selectedWorkspaceId } : {}),
        ...(selectedTicketId ? { ticketId: selectedTicketId } : {}),
        ...(selectedEpicId ? { epicId: selectedEpicId } : {}),
        create: "workspace",
      },
      replace: true,
    });
  };

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="gap-2 p-[var(--sidebar-content-inset)]">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={leaveWorkbench}>
                <ArrowLeftIcon />
                <span>Back to Threads</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex h-9 items-center gap-2.5 px-2 text-sm font-medium text-sidebar-muted-foreground">
            <BlocksIcon className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">Workspaces</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Add Workspace"
                    className="-me-1"
                    onClick={addWorkspace}
                    size="icon-xs"
                    variant="ghost"
                  />
                }
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipPopup side="right">Add Workspace</TooltipPopup>
            </Tooltip>
          </div>

          {environmentId === null ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              Connect an environment to view Workbench Workspaces.
            </p>
          ) : query.isPending && snapshot === null ? (
            <div className="space-y-1" aria-label="Loading Workbench Workspaces">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-5/6" />
            </div>
          ) : query.error && snapshot === null ? (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-foreground">
              <p className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{query.error}</span>
              </p>
              <Button className="w-full" onClick={query.refresh} size="xs" variant="outline">
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : snapshot?.projects.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              No Workspaces yet. Use Add Workspace above.
            </p>
          ) : (
            <WorkbenchSidebarNavigation
              key={[
                environmentId ?? "none",
                selectedWorkspaceId ?? "none",
                selectedTicketId ?? "none",
                selectedEpicId ?? "none",
                selectedTicketIsDone ? "done" : "active",
                context?.threadId ?? "none",
              ].join(":")}
              archivedTickets={archivedTickets}
              contextThreadId={context?.threadId}
              onOpenThread={openThread}
              onSelectTicket={selectTicket}
              onSelectWorkspace={selectWorkspace}
              projects={snapshot?.projects ?? []}
              selectedEpicId={selectedEpicId}
              selectedTicketId={selectedTicketId}
              selectedTicketIsDone={selectedTicketIsDone}
              selectedWorkspaceId={selectedWorkspaceId}
              ticketCountsByWorkspace={ticketCountsByWorkspace}
              ticketGroupsByWorkspace={ticketGroupsByWorkspace}
            />
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

type WorkbenchSidebarNavigationProps = {
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly contextThreadId: ThreadId | undefined;
  readonly onOpenThread: (thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  }) => void;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectWorkspace: (projectId: WorkbenchProjectId) => void;
  readonly projects: ReadonlyArray<Pick<WorkbenchProject, "id" | "title">>;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedTicketIsDone: boolean;
  readonly selectedWorkspaceId: WorkbenchProjectId | undefined;
  readonly ticketCountsByWorkspace: ReadonlyMap<WorkbenchProjectId, number>;
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
};

function WorkbenchSidebarNavigation({
  archivedTickets,
  contextThreadId,
  onOpenThread,
  onSelectTicket,
  onSelectWorkspace,
  projects,
  selectedEpicId,
  selectedTicketId,
  selectedTicketIsDone,
  selectedWorkspaceId,
  ticketCountsByWorkspace,
  ticketGroupsByWorkspace,
}: WorkbenchSidebarNavigationProps) {
  const [expansion, setExpansion] = useState(() =>
    getWorkbenchSidebarExpansionDefaults({
      workspaceId: selectedWorkspaceId,
      ticketId: selectedTicketId,
      ticketIsDone: selectedTicketIsDone,
    }),
  );

  return (
    <div className="space-y-4">
      <SidebarMenu aria-label="Workbench Workspaces" className="ps-px">
        {projects.map((workspace) => {
          const ticketSections = ticketGroupsByWorkspace.get(workspace.id) ?? {
            active: [],
            done: [],
          };
          const activeTicketGroups = ticketSections.active;
          const doneTicketGroups = ticketSections.done;
          const hasArchivedTickets =
            workspace.id === selectedWorkspaceId && archivedTickets.length > 0;
          const hasDescendants =
            activeTicketGroups.length > 0 || doneTicketGroups.length > 0 || hasArchivedTickets;
          const workspaceExpanded = expansion.workspaceId === workspace.id;
          const workspacePanelId = `workbench-sidebar-workspace-${workspace.id}`;
          const workspaceIsDestination =
            workspace.id === selectedWorkspaceId &&
            selectedTicketId === undefined &&
            selectedEpicId === undefined;
          return (
            <SidebarMenuItem key={workspace.id}>
              <div className="flex min-w-0 items-center gap-1">
                {hasDescendants ? (
                  <WorkbenchSidebarDisclosure
                    controls={workspacePanelId}
                    expanded={workspaceExpanded}
                    label={`${workspaceExpanded ? "Collapse" : "Expand"} ${workspace.title}`}
                    onToggle={() =>
                      setExpansion((state) =>
                        reduceWorkbenchSidebarExpansion(state, {
                          type: "toggleWorkspace",
                          workspaceId: workspace.id,
                        }),
                      )
                    }
                  />
                ) : (
                  <span aria-hidden className="size-7 shrink-0" />
                )}
                <SidebarMenuButton
                  aria-current={workspaceIsDestination ? "page" : undefined}
                  className="h-9 w-auto min-w-0 flex-1 gap-2.5 rounded-md px-2.5 text-sm"
                  isActive={workspaceIsDestination}
                  onClick={() => onSelectWorkspace(workspace.id)}
                  tooltip={{ children: workspace.title, hidden: false }}
                >
                  <LayoutDashboardIcon />
                  <WorkbenchSidebarItemTitle>{workspace.title}</WorkbenchSidebarItemTitle>
                  <span className="text-xs tabular-nums text-sidebar-muted-foreground">
                    {ticketCountsByWorkspace.get(workspace.id) ?? 0}
                  </span>
                </SidebarMenuButton>
              </div>
              {hasDescendants ? (
                <div
                  aria-label={`${workspace.title} contents`}
                  className="group-data-[collapsible=icon]:hidden"
                  hidden={!workspaceExpanded}
                  id={workspacePanelId}
                >
                  {workspaceExpanded ? (
                    <div className="ms-3 border-sidebar-border border-l ps-2">
                      {activeTicketGroups.length > 0 ? (
                        <WorkbenchSidebarTicketGroups
                          groups={activeTicketGroups}
                          isDone={false}
                          onOpenThread={onOpenThread}
                          onSelectTicket={onSelectTicket}
                          onToggleTicket={(ticketId, done) =>
                            setExpansion((state) =>
                              reduceWorkbenchSidebarExpansion(state, {
                                type: "toggleTicket",
                                ticketId,
                                workspaceId: workspace.id,
                                done,
                              }),
                            )
                          }
                          selectedEpicId={selectedEpicId}
                          selectedTicketId={selectedTicketId}
                          contextThreadId={contextThreadId}
                          expansion={expansion}
                          workspaceId={workspace.id}
                        />
                      ) : null}
                      {doneTicketGroups.length > 0 ? (
                        <WorkbenchSidebarDoneTickets
                          groups={doneTicketGroups}
                          expanded={expansion.done}
                          onOpenThread={onOpenThread}
                          onSelectTicket={onSelectTicket}
                          onToggle={() =>
                            setExpansion((state) =>
                              reduceWorkbenchSidebarExpansion(state, {
                                type: "toggleDone",
                                workspaceId: workspace.id,
                              }),
                            )
                          }
                          onToggleTicket={(ticketId, done) =>
                            setExpansion((state) =>
                              reduceWorkbenchSidebarExpansion(state, {
                                type: "toggleTicket",
                                ticketId,
                                workspaceId: workspace.id,
                                done,
                              }),
                            )
                          }
                          selectedEpicId={selectedEpicId}
                          selectedTicketId={selectedTicketId}
                          contextThreadId={contextThreadId}
                          expansion={expansion}
                          workspaceId={workspace.id}
                          panelId={`workbench-sidebar-done-${workspace.id}`}
                        />
                      ) : null}
                      {hasArchivedTickets ? (
                        <WorkbenchSidebarArchivedTickets
                          archivedTickets={archivedTickets}
                          expanded={expansion.archived}
                          onSelectTicket={onSelectTicket}
                          onToggle={() =>
                            setExpansion((state) =>
                              reduceWorkbenchSidebarExpansion(state, {
                                type: "toggleArchived",
                                workspaceId: workspace.id,
                              }),
                            )
                          }
                          selectedEpicId={selectedEpicId}
                          selectedTicketId={selectedTicketId}
                          panelId={`workbench-sidebar-archived-${workspace.id}`}
                          contextThreadId={contextThreadId}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </div>
  );
}

type WorkbenchSidebarTicketGroupsProps = {
  readonly contextThreadId: ThreadId | undefined;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly groups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly isDone: boolean;
  readonly onOpenThread: (thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  }) => void;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onToggleTicket: (ticketId: WorkbenchTicketId, isDone: boolean) => void;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly workspaceId: WorkbenchProjectId;
};

function WorkbenchSidebarTicketGroups({
  contextThreadId,
  expansion,
  groups,
  isDone,
  onOpenThread,
  onSelectTicket,
  onToggleTicket,
  selectedEpicId,
  selectedTicketId,
  workspaceId,
}: WorkbenchSidebarTicketGroupsProps) {
  return (
    <SidebarMenu>
      {groups.map((group) => (
        <WorkbenchSidebarTicketGroupRow
          contextThreadId={contextThreadId}
          expansion={expansion}
          group={group}
          isDone={isDone}
          key={group.ticket.id}
          onOpenThread={onOpenThread}
          onSelectTicket={onSelectTicket}
          onToggleTicket={onToggleTicket}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          workspaceId={workspaceId}
        />
      ))}
    </SidebarMenu>
  );
}

function WorkbenchSidebarTicketGroupRow({
  contextThreadId,
  expansion,
  group,
  isDone,
  onOpenThread,
  onSelectTicket,
  onToggleTicket,
  selectedEpicId,
  selectedTicketId,
  workspaceId,
}: Omit<WorkbenchSidebarTicketGroupsProps, "groups"> & {
  readonly group: WorkbenchSidebarTicketGroup;
}) {
  const { ticket, threads } = group;
  const ticketExpanded = expansion.ticketId === ticket.id && expansion.done === isDone;
  const ticketPanelId = `workbench-sidebar-ticket-${ticket.id}`;
  const ticketIsDestination =
    ticket.id === selectedTicketId && contextThreadId === undefined && selectedEpicId === undefined;

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center gap-1">
        {threads.length > 0 ? (
          <WorkbenchSidebarDisclosure
            controls={ticketPanelId}
            expanded={ticketExpanded}
            label={`${ticketExpanded ? "Collapse" : "Expand"} ${ticket.title}`}
            onToggle={() => onToggleTicket(ticket.id, isDone)}
          />
        ) : (
          <span aria-hidden className="size-7 shrink-0" />
        )}
        <SidebarMenuButton
          aria-current={ticketIsDestination ? "page" : undefined}
          className="h-9 w-auto min-w-0 flex-1 gap-2.5 rounded-md px-2.5 text-sm"
          isActive={ticketIsDestination}
          onClick={() => onSelectTicket(workspaceId, ticket.id)}
          size="sm"
          tooltip={{ children: ticket.title, hidden: false }}
        >
          <TicketIcon />
          <WorkbenchSidebarItemTitle>{ticket.title}</WorkbenchSidebarItemTitle>
          {threads.length > 0 ? (
            <span className="text-[10px] tabular-nums text-sidebar-muted-foreground">
              {threads.length}
            </span>
          ) : null}
        </SidebarMenuButton>
      </div>
      {threads.length > 0 ? (
        <div
          aria-label={`${ticket.title} Threads`}
          className="group-data-[collapsible=icon]:hidden"
          hidden={!ticketExpanded}
          id={ticketPanelId}
        >
          {ticketExpanded ? (
            <SidebarMenu className="ms-3 w-auto border-sidebar-border border-l ps-2">
              {threads.map((thread) => (
                <SidebarMenuItem key={thread.id}>
                  <SidebarMenuButton
                    aria-current={thread.id === contextThreadId ? "page" : undefined}
                    className="h-9 gap-2.5 rounded-md px-2.5 text-sm text-sidebar-muted-foreground/75"
                    isActive={thread.id === contextThreadId}
                    onClick={() => onOpenThread(thread)}
                    size="sm"
                    tooltip={{ children: thread.title, hidden: false }}
                  >
                    <MessageSquareIcon />
                    <WorkbenchSidebarItemTitle>{thread.title}</WorkbenchSidebarItemTitle>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : null}
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkbenchSidebarDoneTickets({
  contextThreadId,
  expansion,
  expanded,
  groups,
  onOpenThread,
  onSelectTicket,
  onToggle,
  onToggleTicket,
  panelId,
  selectedEpicId,
  selectedTicketId,
  workspaceId,
}: Omit<WorkbenchSidebarTicketGroupsProps, "isDone"> & {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly panelId: string;
}) {
  return (
    <section aria-label="Done Tickets" className="mt-2">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="mx-0.5 flex h-8 w-[calc(100%-0.25rem)] cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2 text-left text-xs font-medium text-sidebar-muted-foreground/60 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <span className="shrink-0">Done ({groups.length})</span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <div aria-label="Done Ticket list" hidden={!expanded} id={panelId}>
        {expanded ? (
          <WorkbenchSidebarTicketGroups
            contextThreadId={contextThreadId}
            expansion={expansion}
            groups={groups}
            isDone
            onOpenThread={onOpenThread}
            onSelectTicket={onSelectTicket}
            onToggleTicket={onToggleTicket}
            selectedEpicId={selectedEpicId}
            selectedTicketId={selectedTicketId}
            workspaceId={workspaceId}
          />
        ) : null}
      </div>
    </section>
  );
}

function WorkbenchSidebarDisclosure({
  controls,
  expanded,
  label,
  onToggle,
}: {
  readonly controls: string;
  readonly expanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius)] text-sidebar-muted-foreground outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onToggle}
      type="button"
    >
      <ChevronRightIcon
        aria-hidden
        className={`size-3.5 shrink-0 ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

function WorkbenchSidebarItemTitle({ children }: { readonly children: string }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

function WorkbenchSidebarArchivedTickets({
  archivedTickets,
  contextThreadId,
  expanded,
  onSelectTicket,
  onToggle,
  panelId,
  selectedEpicId,
  selectedTicketId,
}: {
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly contextThreadId: ThreadId | undefined;
  readonly expanded: boolean;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onToggle: () => void;
  readonly panelId: string;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
}) {
  return (
    <section aria-label="Archived Tickets" className="mt-2">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="mx-0.5 flex h-8 w-[calc(100%-0.25rem)] cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2 text-left text-xs font-medium text-sidebar-muted-foreground/60 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <span className="shrink-0">Archived ({archivedTickets.length})</span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <div aria-label="Archived Ticket list" hidden={!expanded} id={panelId}>
        {expanded ? (
          <SidebarMenu className="ps-px">
            {archivedTickets.map((ticket) => (
              <SidebarMenuItem key={ticket.id}>
                <SidebarMenuButton
                  aria-current={
                    ticket.id === selectedTicketId &&
                    contextThreadId === undefined &&
                    selectedEpicId === undefined
                      ? "page"
                      : undefined
                  }
                  isActive={
                    ticket.id === selectedTicketId &&
                    contextThreadId === undefined &&
                    selectedEpicId === undefined
                  }
                  onClick={() => onSelectTicket(ticket.projectId, ticket.id)}
                  className="h-9 gap-2.5 rounded-md px-2.5 text-sm text-sidebar-muted-foreground/75"
                  tooltip={{ children: ticket.title, hidden: false }}
                >
                  <ArchiveIcon />
                  <WorkbenchSidebarItemTitle>{ticket.title}</WorkbenchSidebarItemTitle>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        ) : null}
      </div>
    </section>
  );
}
