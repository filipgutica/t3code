const formatJiraSyncStatus = (value: string | null) =>
  value === null ? "Jira not synced yet" : `Jira synced ${new Date(value).toLocaleString()}`;

import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import { useWorkbenchBoardData } from "./useWorkbenchBoardData";
import { useWorkbenchPageData } from "./useWorkbenchPageData";
import { useWorkbenchTicketActions } from "./useWorkbenchTicketActions";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";
import type { useWorkbenchWorkspaceActions } from "./useWorkbenchWorkspaceActions";

import { EnvironmentId, type WorkbenchTicket, type WorkbenchTicketId } from "@t3tools/contracts";

import {
  AlertCircleIcon,
  ArchiveIcon,
  RotateCcwIcon,
  Trash2Icon,
  BlocksIcon,
  FolderGit2Icon,
  Layers3Icon,
  LinkIcon,
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
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { isElectron } from "../env";

import {
  getWorkbenchTicketStartProgressLabel,
  isWorkbenchTicketStartPending,
} from "./startWorkbenchTicket";

import { WorkbenchJiraTransitionsPreloader } from "./WorkbenchJiraTransitionsPreloader";
import { WorkbenchQueryError } from "./WorkbenchQueryError";

import {
  WorkbenchTicketDetail,
  WorkbenchTicketDialog,
  WorkbenchEpicDetail,
  WorkbenchEpicDialog,
  WorkbenchWorkspaceDialog,
} from "./WorkbenchForms";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";
import { WorkbenchAttachThreadDialog } from "./WorkbenchAttachThreadDialog";
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";
import { WorkbenchJiraDialog } from "./WorkbenchJiraDialog";
import { WorkbenchPublishTicketDialog } from "./WorkbenchPublishTicketDialog";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { getWorkbenchJiraBindingSprints, isWorkbenchJiraEpic } from "./workbenchJira.logic";

type WorkbenchPageViewProps = {
  readonly workspaceActions: ReturnType<typeof useWorkbenchWorkspaceActions>;
  readonly environmentId: EnvironmentId | null;
  readonly createWorkspace: boolean;
  readonly jiraDialogOpen: boolean;
  readonly error: string | null;
  readonly pendingAction: string | null;
  readonly setError: (message: string | null) => void;
  readonly beginJiraAuthFlow: () => Promise<void>;
  readonly openJiraDialog: () => void;
  readonly handleJiraDialogOpenChange: (open: boolean) => void;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
  readonly jiraBindings: ReturnType<typeof useWorkbenchJiraBindings>;
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
          <Skeleton key={index} className="h-full min-h-72 rounded-xl" />
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

function WorkbenchWorkspaceStateBadges({
  readOnly,
  jiraBinding,
}: {
  readOnly: boolean;
  jiraBinding: ReturnType<typeof useWorkbenchBoardData>["jiraBinding"];
}) {
  return (
    <>
      {readOnly ? <Badge variant="outline">Archived Workspace</Badge> : null}
      {jiraBinding && !jiraBinding.active ? <Badge variant="outline">Jira paused</Badge> : null}
    </>
  );
}

function WorkbenchBoardHeader(
  props: Pick<
    WorkbenchPageViewProps,
    | "boardData"
    | "dialogs"
    | "jiraBindings"
    | "openJiraDialog"
    | "workspaceActions"
    | "pageData"
    | "selection"
    | "setError"
    | "pendingAction"
  >,
) {
  const {
    pageData,
    selection,
    jiraBindings,
    dialogs,
    boardData,
    setError,
    openJiraDialog,
    workspaceActions,
    pendingAction,
  } = props;
  const { keybindings, availableEditors } = pageData;
  const { selectedProject } = selection;
  const { jiraPendingAction, syncJiraBinding } = jiraBindings;
  const { setEditWorkspaceOpen, openTicketDialog, openEpicDialog } = dialogs;
  const {
    projectTickets,
    linkedT3Projects,
    jiraBinding,
    jiraSprintLinks,
    showJiraImportedOnly,
    boardTickets,
  } = boardData;

  if (selectedProject === null) return null;
  const readOnly = selectedProject.archivedAt != null;
  const lifecyclePending = pendingAction !== null || jiraPendingAction !== null;
  const mutationDisabled = readOnly || lifecyclePending;
  const ticketCountLabel = showJiraImportedOnly
    ? `${boardTickets.length} imported tickets`
    : `${projectTickets.length} tickets`;
  return (
    <WorkspacePageHeader
      electron={isElectron}
      className="h-auto! min-h-20! max-h-none! items-start border-b border-border py-3"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 basis-full flex-col gap-1 sm:basis-auto sm:flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="max-w-full min-w-0 truncate text-xl font-semibold">
              {selectedProject.title}
            </h2>
            <span className="shrink-0 text-xs text-muted-foreground">{ticketCountLabel}</span>
            <WorkbenchWorkspaceStateBadges readOnly={readOnly} jiraBinding={jiraBinding} />
          </div>
          {jiraBinding ? (
            <WorkbenchJiraBoardContext binding={jiraBinding} pendingAction={jiraPendingAction} />
          ) : null}
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
            onClick={() => openTicketDialog()}
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
            <MenuPopup align="end" data-workbench-workspace-actions="">
              <MenuGroup>
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
              {jiraBinding ? (
                <>
                  <MenuGroup>
                    <MenuGroupLabel>
                      {jiraBinding.boardName}
                      {!jiraBinding.active ? " · Paused" : ""}
                    </MenuGroupLabel>
                    <MenuItem disabled={mutationDisabled} onClick={openJiraDialog}>
                      <Settings2Icon /> Configure Jira sprint mirror
                    </MenuItem>
                    <MenuItem
                      disabled={mutationDisabled || !jiraBinding.active}
                      onClick={() => void syncJiraBinding(jiraBinding)}
                    >
                      <RefreshCwIcon />{" "}
                      {jiraPendingAction === "sync" ? "Syncing Jira…" : "Sync Jira"}
                    </MenuItem>
                  </MenuGroup>
                  {jiraSprintLinks.length > 0 ? (
                    <MenuGroup>
                      <MenuGroupLabel>Jira sprints</MenuGroupLabel>
                      {jiraSprintLinks.map((sprint) => (
                        <MenuItem
                          key={sprint.id}
                          render={<a href={sprint.url} target="_blank" rel="noopener noreferrer" />}
                        >
                          <LinkIcon /> {sprint.name}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                  ) : null}
                </>
              ) : (
                <MenuGroup>
                  <MenuItem disabled={mutationDisabled} onClick={openJiraDialog}>
                    <LinkIcon /> Connect Jira
                  </MenuItem>
                </MenuGroup>
              )}
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

function WorkbenchJiraBoardContext({
  binding,
  pendingAction,
}: {
  binding: NonNullable<ReturnType<typeof useWorkbenchBoardData>["jiraBinding"]>;
  pendingAction: ReturnType<typeof useWorkbenchJiraBindings>["jiraPendingAction"];
}) {
  const sprints = getWorkbenchJiraBindingSprints(binding);
  const sprintScope = binding.followActiveSprint ? "Following active" : "Selected";
  return (
    <div
      aria-label="Jira sync context"
      className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
        Jira board: {binding.boardName}
      </span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
        {sprintScope} sprint{sprints.length === 1 ? "" : "s"}:{" "}
        {sprints.map((sprint) => sprint.name).join(", ")}
      </span>
      <span aria-label="Jira sync status" className="break-words">
        {jiraBindingStatusLabel(binding, pendingAction)}
      </span>
    </div>
  );
}

function WorkbenchJiraSyncNotice(
  props: Pick<WorkbenchPageViewProps, "boardData" | "environmentId" | "jiraBindings" | "selection">,
) {
  const { selection, jiraBindings, boardData, environmentId } = props;

  const {
    setSelectedTicketId,
    setSelectedEpicId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    selectedProject,
    updateRouteSelection,
  } = selection;
  const { setJiraSyncNotice, syncJiraBinding } = jiraBindings;

  const { jiraBinding, activeJiraSyncNotice, setJiraBoardFilter } = boardData;

  if (environmentId === null) return null;
  return (
    <>
      {activeJiraSyncNotice ? (
        <div
          className={`mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-lg border p-3 text-sm sm:mx-4 ${
            activeJiraSyncNotice.state === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive-foreground"
              : "border-border bg-muted/25 text-foreground"
          }`}
          role="status"
          aria-live="polite"
        >
          <RefreshCwIcon
            className={`size-4 shrink-0 ${
              activeJiraSyncNotice.state === "syncing" ? "animate-spin" : ""
            }`}
          />
          <span className="min-w-0 flex-1">{activeJiraSyncNotice.message}</span>
          {activeJiraSyncNotice.state === "error" &&
          jiraBinding?.active &&
          selectedProject?.archivedAt == null ? (
            <Button onClick={() => void syncJiraBinding(jiraBinding)} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : activeJiraSyncNotice.state === "success" ? (
            <Button
              onClick={() => {
                setJiraSyncNotice(null);
                if (!selectedProject) return;
                setAwaitingTicketId(null);
                setAwaitingEpicId(null);
                setSelectedEpicId(null);
                setSelectedTicketId(null);
                setJiraBoardFilter({ environmentId, projectId: selectedProject.id });
                void updateRouteSelection(selectedProject.id);
              }}
              size="xs"
              variant="outline"
            >
              View imported tickets
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function WorkbenchBoardErrors(
  props: Pick<WorkbenchPageViewProps, "error" | "jiraBindings" | "pageData">,
) {
  const { pageData, jiraBindings, error } = props;
  const { query, archivedThreadsError, refreshArchivedThreads } = pageData;

  const { jiraError } = jiraBindings;

  return (
    <>
      {query.error || error || archivedThreadsError || jiraError ? (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground sm:mx-4">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {error ?? query.error ?? archivedThreadsError ?? jiraError}
          </span>
          {query.error ? (
            <Button onClick={query.refresh} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : archivedThreadsError ? (
            <Button onClick={refreshArchivedThreads} size="xs" variant="outline">
              <RefreshCwIcon /> Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function WorkbenchBoardToolbar(props: Pick<WorkbenchPageViewProps, "boardData">) {
  const { boardData } = props;

  const {
    jiraIssueLinksByTicketId,
    projectTickets,
    showJiraImportedOnly,
    boardEpics,
    boardGroupModeForView,
    setBoardGroupMode,
    setJiraBoardFilter,
  } = boardData;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showJiraImportedOnly ? (
        <Button
          aria-label="Show all Workbench tickets"
          onClick={() => setJiraBoardFilter(null)}
          size="xs"
          variant="outline"
        >
          Show all tickets
        </Button>
      ) : null}
      {projectTickets.some((ticket) => jiraIssueLinksByTicketId.get(ticket.id)?.issue.flagged) ? (
        <Badge className="ml-1" variant="warning">
          <AlertCircleIcon />
          {
            projectTickets.filter(
              (ticket) => jiraIssueLinksByTicketId.get(ticket.id)?.issue.flagged,
            ).length
          }{" "}
          Jira flagged
        </Badge>
      ) : null}
      {boardEpics.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">Group</span>
          <ToggleGroup
            aria-label="Group Board tickets"
            size="sm"
            value={[boardGroupModeForView]}
            variant="segmented"
            onValueChange={(value) => {
              const nextMode = value[0];
              if (nextMode === "none" || nextMode === "epic") {
                setBoardGroupMode(nextMode);
              }
            }}
          >
            <Toggle value="none">None</Toggle>
            <Toggle value="epic">Epic</Toggle>
          </ToggleGroup>
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
  | "jiraBindings"
  | "pageData"
  | "pendingAction"
  | "selection"
  | "setError"
  | "threadActions"
  | "ticketActions"
>;

function getWorkbenchPageTicketState({
  props: { pageData, ticketActions, jiraBindings, pendingAction, error },
  ticketId,
}: {
  props: WorkbenchPageTicketDetailProps;
  ticketId: WorkbenchTicketId;
}) {
  return {
    ticketWorkspace: pageData.snapshot?.ticketWorkspaces.find(
      (workspace) => workspace.ticketId === ticketId,
    ),
    pending: pendingAction !== null || pageData.optimisticStatus.pendingTicketIds.has(ticketId),
    threadActionPending: isWorkbenchPageTicketThreadPending({
      assignmentsByTicket: pageData.assignmentsByTicket,
      pendingAction,
      ticketId,
    }),
    threadActionLabel: getWorkbenchTicketStartProgressLabel(pendingAction, ticketId),
    error: error ?? pageData.query.error ?? pageData.archivedThreadsError ?? jiraBindings.jiraError,
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

function getWorkbenchPageTicketJiraProps({
  props: { boardData, jiraBindings, pageData, pendingAction, ticketActions, selection },
  ticket,
}: {
  props: WorkbenchPageTicketDetailProps;
  ticket: WorkbenchTicket;
}) {
  const { jiraIssueLinksByTicketId, jiraManagedTicketIds, jiraOwnershipKnown, jiraBinding } =
    boardData;
  const { jiraPendingAction, syncJiraBinding } = jiraBindings;
  const jiraFieldsManaged = jiraManagedTicketIds.has(ticket.id);
  return {
    jiraIssueLink: jiraIssueLinksByTicketId.get(ticket.id) ?? null,
    jiraFieldsManaged,
    jiraOwnershipKnown,
    jiraPublicationAction: (
      <WorkbenchPageTicketPublicationAction
        ticket={ticket}
        binding={jiraBinding}
        ownershipKnown={jiraOwnershipKnown}
        jiraFieldsManaged={jiraFieldsManaged}
        pending={pendingAction !== null || selection.selectedProject?.archivedAt != null}
        editing={pageData.ticketDrafts.get(ticket.id)?.mode === "editing"}
        onPublish={ticketActions.openPublication}
      />
    ),
    jiraRefreshing: jiraPendingAction === "sync",
    jiraRefreshDisabled:
      jiraPendingAction !== null ||
      !jiraBinding?.active ||
      selection.selectedProject?.archivedAt != null,
    onRefreshJira: jiraBinding ? () => void syncJiraBinding(jiraBinding) : null,
    lifecycleActionsEnabled:
      jiraOwnershipKnown && !jiraFieldsManaged && selection.selectedProject?.archivedAt == null,
  };
}

function WorkbenchPageTicketPublicationAction({
  ticket,
  binding,
  ownershipKnown,
  jiraFieldsManaged,
  pending,
  editing,
  onPublish,
}: {
  ticket: WorkbenchTicket;
  binding: WorkbenchPageViewProps["boardData"]["jiraBinding"];
  ownershipKnown: boolean;
  jiraFieldsManaged: boolean;
  pending: boolean;
  editing: boolean;
  onPublish: WorkbenchPageViewProps["ticketActions"]["openPublication"];
}) {
  if (!binding || !ownershipKnown || jiraFieldsManaged) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending || !binding.active || ticket.archivedAt != null || editing}
      onClick={() => onPublish(ticket)}
      title={
        binding.active
          ? "Create a Jira issue for this local Ticket"
          : "Resume Jira sync before publishing"
      }
    >
      <WorkbenchJiraIcon /> Publish to Jira…
    </Button>
  );
}

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
  const {
    changeTicket,
    changeJiraTransition,
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
  return (
    <WorkbenchTicketDetail
      key={selectedTicket.id}
      environmentId={environmentId}
      workspaceTitle={selectedProject.title}
      workspaceReadOnly={selectedProject.archivedAt != null}
      ticket={selectedTicket}
      {...getWorkbenchPageTicketState({ props, ticketId: selectedTicket.id })}
      {...getWorkbenchPageTicketJiraProps({ props, ticket: selectedTicket })}
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
      onJiraTransition={(selection) => {
        void changeJiraTransition(selection);
      }}
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
      onNewThread={requestNewThread}
      onAttachThread={(ticket) => {
        setError(null);
        setAttachThreadTicket(ticket);
      }}
      onUnlinkThread={(threadId) => {
        void unlinkThread(threadId);
      }}
      onDeleteThread={(threadId) => {
        void deleteAssignedThread(threadId);
      }}
      onReplaceThread={(ticket, previousThreadId) => {
        requestReplacementThread({ ticket, previousThreadId });
      }}
      onArchive={setTicketArchived}
      onDelete={removeTicket}
      onResetWorkspace={resetTicketWorkspace}
    />
  );
}

function WorkbenchPageEpicDetail(
  props: Pick<
    WorkbenchPageViewProps,
    "boardData" | "dialogs" | "error" | "pageData" | "pendingAction" | "selection" | "setError"
  >,
) {
  const { pageData, selection, dialogs, boardData, error, pendingAction, setError } = props;
  const { repositoriesById, query, jiraSnapshot, assignmentsByTicket } = pageData;
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

  const { saveEpicContent, openTicketDialog } = dialogs;
  const { jiraIssueLinksByTicketId, selectedEpicTickets, jiraBinding, selectedJiraEpicUrl } =
    boardData;

  const pending = pendingAction !== null;
  if (selectedProject === null || selectedEpic === null) return null;
  return (
    <WorkbenchEpicDetail
      key={selectedEpic.id}
      workspaceTitle={selectedProject.title}
      readOnly={selectedProject.archivedAt != null}
      epic={selectedEpic}
      jiraUrl={selectedJiraEpicUrl}
      jiraManaged={
        jiraBinding !== null &&
        isWorkbenchJiraEpic({
          epicId: selectedEpic.id,
          bindingId: jiraBinding.id,
          epicLinks: jiraSnapshot?.epicLinks,
        })
      }
      tickets={selectedEpicTickets}
      repositoriesById={repositoriesById}
      assignmentsByTicket={assignmentsByTicket}
      jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
      jiraOwnershipKnown={boardData.jiraOwnershipKnown}
      pending={pending}
      error={error ?? query.error}
      onBack={() => {
        setError(null);
        closeWorkItem();
      }}
      onSave={saveEpicContent}
      onOpenTicket={(ticket) => {
        setAwaitingTicketId(null);
        setAwaitingEpicId(null);
        setSelectedEpicId(null);
        setSelectedTicketId(ticket.id);
        void updateRouteSelection(selectedProject.id, ticket.id);
      }}
      onCreateTicket={() => openTicketDialog(selectedEpic.id)}
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
    | "jiraBindings"
    | "openJiraDialog"
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

  const { openTicketDialog } = dialogs;
  const {
    jiraIssueLinksByTicketId,
    jiraBinding,
    activeJiraTicketIds,
    boardTickets,
    boardEpics,
    boardGroupModeForView,
    repositoriesReady,
  } = boardData;
  const { changeTicket, changeJiraTransition, ticketForBoardAction, regenerateSummary } =
    ticketActions;
  const { requestTicketThread } = threadActions;
  const pending = pendingAction !== null;
  if (environmentId === null || selectedProject === null) return null;
  return (
    <>
      <WorkbenchBoardHeader {...props} />

      <WorkbenchJiraSyncNotice {...props} />

      <WorkbenchBoardErrors {...props} />

      <div className="flex min-h-0 flex-1 flex-col">
        {jiraBinding?.lastSyncError ? (
          <p
            role="status"
            className="border-b border-border px-4 py-2 text-sm text-warning-foreground"
          >
            {jiraBinding.lastSyncError}
          </p>
        ) : null}
        <WorkbenchTicketBoard
          environmentId={environmentId}
          readOnly={selectedProject.archivedAt != null}
          onJiraTransition={(selection) => {
            void changeJiraTransition(selection);
          }}
          key={`${selectedProject.id}:${jiraBinding?.boardMode ?? "mapped"}`}
          mirrorColumns={jiraBinding?.boardMode === "mirror_jira" ? jiraBinding.boardColumns : null}
          jiraConnected={jiraBinding !== null}
          jiraOwnershipKnown={boardData.jiraOwnershipKnown}
          {...(jiraBinding && boardData.jiraOwnershipKnown
            ? { onPublishToJira: ticketActions.openPublication }
            : {})}
          jiraPublishDisabled={!jiraBinding?.active || selectedProject.archivedAt != null}
          jiraStatusMappings={jiraBinding?.statusMappings ?? []}
          projectId={selectedProject.id}
          tickets={boardTickets}
          epics={boardEpics}
          groupMode={boardGroupModeForView}
          viewControls={<WorkbenchBoardToolbar boardData={boardData} />}
          jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
          activeJiraTicketIds={activeJiraTicketIds}
          selectedTicketId={null}
          repositoriesById={repositoriesById}
          repositoryProjectIds={selectedProject.linkedProjectIds}
          repositoriesReady={repositoriesReady}
          assignmentsByTicket={assignmentsByTicket}
          assignments={snapshot?.assignments ?? []}
          threadsById={threadsById}
          archivedThreadsById={archivedThreadsById}
          threadLookupReady={threadLookupReady}
          pending={pending}
          pendingAction={pendingAction}
          pendingTicketIds={optimisticStatus.pendingTicketIds}
          onSelect={(projectId, ticketId) => {
            setAwaitingTicketId(null);
            setAwaitingEpicId(null);
            setSelectedEpicId(null);
            setSelectedTicketId(ticketId);
            void updateRouteSelection(projectId, ticketId);
          }}
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
          onCreateTicket={() => openTicketDialog()}
        />
      </div>
    </>
  );
}

function WorkbenchPageWorkspace(
  props: Pick<
    WorkbenchPageViewProps,
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "jiraBindings"
    | "openJiraDialog"
    | "workspaceActions"
    | "pageData"
    | "pendingAction"
    | "selection"
    | "setError"
    | "threadActions"
    | "ticketActions"
  >,
) {
  const { pageData, selection, jiraBindings, boardData, environmentId, pendingAction } = props;
  const { optimisticStatus } = pageData;
  const { selectedEpic, selectedTicket } = selection;
  const { jiraPendingAction } = jiraBindings;

  const { projectJiraIssueLinks } = boardData;

  const pending = pendingAction !== null;
  if (environmentId === null) return null;
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {selection.selectedProject && selection.selectedProject.archivedAt != null ? (
        <div
          role="status"
          className="border-b border-border px-4 py-3 text-sm text-muted-foreground"
        >
          This Workspace is archived. Planning is read-only and Jira sync is paused. Linked Threads
          remain available.
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
      <WorkbenchJiraTransitionsPreloader
        environmentId={environmentId}
        issueLinks={projectJiraIssueLinks}
        paused={
          selection.selectedProject?.archivedAt != null ||
          pending ||
          optimisticStatus.pendingTicketIds.size > 0 ||
          jiraPendingAction !== null
        }
      />
      {selectedTicket ? (
        <WorkbenchPageTicketDetail {...props} />
      ) : selectedEpic ? (
        <WorkbenchPageEpicDetail {...props} />
      ) : (
        <WorkbenchPageBoard {...props} />
      )}
    </main>
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
          error={error ?? query.error}
          onOpenChange={setEditWorkspaceOpen}
          onSave={saveWorkspace}
        />
      ) : null}
    </>
  );
}

function WorkbenchPageJiraDialog(
  props: Pick<
    WorkbenchPageViewProps,
    | "beginJiraAuthFlow"
    | "boardData"
    | "handleJiraDialogOpenChange"
    | "jiraBindings"
    | "jiraDialogOpen"
    | "pageData"
    | "selection"
  >,
) {
  const {
    pageData,
    selection,
    jiraBindings,
    boardData,
    jiraDialogOpen,
    beginJiraAuthFlow,
    handleJiraDialogOpenChange,
  } = props;
  const { jiraQuery, jiraSnapshot } = pageData;
  const { selectedProject } = selection;
  const {
    jiraError,
    jiraPendingAction,
    listJiraProjectsForConnection,
    listJiraBoardsForProject,
    listJiraSprintsForBoard,
    getJiraBoardConfiguration,
    createJiraBindingForWorkspace,
    updateJiraBindingForWorkspace,
    setJiraBindingActive,
  } = jiraBindings;

  const {
    linkedT3Projects,
    jiraBinding,
    localTicketsForJiraMigration,
    localEpicsForJiraMigration,
  } = boardData;

  return (
    <>
      {selectedProject && selectedProject.archivedAt == null && jiraDialogOpen ? (
        <WorkbenchJiraDialog
          // Keep the dialog instance stable while a first migration is being
          // retried; its revision snapshot must not be replaced by a refresh.
          key={selectedProject.id}
          open={jiraDialogOpen}
          connections={jiraSnapshot?.connections ?? []}
          existingBinding={jiraBinding}
          linkedProjects={linkedT3Projects}
          localTickets={localTicketsForJiraMigration}
          localEpics={localEpicsForJiraMigration}
          pending={jiraPendingAction !== null || jiraQuery.isPending}
          error={jiraError ?? jiraQuery.error}
          onOpenChange={handleJiraDialogOpenChange}
          onBeginAuth={beginJiraAuthFlow}
          onListProjects={listJiraProjectsForConnection}
          onListBoards={listJiraBoardsForProject}
          onListSprints={listJiraSprintsForBoard}
          onGetBoardConfiguration={getJiraBoardConfiguration}
          onCreate={createJiraBindingForWorkspace}
          onUpdate={updateJiraBindingForWorkspace}
          onSetActive={setJiraBindingActive}
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
  const { repositoriesById, providers, snapshot, threadsById, reservedThreadIds } = pageData;

  const {
    startThreadRequest,
    setStartThreadRequest,
    attachThreadTicket,
    setAttachThreadTicket,
    attachExistingThread,
    startSelectedThread,
    editStartThreadRepositories,
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
            defaultModelSelection:
              repositoriesById.get(startThreadRequest.ticket.primaryT3ProjectId)
                ?.defaultModelSelection ?? null,
            additional: startThreadRequest.mode === "additional",
          }}
          onEditRepositories={editStartThreadRepositories}
          error={error}
          providers={providers}
          pending={pending}
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
    "boardData" | "dialogs" | "error" | "pageData" | "pendingAction" | "selection" | "ticketActions"
  >,
) {
  const { pageData, selection, dialogs, boardData, error, pendingAction, ticketActions } = props;
  const { query, jiraSnapshot } = pageData;
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
  const { linkedT3Projects, activeProjectEpics, jiraBinding } = boardData;

  const pending = pendingAction !== null;
  const publication = ticketActions.publication;
  if (selectedProject?.archivedAt != null) return null;
  return (
    <>
      {publication ? (
        <WorkbenchPublishTicketDialog
          key={publication.ticket.id}
          ticket={publication.ticket}
          binding={publication.binding}
          epics={activeProjectEpics.filter((epic) =>
            isWorkbenchJiraEpic({
              epicId: epic.id,
              bindingId: publication.binding.id,
              epicLinks: jiraSnapshot?.epicLinks,
            }),
          )}
          pending={pending}
          error={ticketActions.publicationError}
          onClose={ticketActions.closePublication}
          onPublish={ticketActions.publishTicket}
        />
      ) : null}
      {selectedProject ? (
        <WorkbenchEpicDialog
          open={epicDialogOpen}
          pending={pending}
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
          jiraEpics={
            jiraBinding
              ? activeProjectEpics.filter((epic) =>
                  isWorkbenchJiraEpic({
                    epicId: epic.id,
                    bindingId: jiraBinding.id,
                    epicLinks: jiraSnapshot?.epicLinks,
                  }),
                )
              : activeProjectEpics
          }
          initialEpicId={ticketDialogEpicId}
          jiraBinding={jiraBinding}
          localOnlySupported={jiraSnapshot?.supportsLocalOnlyTickets === true}
          jiraOwnershipKnown={boardData.jiraOwnershipKnown}
          pending={pending}
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
    | "boardData"
    | "dialogs"
    | "environmentId"
    | "error"
    | "jiraBindings"
    | "openJiraDialog"
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
  const { query, jiraQuery, snapshot, jiraSnapshot } = pageData;
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
  if (jiraSnapshot === null && jiraQuery.error) return <WorkbenchQueryError query={jiraQuery} />;
  if (jiraSnapshot === null) return <WorkbenchLoading />;
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
          <Button onClick={openWorkspaceDialog}>
            <PlusIcon /> Create Workspace
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function WorkbenchPageView(props: WorkbenchPageViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-workbench-page="">
      <WorkbenchPageContent {...props} />

      <WorkbenchPageWorkspaceDialogs {...props} />
      <WorkbenchPageJiraDialog {...props} />
      <WorkbenchPageThreadDialogs {...props} />
      <WorkbenchPageTicketDialogs {...props} />
    </div>
  );
}

function jiraBindingStatusLabel(
  binding: NonNullable<ReturnType<typeof useWorkbenchBoardData>["jiraBinding"]>,
  pendingAction: string | null,
) {
  if (pendingAction === "sync") return "Syncing with Jira…";
  if (binding.lastSyncError) return "Jira sync failed";
  return formatJiraSyncStatus(binding.lastSyncedAt);
}
