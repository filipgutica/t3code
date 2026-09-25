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
  ArrowLeftIcon,
  BlocksIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayoutDashboardIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { WorkbenchSidebarTicketButton } from "./WorkbenchSidebarTicketButton";
import {
  getWorkbenchSidebarTicketDetails,
  type WorkbenchSidebarTicketDetails,
} from "./workbenchSidebarContext.logic";
import { WorkbenchSidebarThreadRow } from "./WorkbenchSidebarThreadRow";
import "./WorkbenchSidebarRows.css";
import { SidebarChromeFooter } from "../components/sidebar/SidebarChrome";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
import { useProjects, useThreadDetail, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import {
  filterWorkbenchSidebarNavigation,
  getWorkbenchSidebarExpansionDefaults,
  getWorkbenchSidebarTicketGroups,
  reduceWorkbenchSidebarExpansion,
  revealWorkbenchSidebarSelection,
  type WorkbenchSidebarExpansion,
  type WorkbenchSidebarExpansionAction,
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
  const nativeProjects = useProjects();
  const jiraQuery = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.jiraSnapshot({ environmentId, input: {} }),
  );
  const ticketDetailsById = useMemo(
    () =>
      snapshot
        ? getWorkbenchSidebarTicketDetails({
            environmentId,
            tickets: snapshot.tickets,
            assignments: snapshot.assignments,
            threads: currentThread ? [...threadShells, currentThread] : threadShells,
            projects: nativeProjects,
            epics: snapshot.epics,
            issueLinks: jiraQuery.data?.issueLinks ?? [],
          })
        : new Map<WorkbenchTicketId, WorkbenchSidebarTicketDetails>(),
    [
      environmentId,
      snapshot,
      threadShells,
      currentThread,
      nativeProjects,
      jiraQuery.data?.issueLinks,
    ],
  );
  const selectedTicket = snapshot?.tickets.find((ticket) => ticket.id === selectedTicketId);
  const selectedTicketStatus = selectedTicket?.status;
  const selectedTicketIsDone =
    selectedTicketStatus === "done" && selectedTicket?.archivedAt == null;
  const [sidebarSearch, setSidebarSearch] = useState({ environmentId, query: "" });
  const sidebarQuery = sidebarSearch.environmentId === environmentId ? sidebarSearch.query : "";
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
        includeUnassignedTickets: sidebarQuery.trim().length > 0,
      }),
    [
      environmentId,
      selectedTicketId,
      context?.threadId,
      currentThread,
      snapshot?.assignments,
      snapshot?.tickets,
      threadShells,
      sidebarQuery,
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
  const archivedTicketsByWorkspace = useMemo(() => {
    const archived = new Map<WorkbenchProjectId, WorkbenchSidebarTicket[]>();
    for (const ticket of snapshot?.tickets ?? []) {
      if (ticket.archivedAt == null || ticket.id === selectedTicketId) continue;
      const tickets = archived.get(ticket.projectId) ?? [];
      tickets.push(ticket);
      archived.set(ticket.projectId, tickets);
    }
    return archived;
  }, [selectedTicketId, snapshot?.tickets]);

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
        <SidebarGroup className="gap-2 p-(--sidebar-content-inset)">
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
              key={environmentId ?? "none"}
              data={{
                archivedTicketsByWorkspace,
                jiraOwnershipKnown: jiraQuery.data !== null,
                projects: snapshot?.projects ?? [],
                ticketCountsByWorkspace,
                ticketDetailsById,
                ticketGroupsByWorkspace,
              }}
              selection={{
                contextThreadId: context?.threadId,
                selectedEpicId,
                selectedTicketId,
                selectedTicketIsDone,
                selectedWorkspaceId,
              }}
              search={{
                searchQuery: sidebarQuery,
                onSearchQueryChange: (query) => setSidebarSearch({ environmentId, query }),
              }}
              actions={{
                onOpenThread: openThread,
                onSelectTicket: selectTicket,
                onSelectWorkspace: selectWorkspace,
              }}
            />
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

type WorkbenchSidebarNavigationFields = {
  readonly archivedTicketsByWorkspace: ReadonlyMap<
    WorkbenchProjectId,
    ReadonlyArray<WorkbenchSidebarTicket>
  >;
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
  readonly contextThreadId: ThreadId | undefined;
  readonly jiraOwnershipKnown: boolean;
  readonly onOpenThread: (thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  }) => void;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectWorkspace: (projectId: WorkbenchProjectId) => void;
  readonly projects: ReadonlyArray<Pick<WorkbenchProject, "id" | "title">>;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedTicketIsDone: boolean;
  readonly selectedWorkspaceId: WorkbenchProjectId | undefined;
  readonly ticketCountsByWorkspace: ReadonlyMap<WorkbenchProjectId, number>;
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
};

type WorkbenchSidebarNavigationProps = {
  readonly data: Pick<
    WorkbenchSidebarNavigationFields,
    | "archivedTicketsByWorkspace"
    | "jiraOwnershipKnown"
    | "projects"
    | "ticketCountsByWorkspace"
    | "ticketDetailsById"
    | "ticketGroupsByWorkspace"
  >;
  readonly selection: Pick<
    WorkbenchSidebarNavigationFields,
    | "contextThreadId"
    | "selectedEpicId"
    | "selectedTicketId"
    | "selectedTicketIsDone"
    | "selectedWorkspaceId"
  >;
  readonly search: Pick<WorkbenchSidebarNavigationFields, "searchQuery" | "onSearchQueryChange">;
  readonly actions: Pick<
    WorkbenchSidebarNavigationFields,
    "onOpenThread" | "onSelectTicket" | "onSelectWorkspace"
  >;
};

function WorkbenchSidebarNavigation({
  data,
  selection: routeSelection,
  search,
  actions,
}: WorkbenchSidebarNavigationProps) {
  const {
    archivedTicketsByWorkspace,
    ticketDetailsById,
    jiraOwnershipKnown,
    projects,
    ticketCountsByWorkspace,
    ticketGroupsByWorkspace,
  } = data;
  const {
    contextThreadId,
    selectedEpicId,
    selectedTicketId,
    selectedTicketIsDone,
    selectedWorkspaceId,
  } = routeSelection;
  const { searchQuery, onSearchQueryChange } = search;
  const { onOpenThread, onSelectTicket, onSelectWorkspace } = actions;
  const selectionKey = JSON.stringify([
    selectedWorkspaceId ?? "none",
    selectedTicketId ?? "none",
    selectedTicketIsDone ? "done" : "active",
    contextThreadId ?? "none",
  ]);
  const selection = {
    workspaceId: selectedWorkspaceId,
    ticketId: selectedTicketId,
    ticketIsDone: selectedTicketIsDone,
  };
  const [disclosure, setDisclosure] = useState(() => ({
    selectionKey,
    expansion: getWorkbenchSidebarExpansionDefaults(selection),
  }));
  const expansion =
    disclosure.selectionKey === selectionKey
      ? disclosure.expansion
      : revealWorkbenchSidebarSelection(disclosure.expansion, selection);
  const setExpansion = (
    update: (state: WorkbenchSidebarExpansion) => WorkbenchSidebarExpansion,
  ) => {
    setDisclosure((state) => ({
      selectionKey,
      expansion: update(
        state.selectionKey === selectionKey
          ? state.expansion
          : revealWorkbenchSidebarSelection(state.expansion, selection),
      ),
    }));
  };
  const toggleExpansion = (action: WorkbenchSidebarExpansionAction) =>
    setExpansion((state) => reduceWorkbenchSidebarExpansion(state, action));
  const isSearching = searchQuery.trim().length > 0;
  const jiraKeysByTicketId = useMemo(
    () =>
      new Map(
        [...ticketDetailsById].flatMap(([ticketId, details]) =>
          details.issueLink ? [[ticketId, details.issueLink.issue.key] as const] : [],
        ),
      ),
    [ticketDetailsById],
  );
  const filtered = useMemo(
    () =>
      isSearching
        ? filterWorkbenchSidebarNavigation({
            query: searchQuery,
            projects,
            ticketGroupsByWorkspace,
            archivedTicketsByWorkspace,
            jiraKeysByTicketId,
          })
        : {
            projects,
            ticketGroupsByWorkspace,
            archivedTicketsByWorkspace,
            resultCount: 0,
          },
    [
      isSearching,
      searchQuery,
      projects,
      ticketGroupsByWorkspace,
      archivedTicketsByWorkspace,
      jiraKeysByTicketId,
    ],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 px-1">
        <Input
          aria-label="Search Workbench sidebar"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searchQuery) {
              event.stopPropagation();
              onSearchQueryChange("");
            }
          }}
          placeholder="Search Workbench…"
          size="compact"
          type="search"
          value={searchQuery}
        />
        {searchQuery ? (
          <Button
            aria-label="Clear Workbench search"
            onClick={() => onSearchQueryChange("")}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      {isSearching ? (
        <p aria-live="polite" className="px-2 text-xs text-sidebar-muted-foreground">
          {filtered.resultCount === 0
            ? "No Workbench results"
            : `${filtered.resultCount} ${filtered.resultCount === 1 ? "result" : "results"}`}
        </p>
      ) : null}
      <SidebarMenu aria-label="Workbench Workspaces" className="ps-px">
        {filtered.projects.map((workspace) => (
          <WorkbenchSidebarWorkspaceRow
            key={workspace.id}
            workspace={workspace}
            ticketSections={filtered.ticketGroupsByWorkspace.get(workspace.id)}
            archivedTickets={filtered.archivedTicketsByWorkspace.get(workspace.id) ?? []}
            expansion={expansion}
            isSearching={isSearching}
            onToggle={toggleExpansion}
            navigation={{
              contextThreadId,
              jiraOwnershipKnown,
              onOpenThread,
              onSelectTicket,
              onSelectWorkspace,
              selectedEpicId,
              selectedTicketId,
              selectedWorkspaceId,
              ticketCountsByWorkspace,
              ticketDetailsById,
            }}
          />
        ))}
      </SidebarMenu>
    </div>
  );
}

type WorkbenchSidebarWorkspaceRowProps = {
  readonly workspace: Pick<WorkbenchProject, "id" | "title">;
  readonly ticketSections: WorkbenchSidebarTicketSections | undefined;
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly isSearching: boolean;
  readonly onToggle: (action: WorkbenchSidebarExpansionAction) => void;
  readonly navigation: Pick<
    WorkbenchSidebarNavigationFields,
    | "contextThreadId"
    | "jiraOwnershipKnown"
    | "onOpenThread"
    | "onSelectTicket"
    | "onSelectWorkspace"
    | "selectedEpicId"
    | "selectedTicketId"
    | "selectedWorkspaceId"
    | "ticketCountsByWorkspace"
    | "ticketDetailsById"
  >;
};

function WorkbenchSidebarWorkspaceRow({
  workspace,
  ticketSections,
  archivedTickets,
  expansion,
  isSearching,
  onToggle,
  navigation,
}: WorkbenchSidebarWorkspaceRowProps) {
  const {
    contextThreadId,
    jiraOwnershipKnown,
    onOpenThread,
    onSelectTicket,
    onSelectWorkspace,
    selectedEpicId,
    selectedTicketId,
    selectedWorkspaceId,
    ticketCountsByWorkspace,
    ticketDetailsById,
  } = navigation;
  const activeTicketGroups = ticketSections?.active ?? [];
  const doneTicketGroups = ticketSections?.done ?? [];
  const visibleArchivedTickets =
    isSearching || workspace.id === selectedWorkspaceId ? archivedTickets : [];
  const hasArchivedTickets = visibleArchivedTickets.length > 0;
  const hasDescendants =
    activeTicketGroups.length > 0 || doneTicketGroups.length > 0 || hasArchivedTickets;
  const workspaceExpanded = isSearching || expansion.workspaceId === workspace.id;
  const workspacePanelId = `workbench-sidebar-workspace-${workspace.id}`;
  const workspaceIsDestination =
    workspace.id === selectedWorkspaceId &&
    selectedTicketId === undefined &&
    selectedEpicId === undefined;

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center gap-1">
        {hasDescendants ? (
          <WorkbenchSidebarDisclosure
            controls={workspacePanelId}
            expanded={workspaceExpanded}
            disabled={isSearching}
            label={`${workspaceExpanded ? "Collapse" : "Expand"} ${workspace.title}`}
            onToggle={() => onToggle({ type: "toggleWorkspace", workspaceId: workspace.id })}
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
      <WorkbenchSidebarWorkspacePanel
        hasDescendants={hasDescendants}
        expanded={workspaceExpanded}
        panelId={workspacePanelId}
        title={workspace.title}
      >
        <WorkbenchSidebarWorkspaceContents
          activeTicketGroups={activeTicketGroups}
          archivedTickets={visibleArchivedTickets}
          contextThreadId={contextThreadId}
          doneTicketGroups={doneTicketGroups}
          expansion={expansion}
          isSearching={isSearching}
          jiraOwnershipKnown={jiraOwnershipKnown}
          onOpenThread={onOpenThread}
          onSelectTicket={onSelectTicket}
          onToggle={onToggle}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          ticketDetailsById={ticketDetailsById}
          workspaceId={workspace.id}
        />
      </WorkbenchSidebarWorkspacePanel>
    </SidebarMenuItem>
  );
}

function WorkbenchSidebarWorkspacePanel({
  hasDescendants,
  expanded,
  panelId,
  title,
  children,
}: {
  readonly hasDescendants: boolean;
  readonly expanded: boolean;
  readonly panelId: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  if (!hasDescendants) return null;
  return (
    <div
      aria-label={`${title} contents`}
      className="group-data-[collapsible=icon]:hidden"
      hidden={!expanded}
      id={panelId}
    >
      {expanded ? children : null}
    </div>
  );
}

type WorkbenchSidebarWorkspaceContentsProps = Pick<
  WorkbenchSidebarNavigationFields,
  | "contextThreadId"
  | "jiraOwnershipKnown"
  | "onOpenThread"
  | "onSelectTicket"
  | "selectedEpicId"
  | "selectedTicketId"
  | "ticketDetailsById"
> & {
  readonly activeTicketGroups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly doneTicketGroups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly isSearching: boolean;
  readonly onToggle: (action: WorkbenchSidebarExpansionAction) => void;
  readonly workspaceId: WorkbenchProjectId;
};

function WorkbenchSidebarWorkspaceContents({
  activeTicketGroups,
  archivedTickets,
  contextThreadId,
  doneTicketGroups,
  expansion,
  isSearching,
  jiraOwnershipKnown,
  onOpenThread,
  onSelectTicket,
  onToggle,
  selectedEpicId,
  selectedTicketId,
  ticketDetailsById,
  workspaceId,
}: WorkbenchSidebarWorkspaceContentsProps) {
  const onToggleTicket = (ticketId: WorkbenchTicketId, done: boolean) =>
    onToggle({ type: "toggleTicket", ticketId, workspaceId, done });

  return (
    <div className="ms-3 border-sidebar-border border-l ps-2">
      {activeTicketGroups.length > 0 ? (
        <WorkbenchSidebarTicketGroups
          ticketDetailsById={ticketDetailsById}
          groups={activeTicketGroups}
          isDone={false}
          onOpenThread={onOpenThread}
          onSelectTicket={onSelectTicket}
          onToggleTicket={onToggleTicket}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          contextThreadId={contextThreadId}
          jiraOwnershipKnown={jiraOwnershipKnown}
          expansion={expansion}
          isSearching={isSearching}
          workspaceId={workspaceId}
        />
      ) : null}
      {doneTicketGroups.length > 0 ? (
        <WorkbenchSidebarDoneTickets
          ticketDetailsById={ticketDetailsById}
          groups={doneTicketGroups}
          expanded={expansion.done}
          isSearching={isSearching}
          onOpenThread={onOpenThread}
          onSelectTicket={onSelectTicket}
          onToggle={() => onToggle({ type: "toggleDone", workspaceId })}
          onToggleTicket={onToggleTicket}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          contextThreadId={contextThreadId}
          jiraOwnershipKnown={jiraOwnershipKnown}
          expansion={expansion}
          workspaceId={workspaceId}
          panelId={`workbench-sidebar-done-${workspaceId}`}
        />
      ) : null}
      {archivedTickets.length > 0 ? (
        <WorkbenchSidebarArchivedTickets
          ticketDetailsById={ticketDetailsById}
          archivedTickets={archivedTickets}
          expanded={expansion.archived}
          isSearching={isSearching}
          onSelectTicket={onSelectTicket}
          onToggle={() => onToggle({ type: "toggleArchived", workspaceId })}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          panelId={`workbench-sidebar-archived-${workspaceId}`}
          contextThreadId={contextThreadId}
          jiraOwnershipKnown={jiraOwnershipKnown}
        />
      ) : null}
    </div>
  );
}

type WorkbenchSidebarTicketGroupsProps = {
  readonly contextThreadId: ThreadId | undefined;
  readonly jiraOwnershipKnown: boolean;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly isSearching: boolean;
  readonly groups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
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
  ticketDetailsById,
  contextThreadId,
  jiraOwnershipKnown,
  expansion,
  isSearching,
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
          ticketDetailsById={ticketDetailsById}
          contextThreadId={contextThreadId}
          jiraOwnershipKnown={jiraOwnershipKnown}
          expansion={expansion}
          isSearching={isSearching}
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
  ticketDetailsById,
  contextThreadId,
  jiraOwnershipKnown,
  expansion,
  isSearching,
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
  const ticketExpanded =
    isSearching || (expansion.ticketId === ticket.id && expansion.done === isDone);
  const ticketPanelId = `workbench-sidebar-ticket-${ticket.id}-${isDone ? "done" : "active"}`;
  const ticketIsDestination =
    ticket.id === selectedTicketId && contextThreadId === undefined && selectedEpicId === undefined;

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center gap-1">
        {threads.length > 0 ? (
          <WorkbenchSidebarDisclosure
            controls={ticketPanelId}
            expanded={ticketExpanded}
            disabled={isSearching}
            label={`${ticketExpanded ? "Collapse" : "Expand"} ${ticket.title}`}
            onToggle={() => onToggleTicket(ticket.id, isDone)}
          />
        ) : (
          <span aria-hidden className="size-7 shrink-0" />
        )}
        <WorkbenchSidebarTicketButton
          ticket={ticket}
          details={ticketDetailsById.get(ticket.id)}
          jiraOwnershipKnown={jiraOwnershipKnown}
          isActive={ticketIsDestination}
          onSelect={() => onSelectTicket(workspaceId, ticket.id)}
        />
      </div>
      {threads.length > 0 ? (
        <div
          aria-label={`${ticket.title} Threads`}
          className="group-data-[collapsible=icon]:hidden"
          hidden={!ticketExpanded}
          id={ticketPanelId}
        >
          {ticketExpanded ? (
            <WorkbenchSidebarTicketThreads
              key={
                threads.some((thread) => thread.id === contextThreadId) ? contextThreadId : "none"
              }
              threads={threads}
              contextThreadId={contextThreadId}
              isSearching={isSearching}
              onOpenThread={onOpenThread}
              ticket={ticket}
            />
          ) : null}
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkbenchSidebarDoneTickets({
  ticketDetailsById,
  contextThreadId,
  jiraOwnershipKnown,
  expansion,
  expanded,
  isSearching,
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
  readonly isSearching: boolean;
  readonly onToggle: () => void;
  readonly panelId: string;
}) {
  const sectionExpanded = isSearching || expanded;
  return (
    <section aria-label="Done Tickets" className="mt-2">
      <button
        aria-controls={panelId}
        aria-expanded={sectionExpanded}
        className="mx-0.5 flex h-8 w-[calc(100%-0.25rem)] cursor-pointer items-center gap-2 rounded-(--control-radius) px-2 text-left text-xs font-medium text-sidebar-muted-foreground/60 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        disabled={isSearching}
        type="button"
      >
        <span className="shrink-0">Done ({groups.length})</span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={`size-3 shrink-0 transition-transform ${sectionExpanded ? "rotate-180" : ""}`}
        />
      </button>
      <div aria-label="Done Ticket list" hidden={!sectionExpanded} id={panelId}>
        {sectionExpanded ? (
          <WorkbenchSidebarTicketGroups
            ticketDetailsById={ticketDetailsById}
            contextThreadId={contextThreadId}
            jiraOwnershipKnown={jiraOwnershipKnown}
            expansion={expansion}
            isSearching={isSearching}
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

function WorkbenchSidebarTicketThreads({
  threads,
  contextThreadId,
  isSearching,
  onOpenThread,
  ticket,
}: Pick<WorkbenchSidebarTicketGroup, "threads" | "ticket"> &
  Pick<WorkbenchSidebarTicketGroupsProps, "contextThreadId" | "onOpenThread" | "isSearching">) {
  const activeThreads = threads.filter((thread) => thread.settledOverride !== "settled");
  const settledThreads = threads.filter((thread) => thread.settledOverride === "settled");
  const selectedThreadIsSettled = settledThreads.some((thread) => thread.id === contextThreadId);
  const [expanded, setExpanded] = useState(selectedThreadIsSettled);
  const settledExpanded = isSearching || expanded;
  const panelId = `workbench-sidebar-ticket-settled-${ticket.id}`;
  const renderThread = (thread: WorkbenchSidebarTicketGroup["threads"][number]) => (
    <WorkbenchSidebarThreadRow
      key={thread.id}
      thread={thread}
      isActive={thread.id === contextThreadId}
      onOpenThread={onOpenThread}
    />
  );
  return (
    <div className="ms-8 border-sidebar-border border-l ps-2">
      <SidebarMenu>{activeThreads.map(renderThread)}</SidebarMenu>
      {settledThreads.length > 0 ? (
        <section aria-label={`Settled Threads in ${ticket.title}`} className="mt-1">
          <button
            aria-label={`${settledExpanded ? "Collapse" : "Expand"} Settled Threads in ${ticket.title}`}
            aria-controls={panelId}
            aria-expanded={settledExpanded}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setExpanded((value) => !value)}
            disabled={isSearching}
            type="button"
          >
            <span>Settled ({settledThreads.length})</span>
            <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
            <ChevronDownIcon
              aria-hidden
              className={`size-3 ${settledExpanded ? "rotate-180" : ""}`}
            />
          </button>
          <div hidden={!settledExpanded} id={panelId}>
            {settledExpanded ? <SidebarMenu>{settledThreads.map(renderThread)}</SidebarMenu> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function WorkbenchSidebarDisclosure({
  controls,
  expanded,
  label,
  disabled = false,
  onToggle,
}: {
  readonly controls: string;
  readonly expanded: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      disabled={disabled}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-(--control-radius) text-sidebar-muted-foreground outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
  ticketDetailsById,
  archivedTickets,
  contextThreadId,
  jiraOwnershipKnown,
  expanded,
  isSearching,
  onSelectTicket,
  onToggle,
  panelId,
  selectedEpicId,
  selectedTicketId,
}: {
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
  readonly contextThreadId: ThreadId | undefined;
  readonly jiraOwnershipKnown: boolean;
  readonly expanded: boolean;
  readonly isSearching: boolean;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onToggle: () => void;
  readonly panelId: string;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
}) {
  const sectionExpanded = isSearching || expanded;
  return (
    <section aria-label="Archived Tickets" className="mt-2">
      <button
        aria-controls={panelId}
        aria-expanded={sectionExpanded}
        className="mx-0.5 flex h-8 w-[calc(100%-0.25rem)] cursor-pointer items-center gap-2 rounded-(--control-radius) px-2 text-left text-xs font-medium text-sidebar-muted-foreground/60 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        disabled={isSearching}
        type="button"
      >
        <span className="shrink-0">Archived ({archivedTickets.length})</span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={`size-3 shrink-0 transition-transform ${sectionExpanded ? "rotate-180" : ""}`}
        />
      </button>
      <div aria-label="Archived Ticket list" hidden={!sectionExpanded} id={panelId}>
        {sectionExpanded ? (
          <SidebarMenu className="ps-px">
            {archivedTickets.map((ticket) => (
              <SidebarMenuItem key={ticket.id}>
                <WorkbenchSidebarTicketButton
                  ticket={ticket}
                  details={ticketDetailsById.get(ticket.id)}
                  jiraOwnershipKnown={jiraOwnershipKnown}
                  isActive={
                    ticket.id === selectedTicketId &&
                    contextThreadId === undefined &&
                    selectedEpicId === undefined
                  }
                  onSelect={() => onSelectTicket(ticket.projectId, ticket.id)}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        ) : null}
      </div>
    </section>
  );
}
