import { matchesWorkbenchAttention, type WorkbenchAttentionMode } from "./workbenchAttention.logic";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import { WorkbenchProgressCount } from "./WorkbenchProgressCount";
import { WorkbenchTicketAttentionBadge } from "./WorkbenchTicketAttention";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { workbenchTicketIssueReferences } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  BotIcon,
  ChevronDownIcon,
  FolderGit2Icon,
  LayoutDashboardIcon,
  Layers3Icon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { observeResize } from "../lib/observeResize";
import {
  WorkbenchDraggableTicket,
  WorkbenchDropColumn,
  type WorkbenchDraggableTicketRenderProps,
} from "./WorkbenchBoardDrag";
import { canMoveWorkbenchBoardTicket } from "./workbenchBoardDrag.logic";

import { WorkbenchThreadExecutionStatus } from "./WorkbenchThreadExecutionStatus";
import {
  getWorkbenchTicketExecutionStatuses,
  type WorkbenchThreadExecutionStatus as WorkbenchThreadExecutionStatusData,
} from "./workbenchThreadStatus.logic";

import { Badge } from "../components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { matchesWorkbenchTicketSearch, useWorkbenchTicketSearch } from "./useWorkbenchTicketSearch";
import { useWorkbenchBoardView } from "./workbenchBoardViewState";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../components/ui/select";
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
import { MenuItem, MenuSeparator } from "../components/ui/menu";
import { WorkbenchTicketStatusMenu } from "./WorkbenchTicketStatusMenu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { Project } from "../types";
import {
  getWorkbenchTicketStartProgressLabel,
  isWorkbenchTicketStartPending,
} from "./startWorkbenchTicket";
import {
  getWorkbenchBoardColumns,
  getWorkbenchThreadPresentation,
  getVisibleWorkbenchAssignments,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketSummaryActionLabel,
  groupWorkbenchTicketsByEpic,
  isWorkbenchThreadArchived,
} from "./workbench.logic";
import { getWorkbenchBoardTicketPreview } from "./workbenchBoardTicketPreview";
import {
  WorkbenchEpicBadge,
  WorkbenchTicketTypeBadge,
  WorkbenchTicketCopyMenuItems,
} from "./WorkbenchTicketMetadata";
import { WorkbenchDraftTickets } from "./WorkbenchDraftTickets";
import { WorkbenchReferenceBadge } from "./WorkbenchReferences";
import {
  getTicketReferences,
  getWorkbenchReferenceSearchTerms,
  hasJiraReference,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import {
  getConversationDraftTitle,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

const BOARD_CARD_ISSUE_LIMIT = 2;

const STATUS_DOT_CLASS: Record<WorkbenchTicketStatus, string> = {
  todo: "bg-muted-foreground/55",
  in_progress: "bg-info",
  done: "bg-success",
};

type WorkbenchTicketBoardProps = {
  readonly readOnly?: boolean;
  readonly threadRestoreDisabled?: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectId: WorkbenchProjectId;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly drafts?: ReadonlyArray<WorkbenchConversationDraft>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly groupMode: "none" | "epic";
  readonly viewControls: ReactNode;
  /** Floats over the board's lower-right corner; the board leaves room to scroll past it. */
  readonly floatingChat?: ReactNode;
  readonly selectedTicketId: WorkbenchTicketId | null;
  readonly repositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly repositoriesReady: boolean;
  readonly repositoriesById: ReadonlyMap<ProjectId, Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly pendingAction: string | null;
  readonly pendingTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
  readonly onSelectEpic: (projectId: WorkbenchProjectId, epicId: WorkbenchEpic["id"]) => void;
  readonly onMove: (ticket: WorkbenchTicket, status: WorkbenchTicketStatus) => void;
  readonly onRegenerateSummary: (ticket: WorkbenchTicket) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  readonly onCreateTicket: () => void;
};

export function WorkbenchTicketBoard(props: WorkbenchTicketBoardProps) {
  const boardRef = useRef<HTMLElement>(null);
  const [wideBoard, setWideBoard] = useState(false);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const root = document.documentElement;
    const measure = () =>
      setWideBoard(board.clientWidth >= 48 * Number.parseFloat(getComputedStyle(root).fontSize));
    measure();
    const stopResize = observeResize(board, measure);
    // Interface font preferences change rem breakpoints without necessarily resizing the Board.
    const rootStyleObserver = new MutationObserver(measure);
    rootStyleObserver.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      stopResize();
      rootStyleObserver.disconnect();
    };
  }, []);
  const data = useWorkbenchBoardData(props);
  const drag = useWorkbenchBoardDrag({
    ...props,
    wideBoard,
    columns: data.columns,
    swimlanes: data.swimlanes,
  });
  const board = { ...props, ...data, ...drag };
  return (
    <WorkbenchTicketBoardContent
      props={props}
      data={data}
      drag={drag}
      board={board}
      boardRef={boardRef}
    />
  );
}

function WorkbenchTicketBoardContent({
  props,
  data,
  drag,
  board,
  boardRef,
}: {
  boardRef: RefObject<HTMLElement | null>;
  props: WorkbenchTicketBoardProps;
  data: ReturnType<typeof useWorkbenchBoardData>;
  drag: ReturnType<typeof useWorkbenchBoardDrag>;
  board: WorkbenchBoardContext;
}) {
  const { environmentId, tickets, groupMode, epics, onCreateTicket } = props;
  const { search, visibleTickets, columns, swimlanes } = data;
  const {
    sensors,
    dropTargets,
    dragDisabled,
    setActiveTicketId,
    handleDragEnd,
    activeTicket,
    visibleColumnId,
    setSelectedColumnId,
  } = drag;
  const boardStyle: CSSProperties & { "--board-column-count": number } = {
    "--board-column-count": columns.length,
  };

  return (
    <DndContext
      sensors={sensors}
      accessibility={getWorkbenchBoardAccessibility({ tickets, dropTargets })}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => {
        const ticket = tickets.find((candidate) => candidate.id === active.id);
        if (ticket && !dragDisabled) setActiveTicketId(ticket.id);
      }}
      onDragCancel={() => setActiveTicketId(null)}
      onDragEnd={handleDragEnd}
    >
      <section
        ref={boardRef}
        tabIndex={-1}
        aria-label="Ticket board"
        className="@container/board relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {renderWorkbenchBoardControls({
          search,
          viewControls: props.viewControls,
          attentionMode: data.attentionMode,
          setAttentionMode: data.setAttentionMode,
          attentionCoverage: data.attentionCoverage,
          incompleteInspection: data.incompleteInspection,
          refreshAttention: data.refreshAttention,
          repositoryId: data.repositoryId,
          setRepositoryId: data.setRepositoryId,
          repositoryProjectIds: props.repositoryProjectIds,
          repositoriesById: props.repositoriesById,
          visibleTickets,
          tickets,
          columns,
          visibleColumnId,
          setSelectedColumnId,
        })}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "h-full overflow-auto p-3 sm:p-4 @min-[48rem]/board:pt-0",
              props.floatingChat != null && "pb-32 sm:pb-32",
            )}
          >
            <WorkbenchDraftTickets
              key={`${environmentId}:${props.projectId}`}
              environmentId={environmentId}
              readOnly={props.readOnly === true}
              boardRef={boardRef}
              drafts={(props.drafts ?? []).filter(
                (draft) =>
                  data.attentionMode === "all" &&
                  (data.repositoryId === null ||
                    draft.fields.repositoryProjectIds.includes(data.repositoryId)) &&
                  matchesWorkbenchTicketSearch({
                    title: getConversationDraftTitle(
                      draft,
                      props.threadsById.get(draft.threadId)?.title,
                    ),
                    referenceTerms: getWorkbenchReferenceSearchTerms(
                      getTicketReferences(props.referencesByTicket, draft.id),
                    ),
                    query: search.query,
                  }),
              )}
              threadsById={props.threadsById}
              onSelect={props.onSelect}
            />
            <div
              style={boardStyle}
              className="flex min-w-0 flex-col gap-3 @min-[48rem]/board:min-w-[calc(var(--board-column-count)*17rem+(var(--board-column-count)-1)*0.75rem)]"
            >
              <div className="sticky top-0 z-10 -mx-3 hidden grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-3 border-b border-border/60 bg-background px-3 py-1 shadow-sm sm:-mx-4 sm:px-4 @min-[48rem]/board:grid">
                {columns.map((column) => (
                  <div key={column.id} className="flex min-w-0 items-center gap-2 px-2 py-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        STATUS_DOT_CLASS[column.status],
                      )}
                    />
                    <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">
                      {column.title}
                    </h2>
                    <span className="text-xs text-foreground tabular-nums">
                      {column.tickets.length}
                    </span>
                  </div>
                ))}
              </div>
              {swimlanes.map((swimlane) => renderWorkbenchBoardSwimlane({ swimlane, board }))}
            </div>
          </div>

          {tickets.length === 0 &&
          (props.drafts?.length ?? 0) === 0 &&
          !search.query &&
          data.repositoryId === null &&
          !(groupMode === "epic" && epics.length > 0) ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center overflow-auto scrollbar-gutter-both bg-background/45 p-6 backdrop-blur-xs">
              <div className="my-auto w-full max-w-sm shrink-0 rounded-xl border border-border bg-background shadow-lg/10">
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
                    <Button disabled={props.readOnly} onClick={onCreateTicket}>
                      <PlusIcon /> Create Ticket
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            </div>
          ) : null}
          {props.floatingChat}
        </div>
      </section>
      <DragOverlay dropAnimation={null}>
        {activeTicket ? (
          <div className="max-w-sm cursor-grabbing rounded-lg border border-primary/50 bg-background p-3 shadow-lg">
            <p className="line-clamp-3 text-sm font-semibold">{activeTicket.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

type WorkbenchBoardContext = Pick<
  WorkbenchTicketBoardProps,
  | "readOnly"
  | "threadRestoreDisabled"
  | "environmentId"
  | "projectId"
  | "groupMode"
  | "selectedTicketId"
  | "repositoriesById"
  | "assignmentsByTicket"
  | "referencesByTicket"
  | "threadsById"
  | "archivedThreadsById"
  | "threadLookupReady"
  | "pending"
  | "pendingAction"
  | "pendingTicketIds"
  | "onSelect"
  | "onSelectEpic"
  | "onMove"
  | "onRegenerateSummary"
  | "onOpenThread"
> & {
  columns: ReturnType<typeof getWorkbenchBoardColumns<WorkbenchTicket>>;
  visibleColumnId: string | null | undefined;
  dragDisabled: boolean;
  activeTicket: WorkbenchTicket | undefined;
  canDrop: (
    ticket: WorkbenchTicket,
    target: { columnId: string; status: WorkbenchTicketStatus; epicId: WorkbenchEpic["id"] | null },
  ) => boolean;
  agentStatesByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchThreadExecutionStatusData>;
  attentionMode: WorkbenchAttentionMode;
  attentionReasonsByTicket: ReadonlyMap<WorkbenchTicketId, ReadonlyArray<string>>;
  threadCounts: ReadonlyMap<WorkbenchTicketId, number>;
  epicsById: ReadonlyMap<WorkbenchEpic["id"], WorkbenchEpic>;
};

function renderWorkbenchBoardSwimlane({
  swimlane,
  board,
}: {
  swimlane: { epic: WorkbenchEpic | null; tickets: ReadonlyArray<WorkbenchTicket> };
  board: WorkbenchBoardContext;
}) {
  const {
    projectId,
    groupMode,
    onSelectEpic,
    columns,
    visibleColumnId,
    dragDisabled,
    activeTicket,
    canDrop,
  } = board;
  const laneTicketIds = new Set(swimlane.tickets.map((ticket) => ticket.id));
  const laneKey = groupMode === "epic" ? (swimlane.epic?.id ?? "no-epic") : "all-tickets";
  return (
    <Collapsible
      key={laneKey}
      defaultOpen
      render={
        <section
          aria-label={
            groupMode === "epic" ? `${swimlane.epic?.title ?? "No Epic"} swimlane` : "All Tickets"
          }
        />
      }
      className="min-w-0"
    >
      {groupMode === "epic" ? (
        <header className="mb-2 flex items-center gap-2 border-b border-border/40 py-1">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ChevronDownIcon className="size-3.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none" />
            <Layers3Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <h3 className="min-w-0 truncate text-sm font-semibold">
              {swimlane.epic?.title ?? "No Epic"}
            </h3>
            <span className="text-xs text-foreground tabular-nums">{swimlane.tickets.length}</span>
            {swimlane.epic?.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
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
      <CollapsiblePanel>
        <div className="grid min-w-0 grid-cols-1 gap-3 @min-[48rem]/board:auto-cols-[minmax(17rem,1fr)] @min-[48rem]/board:grid-flow-col @min-[48rem]/board:grid-cols-none">
          {columns.map((column) => {
            const laneTickets = column.tickets.filter((ticket) => laneTicketIds.has(ticket.id));
            return (
              <WorkbenchDropColumn
                key={column.id}
                id={JSON.stringify([swimlane.epic?.id ?? null, column.id])}
                label={`${column.title} Tickets`}
                statusId={column.id}
                disabled={
                  dragDisabled ||
                  (activeTicket !== undefined &&
                    !canDrop(activeTicket, {
                      columnId: column.id,
                      status: column.status,
                      epicId: swimlane.epic?.id ?? null,
                    }))
                }
                className={cn(
                  "min-w-0 flex-col rounded-xl @min-[48rem]/board:flex",
                  column.id === visibleColumnId ? "flex" : "hidden",
                )}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-1.5">
                  {laneTickets.map((ticket) => renderWorkbenchBoardTicket({ ticket, board }))}
                  {laneTickets.length === 0 ? (
                    <p
                      className={cn(
                        "py-3 text-center text-xs text-muted-foreground",
                        groupMode === "epic" && "@min-[48rem]/board:sr-only",
                      )}
                    >
                      No tickets in {column.title}
                    </p>
                  ) : null}
                </div>
              </WorkbenchDropColumn>
            );
          })}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function renderWorkbenchBoardTicket({
  ticket,
  board,
}: {
  ticket: WorkbenchTicket;
  board: WorkbenchBoardContext;
}) {
  const {
    environmentId,
    projectId,
    selectedTicketId,
    pending,
    pendingTicketIds,
    onSelect,
    onOpenThread,
    dragDisabled,
  } = board;
  const presentation = getWorkbenchBoardTicketPresentation({ ticket, board });
  const ticketDisabled =
    board.readOnly === true || pendingTicketIds.has(ticket.id) || ticket.archivedAt != null;
  const ticketDragDisabled = dragDisabled || ticketDisabled;
  const attentionReasons = board.attentionReasonsByTicket.get(ticket.id) ?? [];
  return (
    <WorkbenchDraggableTicket key={ticket.id} id={ticket.id} disabled={ticketDragDisabled}>
      {({ attributes, listeners, setActivatorNodeRef }) => (
        <article
          onMouseDown={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("a, [data-workbench-no-drag]")
            )
              return;
            listeners?.onMouseDown?.(event);
          }}
          className={`relative isolate w-full min-w-0 cursor-pointer rounded-lg border bg-background p-3 transition-colors hover:bg-muted ${
            selectedTicketId === ticket.id
              ? "border-primary/50 ring-2 ring-primary/15"
              : "border-foreground/12"
          }`}
        >
          <div className="flex items-start gap-2">
            <WorkbenchBoardTicketTitle
              ticket={ticket}
              attributes={attributes}
              setActivatorNodeRef={setActivatorNodeRef}
              dragDisabled={ticketDragDisabled}
              onSelect={() => onSelect(projectId, ticket.id)}
            />
            <div
              data-workbench-no-drag=""
              className="relative z-10 flex min-w-0 shrink-0 items-center gap-1"
            >
              <WorkbenchTicketAttentionBadge
                environmentId={environmentId}
                ticketId={ticket.id}
                ticketTitle={ticket.title}
                onOpenThread={(threadId) => onOpenThread(ticket, threadId)}
              />
              <WorkbenchBoardTicketActions
                presentation={presentation}
                disabled={pending || ticketDisabled}
              />
            </div>
          </div>
          {renderWorkbenchBoardTicketMetadata(presentation)}
          {board.attentionMode !== "all" && attentionReasons.length > 0 ? (
            <p className="mt-2 text-xs text-foreground">{attentionReasons.join(" · ")}</p>
          ) : null}
          {renderWorkbenchBoardTicketThreadAction(presentation)}
        </article>
      )}
    </WorkbenchDraggableTicket>
  );
}

function WorkbenchBoardTicketTitle({
  ticket,
  attributes,
  setActivatorNodeRef,
  dragDisabled,
  onSelect,
}: Pick<WorkbenchDraggableTicketRenderProps, "attributes" | "setActivatorNodeRef"> & {
  ticket: WorkbenchTicket;
  dragDisabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      ref={setActivatorNodeRef}
      {...(!dragDisabled ? attributes : {})}
      className={cn(
        "min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:z-[1] after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
      )}
      type="button"
      onClick={onSelect}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <h3 className="line-clamp-3 min-w-0 break-words text-sm font-semibold leading-snug" />
          }
        >
          {ticket.title}
        </TooltipTrigger>
        <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
          {ticket.title}
        </TooltipPopup>
      </Tooltip>
    </button>
  );
}

function WorkbenchBoardTicketActions({
  presentation: { ticket, board, issues },
  disabled,
}: {
  presentation: ReturnType<typeof getWorkbenchBoardTicketPresentation>;
  disabled: boolean;
}) {
  return (
    <WorkbenchTicketStatusMenu
      ticket={ticket}
      disabled={disabled}
      onStatusChange={(status) => board.onMove(ticket, status)}
      trigger={
        <Button className="-mr-1 -mt-1 shrink-0" size="icon-xs" variant="ghost">
          <MoreHorizontalIcon />
        </Button>
      }
    >
      <MenuItem
        disabled={disabled || ticket.generatedSummary?.status === "pending"}
        onClick={() => board.onRegenerateSummary(ticket)}
      >
        {getWorkbenchTicketSummaryActionLabel(ticket.generatedSummary)}
      </MenuItem>
      <MenuSeparator />
      <WorkbenchTicketCopyMenuItems ticketId={ticket.id} issue={issues[0] ?? null} />
    </WorkbenchTicketStatusMenu>
  );
}

function useWorkbenchBoardData({
  environmentId,
  projectId,
  repositoryProjectIds,
  repositoriesReady,
  tickets,
  referencesByTicket,
  assignments,
  threadsById,
  archivedThreadsById,
  groupMode,
  epics,
}: Pick<
  WorkbenchTicketBoardProps,
  | "environmentId"
  | "projectId"
  | "repositoryProjectIds"
  | "repositoriesReady"
  | "tickets"
  | "referencesByTicket"
  | "assignments"
  | "threadsById"
  | "archivedThreadsById"
  | "groupMode"
  | "epics"
>) {
  const scope = { environmentId, projectId };
  const search = useWorkbenchTicketSearch(scope);
  const { view, setView } = useWorkbenchBoardView(scope);
  const repositoryId = view.repositoryId;
  const setRepositoryId = (repositoryId: ProjectId | null) => setView({ repositoryId });
  useEffect(() => {
    if (
      repositoriesReady &&
      repositoryId !== null &&
      !repositoryProjectIds.includes(repositoryId)
    ) {
      setView({ repositoryId: null });
    }
  }, [repositoriesReady, repositoryProjectIds, repositoryId, setView]);
  const attentionMode = view.attentionMode;
  const setAttentionMode = (attentionMode: WorkbenchAttentionMode) => setView({ attentionMode });
  const {
    refreshAttention,
    attentionReasonsByTicket,
    attentionSignalsByTicket,
    attentionInspectionsByTicket,
    attentionCoverage,
  } = useWorkbenchAttentionData();
  const incompleteInspection = [...attentionInspectionsByTicket.values()].some((rows) =>
    rows.some((row) => row.status !== "complete"),
  );
  const visibleTickets = tickets.filter(
    (ticket) =>
      matchesWorkbenchAttention(attentionMode, attentionSignalsByTicket.get(ticket.id) ?? []) &&
      (repositoryId === null ||
        getWorkbenchTicketRepositoryProjectIds(ticket).includes(repositoryId)) &&
      matchesWorkbenchTicketSearch({
        title: ticket.title,
        referenceTerms: getWorkbenchReferenceSearchTerms(
          getTicketReferences(referencesByTicket, ticket.id),
        ),
        query: search.query,
      }),
  );
  const agentStatesByTicket = getWorkbenchTicketExecutionStatuses({
    environmentId,
    assignments,
    threadsById,
  });
  const threadCounts = (() => {
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
  })();
  const columns = getWorkbenchBoardColumns(visibleTickets);
  const swimlanes =
    groupMode === "epic"
      ? groupWorkbenchTicketsByEpic(visibleTickets, epics).filter(
          (lane) => (!search.query && repositoryId === null) || lane.tickets.length > 0,
        )
      : [{ epic: null, tickets: visibleTickets }];
  const epicsById = new Map(epics.map((epic) => [epic.id, epic]));

  return {
    search,
    attentionMode,
    setAttentionMode,
    attentionReasonsByTicket,
    attentionCoverage,
    incompleteInspection,
    refreshAttention,
    repositoryId,
    setRepositoryId,
    visibleTickets,
    agentStatesByTicket,
    threadCounts,
    columns,
    swimlanes,
    epicsById,
  };
}

function getWorkbenchBoardTicketPresentation({
  ticket,
  board,
}: {
  ticket: WorkbenchTicket;
  board: WorkbenchBoardContext;
}) {
  const {
    threadsById,
    archivedThreadsById,
    assignmentsByTicket,
    pendingAction,
    threadLookupReady,
    repositoriesById,
    epicsById,
    agentStatesByTicket,
    referencesByTicket,
  } = board;
  const assignment = assignmentsByTicket.get(ticket.id);
  const nativeThread = assignment ? threadsById.get(assignment.threadId) : undefined;
  const archivedThread =
    assignment && isWorkbenchThreadArchived(assignment.threadId, threadsById, archivedThreadsById)
      ? archivedThreadsById.get(assignment.threadId)
      : undefined;
  const nativeStatus = agentStatesByTicket.get(ticket.id) ?? null;
  const thread = getWorkbenchThreadPresentation(
    assignment !== undefined,
    nativeThread !== undefined,
    nativeStatus?.presentation.label ?? null,
    archivedThread !== undefined,
    threadLookupReady,
  );
  const threadActionPending =
    isWorkbenchTicketStartPending(pendingAction, ticket.id) ||
    (assignment !== undefined && pendingAction === `restore:${assignment.threadId}`);
  const threadActionLabel =
    getWorkbenchTicketStartProgressLabel(pendingAction, ticket.id) ??
    (threadActionPending ? thread.pendingActionLabel : null);
  const repositories = getWorkbenchTicketRepositoryProjectIds(ticket).map((id) => ({
    id,
    title: repositoriesById.get(id)?.title ?? "Repository unavailable",
  }));
  const epic = ticket.epicId ? epicsById.get(ticket.epicId) : undefined;
  const references = getTicketReferences(referencesByTicket, ticket.id);
  const summary = getWorkbenchBoardTicketPreview({ ticket, jira: hasJiraReference(references) });
  const issues = workbenchTicketIssueReferences(references);

  return {
    ticket,
    board,
    assignment,
    nativeStatus,
    thread,
    threadActionPending,
    threadActionLabel,
    repositories,
    epic,
    summary,
    issues,
  };
}

function renderWorkbenchBoardTicketMetadata(
  presentation: ReturnType<typeof getWorkbenchBoardTicketPresentation>,
) {
  const { ticket, board, repositories, epic, summary, issues } = presentation;
  const { pendingTicketIds, groupMode, onSelect, projectId } = board;
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-2 text-xs text-foreground">
      {pendingTicketIds.has(ticket.id) ? <span role="status">Saving status…</span> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {issues.slice(0, BOARD_CARD_ISSUE_LIMIT).map((issue) => (
          <WorkbenchReferenceBadge key={issue.url} reference={issue} className="z-10" />
        ))}
        {issues.length > BOARD_CARD_ISSUE_LIMIT ? (
          <Badge variant="outline">+{issues.length - BOARD_CARD_ISSUE_LIMIT}</Badge>
        ) : null}
        <WorkbenchTicketTypeBadge kind={ticket.kind} />
        {groupMode === "none" && epic ? (
          <WorkbenchEpicBadge className="min-w-0 max-w-full" title={epic.title} />
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => onSelect(projectId, ticket.id)}
              aria-label={`Ticket ${summary.source === "description" ? "description" : "summary"}: ${summary.text}`}
              className="relative z-10 line-clamp-2 cursor-pointer break-words text-left text-xs text-foreground/80 outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
        <p className="text-2xs text-foreground" role="status">
          {summary.statusLabel}
        </p>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => onSelect(projectId, ticket.id)}
              aria-label={`Repositories for ${ticket.title}: ${repositories.map(({ id, title }) => `${title}${id === ticket.primaryT3ProjectId ? " (primary)" : ""}`).join(", ")}. Open ticket`}
              className="relative z-10 flex min-w-0 max-w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          {repositories.slice(0, 2).map(({ id, title }) => (
            <span key={id} className="flex min-w-0 max-w-full items-center gap-1.5">
              <FolderGit2Icon className="size-3.5 shrink-0" />
              <span className="truncate">{title}</span>
            </span>
          ))}
          {repositories.length > 2 ? (
            <span className="shrink-0">+{repositories.length - 2}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup align="start" side="bottom" variant="glass">
          <div className="space-y-2 py-1">
            <p className="font-medium">Ticket repositories</p>
            <div className="space-y-1.5">
              {repositories.map(({ id, title }) => (
                <div key={id} className="flex items-start gap-2">
                  <FolderGit2Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">{title}</span>
                  {id === ticket.primaryT3ProjectId ? (
                    <Badge size="sm" variant="outline">
                      Primary
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function renderWorkbenchBoardTicketThreadAction(
  presentation: ReturnType<typeof getWorkbenchBoardTicketPresentation>,
) {
  const { ticket, board, assignment, thread, threadActionPending, threadActionLabel } =
    presentation;
  const { pending, pendingTicketIds, onOpenThread } = board;
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {renderWorkbenchBoardTicketThreadStatus(presentation)}
        <WorkbenchProgressCount done={ticket.progressDone ?? 0} total={ticket.progressTotal ?? 0} />
      </div>
      {ticket.status !== "done" || (thread.state !== "unassigned" && thread.state !== "missing") ? (
        <Button
          aria-busy={threadActionPending}
          aria-label={`${threadActionLabel ?? thread.actionLabel} for ${ticket.title}`}
          data-workbench-no-drag=""
          className="relative z-10"
          disabled={
            pending ||
            pendingTicketIds.has(ticket.id) ||
            (board.threadRestoreDisabled === true && thread.state === "archived") ||
            (board.readOnly === true &&
              (thread.state === "unassigned" || thread.state === "missing"))
          }
          onClick={() => onOpenThread(ticket, assignment?.threadId)}
          size="xs"
          variant="ghost"
        >
          {threadActionPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {threadActionLabel ?? thread.actionLabel}
          {threadActionPending ? null : <ArrowRightIcon />}
        </Button>
      ) : null}
    </div>
  );
}

function useWorkbenchBoardDrag({
  projectId,
  environmentId,
  tickets,
  groupMode,
  pending,
  readOnly,
  pendingTicketIds,
  onMove,
  columns,
  swimlanes,
  wideBoard,
}: Pick<
  WorkbenchTicketBoardProps,
  | "projectId"
  | "environmentId"
  | "tickets"
  | "groupMode"
  | "pending"
  | "pendingTicketIds"
  | "onMove"
  | "readOnly"
> &
  Pick<ReturnType<typeof useWorkbenchBoardData>, "columns" | "swimlanes"> & {
    wideBoard: boolean;
  }) {
  const { view, setView } = useWorkbenchBoardView({ environmentId, projectId });
  const selectedColumnId = view.mobileColumnId;
  const setSelectedColumnId = (mobileColumnId: string) => setView({ mobileColumnId });
  const visibleColumnId = columns.some((column) => column.id === selectedColumnId)
    ? selectedColumnId
    : columns[0]?.id;
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
  const [activeTicketId, setActiveTicketId] = useState<WorkbenchTicketId | null>(null);
  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId);
  const dragDisabled = readOnly === true || !wideBoard || pending;
  const dropTargets = new Map(
    swimlanes.flatMap((lane) =>
      columns.map(
        (column) =>
          [
            JSON.stringify([lane.epic?.id ?? null, column.id]),
            {
              columnId: column.id,
              title: column.title,
              status: column.status,
              epicId: lane.epic?.id ?? null,
            },
          ] as const,
      ),
    ),
  );
  const canDrop = (
    ticket: WorkbenchTicket,
    target: { columnId: string; status: WorkbenchTicketStatus; epicId: WorkbenchEpic["id"] | null },
  ) =>
    !dragDisabled &&
    !pendingTicketIds.has(ticket.id) &&
    canMoveWorkbenchBoardTicket({
      ticket,
      sourceColumnId: columns.find((column) =>
        column.tickets.some((candidate) => candidate.id === ticket.id),
      )?.id,
      target,
      groupByEpic: groupMode === "epic",
      pending,
    });
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTicketId(null);
    const ticket = tickets.find((candidate) => candidate.id === active.id);
    const target = over ? dropTargets.get(String(over.id)) : undefined;
    if (!ticket || !target || !canDrop(ticket, target)) return;
    onMove(ticket, target.status);
  };

  return {
    selectedColumnId,
    setSelectedColumnId,
    visibleColumnId,
    sensors,
    activeTicket,
    dragDisabled,
    dropTargets,
    canDrop,
    handleDragEnd,
    setActiveTicketId,
  };
}

function renderWorkbenchBoardTicketThreadStatus(
  presentation: ReturnType<typeof getWorkbenchBoardTicketPresentation>,
) {
  const { ticket, board, nativeStatus, thread } = presentation;
  const { threadCounts } = board;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-foreground">
      {nativeStatus ? (
        <WorkbenchThreadExecutionStatus
          status={nativeStatus.presentation}
          startedAt={nativeStatus.startedAt}
        />
      ) : (
        <>
          {thread.state === "linked" || thread.state === "archived" ? (
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
          ) : (
            <BotIcon className="size-3.5" />
          )}
          <span>{thread.stateLabel}</span>
        </>
      )}
      {(threadCounts.get(ticket.id) ?? 0) > 1 ? (
        <span className="text-foreground">· {threadCounts.get(ticket.id)} Threads</span>
      ) : null}
    </div>
  );
}

function WorkbenchBoardRepositoryFilter({
  repositoryId,
  setRepositoryId,
  repositoryProjectIds,
  repositoriesById,
}: Pick<ReturnType<typeof useWorkbenchBoardData>, "repositoryId" | "setRepositoryId"> &
  Pick<WorkbenchTicketBoardProps, "repositoryProjectIds" | "repositoriesById">) {
  return (
    <div className="w-full min-w-0 @min-[42rem]/board-controls:w-48">
      <Select
        value={repositoryId ?? "all-repositories"}
        onValueChange={(value) => {
          const repositoryId = repositoryProjectIds.find((candidate) => candidate === value);
          setRepositoryId(repositoryId ?? null);
        }}
      >
        <SelectTrigger aria-label="Filter by repository" size="sm">
          <SelectValue>
            {repositoryId === null
              ? "All repositories"
              : (repositoriesById.get(repositoryId)?.title ?? "Repository unavailable")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup data-workbench-header-overlay="">
          <SelectItem value="all-repositories">All repositories</SelectItem>
          {repositoryProjectIds.map((repositoryId) => (
            <SelectItem
              key={repositoryId}
              value={repositoryId}
              disabled={!repositoriesById.has(repositoryId)}
            >
              {repositoriesById.get(repositoryId)?.title ?? "Repository unavailable"}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function renderWorkbenchAttentionModeControl(
  attentionMode: WorkbenchAttentionMode,
  setAttentionMode: (mode: WorkbenchAttentionMode) => void,
) {
  return (
    <ToggleGroup
      value={[attentionMode]}
      onValueChange={(values) => {
        const mode = values[0];
        if (mode === "all" || mode === "attention" || mode === "replies") setAttentionMode(mode);
      }}
      aria-label="Filter by attention"
    >
      <Toggle value="all">All</Toggle>
      <Toggle value="attention">Needs attention</Toggle>
      <Toggle value="replies">Agent replies</Toggle>
    </ToggleGroup>
  );
}

function renderWorkbenchBoardEmptyFilter({
  search,
  repositoryId,
  attentionMode,
  visibleTickets,
}: Pick<
  ReturnType<typeof useWorkbenchBoardData>,
  "search" | "repositoryId" | "attentionMode" | "visibleTickets"
>) {
  return (
    <>
      {" "}
      {(search.query || repositoryId !== null || attentionMode !== "all") &&
      visibleTickets.length === 0 ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center p-4 text-sm text-muted-foreground"
        >
          No matching tickets.
        </div>
      ) : null}
    </>
  );
}

function renderWorkbenchBoardStatus({
  attentionMode,
  attentionCoverage,
  incompleteInspection,
  refreshAttention,
  search,
  repositoryId,
  setRepositoryId,
  setAttentionMode,
  visibleTickets,
  tickets,
}: Pick<
  ReturnType<typeof useWorkbenchBoardData>,
  | "search"
  | "attentionMode"
  | "attentionCoverage"
  | "incompleteInspection"
  | "refreshAttention"
  | "repositoryId"
  | "setRepositoryId"
  | "setAttentionMode"
  | "visibleTickets"
> &
  Pick<WorkbenchTicketBoardProps, "tickets">) {
  if (!search.query && repositoryId === null && attentionMode === "all") return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-2xs text-muted-foreground">
      {attentionMode !== "all" ? (
        <div className="flex min-w-0 items-center gap-1">
          <span role="status">
            Environment: {attentionCoverage}
            {incompleteInspection ? ". Some actions may be missing." : ""}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Refresh linked PRs"
                  variant="ghost"
                  size="icon-micro"
                  onClick={refreshAttention}
                />
              }
            >
              <RefreshCwIcon aria-hidden className="size-3" />
            </TooltipTrigger>
            <TooltipPopup>Refresh linked PRs</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <span role="status" className="tabular-nums">
          {visibleTickets.length} of {tickets.length} tickets
        </span>
        <Button
          variant="ghost"
          size="micro"
          onClick={() => {
            search.setText("");
            setRepositoryId(null);
            setAttentionMode("all");
          }}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function renderWorkbenchBoardSearch({
  search,
}: Pick<ReturnType<typeof useWorkbenchBoardData>, "search">) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search tickets"
        placeholder="Search by title or reference…"
        value={search.text}
        onChange={(event) => search.setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            search.setText("");
          }
        }}
      />
      {search.text ? (
        <InputGroupAddon align="inline-end">
          <Button
            aria-label="Clear ticket search"
            variant="ghost"
            size="icon-xs"
            onClick={() => search.setText("")}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function renderWorkbenchBoardControls({
  viewControls,
  attentionMode,
  setAttentionMode,
  attentionCoverage,
  incompleteInspection,
  refreshAttention,
  search,
  repositoryId,
  setRepositoryId,
  repositoryProjectIds,
  repositoriesById,
  visibleTickets,
  tickets,
  columns,
  visibleColumnId,
  setSelectedColumnId,
}: Pick<
  ReturnType<typeof useWorkbenchBoardData>,
  | "search"
  | "attentionMode"
  | "setAttentionMode"
  | "attentionCoverage"
  | "incompleteInspection"
  | "refreshAttention"
  | "repositoryId"
  | "setRepositoryId"
  | "visibleTickets"
  | "columns"
> &
  Pick<
    WorkbenchTicketBoardProps,
    "viewControls" | "tickets" | "repositoryProjectIds" | "repositoriesById"
  > &
  Pick<ReturnType<typeof useWorkbenchBoardDrag>, "visibleColumnId" | "setSelectedColumnId">) {
  return (
    <>
      {" "}
      <div className="@container/board-controls flex shrink-0 flex-col gap-2 border-b border-border/60 px-3 py-2 sm:px-4">
        <div className="min-w-0 max-w-full overflow-x-auto">
          {renderWorkbenchAttentionModeControl(attentionMode, setAttentionMode)}
        </div>
        <div
          aria-label="Board filters and grouping"
          className="grid min-w-0 grid-cols-1 items-center gap-2 @min-[22rem]/board-controls:grid-cols-[minmax(0,1fr)_auto] @min-[42rem]/board-controls:grid-cols-[minmax(0,1fr)_auto_auto]"
          role="group"
        >
          <div className="min-w-0 @min-[22rem]/board-controls:col-span-2 @min-[42rem]/board-controls:col-span-1">
            {renderWorkbenchBoardSearch({ search })}
          </div>
          <WorkbenchBoardRepositoryFilter
            repositoryId={repositoryId}
            setRepositoryId={setRepositoryId}
            repositoryProjectIds={repositoryProjectIds}
            repositoriesById={repositoriesById}
          />
          {viewControls}
        </div>
        {renderWorkbenchBoardStatus({
          attentionMode,
          attentionCoverage,
          incompleteInspection,
          refreshAttention,
          search,
          repositoryId,
          setRepositoryId,
          setAttentionMode,
          visibleTickets,
          tickets,
        })}
      </div>
      {renderWorkbenchBoardEmptyFilter({
        search,
        repositoryId,
        attentionMode,
        visibleTickets,
      })}
      <div className="shrink-0 overflow-x-auto border-b border-border/60 px-3 py-2 @min-[48rem]/board:hidden">
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
              <span className="text-foreground tabular-nums">{column.tickets.length}</span>
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
    </>
  );
}

function getWorkbenchBoardAccessibility({
  tickets,
  dropTargets,
}: Pick<WorkbenchTicketBoardProps, "tickets"> &
  Pick<ReturnType<typeof useWorkbenchBoardDrag>, "dropTargets">): NonNullable<
  Parameters<typeof DndContext>[0]["accessibility"]
> {
  return {
    screenReaderInstructions: {
      draggable: "To change this ticket’s status with the keyboard, use its status menu.",
    },
    announcements: {
      onDragStart: ({ active }) =>
        `Picked up ${tickets.find((ticket) => ticket.id === active.id)?.title ?? "ticket"}.`,
      onDragOver: ({ over }) => {
        const target = over ? dropTargets.get(String(over.id)) : undefined;
        return target ? `Over ${target.title}.` : "Outside a status column.";
      },
      onDragEnd: ({ over }) => {
        const target = over ? dropTargets.get(String(over.id)) : undefined;
        return target ? `Dropped on ${target.title}.` : "No status change.";
      },
      onDragCancel: () => "Status change canceled.",
    },
  };
}
