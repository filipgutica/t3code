import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  type ThreadId,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  AlertCircleIcon,
  BellIcon,
  BlocksIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  LayoutDashboardIcon,
  ListFilterIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useWorkbenchSidebarReveal } from "./useWorkbenchSidebarReveal";
import { useRefreshOnThreadActivity } from "./useWorkbenchTicketConversation";
import { getWorkbenchSidebarActiveKey } from "./workbenchSidebarReveal.logic";
import { useWorkbenchSidebarFilters } from "./workbenchSidebarFilterState";

import {
  getWorkbenchSidebarSearchResults,
  type WorkbenchSidebarSearchResult,
} from "./workbenchSidebarSearch.logic";
import { WorkbenchSidebarSearchResults } from "./WorkbenchSidebarSearchResults";
import { WorkbenchSidebarTicketButton } from "./WorkbenchSidebarTicketButton";
import { WorkbenchRetainedWorktrees } from "./WorkbenchRetainedWorktrees";
import {
  getWorkbenchSidebarTicketDetails,
  type WorkbenchSidebarTicketDetails,
} from "./workbenchSidebarContext.logic";
import {
  groupWorkbenchReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import { WorkbenchSidebarRowNavigation } from "./WorkbenchSidebarRowNavigation";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import {
  getWorkbenchSidebarActionableThreadIds,
  prioritizeWorkbenchSidebarAttention,
} from "./workbenchSidebarAttention.logic";
import "./WorkbenchSidebarRows.css";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { WorkbenchInlineError } from "./WorkbenchForms";
import {
  WorkbenchSidebarDrafts,
  useWorkbenchSidebarDraftMenu,
  useWorkbenchSidebarDrafts,
  type WorkbenchSidebarDraft,
} from "./WorkbenchSidebarDrafts";
import { WorkbenchSidebarFooter } from "./WorkbenchSidebarFooter";
import {
  getUnsavedConversationDrafts,
  getConversationDraftTitle,
} from "./workbenchTicketDraft.logic";

type SidebarDraft = WorkbenchSidebarDraft;

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShell, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import {
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

function useWorkbenchSidebarNavigation({
  context,
  environmentId,
  selectedWorkspaceId,
  selectedTicketId,
  selectedEpicId,
  isMobile,
  setOpenMobile,
}: {
  context: Parameters<typeof WorkbenchSidebar>[0]["context"];
  environmentId: EnvironmentId | null;
  selectedWorkspaceId: WorkbenchProjectId | undefined;
  selectedTicketId: WorkbenchTicketId | undefined;
  selectedEpicId: WorkbenchEpicId | undefined;
  isMobile: boolean;
  setOpenMobile: (open: boolean) => void;
}) {
  const navigate = useNavigate();
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

  const createTicket = (projectId: WorkbenchProjectId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: {
        ...(environmentId ? { environmentId } : {}),
        workbenchProjectId: projectId,
        create: "ticket",
      },
    });
  };
  return { selectWorkspace, selectTicket, openThread, leaveWorkbench, addWorkspace, createTicket };
}

export function WorkbenchSidebar({
  context,
  routeEnvironmentId,
}: {
  readonly routeEnvironmentId?: EnvironmentId | undefined;
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
  const selectedEnvironmentId =
    context?.environmentId ?? routeEnvironmentId ?? search.environmentId;
  const environmentId = selectedEnvironmentId ?? primaryEnvironmentId;
  const { isMobile, setOpenMobile } = useSidebar();
  const {
    query,
    snapshot,
    draftsByWorkspace,
    ticketDetailsById,
    referencesByTicket,
    selectedTicketIsDone,
    sidebarQuery,
    setSidebarSearch,
    onlyActionable,
    setOnlyActionable,
    actionableThreadIdsByTicket,
    ticketGroupsByWorkspace,
    ticketCountsByWorkspace,
    archivedTicketsByWorkspace,
  } = useWorkbenchSidebarData({ context, environmentId, selectedTicketId });

  const { selectWorkspace, selectTicket, openThread, leaveWorkbench, addWorkspace, createTicket } =
    useWorkbenchSidebarNavigation({
      context,
      environmentId,
      selectedWorkspaceId,
      selectedTicketId,
      selectedEpicId,
      isMobile,
      setOpenMobile,
    });

  const header = (
    <>
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
    </>
  );
  return (
    <>
      {environmentId ? (
        <WorkbenchSidebarNavigation
          key={environmentId}
          header={header}
          query={query}
          snapshot={snapshot}
          data={{
            environmentId,
            archivedTicketsByWorkspace,
            projects: snapshot?.projects ?? [],
            draftsByWorkspace,
            ticketCountsByWorkspace,
            ticketDetailsById,
            referencesByTicket,
            ticketGroupsByWorkspace,
            actionableThreadIdsByTicket,
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
            onSearchQueryChange: setSidebarSearch,
            onlyActionable,
            onOnlyActionableChange: setOnlyActionable,
          }}
          actions={{
            onOpenThread: openThread,
            onSelectTicket: selectTicket,
            onSelectWorkspace: selectWorkspace,
            onCreateTicket: createTicket,
          }}
        />
      ) : (
        <SidebarContent fixedHeader={<SidebarGroup>{header}</SidebarGroup>}>
          <WorkbenchSidebarWorkspaceState
            environmentId={null}
            query={query}
            snapshot={snapshot}
            navigation={null}
          />
        </SidebarContent>
      )}
      <WorkbenchSidebarFooter
        onLeave={leaveWorkbench}
        retainedWorktrees={
          environmentId && snapshot ? (
            <WorkbenchRetainedWorktrees
              key={environmentId}
              environmentId={environmentId}
              snapshot={snapshot}
              compact
            />
          ) : null
        }
      />
    </>
  );
}

type WorkbenchSidebarNavigationFields = {
  readonly environmentId: EnvironmentId;
  readonly draftsByWorkspace: ReadonlyMap<WorkbenchProjectId, ReadonlyArray<SidebarDraft>>;
  readonly archivedTicketsByWorkspace: ReadonlyMap<
    WorkbenchProjectId,
    ReadonlyArray<WorkbenchSidebarTicket>
  >;
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
  readonly contextThreadId: ThreadId | undefined;
  readonly onOpenThread: (thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  }) => void;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectWorkspace: (projectId: WorkbenchProjectId) => void;
  readonly onCreateTicket: (projectId: WorkbenchProjectId) => void;
  readonly projects: ReadonlyArray<Pick<WorkbenchProject, "id" | "title" | "archivedAt">>;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onlyActionable: boolean;
  readonly onOnlyActionableChange: (value: boolean) => void;
  readonly actionableThreadIdsByTicket: ReturnType<typeof getWorkbenchSidebarActionableThreadIds>;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedTicketIsDone: boolean;
  readonly selectedWorkspaceId: WorkbenchProjectId | undefined;
  readonly ticketCountsByWorkspace: ReadonlyMap<WorkbenchProjectId, number>;
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
};

type WorkbenchSidebarNavigationProps = {
  readonly header: ReactNode;
  readonly query: { isPending: boolean; error: string | null; refresh: () => void };
  readonly snapshot: { projects: ReadonlyArray<unknown> } | null;
  readonly data: Pick<
    WorkbenchSidebarNavigationFields,
    | "archivedTicketsByWorkspace"
    | "environmentId"
    | "projects"
    | "draftsByWorkspace"
    | "ticketCountsByWorkspace"
    | "ticketDetailsById"
    | "referencesByTicket"
    | "ticketGroupsByWorkspace"
    | "actionableThreadIdsByTicket"
  >;
  readonly selection: Pick<
    WorkbenchSidebarNavigationFields,
    | "contextThreadId"
    | "selectedEpicId"
    | "selectedTicketId"
    | "selectedTicketIsDone"
    | "selectedWorkspaceId"
  >;
  readonly search: Pick<
    WorkbenchSidebarNavigationFields,
    "searchQuery" | "onSearchQueryChange" | "onlyActionable" | "onOnlyActionableChange"
  >;
  readonly actions: Pick<
    WorkbenchSidebarNavigationFields,
    "onOpenThread" | "onSelectTicket" | "onSelectWorkspace" | "onCreateTicket"
  >;
};

const getWorkbenchSidebarFilterLabel = ({
  isSearching,
  resultCount,
  actionableTicketCount,
}: {
  isSearching: boolean;
  resultCount: number;
  actionableTicketCount: number;
}) => {
  if (isSearching) {
    if (resultCount === 0) return "No Workbench results";
    return `${resultCount} ${resultCount === 1 ? "result" : "results"}`;
  }
  if (actionableTicketCount === 0) return "No confirmed actions";
  return `${actionableTicketCount} actionable ${actionableTicketCount === 1 ? "Ticket" : "Tickets"}`;
};

function WorkbenchSidebarFilters({
  search,
  resultCount,
  actionableTicketCount,
  onSearchKeyDown,
  activeResultIndex,
}: {
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  activeResultIndex: number;
  search: WorkbenchSidebarNavigationProps["search"];
  resultCount: number;
  actionableTicketCount: number;
}) {
  const { searchQuery, onSearchQueryChange, onlyActionable, onOnlyActionableChange } = search;
  const isSearching = searchQuery.trim().length > 0;
  return (
    <>
      <div className="flex items-center gap-1 px-1">
        <Input
          aria-label="Search Workbench sidebar"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isSearching}
          aria-controls={isSearching ? "workbench-sidebar-search-results" : undefined}
          aria-activedescendant={
            isSearching && activeResultIndex >= 0
              ? `workbench-sidebar-search-result-${activeResultIndex}`
              : undefined
          }
          onKeyDown={onSearchKeyDown}
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
        <Menu>
          <span className="relative flex shrink-0">
            <MenuTrigger
              render={
                <Button
                  aria-label={onlyActionable ? "Filter Workbench, filter on" : "Filter Workbench"}
                  size="icon-xs"
                  variant={onlyActionable ? "accent-soft" : "ghost"}
                />
              }
            >
              <ListFilterIcon />
            </MenuTrigger>
            {onlyActionable ? <span aria-hidden data-workbench-sidebar-filter-dot="" /> : null}
          </span>
          <MenuPopup align="end">
            <MenuCheckboxItem
              variant="switch"
              checked={onlyActionable}
              onCheckedChange={onOnlyActionableChange}
            >
              <span className="flex items-center gap-2">
                <BellIcon aria-hidden className="size-4" />
                <span className="flex-1">Needs attention</span>
                <span className="tabular-nums text-muted-foreground">{actionableTicketCount}</span>
              </span>
            </MenuCheckboxItem>
          </MenuPopup>
        </Menu>
      </div>
      {onlyActionable ? (
        <button
          type="button"
          data-workbench-sidebar-filter-chip=""
          aria-label="Turn off Needs attention filter"
          onClick={() => onOnlyActionableChange(false)}
        >
          <BellIcon aria-hidden className="size-3 shrink-0" />
          <span>Needs attention</span>
          {actionableTicketCount > 0 ? (
            <span className="tabular-nums">{actionableTicketCount}</span>
          ) : null}
          <XIcon aria-hidden className="size-3 shrink-0" />
        </button>
      ) : null}
      {isSearching || onlyActionable ? (
        <p
          aria-live="polite"
          className={isSearching ? "px-2 text-xs text-sidebar-muted-foreground" : "sr-only"}
        >
          {getWorkbenchSidebarFilterLabel({ isSearching, resultCount, actionableTicketCount })}
        </p>
      ) : null}
    </>
  );
}

function WorkbenchSidebarNothingNeedsYou({
  visible,
  inspectionIncomplete,
  onShowAll,
}: {
  readonly visible: boolean;
  readonly inspectionIncomplete: boolean;
  readonly onShowAll: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-xs text-sidebar-muted-foreground">
      <CircleCheckIcon aria-hidden className="mb-1 size-4 text-success-foreground" />
      <p className="text-sm font-medium text-sidebar-foreground">Nothing needs you</p>
      <p>Agents are working or done.</p>
      {inspectionIncomplete ? <p>Some linked PRs couldn't be checked yet.</p> : null}
      <Button size="xs" variant="link" onClick={onShowAll}>
        Show all Tickets
      </Button>
    </div>
  );
}

function useWorkbenchSidebarSearchKeyboard({
  searchQuery,
  searchResults,
  onSearchQueryChange,
  onSelect,
}: {
  searchQuery: string;
  searchResults: ReadonlyArray<WorkbenchSidebarSearchResult>;
  onSearchQueryChange: (query: string) => void;
  onSelect: (result: WorkbenchSidebarSearchResult) => void;
}) {
  const [searchCursor, setSearchCursor] = useState({ query: searchQuery, index: -1 });
  const activeResultIndex =
    searchResults.length === 0
      ? -1
      : Math.min(
          searchCursor.query === searchQuery ? searchCursor.index : -1,
          searchResults.length - 1,
        );
  const setActiveResultIndex = (index: number) => setSearchCursor({ query: searchQuery, index });
  const changeSearchQuery = (query: string) => {
    setSearchCursor({ query, index: -1 });
    onSearchQueryChange(query);
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (searchQuery) event.stopPropagation();
      changeSearchQuery("");
      return;
    }
    if (searchResults.length === 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[Math.max(0, activeResultIndex)];
      if (result) onSelect(result);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const current = activeResultIndex < 0 && direction < 0 ? 0 : activeResultIndex;
    const index = (current + direction + searchResults.length) % searchResults.length;
    setActiveResultIndex(index);
    document
      .getElementById(`workbench-sidebar-search-result-${index}`)
      ?.scrollIntoView({ block: "nearest" });
  };
  return { activeResultIndex, onSearchKeyDown, setActiveResultIndex, changeSearchQuery };
}

function useWorkbenchSidebarDisclosure({
  selectionKey,
  selection,
  onlyActionable,
  onOnlyActionableChange,
}: {
  selectionKey: string;
  selection: Parameters<typeof getWorkbenchSidebarExpansionDefaults>[0];
  onlyActionable: boolean;
  onOnlyActionableChange: (value: boolean) => void;
}) {
  const [allDisclosure, setAllDisclosure] = useState(() => ({
    selectionKey,
    expansion: getWorkbenchSidebarExpansionDefaults(selection),
  }));
  const [attentionDisclosure, setAttentionDisclosure] = useState(() => ({
    selectionKey,
    expansion: getWorkbenchSidebarExpansionDefaults(selection),
  }));
  const disclosure = onlyActionable ? attentionDisclosure : allDisclosure;
  const setDisclosure = onlyActionable ? setAttentionDisclosure : setAllDisclosure;
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
  const [collapsedAttentionWorkspaces, setCollapsedAttentionWorkspaces] = useState<
    ReadonlySet<WorkbenchProjectId>
  >(() => new Set());
  const changeAttentionFilter = (value: boolean) => {
    if (value !== onlyActionable) setCollapsedAttentionWorkspaces(new Set());
    onOnlyActionableChange(value);
  };
  const toggleExpansion = (action: WorkbenchSidebarExpansionAction) => {
    if (!onlyActionable || action.type !== "toggleWorkspace") {
      setExpansion((state) => reduceWorkbenchSidebarExpansion(state, action));
      return;
    }
    setCollapsedAttentionWorkspaces((previous) => {
      const next = new Set(previous);
      if (next.has(action.workspaceId)) next.delete(action.workspaceId);
      else next.add(action.workspaceId);
      return next;
    });
  };
  const revealAttentionWorkspace = (workspaceId: WorkbenchProjectId) =>
    setCollapsedAttentionWorkspaces((previous) => {
      const next = new Set(previous);
      next.delete(workspaceId);
      return next;
    });
  return {
    expansion,
    setExpansion,
    toggleExpansion,
    collapsedAttentionWorkspaces,
    changeAttentionFilter,
    revealAttentionWorkspace,
  };
}

function isWorkbenchSidebarSelectionVisible({
  selection,
  projects,
  groups,
}: {
  selection: WorkbenchSidebarNavigationProps["selection"];
  projects: WorkbenchSidebarNavigationFields["projects"];
  groups: WorkbenchSidebarNavigationFields["ticketGroupsByWorkspace"];
}) {
  const { selectedWorkspaceId, selectedTicketId } = selection;
  if (!selectedWorkspaceId) return true;
  if (!selectedTicketId) return projects.some((project) => project.id === selectedWorkspaceId);
  return (
    groups.get(selectedWorkspaceId)?.active.some((group) => group.ticket.id === selectedTicketId) ??
    false
  );
}

function WorkbenchSidebarFilterLocationCue({
  selection,
  onClear,
}: {
  selection: WorkbenchSidebarNavigationProps["selection"];
  onClear: () => void;
}) {
  const kind = selection.contextThreadId
    ? "Thread"
    : selection.selectedTicketId
      ? "Ticket"
      : "Workspace";
  return (
    <div className="px-2 text-xs text-sidebar-muted-foreground">
      Current {kind} is outside this filter.{" "}
      <button type="button" className="underline" onClick={onClear}>
        Show all work
      </button>
    </div>
  );
}

function WorkbenchSidebarFixedHeader({
  header,
  filters,
  location,
}: {
  header: ReactNode;
  filters: Parameters<typeof WorkbenchSidebarFilters>[0];
  location: Parameters<typeof WorkbenchSidebarFilterLocationCue>[0] & { visible: boolean };
}) {
  return (
    <SidebarGroup>
      <div className="space-y-2">
        {header}
        <WorkbenchSidebarFilters {...filters} />
        {location.visible ? (
          <WorkbenchSidebarFilterLocationCue
            selection={location.selection}
            onClear={location.onClear}
          />
        ) : null}
      </div>
    </SidebarGroup>
  );
}

function getWorkbenchSidebarSearchSelection(
  result: WorkbenchSidebarSearchResult,
  groups: WorkbenchSidebarNavigationFields["ticketGroupsByWorkspace"],
) {
  const ticketId = result.kind === "workspace" ? undefined : result.ticketId;
  const ticketIsDone =
    groups.get(result.workspaceId)?.done.some((group) => group.ticket.id === ticketId) ?? false;
  return { workspaceId: result.workspaceId, ticketIsDone };
}

const emptySidebarDrafts: WorkbenchSidebarNavigationFields["draftsByWorkspace"] = new Map();

/** Ticket status moves rows between lists, removing focused actions. */
function useWorkbenchSidebarRowFocus(navigationRef: RefObject<HTMLElement | null>) {
  const previousFocus = useRef<{
    ticketId: string | undefined;
    trigger: HTMLElement;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores DOM focus when a status commit replaces the focused sidebar action
  useLayoutEffect(() => {
    const previous = previousFocus.current;
    if (!previous || previous.trigger.isConnected) return;
    previousFocus.current = null;
    if (document.activeElement !== document.body) return;
    const ticketRow = Array.from(
      navigationRef.current?.querySelectorAll<HTMLElement>(
        "[data-workbench-sidebar-ticket-row-id]",
      ) ?? [],
    ).find((row) => row.dataset.workbenchSidebarTicketRowId === previous.ticketId);
    const target =
      ticketRow?.querySelector<HTMLButtonElement>("[data-workbench-sidebar-navigation]") ??
      document.querySelector<HTMLInputElement>('input[aria-label="Search Workbench sidebar"]');
    target?.focus({ preventScroll: true });
  });
  return (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    const ticketRow = event.target.closest<HTMLElement>("[data-workbench-sidebar-ticket-row-id]");
    previousFocus.current = ticketRow
      ? { ticketId: ticketRow.dataset.workbenchSidebarTicketRowId, trigger: event.target }
      : null;
  };
}

function getWorkbenchSidebarVisibleProjects({
  projects,
  onlyActionable,
  groups,
}: {
  projects: WorkbenchSidebarNavigationFields["projects"];
  onlyActionable: boolean;
  groups: WorkbenchSidebarNavigationFields["ticketGroupsByWorkspace"];
}) {
  return projects.filter((project) => {
    if (project.archivedAt != null) return false;
    return !onlyActionable || (groups.get(project.id)?.active.length ?? 0) > 0;
  });
}

function useWorkbenchSidebarAttentionNavigation({
  ticketGroupsByWorkspace,
  actionableThreadIdsByTicket,
  projects,
  onlyActionable,
}: Pick<
  WorkbenchSidebarNavigationFields,
  "ticketGroupsByWorkspace" | "actionableThreadIdsByTicket" | "projects" | "onlyActionable"
>) {
  const { attentionSignalsByTicket, attentionInspectionsByTicket } = useWorkbenchAttentionData();
  const prioritizedGroups = prioritizeWorkbenchSidebarAttention({
    ticketGroupsByWorkspace,
    attentionSignalsByTicket,
    actionableThreadIdsByTicket,
    onlyActionable,
  });
  const actionableProjects = getWorkbenchSidebarVisibleProjects({
    projects,
    onlyActionable,
    groups: prioritizedGroups,
  });
  const actionableTicketCount = [...attentionSignalsByTicket.values()].filter(
    (signals) => signals.length > 0,
  ).length;
  const inspectionIncomplete = [...attentionInspectionsByTicket.values()].some((inspections) =>
    inspections.some((inspection) => inspection.displayStatus !== "complete"),
  );
  const archivedProjects = onlyActionable
    ? []
    : projects.filter((workspace) => workspace.archivedAt != null);
  return {
    archivedProjects,
    prioritizedGroups,
    actionableProjects,
    actionableTicketCount,
    inspectionIncomplete,
  };
}

function WorkbenchSidebarNavigation({
  header,
  query,
  snapshot,
  data,
  selection: routeSelection,
  search,
  actions,
}: WorkbenchSidebarNavigationProps) {
  const {
    environmentId,
    archivedTicketsByWorkspace,
    ticketDetailsById,
    referencesByTicket,
    projects,
    ticketCountsByWorkspace,
    ticketGroupsByWorkspace,
    actionableThreadIdsByTicket,
    draftsByWorkspace,
  } = data;
  const {
    contextThreadId,
    selectedEpicId,
    selectedTicketId,
    selectedTicketIsDone,
    selectedWorkspaceId,
  } = routeSelection;
  const { searchQuery, onlyActionable } = search;
  const { onOpenThread, onSelectTicket, onSelectWorkspace, onCreateTicket } = actions;
  const selectionKey = JSON.stringify([
    selectedWorkspaceId,
    selectedTicketId,
    selectedTicketIsDone,
    contextThreadId,
  ]);
  const selection = { workspaceId: selectedWorkspaceId, ticketIsDone: selectedTicketIsDone };
  const {
    expansion,
    setExpansion,
    toggleExpansion,
    collapsedAttentionWorkspaces,
    changeAttentionFilter,
    revealAttentionWorkspace,
  } = useWorkbenchSidebarDisclosure({
    selectionKey,
    selection,
    onlyActionable,
    onOnlyActionableChange: search.onOnlyActionableChange,
  });
  const isSearching = searchQuery.trim().length > 0;
  const {
    prioritizedGroups,
    archivedProjects,
    actionableProjects,
    actionableTicketCount,
    inspectionIncomplete,
  } = useWorkbenchSidebarAttentionNavigation({
    ticketGroupsByWorkspace,
    actionableThreadIdsByTicket,
    projects,
    onlyActionable,
  });
  const visibleDrafts = onlyActionable ? emptySidebarDrafts : draftsByWorkspace;
  const visibleProjects = actionableProjects;
  const archivedFiltered = {
    projects: archivedProjects,
    ticketGroupsByWorkspace,
    archivedTicketsByWorkspace,
  };
  const allDrafts = [...draftsByWorkspace.values()].flat();
  const selectedDraft = allDrafts.find((draft) => draft.id === selectedTicketId);
  const writableWorkspaceIds = new Set(
    projects.filter((workspace) => workspace.archivedAt == null).map((workspace) => workspace.id),
  );
  const {
    navigationRef,
    disclosure: draftDisclosure,
    menu: draftMenu,
  } = useWorkbenchSidebarDrafts({
    environmentId,
    drafts: [...visibleDrafts.values()].flat(),
    writableWorkspaceIds,
    selectedWorkspaceId,
    selectedTicketId,
    onSelectWorkspace,
    selectedDraft,
  });
  const onRowFocusCapture = useWorkbenchSidebarRowFocus(navigationRef);
  const contentRef = useWorkbenchSidebarReveal({
    navigationRef,
    activeKey: getWorkbenchSidebarActiveKey([
      selectedWorkspaceId,
      selectedTicketId,
      contextThreadId,
      selectedEpicId,
    ]),
    onlyActionable,
    isSearching,
  });
  const navigation = {
    onSelectTicket,
    onSelectWorkspace,
    selectedEpicId,
    selectedTicketId,
    selectedWorkspaceId,
    ticketCountsByWorkspace,
    ticketDetailsById,
    onCreateTicket,
    collapsedDrafts: draftDisclosure.collapsed,
    onToggleDrafts: draftDisclosure.toggle,
    onOpenDraftMenu: draftMenu.openMenu,
  };
  const renderWorkspace = (workspace: Pick<WorkbenchProject, "id" | "title" | "archivedAt">) => (
    <WorkbenchSidebarWorkspaceRow
      key={workspace.id}
      workspace={workspace}
      drafts={visibleDrafts.get(workspace.id) ?? []}
      ticketSections={prioritizedGroups.get(workspace.id)}
      archivedTickets={onlyActionable ? [] : (archivedTicketsByWorkspace.get(workspace.id) ?? [])}
      expansion={expansion}
      attentionExpanded={
        onlyActionable ? !collapsedAttentionWorkspaces.has(workspace.id) : undefined
      }
      onToggle={toggleExpansion}
      navigation={navigation}
    />
  );
  const searchResults = getWorkbenchSidebarSearchResults({
    query: searchQuery,
    projects: onlyActionable ? actionableProjects : projects,
    ticketGroupsByWorkspace: prioritizedGroups,
    archivedTicketsByWorkspace: onlyActionable ? new Map() : archivedTicketsByWorkspace,
    referencesByTicket,
    draftsByWorkspace: visibleDrafts,
  });
  const selectSearchResult = (result: WorkbenchSidebarSearchResult) => {
    search.onSearchQueryChange("");
    revealAttentionWorkspace(result.workspaceId);
    if (result.kind === "draft") draftDisclosure.reveal(result.workspaceId);
    setExpansion((state) =>
      revealWorkbenchSidebarSelection(
        state,
        getWorkbenchSidebarSearchSelection(result, ticketGroupsByWorkspace),
      ),
    );
    switch (result.kind) {
      case "thread":
        onOpenThread(result.thread);
        break;
      case "workspace":
        onSelectWorkspace(result.workspaceId);
        break;
      default:
        onSelectTicket(result.workspaceId, result.ticketId);
    }
  };
  const { activeResultIndex, onSearchKeyDown, setActiveResultIndex, changeSearchQuery } =
    useWorkbenchSidebarSearchKeyboard({
      searchQuery,
      searchResults,
      onSearchQueryChange: search.onSearchQueryChange,
      onSelect: selectSearchResult,
    });
  const selectionOutsideAttention =
    onlyActionable &&
    !isWorkbenchSidebarSelectionVisible({
      selection: routeSelection,
      projects: actionableProjects,
      groups: prioritizedGroups,
    });
  return (
    <SidebarContent
      ref={contentRef}
      fixedHeader={
        <WorkbenchSidebarFixedHeader
          header={header}
          filters={{
            search: {
              ...search,
              onOnlyActionableChange: changeAttentionFilter,
              onSearchQueryChange: changeSearchQuery,
            },
            resultCount: searchResults.length,
            actionableTicketCount,
            onSearchKeyDown,
            activeResultIndex,
          }}
          location={{
            visible: selectionOutsideAttention,
            selection: routeSelection,
            onClear: () => changeAttentionFilter(false),
          }}
        />
      }
    >
      <SidebarGroup>
        <WorkbenchSidebarWorkspaceState
          environmentId={environmentId}
          query={query}
          snapshot={snapshot}
          navigation={
            <div
              ref={navigationRef}
              onFocusCapture={onRowFocusCapture}
              tabIndex={-1}
              aria-label="Workbench navigation"
              className="space-y-4"
            >
              {isSearching ? (
                <WorkbenchSidebarSearchResults
                  results={searchResults}
                  activeIndex={activeResultIndex}
                  onActiveIndexChange={setActiveResultIndex}
                  onSelect={selectSearchResult}
                />
              ) : (
                <>
                  <WorkbenchInlineError message={draftMenu.error} />
                  <WorkbenchSidebarNothingNeedsYou
                    visible={onlyActionable && visibleProjects.length === 0}
                    inspectionIncomplete={inspectionIncomplete}
                    onShowAll={() => changeAttentionFilter(false)}
                  />
                  <SidebarMenu aria-label="Workbench Workspaces">
                    {visibleProjects.map(renderWorkspace)}
                  </SidebarMenu>
                  <WorkbenchSidebarArchivedWorkspaces
                    filtered={archivedFiltered}
                    draftsByWorkspace={visibleDrafts}
                    expansion={expansion}
                    onToggle={toggleExpansion}
                    navigation={navigation}
                  />
                </>
              )}
              <WorkbenchDiscardDraftDialog
                title={draftMenu.confirmationTitle}
                open={draftMenu.actions.confirmation?.open === true}
                busy={draftMenu.actions.busy}
                error={null}
                finalFocus={draftMenu.finalFocus}
                onOpenChange={(open) => {
                  if (!open) draftMenu.actions.closeConfirmation();
                }}
                onDiscard={draftMenu.actions.discard}
              />
            </div>
          }
        />
      </SidebarGroup>
    </SidebarContent>
  );
}

function WorkbenchSidebarArchivedWorkspaces({
  filtered,
  draftsByWorkspace,
  ...rowProps
}: Pick<WorkbenchSidebarWorkspaceRowProps, "expansion" | "onToggle" | "navigation"> & {
  filtered: Pick<
    WorkbenchSidebarNavigationFields,
    "projects" | "ticketGroupsByWorkspace" | "archivedTicketsByWorkspace"
  >;
  draftsByWorkspace: ReadonlyMap<WorkbenchProjectId, ReadonlyArray<SidebarDraft>>;
}) {
  if (filtered.projects.length === 0) return null;
  const selected = filtered.projects.some(
    (workspace) => workspace.id === rowProps.navigation.selectedWorkspaceId,
  );
  return (
    <details open={selected || undefined}>
      <summary className="cursor-pointer px-2 py-2 text-xs font-medium text-sidebar-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        Archived Workspaces
      </summary>
      <SidebarMenu aria-label="Archived Workspaces">
        {filtered.projects.map((workspace) => (
          <WorkbenchSidebarWorkspaceRow
            key={workspace.id}
            {...rowProps}
            workspace={workspace}
            drafts={draftsByWorkspace.get(workspace.id) ?? []}
            ticketSections={filtered.ticketGroupsByWorkspace.get(workspace.id)}
            archivedTickets={filtered.archivedTicketsByWorkspace.get(workspace.id) ?? []}
          />
        ))}
      </SidebarMenu>
    </details>
  );
}

type WorkbenchSidebarWorkspaceRowProps = {
  readonly attentionExpanded?: boolean | undefined;
  readonly drafts: ReadonlyArray<SidebarDraft>;
  readonly workspace: Pick<WorkbenchProject, "id" | "title" | "archivedAt">;
  readonly ticketSections: WorkbenchSidebarTicketSections | undefined;
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly onToggle: (action: WorkbenchSidebarExpansionAction) => void;
  readonly navigation: Pick<
    WorkbenchSidebarNavigationFields,
    | "onSelectTicket"
    | "onSelectWorkspace"
    | "onCreateTicket"
    | "selectedEpicId"
    | "selectedTicketId"
    | "selectedWorkspaceId"
    | "ticketCountsByWorkspace"
    | "ticketDetailsById"
  > & {
    readonly collapsedDrafts: ReadonlySet<WorkbenchProjectId>;
    readonly onToggleDrafts: (workspaceId: WorkbenchProjectId) => void;
    readonly onOpenDraftMenu: ReturnType<typeof useWorkbenchSidebarDraftMenu>["openMenu"];
  };
};

function WorkbenchSidebarWorkspaceRow({
  workspace,
  drafts,
  ticketSections,
  archivedTickets,
  expansion,
  attentionExpanded,
  onToggle,
  navigation,
}: WorkbenchSidebarWorkspaceRowProps) {
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const { onSelectTicket, selectedEpicId, selectedTicketId, ticketDetailsById } = navigation;
  const activeTicketGroups = ticketSections?.active ?? [];
  const doneTicketGroups = ticketSections?.done ?? [];
  const showArchivedTickets = workspace.id === navigation.selectedWorkspaceId;
  const visibleArchivedTickets = showArchivedTickets ? archivedTickets : [];
  const hasContents = [drafts, activeTicketGroups, doneTicketGroups, visibleArchivedTickets].some(
    (items) => items.length > 0,
  );
  const workspaceExpanded = attentionExpanded ?? expansion.workspaceId === workspace.id;
  const workspacePanelId = `workbench-sidebar-workspace-${workspace.id}`;

  return (
    <SidebarMenuItem>
      <WorkbenchSidebarWorkspaceHeader
        workspace={workspace}
        hasContents={hasContents}
        workspaceButtonRef={workspaceButtonRef}
        workspaceExpanded={workspaceExpanded}
        workspacePanelId={workspacePanelId}
        onToggle={onToggle}
        navigation={navigation}
      />
      <WorkbenchSidebarWorkspacePanel
        expanded={workspaceExpanded}
        panelId={workspacePanelId}
        title={workspace.title}
      >
        <div className="ms-4">
          <WorkbenchSidebarDrafts
            drafts={drafts}
            workspaceTitle={workspace.title}
            workspaceButtonRef={workspaceButtonRef}
            selectedTicketId={selectedTicketId}
            expanded={!navigation.collapsedDrafts.has(workspace.id)}
            onToggle={() => navigation.onToggleDrafts(workspace.id)}
            onSelect={(draft) => onSelectTicket(workspace.id, draft.id)}
            onOpenMenu={navigation.onOpenDraftMenu}
          />
          <WorkbenchSidebarWorkspaceContents
            activeTicketGroups={activeTicketGroups}
            archivedTickets={visibleArchivedTickets}
            doneTicketGroups={doneTicketGroups}
            expansion={expansion}
            onSelectTicket={onSelectTicket}
            onToggle={onToggle}
            selectedEpicId={selectedEpicId}
            selectedTicketId={selectedTicketId}
            ticketDetailsById={ticketDetailsById}
            workspaceId={workspace.id}
          />
        </div>
      </WorkbenchSidebarWorkspacePanel>
    </SidebarMenuItem>
  );
}

function WorkbenchSidebarWorkspaceHeader({
  workspace,
  hasContents,
  workspaceButtonRef,
  workspaceExpanded,
  workspacePanelId,
  onToggle,
  navigation,
}: Pick<WorkbenchSidebarWorkspaceRowProps, "workspace" | "onToggle" | "navigation"> & {
  hasContents: boolean;
  workspaceButtonRef: RefObject<HTMLButtonElement | null>;
  workspaceExpanded: boolean;
  workspacePanelId: string;
}) {
  const { selectedWorkspaceId, selectedTicketId, selectedEpicId, onSelectWorkspace } = navigation;
  const ticketCount = navigation.ticketCountsByWorkspace.get(workspace.id) ?? 0;
  const boardLabel = `Open ${workspace.title} board (${ticketCount} Tickets)`;
  const disclosureLabel = `${workspaceExpanded ? "Collapse" : "Expand"} ${workspace.title}`;
  const workspaceIsDestination =
    workspace.id === selectedWorkspaceId &&
    selectedTicketId === undefined &&
    selectedEpicId === undefined;

  return (
    <div
      data-workbench-sidebar-disclosure-row=""
      data-workbench-sidebar-surface=""
      data-active={workspaceIsDestination || undefined}
      className="relative flex min-w-0 items-start rounded-md"
    >
      <WorkbenchSidebarDisclosure
        available={hasContents}
        controls={workspacePanelId}
        expanded={workspaceExpanded}
        label={disclosureLabel}
        onToggle={() => onToggle({ type: "toggleWorkspace", workspaceId: workspace.id })}
      />
      <WorkbenchSidebarRowNavigation
        ref={workspaceButtonRef}
        label={boardLabel}
        isActive={workspaceIsDestination}
        compact
        onSelect={() => {
          if (hasContents && (workspaceIsDestination || !workspaceExpanded)) {
            onToggle({ type: "toggleWorkspace", workspaceId: workspace.id });
          }
          onSelectWorkspace(workspace.id);
        }}
        preview={<span className="p-2">{boardLabel}</span>}
      >
        <LayoutDashboardIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{workspace.title}</span>
        <span aria-hidden className="ms-auto text-xs tabular-nums text-sidebar-muted-foreground">
          {ticketCount}
        </span>
      </WorkbenchSidebarRowNavigation>
      {workspace.archivedAt == null ? (
        <span className="flex h-8 shrink-0 items-center justify-center pe-1 pointer-coarse:size-11 max-md:size-11">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`New Ticket in ${workspace.title}`}
            onClick={() => navigation.onCreateTicket(workspace.id)}
          >
            <PlusIcon />
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function WorkbenchSidebarWorkspacePanel({
  expanded,
  panelId,
  title,
  children,
}: {
  readonly expanded: boolean;
  readonly panelId: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
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
  "onSelectTicket" | "selectedEpicId" | "selectedTicketId" | "ticketDetailsById"
> & {
  readonly activeTicketGroups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly doneTicketGroups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly expansion: WorkbenchSidebarExpansion;
  readonly onToggle: (action: WorkbenchSidebarExpansionAction) => void;
  readonly workspaceId: WorkbenchProjectId;
};

function WorkbenchSidebarWorkspaceContents({
  activeTicketGroups,
  archivedTickets,
  doneTicketGroups,
  expansion,
  onSelectTicket,
  onToggle,
  selectedEpicId,
  selectedTicketId,
  ticketDetailsById,
  workspaceId,
}: WorkbenchSidebarWorkspaceContentsProps) {
  return (
    <>
      {activeTicketGroups.length > 0 ? (
        <WorkbenchSidebarTicketGroups
          ticketDetailsById={ticketDetailsById}
          groups={activeTicketGroups}
          onSelectTicket={onSelectTicket}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
        />
      ) : null}
      {doneTicketGroups.length > 0 ? (
        <WorkbenchSidebarDoneTickets
          ticketDetailsById={ticketDetailsById}
          groups={doneTicketGroups}
          expanded={expansion.done}
          onSelectTicket={onSelectTicket}
          onToggle={() => onToggle({ type: "toggleDone", workspaceId })}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          panelId={`workbench-sidebar-done-${workspaceId}`}
        />
      ) : null}
      {archivedTickets.length > 0 ? (
        <WorkbenchSidebarArchivedTickets
          ticketDetailsById={ticketDetailsById}
          archivedTickets={archivedTickets}
          expanded={expansion.archived}
          onSelectTicket={onSelectTicket}
          onToggle={() => onToggle({ type: "toggleArchived", workspaceId })}
          selectedEpicId={selectedEpicId}
          selectedTicketId={selectedTicketId}
          panelId={`workbench-sidebar-archived-${workspaceId}`}
        />
      ) : null}
    </>
  );
}

type WorkbenchSidebarTicketRowProps = {
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
};

type WorkbenchSidebarTicketGroupsProps = WorkbenchSidebarTicketRowProps & {
  readonly groups: ReadonlyArray<WorkbenchSidebarTicketGroup>;
};

function WorkbenchSidebarTicketRow({
  ticket,
  ticketDetailsById,
  onSelectTicket,
  selectedEpicId,
  selectedTicketId,
}: WorkbenchSidebarTicketRowProps & { readonly ticket: WorkbenchSidebarTicket }) {
  const isActive = isWorkbenchSidebarTicketDestination({
    ticketId: ticket.id,
    selectedTicketId,
    selectedEpicId,
  });
  return (
    <SidebarMenuItem>
      {/* The empty disclosure column keeps Tickets aligned under their Workspace. */}
      <div
        data-workbench-sidebar-disclosure-row=""
        data-workbench-sidebar-surface=""
        data-workbench-sidebar-ticket-row-id={ticket.id}
        data-active={isActive || undefined}
        className="relative flex min-w-0 items-start rounded-md"
      >
        <span aria-hidden data-workbench-sidebar-disclosure="ticket" />
        <WorkbenchSidebarTicketButton
          ticket={ticket}
          details={ticketDetailsById.get(ticket.id)}
          isActive={isActive}
          onSelect={() => onSelectTicket(ticket.projectId, ticket.id)}
        />
      </div>
    </SidebarMenuItem>
  );
}

function WorkbenchSidebarTicketGroups({ groups, ...rowProps }: WorkbenchSidebarTicketGroupsProps) {
  return (
    <SidebarMenu>
      {groups.map(({ ticket }) => (
        <WorkbenchSidebarTicketRow key={ticket.id} ticket={ticket} {...rowProps} />
      ))}
    </SidebarMenu>
  );
}

function WorkbenchSidebarDoneTickets({
  expanded,
  groups,
  onToggle,
  panelId,
  ...rowProps
}: WorkbenchSidebarTicketGroupsProps & {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly panelId: string;
}) {
  return (
    <section aria-label="Done Tickets" className="mt-1">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        data-workbench-sidebar-group-toggle=""
        onClick={onToggle}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-3 shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span>Done</span>
        <span className="tabular-nums">{groups.length}</span>
      </button>
      <div aria-label="Done Ticket list" hidden={!expanded} id={panelId}>
        {expanded ? <WorkbenchSidebarTicketGroups groups={groups} {...rowProps} /> : null}
      </div>
    </section>
  );
}

function WorkbenchSidebarDisclosure({
  controls,
  expanded,
  label,
  available,
  onToggle,
}: {
  readonly controls: string;
  readonly expanded: boolean;
  readonly label: string;
  readonly available: boolean;
  readonly onToggle: () => void;
}) {
  if (!available) return <span aria-hidden data-workbench-sidebar-disclosure="workspace" />;
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      data-workbench-sidebar-disclosure="workspace"
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

function WorkbenchSidebarArchivedTickets({
  ticketDetailsById,
  archivedTickets,
  expanded,
  onSelectTicket,
  onToggle,
  panelId,
  selectedEpicId,
  selectedTicketId,
}: {
  readonly archivedTickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly ticketDetailsById: ReadonlyMap<WorkbenchTicketId, WorkbenchSidebarTicketDetails>;
  readonly expanded: boolean;
  readonly onSelectTicket: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onToggle: () => void;
  readonly panelId: string;
  readonly selectedEpicId: WorkbenchEpicId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
}) {
  return (
    <section aria-label="Archived Tickets" className="mt-1">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        data-workbench-sidebar-group-toggle=""
        onClick={onToggle}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-3 shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span>Archived</span>
        <span className="tabular-nums">{archivedTickets.length}</span>
      </button>
      <div aria-label="Archived Ticket list" hidden={!expanded} id={panelId}>
        {expanded ? (
          <SidebarMenu>
            {archivedTickets.map((ticket) => (
              <WorkbenchSidebarTicketRow
                key={ticket.id}
                ticket={ticket}
                ticketDetailsById={ticketDetailsById}
                onSelectTicket={onSelectTicket}
                selectedEpicId={selectedEpicId}
                selectedTicketId={selectedTicketId}
              />
            ))}
          </SidebarMenu>
        ) : null}
      </div>
    </section>
  );
}

function WorkbenchSidebarWorkspaceState({
  environmentId,
  query,
  snapshot,
  navigation,
}: {
  environmentId: EnvironmentId | null;
  query: { isPending: boolean; error: string | null; refresh: () => void };
  snapshot: { projects: ReadonlyArray<unknown> } | null;
  navigation: ReactNode;
}) {
  return environmentId === null ? (
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
    navigation
  );
}

function getWorkbenchSidebarThreads({
  currentThread,
  threadShells,
}: {
  currentThread: ReturnType<typeof useThreadShell>;
  threadShells: ReturnType<typeof useThreadShells>;
}) {
  return currentThread &&
    !threadShells.some(
      (thread) =>
        thread.environmentId === currentThread.environmentId && thread.id === currentThread.id,
    )
    ? [...threadShells, currentThread]
    : threadShells;
}

function getWorkbenchSidebarDrafts({
  snapshot,
  threadShells,
  environmentId,
}: {
  snapshot: WorkbenchSnapshot | null;
  threadShells: ReturnType<typeof useThreadShells>;
  environmentId: EnvironmentId | null;
}) {
  const threadTitles = new Map(
    threadShells
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => [thread.id, thread.title]),
  );
  return new Map(
    (snapshot?.projects ?? []).map((workspace) => [
      workspace.id,
      getUnsavedConversationDrafts(snapshot, workspace.id).map((draft) => ({
        ...draft,
        title: getConversationDraftTitle(draft, threadTitles.get(draft.threadId)),
      })),
    ]),
  );
}

function getWorkbenchSidebarArchivedTickets(
  tickets: ReadonlyArray<WorkbenchSidebarTicket>,
  selectedTicketId: WorkbenchTicketId | undefined,
) {
  const archived = new Map<WorkbenchProjectId, WorkbenchSidebarTicket[]>();
  for (const ticket of tickets) {
    if (ticket.archivedAt == null || ticket.id === selectedTicketId) continue;
    const group = archived.get(ticket.projectId) ?? [];
    group.push(ticket);
    archived.set(ticket.projectId, group);
  }
  return archived;
}

function getWorkbenchSidebarTicketCounts(tickets: ReadonlyArray<WorkbenchSidebarTicket>) {
  const counts = new Map<WorkbenchProjectId, number>();
  for (const ticket of tickets) {
    if (ticket.archivedAt != null) continue;
    counts.set(ticket.projectId, (counts.get(ticket.projectId) ?? 0) + 1);
  }
  return counts;
}

function getWorkbenchSidebarRecordGroups({
  snapshot,
  threadShells,
  environmentId,
  selectedTicketId,
}: {
  snapshot: WorkbenchSnapshot | null;
  threadShells: ReturnType<typeof useThreadShells>;
  environmentId: EnvironmentId | null;
  selectedTicketId: WorkbenchTicketId | undefined;
}) {
  const draftsByWorkspace = getWorkbenchSidebarDrafts({ snapshot, threadShells, environmentId });
  const ticketCountsByWorkspace = getWorkbenchSidebarTicketCounts(snapshot?.tickets ?? []);
  const archivedTicketsByWorkspace = getWorkbenchSidebarArchivedTickets(
    snapshot?.tickets ?? [],
    selectedTicketId,
  );
  return { draftsByWorkspace, ticketCountsByWorkspace, archivedTicketsByWorkspace };
}

function useWorkbenchSidebarData({
  context,
  environmentId,
  selectedTicketId,
}: {
  context: Parameters<typeof WorkbenchSidebar>[0]["context"];
  environmentId: EnvironmentId | null;
  selectedTicketId: WorkbenchTicketId | undefined;
}) {
  const threadShells = useThreadShells();
  const currentThread = useWorkbenchSidebarCurrentThread({ context, threadShells });
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  // On a Workbench Thread's own page, show the edits it makes to its Ticket while it works.
  useRefreshOnThreadActivity(
    context ? scopeThreadRef(context.environmentId, context.threadId) : null,
    query.refresh,
  );
  const snapshot = query.data;
  const tickets = snapshot?.tickets ?? [];
  const assignments = snapshot?.assignments ?? [];
  const threads = getWorkbenchSidebarThreads({ currentThread, threadShells });
  const nativeProjects = useProjects();
  const referencesByTicket = groupWorkbenchReferences(snapshot?.references ?? []);
  const ticketDetailsById = (() =>
    snapshot
      ? getWorkbenchSidebarTicketDetails({
          environmentId,
          tickets,
          assignments,
          threads,
          projects: nativeProjects,
          workbenchProjects: snapshot.projects,
          epics: snapshot.epics,
          referencesByTicket,
        })
      : new Map<WorkbenchTicketId, WorkbenchSidebarTicketDetails>())();
  const { draftsByWorkspace, ticketCountsByWorkspace, archivedTicketsByWorkspace } =
    getWorkbenchSidebarRecordGroups({ snapshot, threadShells, environmentId, selectedTicketId });
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId);
  const selectedTicketStatus = selectedTicket?.status;
  const selectedTicketIsDone =
    selectedTicketStatus === "done" && selectedTicket?.archivedAt == null;
  const { attentionSignalsByTicket } = useWorkbenchAttentionData();
  const { sidebarQuery, onlyActionable, setSidebarSearch, setOnlyActionable } =
    useWorkbenchSidebarFilters(environmentId);
  const actionableThreadIdsByTicket = getWorkbenchSidebarActionableThreadIds({
    environmentId,
    assignments,
    threads,
    attentionSignalsByTicket,
  });
  const ticketGroupsByWorkspace = getWorkbenchSidebarTicketGroups({
    environmentId,
    tickets,
    assignments,
    threads,
    selectedTicketId,
    selectedThreadId: context?.threadId,
    includeUnassignedTickets: sidebarQuery.trim().length > 0 || onlyActionable,
  });

  return {
    query,
    snapshot,
    draftsByWorkspace,
    ticketDetailsById,
    referencesByTicket,
    selectedTicketIsDone,
    sidebarQuery,
    setSidebarSearch,
    onlyActionable,
    setOnlyActionable,
    actionableThreadIdsByTicket,
    ticketGroupsByWorkspace,
    ticketCountsByWorkspace,
    archivedTicketsByWorkspace,
  };
}

/** A Thread page marks its Ticket, since the sidebar lists only Tickets. */
function isWorkbenchSidebarTicketDestination({
  ticketId,
  selectedTicketId,
  selectedEpicId,
}: {
  ticketId: WorkbenchTicketId;
  selectedTicketId: WorkbenchTicketId | undefined;
  selectedEpicId: WorkbenchEpicId | undefined;
}) {
  return ticketId === selectedTicketId && selectedEpicId === undefined;
}

function useWorkbenchSidebarCurrentThread({
  context,
  threadShells,
}: {
  context: Parameters<typeof WorkbenchSidebar>[0]["context"];
  threadShells: ReturnType<typeof useThreadShells>;
}) {
  const currentThread = useThreadShell(
    context &&
      !threadShells.some(
        (thread) =>
          thread.environmentId === context.environmentId && thread.id === context.threadId,
      )
      ? scopeThreadRef(context.environmentId, context.threadId)
      : null,
  );
  return currentThread;
}
