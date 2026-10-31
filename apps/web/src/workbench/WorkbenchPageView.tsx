import "./WorkbenchPage.css";

import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import { useWorkbenchBoardData } from "./useWorkbenchBoardData";
import { useWorkbenchPageData } from "./useWorkbenchPageData";
import { useWorkbenchTicketActions } from "./useWorkbenchTicketActions";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import type { useWorkbenchWorkspaceActions } from "./useWorkbenchWorkspaceActions";

import { EnvironmentId, type WorkbenchProjectId, type WorkbenchTicketId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import {
  AlertCircleIcon,
  XIcon,
  ArchiveIcon,
  RotateCcwIcon,
  Trash2Icon,
  BlocksIcon,
  FolderGit2Icon,
  Layers3Icon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Settings2Icon,
  RefreshCwIcon,
} from "lucide-react";

import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { OpenInPicker } from "../components/chat/OpenInPicker";
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
import { Skeleton } from "../components/ui/skeleton";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { isElectron } from "../env";

import {
  getWorkbenchTicketStartProgressLabel,
  isWorkbenchTicketStartPending,
} from "./startWorkbenchTicket";

import { WorkbenchQueryError } from "./WorkbenchQueryError";

import {
  WorkbenchTicketDetail,
  WorkbenchTicketDialog,
  WorkbenchEpicDetail,
  WorkbenchEpicDialog,
  WorkbenchWorkspaceDialog,
} from "./WorkbenchForms";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";
import { WorkbenchBoardFloatingChat, WorkbenchDraftThread } from "./WorkbenchBoardFloatingChat";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { WorkbenchTicketConversation } from "./WorkbenchTicketConversation";
import { WorkbenchAttachThreadDialog } from "./WorkbenchAttachThreadDialog";
import { WorkbenchPageRow } from "./WorkbenchPagePanel";
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";
import { getTicketReferences } from "./workbenchReferences.logic";
import {
  getPlanningTicketDraft,
  getUnsavedConversationDrafts,
  resolveWorkbenchWorkItemView,
  supportsConversationDrafts,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

type WorkbenchPageViewProps = {
  readonly workspaceActions: ReturnType<typeof useWorkbenchWorkspaceActions>;
  readonly environmentId: EnvironmentId | null;
  readonly createWorkspace: boolean;
  /** `create=ticket` is in the URL: the Workspace shows its ticket planning conversation. */
  readonly createTicket?: boolean;
  readonly error: string | null;
  readonly pendingAction: string | null;
  readonly setError: (message: string | null) => void;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
  readonly dialogs: ReturnType<typeof useWorkbenchPageDialogs>;
  readonly boardData: ReturnType<typeof useWorkbenchBoardData>;
  readonly ticketActions: ReturnType<typeof useWorkbenchTicketActions>;
  readonly threadActions: ReturnType<typeof useWorkbenchThreadActions>;
};

function WorkbenchLoading() {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="Loading Workbench"
    >
      <div className="space-y-3 border-b border-border px-4 py-4 sm:px-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-full min-h-72" />
        ))}
      </div>
    </div>
  );
}

function WorkbenchWorkspaceLifecycleMenu({
  workspace,
  pending,
  actions,
}: {
  workspace: NonNullable<ReturnType<typeof useWorkbenchPageSelection>["selectedProject"]>;
  pending: boolean;
  actions: ReturnType<typeof useWorkbenchWorkspaceActions>;
}) {
  const archived = workspace.archivedAt != null;
  return (
    <MenuGroup>
      <MenuItem
        disabled={pending || !actions.canArchive}
        onClick={() => void actions.setArchived(workspace)}
      >
        {archived ? <RotateCcwIcon /> : <ArchiveIcon />}
        {archived ? "Restore Workspace" : "Archive Workspace"}
      </MenuItem>
      <MenuItem
        variant="destructive"
        disabled={pending || !actions.canDelete}
        onClick={() => actions.requestDeletion(workspace)}
      >
        <Trash2Icon /> Delete Workspace…
      </MenuItem>
    </MenuGroup>
  );
}

function WorkbenchBoardHeader(
  props: Pick<
    WorkbenchPageViewProps,
    | "boardData"
    | "dialogs"
    | "workspaceActions"
    | "pageData"
    | "selection"
    | "setError"
    | "pendingAction"
  >,
) {
  const { pageData, selection, dialogs, boardData, setError, workspaceActions, pendingAction } =
    props;
  const { keybindings, availableEditors } = pageData;
  const { selectedProject } = selection;
  const { setEditWorkspaceOpen, openTicketDialog, openTicketConversation, openEpicDialog } =
    dialogs;
  const { projectTickets, linkedT3Projects } = boardData;

  if (selectedProject === null) return null;
  const readOnly = selectedProject.archivedAt != null;
  const lifecyclePending = !pageData.canOperate || pendingAction !== null;
  const mutationDisabled = readOnly || lifecyclePending;
  return (
    <WorkspacePageHeader
      electron={isElectron}
      className="h-auto! min-h-20! max-h-none! items-start border-b border-border py-3"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 basis-full flex-col gap-1 sm:basis-auto sm:flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="max-w-full min-w-0 truncate text-xl font-semibold">
              {selectedProject.title}
            </h1>
            <span className="shrink-0 text-xs text-muted-foreground">
              {projectTickets.length} tickets
            </span>
            {readOnly ? <Badge variant="outline">Archived Workspace</Badge> : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger render={<Button size="sm" variant="outline" />}>
              <FolderGit2Icon data-icon="inline-start" />
              Repositories {linkedT3Projects.length}
            </PopoverTrigger>
            <PopoverPopup align="end" className="w-80 max-w-[calc(100vw-2rem)]">
              <PopoverTitle>Repositories</PopoverTitle>
              <div className="mt-3 flex flex-col gap-2">
                {linkedT3Projects.map((project) => (
                  <div key={project.id} className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-words text-sm">{project.title}</span>
                    <OpenInPicker
                      environmentId={project.environmentId}
                      keybindings={keybindings}
                      availableEditors={availableEditors}
                      openInCwd={project.workspaceRoot}
                      compact
                      enableShortcut={false}
                    />
                  </div>
                ))}
              </div>
            </PopoverPopup>
          </Popover>
          <Button
            aria-label="New Ticket"
            disabled={mutationDisabled}
            onClick={() => openTicketConversation()}
            size="sm"
          >
            <PlusIcon data-icon="inline-start" />
            New Ticket
          </Button>
          <Menu>
            <MenuTrigger
              render={<Button aria-label="Workspace actions" size="icon-sm" variant="ghost" />}
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end" data-workbench-header-overlay="">
              <MenuGroup>
                <MenuItem disabled={mutationDisabled} onClick={() => openTicketDialog()}>
                  <PlusIcon /> New ticket manually
                </MenuItem>
                <MenuItem disabled={mutationDisabled} onClick={() => openEpicDialog()}>
                  <Layers3Icon /> New Epic
                </MenuItem>
                <MenuItem
                  disabled={mutationDisabled}
                  onClick={() => {
                    setError(null);
                    setEditWorkspaceOpen(true);
                  }}
                >
                  <Settings2Icon /> Edit Workspace
                </MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <WorkbenchWorkspaceLifecycleMenu
                workspace={selectedProject}
                pending={lifecyclePending}
                actions={workspaceActions}
              />
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </WorkspacePageHeader>
  );
}

function WorkbenchBoardErrors(
  props: Pick<WorkbenchPageViewProps, "error" | "setError" | "pageData">,
) {
  const { pageData, error, setError } = props;
  const { query, threadLookupError, refreshThreadLookup } = pageData;

  return (
    <>
      {query.error || error || threadLookupError ? (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground sm:mx-4">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{error ?? query.error ?? threadLookupError}</span>
          {error === null && query.error ? (
            <Button onClick={query.refresh} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : error === null && threadLookupError ? (
            <Button onClick={refreshThreadLookup} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : null}
          {error ? (
            <Button
              aria-label="Dismiss action error"
              size="icon-xs"
              variant="ghost"
              onClick={() => setError(null)}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function WorkbenchBoardToolbar(props: Pick<WorkbenchPageViewProps, "boardData">) {
  const { boardData } = props;

  const { projectEpics, boardGroupModeForView, setBoardGroupMode } = boardData;

  return (
    <div className="flex min-w-0 max-w-44 flex-wrap items-center gap-2 text-sm">
      {projectEpics.length > 0 ? (
        <div className="w-44 max-w-full">
          <Select
            value={boardGroupModeForView}
            onValueChange={(value) => {
              if (value === "none" || value === "epic") {
                setBoardGroupMode(value);
              }
            }}
          >
            <SelectTrigger aria-label="Group Board tickets" size="sm">
              <SelectValue>
                Group by: {boardGroupModeForView === "epic" ? "Epic" : "Status"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup data-workbench-header-overlay="">
              <SelectItem value="none">Status</SelectItem>
              <SelectItem value="epic">Epic</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

type WorkbenchPageTicketDetailProps = Pick<
  WorkbenchPageViewProps,
  | "boardData"
  | "dialogs"
  | "environmentId"
  | "error"
  | "pageData"
  | "pendingAction"
  | "selection"
  | "setError"
  | "threadActions"
  | "ticketActions"
>;

function getWorkbenchPageTicketState({
  props: { pageData, ticketActions, pendingAction, error },
  ticketId,
}: {
  props: WorkbenchPageTicketDetailProps;
  ticketId: WorkbenchTicketId;
}) {
  return {
    ticketWorkspace: pageData.snapshot?.ticketWorkspaces.find(
      (workspace) => workspace.ticketId === ticketId,
    ),
    references: getTicketReferences(pageData.referencesByTicket, ticketId),
    pending: pendingAction !== null || pageData.optimisticStatus.pendingTicketIds.has(ticketId),
    threadMutationsDisabled: !pageData.canOperate,
    threadActionPending: isWorkbenchPageTicketThreadPending({
      assignmentsByTicket: pageData.assignmentsByTicket,
      pendingAction,
      ticketId,
    }),
    threadActionLabel: getWorkbenchTicketStartProgressLabel(pendingAction, ticketId),
    error: error ?? pageData.query.error ?? pageData.threadLookupError,
    onRetryError: error
      ? undefined
      : pageData.query.error
        ? pageData.query.refresh
        : pageData.threadLookupError
          ? pageData.refreshThreadLookup
          : undefined,
    preparationFailed: ticketActions.workspacePreparationFailure === ticketId,
    preparationPending:
      pendingAction === `prepare-workspace:${ticketId}` ||
      pendingAction === `start:${ticketId}:preparing-workspace`,
  };
}

function isWorkbenchPageTicketThreadPending({
  assignmentsByTicket,
  pendingAction,
  ticketId,
}: {
  assignmentsByTicket: WorkbenchPageViewProps["pageData"]["assignmentsByTicket"];
  pendingAction: string | null;
  ticketId: WorkbenchTicketId;
}) {
  const assignment = assignmentsByTicket.get(ticketId);
  return (
    isWorkbenchTicketStartPending(pendingAction, ticketId) ||
    (assignment !== undefined && pendingAction === `restore:${assignment.threadId}`)
  );
}

/**
 * While a saved ticket is still planning, its Thread is the planning conversation: Start work is
 * the step that hands it over. Thread changes here would only make Start work fail, so they
 * explain that instead.
 */
function WorkbenchPageTicketDetail(props: WorkbenchPageTicketDetailProps) {
  const {
    pageData,
    selection,
    dialogs,
    boardData,
    ticketActions,
    threadActions,
    environmentId,
    setError,
  } = props;
  const { keybindings, availableEditors, threadsById, archivedThreadsById, threadLookupReady } =
    pageData;
  const {
    setSelectedTicketId,
    setSelectedEpicId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    selectedProject,
    selectedTicket,
    updateEpicRouteSelection,
    closeWorkItem,
  } = selection;
  const { openEpicDialog } = dialogs;
  const { linkedT3Projects, projectEpics, selectedAssignments } = boardData;
  const planning =
    selectedTicket === null ? null : getPlanningTicketDraft(pageData.snapshot, selectedTicket.id);
  const blockThreadChange = () =>
    setError("Start work before changing this ticket's Threads. Planning keeps its own Thread.");
  const {
    changeTicket,
    setTicketArchived,
    removeTicket,
    resetTicketWorkspace,
    saveTicketContent,
    regenerateSummary,
  } = ticketActions;
  const {
    setAttachThreadTicket,
    openAssignedThread,
    requestTicketThread,
    requestNewThread,
    requestReplacementThread,
    deleteAssignedThread,
    unlinkThread,
  } = threadActions;
  if (environmentId === null || selectedProject === null || selectedTicket === null) return null;
  const planningThread = (conversation?: ReactNode) =>
    planning ? (
      <WorkbenchDraftThread
        key={planning.id}
        environmentId={environmentId}
        workspace={selectedProject}
        snapshotDraft={planning}
        ticket={selectedTicket}
        createContext={{
          linkedProjects: linkedT3Projects,
          epics: boardData.activeProjectEpics,
        }}
        refreshSnapshot={pageData.refreshWorkbenchSnapshot}
        onOpenDraft={() => props.dialogs.openTicketDialog()}
        neverRan={threadsById.get(planning.threadId)?.latestRun == null}
        onDiscarded={closeWorkItem}
      >
        {conversation}
      </WorkbenchDraftThread>
    ) : null;
  return (
    <>
      {planning ? <div className="shrink-0 border-b border-border">{planningThread()}</div> : null}
      <WorkbenchTicketDetail
        key={selectedTicket.id}
        environmentId={environmentId}
        workspaceTitle={selectedProject.title}
        workspaceReadOnly={!pageData.canOperate || selectedProject.archivedAt != null}
        ticket={selectedTicket}
        {...getWorkbenchPageTicketState({ props, ticketId: selectedTicket.id })}
        lifecycleActionsEnabled={pageData.canOperate && selectedProject.archivedAt == null}
        repositoryScopeDraft={ticketActions.repositoryScopeDraft}
        onEditRepositories={ticketActions.editRepositories}
        onRepositoryScopeChange={ticketActions.changeRepositoryScope}
        onCancelRepositories={ticketActions.cancelRepositoryScope}
        onSaveRepositories={ticketActions.saveRepositories}
        linkedProjects={linkedT3Projects}
        epics={projectEpics}
        keybindings={keybindings}
        availableEditors={availableEditors}
        assignments={selectedAssignments}
        floatingChat
        floatingChatPlanning={
          planning
            ? {
                threadIds: new Set([planning.threadId]),
                render: (_threadId, conversation) => planningThread(conversation),
              }
            : undefined
        }
        threadsById={threadsById}
        archivedThreadsById={archivedThreadsById}
        threadLookupReady={threadLookupReady}
        onBack={() => {
          setError(null);
          closeWorkItem();
        }}
        onSave={saveTicketContent}
        onRegenerateSummary={(ticket) => {
          void regenerateSummary(ticket);
        }}
        onUpdate={changeTicket}
        onCreateEpic={openEpicDialog}
        onOpenEpic={(epicId) => {
          setAwaitingTicketId(null);
          setAwaitingEpicId(null);
          setSelectedTicketId(null);
          setSelectedEpicId(epicId);
          void updateEpicRouteSelection(selectedProject.id, epicId);
        }}
        onOpenThread={requestTicketThread}
        onOpenAssignedThread={openAssignedThread}
        onNewThread={planning ? blockThreadChange : requestNewThread}
        onAttachThread={(ticket) => {
          if (planning) return blockThreadChange();
          setError(null);
          setAttachThreadTicket(ticket);
        }}
        onUnlinkThread={(threadId) => {
          if (planning) return blockThreadChange();
          void unlinkThread(threadId);
        }}
        onDeleteThread={(threadId) => {
          if (planning) return blockThreadChange();
          void deleteAssignedThread(threadId);
        }}
        onReplaceThread={(ticket, previousThreadId) => {
          if (planning) return blockThreadChange();
          requestReplacementThread({ ticket, previousThreadId });
        }}
        onArchive={setTicketArchived}
        onDelete={removeTicket}
        onResetWorkspace={resetTicketWorkspace}
      />
    </>
  );
}

function WorkbenchPageEpicDetail(
  props: Pick<
    WorkbenchPageViewProps,
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "pageData"
    | "pendingAction"
    | "selection"
    | "setError"
  >,
) {
  const { pageData, selection, dialogs, boardData, environmentId, error, pendingAction, setError } =
    props;
  const { repositoriesById, query, assignmentsByTicket } = pageData;
  const {
    setSelectedTicketId,
    setSelectedEpicId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    selectedProject,
    selectedEpic,
    updateRouteSelection,
    closeWorkItem,
  } = selection;

  const { saveEpicContent, openTicketConversation, canArchiveEpic, setEpicArchived } = dialogs;
  const { selectedEpicTickets } = boardData;

  const pending = pendingAction !== null;
  if (environmentId === null || selectedProject === null || selectedEpic === null) return null;
  return (
    <WorkbenchEpicDetail
      key={selectedEpic.id}
      environmentId={environmentId}
      workspaceTitle={selectedProject.title}
      readOnly={!pageData.canOperate || selectedProject.archivedAt != null}
      epic={selectedEpic}
      tickets={selectedEpicTickets}
      repositoriesById={repositoriesById}
      assignmentsByTicket={assignmentsByTicket}
      pending={pending}
      error={error ?? query.error}
      onBack={() => {
        setError(null);
        closeWorkItem();
      }}
      actions={{
        onSave: saveEpicContent,
        lifecycleSupported: pageData.snapshot?.supportsEpicLifecycle === true,
        canArchive: canArchiveEpic,
        onArchive: setEpicArchived,
      }}
      onOpenTicket={(ticketId) => {
        setAwaitingTicketId(null);
        setAwaitingEpicId(null);
        setSelectedEpicId(null);
        setSelectedTicketId(ticketId);
        void updateRouteSelection(selectedProject.id, ticketId);
      }}
      onCreateTicket={() => openTicketConversation(selectedEpic.id)}
    />
  );
}

function WorkbenchPageConversation(
  props: WorkbenchPageTicketDetailProps & { readonly draft: WorkbenchConversationDraft | null },
) {
  const { pageData, selection, dialogs, boardData, environmentId, draft } = props;
  const { selectedProject, selectedTicket } = selection;
  if (environmentId === null || selectedProject === null) return null;
  return (
    <WorkbenchTicketConversation
      environmentId={environmentId}
      workspace={selectedProject}
      draft={draft}
      requestedDraftId={selection.selectedTicketId}
      // Resuming from the board selects no ticket, yet an interrupted Create ticket may have saved one.
      ticket={selectedTicket ?? pageData.snapshot?.tickets.find((t) => t.id === draft?.id) ?? null}
      draftsSupported={supportsConversationDrafts(pageData.snapshot)}
      providers={pageData.providers}
      linkedProjects={boardData.linkedT3Projects}
      references={draft ? getTicketReferences(pageData.referencesByTicket, draft.id) : []}
      threadsById={pageData.threadsById}
      archivedThreadsById={pageData.archivedThreadsById}
      epics={boardData.activeProjectEpics}
      initialEpicId={dialogs.conversationEpicId}
      refreshSnapshot={pageData.refreshWorkbenchSnapshot}
      onClose={dialogs.closeTicketConversation}
      onCreateManually={() =>
        dialogs.openTicketDialog(draft ? draft.fields.epicId : dialogs.conversationEpicId)
      }
      onCreateEpic={dialogs.openEpicDialog}
      onDraftPrepared={dialogs.openCreatedTicket}
      onTicketCreated={(created) => {
        dialogs.openCreatedTicket(created);
        // The ticket's page continues this conversation in its floating chat.
        useWorkbenchFloatingChatStore.getState().expand(created.threadId);
      }}
      onDiscarded={dialogs.closeTicketConversation}
      onWorkStarted={dialogs.openDraftThread}
      // A saved ticket opens its own page once the snapshot holds it.
      onShowTicketDetails={pageData.refreshWorkbenchSnapshot}
    />
  );
}

function WorkbenchPageBoard(
  props: Pick<
    WorkbenchPageViewProps,
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "workspaceActions"
    | "pageData"
    | "pendingAction"
    | "selection"
    | "setError"
    | "threadActions"
    | "ticketActions"
  >,
) {
  const {
    pageData,
    selection,
    dialogs,
    boardData,
    ticketActions,
    threadActions,
    environmentId,
    pendingAction,
  } = props;
  const {
    repositoriesById,
    snapshot,
    optimisticStatus,
    threadsById,
    archivedThreadsById,
    assignmentsByTicket,
    threadLookupReady,
  } = pageData;
  const {
    setSelectedTicketId,
    setSelectedEpicId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    selectedProject,
    updateRouteSelection,
    updateEpicRouteSelection,
  } = selection;

  const { openTicketConversation } = dialogs;
  const { projectTickets, projectEpics, boardGroupModeForView, repositoriesReady } = boardData;
  const { changeTicket, ticketForBoardAction, regenerateSummary } = ticketActions;
  const { requestTicketThread } = threadActions;
  const pending = pendingAction !== null;
  if (environmentId === null || selectedProject === null) return null;
  const selectTicket = (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => {
    setAwaitingTicketId(null);
    setAwaitingEpicId(null);
    setSelectedEpicId(null);
    setSelectedTicketId(ticketId);
    void updateRouteSelection(projectId, ticketId);
  };
  return (
    <>
      <WorkbenchBoardHeader {...props} />

      <WorkbenchBoardErrors {...props} />

      <div className="flex min-h-0 flex-1 flex-col">
        <WorkbenchTicketBoard
          environmentId={environmentId}
          readOnly={!pageData.canOperate || selectedProject.archivedAt != null}
          threadRestoreDisabled={!pageData.canOperate}
          key={selectedProject.id}
          projectId={selectedProject.id}
          drafts={getUnsavedConversationDrafts(snapshot, selectedProject.id)}
          tickets={projectTickets}
          epics={projectEpics}
          groupMode={boardGroupModeForView}
          viewControls={<WorkbenchBoardToolbar boardData={boardData} />}
          floatingChat={
            <WorkbenchPageBoardChat
              pageData={pageData}
              boardData={boardData}
              threadActions={threadActions}
              ticketActions={ticketActions}
              pendingAction={pendingAction}
              environmentId={environmentId}
              workspace={selectedProject}
              onOpenDraft={(draftId) => selectTicket(selectedProject.id, draftId)}
              onCreateEpic={dialogs.openEpicDialog}
            />
          }
          selectedTicketId={null}
          repositoriesById={repositoriesById}
          repositoryProjectIds={selectedProject.linkedProjectIds}
          repositoriesReady={repositoriesReady}
          assignmentsByTicket={assignmentsByTicket}
          referencesByTicket={pageData.referencesByTicket}
          assignments={snapshot?.assignments ?? []}
          threadsById={threadsById}
          archivedThreadsById={archivedThreadsById}
          threadLookupReady={threadLookupReady}
          pending={pending}
          pendingAction={pendingAction}
          pendingTicketIds={optimisticStatus.pendingTicketIds}
          onSelect={selectTicket}
          onSelectEpic={(projectId, epicId) => {
            setAwaitingTicketId(null);
            setAwaitingEpicId(null);
            setSelectedTicketId(null);
            setSelectedEpicId(epicId);
            void updateEpicRouteSelection(projectId, epicId);
          }}
          onMove={(ticket, status) => {
            changeTicket(ticketForBoardAction(ticket), { status });
          }}
          onRegenerateSummary={(ticket) => {
            void regenerateSummary(ticket);
          }}
          onOpenThread={(ticket, threadId) =>
            requestTicketThread(ticketForBoardAction(ticket), threadId)
          }
          onCreateTicket={() => openTicketConversation()}
        />
      </div>
    </>
  );
}

/** The board's floating chat, fed from the same page data as the board. */
function WorkbenchPageBoardChat({
  pageData,
  boardData,
  threadActions,
  ticketActions,
  pendingAction,
  environmentId,
  workspace,
  onOpenDraft,
  onCreateEpic,
}: Pick<
  WorkbenchPageViewProps,
  "pageData" | "boardData" | "threadActions" | "ticketActions" | "pendingAction"
> & {
  readonly environmentId: EnvironmentId;
  readonly workspace: NonNullable<WorkbenchPageViewProps["selection"]["selectedProject"]>;
  readonly onOpenDraft: (draftId: WorkbenchTicketId) => void;
  readonly onCreateEpic: Parameters<typeof WorkbenchBoardFloatingChat>[0]["onCreateEpic"];
}) {
  const { snapshot } = pageData;
  return (
    <WorkbenchBoardFloatingChat
      environmentId={environmentId}
      workspace={workspace}
      providers={pageData.providers}
      linkedProjects={boardData.linkedT3Projects}
      tickets={boardData.projectTickets}
      assignments={snapshot?.assignments ?? []}
      referencesByTicket={pageData.referencesByTicket}
      drafts={snapshot?.ticketDrafts ?? []}
      threadsById={pageData.threadsById}
      archivedThreadsById={pageData.archivedThreadsById}
      createContext={{
        linkedProjects: boardData.linkedT3Projects,
        epics: boardData.activeProjectEpics,
      }}
      canStartDrafts={
        pageData.canOperate && workspace.archivedAt == null && supportsConversationDrafts(snapshot)
      }
      refreshSnapshot={pageData.refreshWorkbenchSnapshot}
      onOpenDraft={onOpenDraft}
      onCreateEpic={onCreateEpic}
      onOpenThread={(threadId) => void threadActions.openAssignedThread(threadId)}
      onNewTicketThread={(ticket) =>
        threadActions.requestNewThread(ticketActions.ticketForBoardAction(ticket))
      }
      newTicketThreadDisabled={
        !pageData.canOperate ||
        !pageData.threadLookupReady ||
        pendingAction !== null ||
        workspace.archivedAt != null
      }
    />
  );
}

function WorkbenchPageWorkspace(
  props: Pick<
    WorkbenchPageViewProps,
    | "createTicket"
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "workspaceActions"
    | "pageData"
    | "pendingAction"
    | "selection"
    | "setError"
    | "threadActions"
    | "ticketActions"
  >,
) {
  const { pageData, selection, environmentId, pendingAction } = props;
  const { selectedProject, selectedEpic, selectedTicket } = selection;
  const workItemView = resolveWorkbenchWorkItemView({
    snapshot: pageData.snapshot,
    workspaceId: selectedProject?.id ?? null,
    selectedTicketId: selection.selectedTicketId,
    ticketExists: selectedTicket !== null,
    hasSelectedEpic: selectedEpic !== null,
    // An archived Workspace is read-only, so it never starts a conversation.
    createTicket:
      props.createTicket === true && pageData.canOperate && selectedProject?.archivedAt == null,
    awaitingTicketId: selection.awaitingTicketId,
  });

  const pending = !pageData.canOperate || pendingAction !== null;
  if (environmentId === null) return null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {selection.selectedProject && selection.selectedProject.archivedAt != null ? (
        <div
          role="status"
          className="border-b border-border px-4 py-3 text-sm text-muted-foreground"
        >
          This Workspace is archived. Planning is read-only. Linked Threads remain available.
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              if (selection.selectedProject)
                void props.workspaceActions.setArchived(selection.selectedProject);
            }}
            disabled={pending || !props.workspaceActions.canArchive}
          >
            <RotateCcwIcon /> Restore Workspace
          </Button>
        </div>
      ) : null}
      {workItemView.kind === "conversation" ? (
        <WorkbenchPageConversation {...props} draft={workItemView.draft} />
      ) : workItemView.kind === "ticket" ? (
        <WorkbenchPageTicketDetail {...props} />
      ) : workItemView.kind === "epic" ? (
        <WorkbenchPageEpicDetail {...props} />
      ) : (
        <WorkbenchPageBoard {...props} />
      )}
    </div>
  );
}

function WorkbenchPageWorkspaceDialogs(
  props: Pick<
    WorkbenchPageViewProps,
    "createWorkspace" | "dialogs" | "error" | "pageData" | "pendingAction" | "selection"
  >,
) {
  const { pageData, selection, dialogs, createWorkspace, error, pendingAction } = props;
  const { projects, query } = pageData;
  const { selectedProject, handleWorkspaceDialogOpenChange } = selection;

  const { editWorkspaceOpen, setEditWorkspaceOpen, submitProject, saveWorkspace } = dialogs;

  const pending = pendingAction !== null;
  return (
    <>
      {createWorkspace ? (
        <WorkbenchWorkspaceDialog
          open={createWorkspace}
          projects={projects}
          pending={pending}
          disabled={!pageData.canOperate}
          error={error ?? query.error}
          onOpenChange={handleWorkspaceDialogOpenChange}
          onSave={submitProject}
        />
      ) : null}
      {editWorkspaceOpen && selectedProject && selectedProject.archivedAt == null ? (
        <WorkbenchWorkspaceDialog
          key={selectedProject.id}
          open
          projects={projects}
          initialWorkspace={selectedProject}
          pending={pending}
          disabled={!pageData.canOperate}
          error={error ?? query.error}
          onOpenChange={setEditWorkspaceOpen}
          onSave={saveWorkspace}
        />
      ) : null}
    </>
  );
}

function WorkbenchPageThreadDialogs(
  props: Pick<
    WorkbenchPageViewProps,
    "environmentId" | "error" | "pageData" | "pendingAction" | "threadActions"
  >,
) {
  const { pageData, threadActions, environmentId, error, pendingAction } = props;
  const { providers, snapshot, threadsById, reservedThreadIds } = pageData;

  const {
    startThreadRequest,
    setStartThreadRequest,
    attachThreadTicket,
    setAttachThreadTicket,
    attachExistingThread,
    startSelectedThread,
  } = threadActions;
  const pending = pendingAction !== null;
  return (
    <>
      {startThreadRequest && environmentId && startThreadRequest.environmentId === environmentId ? (
        <WorkbenchStartThreadDialog
          key={`${environmentId}:${startThreadRequest.ticket.id}:${startThreadRequest.reviewVersion ?? 0}`}
          open
          request={{
            ticket: startThreadRequest.ticket,
            projects: pageData.projects.filter((project) =>
              snapshot?.projects
                .find((workspace) => workspace.id === startThreadRequest.ticket.projectId)
                ?.linkedProjectIds.includes(project.id),
            ),
            workspace: snapshot?.ticketWorkspaces.find(
              (workspace) => workspace.ticketId === startThreadRequest.ticket.id,
            ),
            initialRepositoryScope: startThreadRequest.repositoryScope,
            environmentId,
            additional: startThreadRequest.mode === "additional",
          }}
          error={error}
          providers={providers}
          pending={pending}
          disabled={!pageData.canOperate}
          onOpenChange={(open) => {
            if (!open) setStartThreadRequest(null);
          }}
          onStart={(input) => {
            void startSelectedThread(input);
          }}
        />
      ) : null}
      {attachThreadTicket ? (
        <WorkbenchAttachThreadDialog
          threads={[...threadsById.values()].filter(
            (thread) =>
              thread.projectId === attachThreadTicket.primaryT3ProjectId &&
              !reservedThreadIds.has(thread.id) &&
              !(snapshot?.assignments ?? []).some(
                (assignment) => assignment.threadId === thread.id,
              ),
          )}
          pending={pending}
          disabled={!pageData.canOperate}
          error={error}
          onClose={() => setAttachThreadTicket(null)}
          onAttach={attachExistingThread}
        />
      ) : null}
    </>
  );
}

function WorkbenchPageTicketDialogs(
  props: Pick<
    WorkbenchPageViewProps,
    "boardData" | "dialogs" | "error" | "pageData" | "pendingAction" | "selection"
  >,
) {
  const { pageData, selection, dialogs, boardData, error, pendingAction } = props;
  const { query } = pageData;
  const { selectedProject } = selection;

  const {
    ticketDialogOpen,
    ticketDialogEpicId,
    epicDialogOpen,
    submitTicket,
    submitEpic,
    openEpicDialog,
    handleTicketDialogOpenChange,
    handleEpicDialogOpenChange,
  } = dialogs;
  const { linkedT3Projects, activeProjectEpics } = boardData;

  const pending = pendingAction !== null;
  if (selectedProject?.archivedAt != null) return null;
  return (
    <>
      {selectedProject ? (
        <WorkbenchEpicDialog
          open={epicDialogOpen}
          pending={pending}
          disabled={!pageData.canOperate}
          error={error ?? query.error}
          onOpenChange={handleEpicDialogOpenChange}
          onCreate={submitEpic}
        />
      ) : null}
      {selectedProject ? (
        <WorkbenchTicketDialog
          key={`${selectedProject.id}:${ticketDialogEpicId ?? "no-epic"}`}
          open={ticketDialogOpen}
          linkedProjects={linkedT3Projects}
          epics={activeProjectEpics}
          initialEpicId={ticketDialogEpicId}
          pending={pending}
          disabled={!pageData.canOperate}
          error={error ?? query.error}
          onOpenChange={handleTicketDialogOpenChange}
          onCreate={submitTicket}
          onCreateEpic={openEpicDialog}
        />
      ) : null}
    </>
  );
}

function WorkbenchPageContent(
  props: Pick<
    WorkbenchPageViewProps,
    | "createTicket"
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "workspaceActions"
    | "pageData"
    | "pendingAction"
    | "selection"
    | "setError"
    | "threadActions"
    | "ticketActions"
  >,
) {
  const { environmentId, pageData, selection } = props;
  const { query, snapshot } = pageData;
  const { awaitingSelectedProject, selectedProject } = selection;
  if (environmentId === null)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BlocksIcon />
          </EmptyMedia>
          <EmptyTitle>Connect an environment</EmptyTitle>
          <EmptyDescription>
            Workbench Workspaces and Tickets belong to the active T3 environment.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (query.isPending && snapshot === null) return <WorkbenchLoading />;
  if (snapshot === null && query.error) return <WorkbenchQueryError query={query} />;
  if (awaitingSelectedProject && query.error) return <WorkbenchQueryError query={query} />;
  if (awaitingSelectedProject) return <WorkbenchLoading />;
  if (selectedProject === null) return <WorkbenchPageNoWorkspace {...props} />;
  return <WorkbenchPageWorkspace {...props} />;
}

function WorkbenchPageNoWorkspace(
  props: Pick<WorkbenchPageViewProps, "pageData" | "selection" | "error">,
) {
  const { query } = props.pageData;
  const { openWorkspaceDialog } = props.selection;
  const error = props.error ?? query.error;
  return (
    <div className="relative min-h-0 flex-1">
      {error ? (
        <div className="absolute inset-x-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground">
          <AlertCircleIcon className="size-4" />
          <span className="min-w-0 flex-1">{error}</span>
          {query.error ? (
            <Button onClick={query.refresh} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboardIcon />
          </EmptyMedia>
          <EmptyTitle>
            {props.pageData.snapshot?.projects.length
              ? "No active Workbench Workspaces"
              : "Create your first Workbench Workspace"}
          </EmptyTitle>
          <EmptyDescription>
            {props.pageData.snapshot?.projects.length
              ? "Open Archived Workspaces in the sidebar to inspect or restore one, or create a new Workspace."
              : "Group tickets around the repositories and native Agent Threads that deliver them."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={!props.pageData.canOperate} onClick={openWorkspaceDialog}>
            <PlusIcon /> Create Workspace
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function WorkbenchPageView(props: WorkbenchPageViewProps) {
  return (
    <WorkbenchPageRow>
      <WorkbenchPageContent {...props} />

      <WorkbenchPageWorkspaceDialogs {...props} />
      <WorkbenchPageThreadDialogs {...props} />
      <WorkbenchPageTicketDialogs {...props} />
    </WorkbenchPageRow>
  );
}
