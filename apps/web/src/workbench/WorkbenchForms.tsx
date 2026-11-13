import { WorkbenchTicketProgress, WorkbenchTicketSharedContext } from "./WorkbenchTicketPlanning";
import { useWorkbenchTicketContent } from "./useWorkbenchTicketContent";
import {
  WorkbenchRepositoryScopeFields,
  WorkbenchTicketRepositoryStatus,
} from "./WorkbenchRepositoryScopeFields";
import {
  getWorkbenchRepositoryScope,
  isWorkbenchRepositoryScopeValid,
  type WorkbenchRepositoryScope,
  type WorkbenchRepositoryScopeDraft,
} from "./workbenchRepositoryScope";
import {
  WorkbenchTicketAttentionBadge,
  WorkbenchTicketAttentionPanel,
} from "./WorkbenchTicketAttention";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  type EditorId,
  ProjectId,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchCreateTicketInput,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchProject,
  type WorkbenchReference,
  type WorkbenchTicket,
  WorkbenchTicketId,
  type WorkbenchReferenceDraft,
  type WorkbenchTicketWorkspace,
  type WorkbenchTicketWorktree,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CheckIcon,
  FolderGit2Icon,
  LinkIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { WorkbenchTicketStatusMenu } from "./WorkbenchTicketStatusMenu";

import {
  WorkbenchThreadExecutionStatus,
  WorkbenchThreadExecutionStatusIcon,
} from "./WorkbenchThreadExecutionStatus";
import { WorkbenchThreadHoverPreview } from "./WorkbenchThreadHoverPreview";
import { WorkbenchThreadProviderIcon } from "./WorkbenchThreadProviderIcon";
import { useWorkbenchControlsHostRef } from "./WorkbenchPagePanel";
import {
  useWorkbenchFloatingChatStore,
  useWorkbenchThreadOpenLabel,
} from "./workbenchFloatingChatState";
import { readLocalApi } from "../localApi";
import { handleWorkbenchSidebarMenuKeyDown } from "./WorkbenchSidebarRowActions";
import {
  getWorkbenchThreadExecutionStatus,
  getWorkbenchTicketExecutionStatuses,
  hasWorkbenchUnreadReply,
  type WorkbenchThreadExecutionStatus as WorkbenchThreadExecutionStatusData,
} from "./workbenchThreadStatus.logic";
import { getWorkbenchThreadStatusSections, titleUnderHeading } from "./workbenchFloatingChat.logic";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { cn } from "../lib/utils";
import type { WorkbenchFloatingChatPlanning } from "./WorkbenchFloatingChat";
import {
  getWorkbenchFloatingChatInset,
  WorkbenchTicketFloatingChat,
} from "./WorkbenchTicketFloatingChat";
import { isElectron } from "../env";

import { Badge } from "../components/ui/badge";
import { shouldRecedeSidebarThread } from "../components/Sidebar.logic";
import { Alert, AlertAction, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { useWorkbenchThreadSettlement } from "./useWorkbenchThreadSettlement";
import { useUiStateStore } from "../uiStateStore";
import { randomUUID } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { Project } from "../types";
import { useWorkbenchRemoteRefs } from "./WorkbenchRemoteRefs";
import {
  formatWorkbenchRemoteRepositoryTitle,
  getWorkbenchAssignmentMachineLabel,
  getWorkbenchBoardLinkedOptionKeys,
  getWorkbenchBoardProjectSelection,
  getWorkbenchBoardProjectUnavailableReason,
  getWorkbenchBoardSelectionGap,
  workbenchBoardProjectOptionKey,
  type WorkbenchBoardProjectOption,
} from "./workbenchRemote.logic";
import {
  getWorkbenchThreadLookupState,
  getWorkbenchThreadPresentation,
  type WorkbenchThreadLookupState,
  getActiveAssignmentsByTicket,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  getWorkbenchTicketThreadSections,
  isWorkbenchHostAssignment,
  isWorkbenchThreadArchived,
  WORKBENCH_TICKET_STATUS_LABELS,
  WORKBENCH_TICKET_TEMPLATE,
} from "./workbench.logic";
import {
  isWorkbenchDraftProjected,
  useWorkbenchDraftStore,
  type WorkbenchTicketSavedVersion,
  type WorkbenchTicketDraft,
} from "./workbenchDraftStore";
import { WorkbenchTicketDescriptionEditor } from "./WorkbenchTicketDescriptionEditor";
import { WorkbenchBriefAskButton, WorkbenchBriefBody } from "./WorkbenchBriefReview";
import { WorkbenchWordDiff } from "./WorkbenchMarkdownReview";
import type { WordDiffSegment } from "./markdownReview";
import { WorkbenchReviewBar } from "./WorkbenchReviewBar";
import { useWorkbenchTicketBriefReview } from "./useWorkbenchBriefReview";
import { WorkbenchReferenceFileSheetProvider } from "./WorkbenchReferenceFileSheet";
import {
  useWorkbenchCheckoutStatusRefresh,
  WorkbenchCheckoutDirectory,
} from "./WorkbenchCheckoutDetails";
import {
  WorkbenchTicketCheckoutRows,
  useWorkbenchTicketWorktrees,
} from "./WorkbenchTicketWorktrees";
import { WorkbenchTicketCopyMenuItems } from "./WorkbenchTicketMetadata";
import {
  WorkbenchProvenanceBadge,
  WorkbenchReferenceBadge,
  WorkbenchStagedReferences,
  WorkbenchTicketReferencesPanel,
  workbenchProvenanceSource,
  type WorkbenchProvenanceSource,
} from "./WorkbenchReferences";
import {
  getReferenceFileCwd,
  getTicketIssue,
  listWorkbenchTicketReferences,
  splitWorkbenchReferences,
  workbenchDescriptionLinks,
} from "./workbenchReferences.logic";
import { WorkbenchTicketPullRequests } from "./WorkbenchTicketPullRequests";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import {
  getWorkbenchPullRequestOwnerToShow,
  getWorkbenchTicketPullRequests,
  getWorkbenchTicketPullRequestCheckouts,
  type WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";

const NO_TICKET_WORKTREES: ReadonlyArray<WorkbenchTicketWorktree> = [];

export function WorkbenchWorkspaceDialog({
  open,
  projects,
  otherMachineProjects = [],
  pending,
  disabled,
  error,
  onOpenChange,
  onSave,
  initialWorkspace,
}: {
  readonly open: boolean;
  /** Projects on the Board host. */
  readonly projects: ReadonlyArray<Project>;
  /** Projects on other connected machines, with each machine's native label. */
  readonly otherMachineProjects?: ReadonlyArray<{
    readonly project: Project;
    readonly environmentLabel: string;
  }>;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialWorkspace?: Pick<
    WorkbenchProject,
    "title" | "linkedProjectIds" | "remoteProjects"
  >;
  readonly onSave: (
    title: string,
    selection: ReturnType<typeof getWorkbenchBoardProjectSelection>,
  ) => Promise<boolean>;
}) {
  const options: ReadonlyArray<WorkbenchBoardProjectOption & { readonly workspaceRoot: string }> = [
    ...projects.map((project) => ({ project, environmentLabel: null })),
    ...otherMachineProjects,
  ].map(({ project, environmentLabel }) => ({
    id: project.id,
    environmentId: project.environmentId,
    title: project.title,
    environmentLabel,
    workspaceRoot: project.workspaceRoot,
  }));
  const [title, setTitle] = useState(initialWorkspace?.title ?? "");
  const initialKeys = getWorkbenchBoardLinkedOptionKeys(options, initialWorkspace);
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(new Set());
  const linkedKeys = new Set([...initialKeys, ...addedKeys]);
  const selection = getWorkbenchBoardProjectSelection(
    options.filter((option) => linkedKeys.has(workbenchBoardProjectOptionKey(option))),
  );
  const saveLabel = pending ? "Saving…" : "Save changes";
  const selectionGap = getWorkbenchBoardSelectionGap(selection, initialWorkspace === undefined);
  const cannotSave = disabled || pending || title.trim().length === 0 || selectionGap !== null;
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    onOpenChange(nextOpen);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cannotSave) return;
    void (async () => {
      if (!(await onSave(title.trim(), selection))) return;
      onOpenChange(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{initialWorkspace ? "Edit Board" : "Create Board"}</DialogTitle>
          <DialogDescription>
            {initialWorkspace
              ? "Rename this Board or add repositories. Existing Tickets and Threads keep their repository scope."
              : "Group related tickets around one or more existing T3 Projects."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="workbench-workspace" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="workbench-workspace-title">Board title</Label>
              <Input
                id="workbench-workspace-title"
                disabled={pending}
                autoFocus
                placeholder="Board title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <WorkbenchWorkspaceRepositories
              options={options}
              pending={pending}
              editing={initialWorkspace !== undefined}
              initialKeys={initialKeys}
              linkedKeys={linkedKeys}
              setAddedKeys={setAddedKeys}
              needsHostProject={selectionGap === "host-project"}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={pending} onClick={() => handleOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button form="workbench-workspace" disabled={cannotSave} type="submit">
            {initialWorkspace ? (
              saveLabel
            ) : (
              <>
                <PlusIcon /> Create Board
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export type WorkbenchCreateTicketDraft = Omit<
  WorkbenchCreateTicketInput,
  "projectId" | "createdAt"
>;

export function WorkbenchTicketDialog({
  open,
  linkedProjects,
  pending,
  disabled,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (draft: WorkbenchCreateTicketDraft) => Promise<boolean>;
}) {
  const {
    requestId,
    title,
    setTitle,
    markdown,
    setMarkdown,
    repositoryProjectIds,
    setRepositoryProjectIds,
    references,
    setReferences,
    handleOpenChange,
  } = useWorkbenchCreateTicketDraft({ pending, onOpenChange });
  const { selectedRepositoryProjectIds } = getWorkbenchCreateTicketRepositories({
    linkedProjects,
    repositoryProjectIds,
  });
  const createLabel = pending ? "Creating Ticket…" : "Create Ticket";
  const mutationDisabled = disabled || pending;
  const cannotCreate =
    mutationDisabled || title.trim().length === 0 || selectedRepositoryProjectIds.length === 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (cannotCreate) return;
    const created = await onCreate({
      id: requestId,
      title,
      markdown,
      repositoryProjectIds: selectedRepositoryProjectIds,
      ...(references.length > 0 ? { references } : {}),
    });
    if (created) handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Ticket</DialogTitle>
          <DialogDescription>
            Capture the work and choose the repositories it needs.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-ticket" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="workbench-ticket-title">Title</Label>
              <Input
                id="workbench-ticket-title"
                autoFocus
                placeholder="What needs doing?"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workbench-ticket-context">Brief</Label>
              <Textarea
                id="workbench-ticket-context"
                className="min-h-32"
                placeholder="Goal, constraints, and acceptance criteria…"
                value={markdown}
                onChange={(event) => setMarkdown(event.currentTarget.value)}
              />
            </div>
            <WorkbenchCreateTicketRepositories
              linkedProjects={linkedProjects}
              selectedRepositoryProjectIds={selectedRepositoryProjectIds}
              setRepositoryProjectIds={setRepositoryProjectIds}
            />
            <WorkbenchStagedReferences
              references={references}
              disabled={mutationDisabled}
              onChange={setReferences}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={pending} onClick={() => handleOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button
            form="create-workbench-ticket"
            aria-label={createLabel}
            aria-busy={pending}
            disabled={cannotCreate}
            type="submit"
          >
            {pending ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            <span role="status">{createLabel}</span>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export type WorkbenchTicketDetailProps = {
  readonly environmentId: EnvironmentId;
  readonly workspaceTitle: string;
  readonly workspaceReadOnly?: boolean;
  readonly threadMutationsDisabled?: boolean;
  readonly ticket: WorkbenchTicket;
  readonly references: ReadonlyArray<WorkbenchReference>;
  readonly ticketWorkspace: WorkbenchTicketWorkspace | undefined;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly preparationFailed: boolean;
  readonly preparationPending: boolean;
  readonly threadActionPending: boolean;
  readonly threadActionLabel?: string | null;
  readonly error: string | null;
  readonly onRetryError?: (() => void) | undefined;
  readonly onBack: () => void;
  readonly onSave: (
    ticket: WorkbenchTicket,
    title: string,
    markdown: string,
  ) => Promise<WorkbenchTicketSavedVersion | false>;
  readonly onRegenerateSummary: (ticket: WorkbenchTicket) => void;
  readonly onUpdate: (
    ticket: WorkbenchTicket,
    patch: Partial<
      Pick<WorkbenchTicket, "title" | "markdown" | "repositoryProjectIds" | "status" | "blocked">
    >,
  ) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  readonly onOpenAssignedThread: (threadId: ThreadId) => void;
  readonly onNewThread: (ticket: WorkbenchTicket) => void;
  readonly onAttachThread: (ticket: WorkbenchTicket) => void;
  readonly onUnlinkThread: (threadId: ThreadId) => void;
  readonly onDeleteThread: (threadId: ThreadId) => void;
  readonly onReplaceThread: (ticket: WorkbenchTicket, previousThreadId: ThreadId) => void;
  readonly onArchive: (ticket: WorkbenchTicket, archivedAt: string | null) => Promise<boolean>;
  readonly onDelete: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly repositoryScopeDraft: WorkbenchRepositoryScopeDraft | null;
  readonly onEditRepositories: ({
    ticket,
    prepare,
  }: {
    ticket: WorkbenchTicket;
    prepare: boolean;
  }) => void;
  readonly onRepositoryScopeChange: (value: WorkbenchRepositoryScope) => void;
  readonly onCancelRepositories: () => void;
  readonly onSaveRepositories: () => Promise<boolean>;
  readonly onResetWorkspace: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly lifecycleActionsEnabled: boolean;
  /** Shows the ticket's Threads in a floating chat. */
  readonly floatingChat?: boolean;
  /** Renders the planning Thread, which still offers Start work, in the floating chat. */
  readonly floatingChatPlanning?: WorkbenchFloatingChatPlanning | undefined;
};
export function WorkbenchTicketDetail(props: WorkbenchTicketDetailProps) {
  const content = useWorkbenchTicketContent(props.environmentId, props.ticket);
  if (content.ticket === null) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div>
          <Button variant="ghost" onClick={props.onBack}>
            <ArrowLeftIcon /> Back
          </Button>
        </div>
        <p role={content.error ? "alert" : "status"}>{content.error ?? "Loading Ticket…"}</p>
        {content.error ? (
          <div>
            <Button variant="outline" onClick={content.refresh}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return <WorkbenchLoadedTicketDetail {...props} ticket={content.ticket} />;
}

function WorkbenchLoadedTicketDetail(props: WorkbenchTicketDetailProps) {
  return (
    <WorkbenchTicketDetailController
      context={{
        environmentId: props.environmentId,
        keybindings: props.keybindings,
        availableEditors: props.availableEditors,
        threadsById: props.threadsById,
        archivedThreadsById: props.archivedThreadsById,
        threadLookupReady: props.threadLookupReady,
      }}
      content={{
        workspaceTitle: props.workspaceTitle,
        workspaceReadOnly: props.workspaceReadOnly ?? false,
        threadMutationsDisabled: props.threadMutationsDisabled ?? false,
        ticket: props.ticket,
        references: props.references,
        pending: props.pending,
        error: props.error,
        onRetryError: props.onRetryError,
        lifecycleActionsEnabled: props.lifecycleActionsEnabled,
        floatingChat: props.floatingChat ?? false,
        floatingChatPlanning: props.floatingChatPlanning,
      }}
      workspace={{
        ticketWorkspace: props.ticketWorkspace,
        linkedProjects: props.linkedProjects,
        preparationFailed: props.preparationFailed,
        preparationPending: props.preparationPending,
        repositoryScopeDraft: props.repositoryScopeDraft,
      }}
      actions={{
        onBack: props.onBack,
        onSave: props.onSave,
        onRegenerateSummary: props.onRegenerateSummary,
        onUpdate: props.onUpdate,
        onOpenThread: props.onOpenThread,
        onOpenAssignedThread: props.onOpenAssignedThread,
        onNewThread: props.onNewThread,
        onAttachThread: props.onAttachThread,
        onUnlinkThread: props.onUnlinkThread,
        onDeleteThread: props.onDeleteThread,
        onReplaceThread: props.onReplaceThread,
        onArchive: props.onArchive,
        onDelete: props.onDelete,
        onEditRepositories: props.onEditRepositories,
        onRepositoryScopeChange: props.onRepositoryScopeChange,
        onCancelRepositories: props.onCancelRepositories,
        onSaveRepositories: props.onSaveRepositories,
        onResetWorkspace: props.onResetWorkspace,
      }}
      threads={{
        assignments: props.assignments,
        threadActionPending: props.threadActionPending,
        ...(props.threadActionLabel === undefined
          ? {}
          : { threadActionLabel: props.threadActionLabel }),
      }}
    />
  );
}
const focusWorkbenchTicketPane = (pane: HTMLElement | null) => {
  if (!pane) return;
  pane.scrollIntoView({ block: "start" });
  // The pane's scroll viewport is its tab stop, so arrow keys scroll the pane.
  pane
    .querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    ?.focus({ preventScroll: true });
};

function WorkbenchTicketDetailController({
  context,
  content,
  workspace,
  actions,
  threads,
}: {
  context: Pick<
    WorkbenchTicketDetailProps,
    | "environmentId"
    | "keybindings"
    | "availableEditors"
    | "threadsById"
    | "archivedThreadsById"
    | "threadLookupReady"
  >;
  content: Pick<
    WorkbenchTicketDetailProps,
    | "workspaceTitle"
    | "workspaceReadOnly"
    | "threadMutationsDisabled"
    | "ticket"
    | "references"
    | "pending"
    | "error"
    | "onRetryError"
    | "lifecycleActionsEnabled"
    | "floatingChat"
    | "floatingChatPlanning"
  >;
  workspace: Pick<
    WorkbenchTicketDetailProps,
    | "ticketWorkspace"
    | "linkedProjects"
    | "preparationFailed"
    | "preparationPending"
    | "repositoryScopeDraft"
  >;
  actions: Pick<
    WorkbenchTicketDetailProps,
    | "onBack"
    | "onSave"
    | "onRegenerateSummary"
    | "onUpdate"
    | "onOpenThread"
    | "onOpenAssignedThread"
    | "onNewThread"
    | "onAttachThread"
    | "onUnlinkThread"
    | "onDeleteThread"
    | "onReplaceThread"
    | "onArchive"
    | "onDelete"
    | "onEditRepositories"
    | "onRepositoryScopeChange"
    | "onCancelRepositories"
    | "onSaveRepositories"
    | "onResetWorkspace"
  >;
  threads: Pick<
    WorkbenchTicketDetailProps,
    "assignments" | "threadActionPending" | "threadActionLabel"
  >;
}) {
  const {
    environmentId,
    keybindings,
    availableEditors,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
  } = context;
  const { environmentStates: remoteEnvironmentStates, repositories: remoteRepositories } =
    useWorkbenchRemoteRefs();
  const {
    workspaceTitle,
    ticket,
    references,
    pending,
    error,
    onRetryError,
    lifecycleActionsEnabled,
    workspaceReadOnly = false,
    threadMutationsDisabled = false,
    floatingChat = false,
    floatingChatPlanning,
  } = content;
  const {
    ticketWorkspace,
    linkedProjects,
    preparationFailed,
    preparationPending,
    repositoryScopeDraft,
  } = workspace;
  const {
    onBack,
    onSave,
    onRegenerateSummary,
    onUpdate,
    onOpenThread,
    onOpenAssignedThread,
    onNewThread,
    onAttachThread,
    onUnlinkThread,
    onDeleteThread,
    onReplaceThread,
    onArchive,
    onDelete,
    onEditRepositories,
    onRepositoryScopeChange,
    onCancelRepositories,
    onSaveRepositories,
    onResetWorkspace,
  } = actions;
  const { assignments, threadActionPending, threadActionLabel } = threads;
  const { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement } =
    useWorkbenchThreadSettlement(environmentId);
  const {
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    resetConfirmationOpen,
    setResetConfirmationOpen,
    threadPanelCollapsed,
    setThreadPanelCollapsed,
    repositoryScopePanelCollapsed,
    setRepositoryScopePanelCollapsed,
    advancedWorkspaceSettingsCollapsed,
    setAdvancedWorkspaceSettingsCollapsed,
  } = useWorkbenchTicketDetailPanels();
  const {
    activeAssignments,
    historicalAssignments,
    settledAssignments,
    associatedPullRequests,
    assignment,
    chatAssignments,
  } = getWorkbenchDetailAssignments({
    assignments,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
    remoteEnvironmentStates,
    ticket,
  });
  const {
    nativeThread,
    archivedThread,
    displayedThread,
    nativeStatus,

    thread,
  } = getWorkbenchDetailThread({
    assignment,
    threadsById,
    archivedThreadsById,
    ticket,
    threadLookupReady,
    remoteEnvironmentStates,
  });
  const {
    draft,
    setDraft,
    markDraftSaved,
    isArchived,
    editing,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    summaryFailedEmpty,
    hasUnsavedChanges,
    cancelEditing,
    startEditing,
  } = useWorkbenchTicketDraftEditor({
    environmentId,
    ticket,
    workspaceReadOnly: workspaceReadOnly ?? false,
  });
  const agentTitle = getWorkbenchAgentTitle({
    displayedThread,
    assignment,
    threadState: thread.state,
    settledCount: settledAssignments.length,
  });
  const {
    repositoryScopeLocked,
    workspaceHasSelectedRepositories,
    workspaceIsReady,
    workspaceIsPreparing,
    workspaceStatusLabel,
    workspacePreparationActionLabel,
    repositories,
    retainedRepositories,
  } = getWorkbenchDetailWorkspace({
    ticket,
    ticketWorkspace,
    preparationPending,
    preparationFailed,
    linkedProjects,
    remoteRepositoryIds: new Set(remoteRepositories.keys()),
  });
  useWorkbenchCheckoutStatusRefresh({
    environmentId,
    cwds: [
      ...repositories.map((repository) => repository.openInCwd),
      ...retainedRepositories.map((repository) => repository.openInCwd),
    ],
  });
  const floatingChatInset = getWorkbenchFloatingChatInset(floatingChat);
  const briefReview = useWorkbenchTicketBriefReview({
    environmentId,
    ticket,
    localEdit: draft !== undefined,
    archived: isArchived,
  });
  const descriptionLinks = workbenchDescriptionLinks(displayedMarkdown);
  // Thread links on the Ticket show the Thread in its floating chat, which offers the full page.
  const showThreadInChat = (threadId: ThreadId) => {
    const { pageChat } = useWorkbenchFloatingChatStore.getState();
    const inChat =
      floatingChat &&
      pageChat?.kind === "ticket" &&
      pageChat.ticketId === ticket.id &&
      threadsById.has(threadId) &&
      [...chatAssignments.active, ...chatAssignments.settled].some(
        (entry) => entry.threadId === threadId,
      );
    if (inChat) pageChat.showThread(threadId);
    return inChat;
  };
  const openAssignedThread = (threadId: ThreadId) => {
    if (!showThreadInChat(threadId)) onOpenAssignedThread(threadId);
  };
  // A PR opens in the shown Thread's panel, so another Thread's PR shows that Thread first.
  const showPullRequestOwner = (row: WorkbenchTicketPullRequest) => {
    const { shownThread } = useWorkbenchFloatingChatStore.getState();
    const ownerId = getWorkbenchPullRequestOwnerToShow({
      row,
      shownThread:
        shownThread?.environmentId === environmentId
          ? (threadsById.get(shownThread.threadId) ?? null)
          : null,
    });
    return ownerId !== null && showThreadInChat(ownerId);
  };
  const openThread = (target: WorkbenchTicket, threadId?: ThreadId) => {
    if (threadId === undefined || !showThreadInChat(threadId)) onOpenThread(target, threadId);
  };
  const executionStatus =
    getWorkbenchTicketExecutionStatuses({ environmentId, assignments, threadsById }).get(
      ticket.id,
    ) ?? null;
  const canOpenThread = workspaceReadOnly
    ? assignment !== undefined && displayedThread !== undefined
    : !isArchived || assignment !== undefined;

  return (
    <article className="@container/ticket relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&_[data-slot=button]>svg]:mx-0">
      <WorkbenchTicketHeader
        actions={{
          onBack: onBack,
          onUpdate: onUpdate,
          onArchive: onArchive,
          setDeleteConfirmationOpen: setDeleteConfirmationOpen,
        }}
        presentation={{
          workspaceTitle: workspaceTitle,
          displayedTitle: displayedTitle,
          isArchived: isArchived,
          pending: isWorkbenchThreadOpenDisabled({
            pending,
            threadMutationsDisabled,
            thread: displayedThread,
          }),
          editing: editing,
          lifecycleActionsEnabled: lifecycleActionsEnabled,
          executionStatus,
          titleWords: briefReview.shownTitleWords,
        }}
        records={{
          ticket: ticket,
          issue: getTicketIssue(references),
          actionableTicket: actionableTicket,
        }}
        context={{ environmentId: environmentId }}
      />

      <nav
        aria-label="Ticket sections"
        className="flex shrink-0 items-center gap-1 border-b border-border/60 px-4 py-1 @min-[64rem]/ticket:hidden"
      >
        <Button
          aria-controls="workbench-ticket-work"
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => focusWorkbenchTicketPane(document.getElementById("workbench-ticket-work"))}
        >
          Work
        </Button>
        <Button
          aria-controls="workbench-ticket-reading"
          size="xs"
          type="button"
          variant="ghost"
          onClick={() =>
            focusWorkbenchTicketPane(document.getElementById("workbench-ticket-reading"))
          }
        >
          Brief
        </Button>
      </nav>

      <form
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-gutter-both p-4 @min-[64rem]/ticket:overflow-hidden @min-[64rem]/ticket:scrollbar-gutter-auto @min-[64rem]/ticket:pe-2 [&_[data-slot=button]>svg]:mx-0",
          floatingChatInset.form,
        )}
        onSubmit={(event) => {
          event.preventDefault();
          if (!editing || !draft || workspaceReadOnly) return;
          const normalizedTitle = draft.title.trim();
          const normalizedMarkdown = draft.markdown.trim();
          const submittedContent = draft;
          void (async () => {
            const savedVersion = await onSave(ticket, normalizedTitle, normalizedMarkdown);
            if (savedVersion === false) return;
            markDraftSaved(
              environmentId,
              ticket.id,
              {
                title: normalizedTitle,
                markdown: normalizedMarkdown,
                ...savedVersion,
              },
              submittedContent,
            );
          })();
        }}
      >
        {/* Cards sit 1rem apart both ways: side by side, the column gap plus the reading
            column's scrollbar padding (pr-2) make the same 1rem. */}
        <div className="mx-auto grid min-h-0 min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)] items-start gap-4 @min-[64rem]/ticket:h-full @min-[64rem]/ticket:grid-cols-[minmax(0,1fr)_22rem] @min-[64rem]/ticket:items-stretch @min-[64rem]/ticket:gap-2">
          {/* Side by side, each column scrolls on its own; ScrollArea's overlay scrollbar
              takes no width and shows only while the pointer is over the column or it scrolls. */}
          <ScrollArea
            id="workbench-ticket-reading"
            chainVerticalScroll
            role="region"
            aria-label="Ticket description and summary"
            viewportTabIndex={0}
            className="min-w-0 scroll-mt-4 @min-[64rem]/ticket:col-start-1 @min-[64rem]/ticket:row-start-1"
          >
            <div
              className={cn(
                "space-y-4 @min-[64rem]/ticket:pr-2 @min-[64rem]/ticket:pb-2",
                floatingChatInset.column,
              )}
            >
              {error ? <WorkbenchInlineError message={error} onRetry={onRetryError} /> : null}
              <WorkbenchReferenceFileSheetProvider
                environmentId={environmentId}
                cwd={getReferenceFileCwd(linkedProjects, ticket.repositoryProjectIds)}
                threadId={(assignment ?? activeAssignments[0])?.threadId ?? null}
              >
                <WorkbenchTicketDescriptionPanel
                  presentation={{
                    editing: editing,
                    isArchived: isArchived,
                    pending: pending,
                    startEditing: startEditing,
                    draft: draft,
                    cancelEditing: cancelEditing,
                    dirty: dirty,
                    displayedMarkdown: displayedMarkdown,
                  }}
                  actions={{ setDraft: setDraft, onOpenThread: openAssignedThread }}
                  context={{ environmentId: environmentId }}
                  records={{
                    ticket: ticket,
                    updatedBy: workbenchProvenanceSource({
                      environmentId,
                      threadId: ticket.updatedByThreadId,
                      askForChange: ticket.updatedByAskForChange,
                      threadsById,
                      archivedThreadsById,
                    }),
                    briefReview,
                  }}
                />
                <WorkbenchTicketReferencesPanel
                  environmentId={environmentId}
                  ticketId={ticket.id}
                  references={references}
                  descriptionLinks={descriptionLinks}
                  threadsById={threadsById}
                  archivedThreadsById={archivedThreadsById}
                  readOnly={workspaceReadOnly}
                />
              </WorkbenchReferenceFileSheetProvider>
              <WorkbenchTicketSummaryPanel
                key={`${ticket.id}:${summaryFailedEmpty}`}
                summaryHeaderLabel={summaryHeaderLabel}
                initiallyCollapsed={summaryFailedEmpty}
                hasUnsavedChanges={hasUnsavedChanges}
                summary={summary}
                ticket={ticket}
                displayedTitle={displayedTitle}
                pending={pending}
                isArchived={isArchived}
                onRegenerateSummary={onRegenerateSummary}
              />
            </div>
          </ScrollArea>

          <ScrollArea
            render={<aside />}
            id="workbench-ticket-work"
            chainVerticalScroll
            aria-label="Ticket work"
            viewportTabIndex={0}
            className="min-w-0 scroll-mt-4 @min-[64rem]/ticket:col-start-2 @min-[64rem]/ticket:row-start-1"
          >
            <div
              className={cn(
                "flex flex-col gap-4 @min-[64rem]/ticket:pr-2 @min-[64rem]/ticket:pb-2",
                floatingChatInset.column,
              )}
            >
              <WorkbenchTicketProgress
                ticket={ticket}
                updatedBy={workbenchProvenanceSource({
                  environmentId,
                  threadId: ticket.progressUpdatedByThreadId,
                  threadsById,
                  archivedThreadsById,
                })}
              />
              <WorkbenchTicketSharedContext
                key={ticket.id}
                environmentId={environmentId}
                ticket={ticket}
                references={references}
                assignments={assignments}
                threadsById={threadsById}
                archivedThreadsById={archivedThreadsById}
                ticketWorkspace={ticketWorkspace}
              />
              <WorkbenchTicketAttentionPanel
                environmentId={environmentId}
                ticketId={ticket.id}
                ticketTitle={ticket.title}
                onOpenThread={openAssignedThread}
                onShowPullRequestOwner={showPullRequestOwner}
              />
              <WorkbenchTicketThreadsPanel
                planningRow={floatingChatPlanning?.row}
                expansion={{ threadPanelCollapsed: threadPanelCollapsed }}
                actions={{
                  setThreadPanelCollapsed: setThreadPanelCollapsed,
                  settledAssignments: settledAssignments,
                  onNewThread: onNewThread,
                  onOpenThread: openThread,
                  onUnlinkThread: onUnlinkThread,
                  toggleThreadSettlement: toggleThreadSettlement,
                  settlementPendingThreadId: settlementPendingThreadId,
                  onDeleteThread: onDeleteThread,
                  onOpenAssignedThread: openAssignedThread,
                  onReplaceThread: onReplaceThread,
                  onAttachThread: onAttachThread,
                }}
                presentation={{
                  canOpenThread: canOpenThread,
                  threadActionPending: threadActionPending,
                  threadActionLabel: threadActionLabel,
                  thread: thread,
                  displayedTitle: displayedTitle,
                  pending: pending,
                  nativeStatus: nativeStatus,

                  agentTitle: agentTitle,
                  isArchived: isArchived,
                  supportsSettlement: supportsSettlement,
                }}
                context={{
                  threadMutationsDisabled,
                  threadsById: threadsById,
                  archivedThreadsById: archivedThreadsById,
                  threadLookupReady: threadLookupReady,
                }}
                records={{
                  displayedThread: displayedThread,
                  assignment: assignment,
                  actionableTicket: actionableTicket,
                  nativeThread: nativeThread,
                  archivedThread: archivedThread,
                  activeAssignments: activeAssignments,
                  ticket: ticket,
                  historicalAssignments: historicalAssignments,
                }}
              />

              <WorkbenchTicketPullRequests
                readOnly={workspaceReadOnly ?? false}
                onOpenThread={openAssignedThread}
                environmentId={environmentId}
                ticketId={ticket.id}
                assignments={activeAssignments}
                threadsById={threadsById}
                references={splitWorkbenchReferences(references).pullRequests.map(
                  (view) => view.reference,
                )}
                descriptionPullRequests={
                  listWorkbenchTicketReferences(references, descriptionLinks)
                    .descriptionPullRequests
                }
                pullRequests={associatedPullRequests}
                checkouts={getWorkbenchTicketPullRequestCheckouts({
                  workspace: ticketWorkspace,
                  repositories: repositories.map(({ id, repository }) => ({
                    projectId: id,
                    title: repository?.title ?? "Repository",
                  })),
                })}
              />

              <WorkbenchTicketWorkspacePanel
                expansion={{
                  repositoryScopePanelCollapsed: repositoryScopePanelCollapsed,
                  advancedWorkspaceSettingsCollapsed: advancedWorkspaceSettingsCollapsed,
                }}
                presentation={{
                  workspaceStatusLabel: workspaceStatusLabel,
                  workspaceIsReady: workspaceIsReady,
                  workspaceIsPreparing: workspaceIsPreparing,
                  pending: pending,
                  preparationPending: preparationPending,
                  isArchived: isArchived,
                  repositoryScopeLocked: repositoryScopeLocked,
                  workspacePreparationActionLabel: workspacePreparationActionLabel,
                  workspaceHasSelectedRepositories: workspaceHasSelectedRepositories,
                }}
                actions={{
                  onEditRepositories,
                  onRepositoryScopeChange,
                  onCancelRepositories,
                  onSaveRepositories,
                  setRepositoryScopePanelCollapsed: setRepositoryScopePanelCollapsed,
                  setAdvancedWorkspaceSettingsCollapsed: setAdvancedWorkspaceSettingsCollapsed,
                  setResetConfirmationOpen: setResetConfirmationOpen,
                }}
                records={{
                  ticket: ticket,
                  repositories: repositories,
                  ticketWorkspace: ticketWorkspace,
                  retainedRepositories: retainedRepositories,
                  activeAssignments: activeAssignments,
                  repositoryScopeDraft,
                }}
                context={{
                  environmentId: environmentId,
                  keybindings: keybindings,
                  availableEditors: availableEditors,
                  linkedProjects: linkedProjects,
                }}
              />
            </div>
          </ScrollArea>
        </div>
      </form>
      <WorkbenchTicketDeleteConfirmation
        disabled={workspaceReadOnly}
        displayedTitle={displayedTitle}
        error={error}
        pending={pending}
        ticket={ticket}
        onDelete={onDelete}
        deleteConfirmationOpen={deleteConfirmationOpen}
        setDeleteConfirmationOpen={setDeleteConfirmationOpen}
      />
      <WorkbenchTicketResetConfirmation
        disabled={workspaceReadOnly}
        displayedTitle={displayedTitle}
        error={error}
        pending={pending}
        ticket={ticket}
        onResetWorkspace={onResetWorkspace}
        resetConfirmationOpen={resetConfirmationOpen}
        setResetConfirmationOpen={setResetConfirmationOpen}
      />
      <WorkbenchTicketFloatingChat
        enabled={floatingChat}
        environmentId={environmentId}
        ticket={actionableTicket}
        ticketKey={getTicketIssue(references)?.label}
        activeAssignments={chatAssignments.active}
        settledAssignments={chatAssignments.settled}
        primaryAssignment={chatAssignments.primary}
        threadsById={threadsById}
        archivedThreadsById={archivedThreadsById}
        onOpenThread={onOpenAssignedThread}
        onNewThread={onNewThread}
        pending={pending}
        threadMutationsDisabled={threadMutationsDisabled}
        isArchived={isArchived}
        planning={floatingChatPlanning}
      />
    </article>
  );
}

type WorkbenchTicketRepositoryEntry = {
  readonly id: ProjectId;
  readonly repository: Project | undefined;
  readonly openInCwd: string | null;
  readonly workspaceRepository: WorkbenchTicketWorkspace["repositories"][number] | undefined;
};

function WorkbenchTicketRepositoryRow({
  environmentId,
  ticketId,
  entry,
  worktrees,
  keybindings,
  availableEditors,
  isArchived,
  canOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly entry: WorkbenchTicketRepositoryEntry;
  readonly worktrees: ReadonlyArray<WorkbenchTicketWorktree>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly isArchived: boolean;
  readonly canOpen: boolean;
}) {
  const checkoutCount = (entry.openInCwd ? 1 : 0) + worktrees.length;
  return (
    <div className="min-w-0 text-sm">
      <div className="py-2">
        <WorkbenchTicketRepositoryIdentity entry={entry} checkoutCount={checkoutCount} />
        {entry.workspaceRepository?.errorMessage ? (
          <p className="mt-1 min-w-0 break-words text-xs text-destructive" role="alert">
            {entry.workspaceRepository.errorMessage}
          </p>
        ) : null}
      </div>
      <WorkbenchTicketCheckoutRows
        environmentId={environmentId}
        ticketId={ticketId}
        preparedPath={entry.openInCwd}
        canOpenPrepared={canOpen && entry.repository !== null}
        worktrees={worktrees}
        keybindings={keybindings}
        availableEditors={availableEditors}
        isArchived={isArchived}
      />
    </div>
  );
}

function WorkbenchTicketRepositoryIdentity({
  entry,
  checkoutCount,
}: {
  readonly entry: WorkbenchTicketRepositoryEntry;
  readonly checkoutCount: number;
}) {
  const remoteRepository = useWorkbenchRemoteRefs().repositories.get(entry.id);
  const repositoryTitle =
    entry.repository?.title ??
    (remoteRepository
      ? formatWorkbenchRemoteRepositoryTitle(remoteRepository)
      : "Repository unavailable");
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entry.openInCwd ? (
          <WorkbenchCheckoutDirectory
            cwd={entry.openInCwd}
            icon={<FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
            value={repositoryTitle}
            valueClassName="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]"
          />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]">
              {repositoryTitle}
            </span>
          </span>
        )}
        {/* Worktrees are prepared only on the Board host. */}
        {remoteRepository ? null : (
          <WorkbenchTicketRepositoryStatus repository={entry.workspaceRepository} />
        )}
        {checkoutCount > 1 ? (
          <span className="text-xs text-muted-foreground">{checkoutCount} worktrees</span>
        ) : null}
      </div>
    </div>
  );
}

function isWorkbenchThreadOpenDisabled({
  pending,
  threadMutationsDisabled,
  thread,
}: {
  pending: boolean;
  threadMutationsDisabled: boolean;
  thread: EnvironmentThreadShell | undefined;
}) {
  return (
    pending || (threadMutationsDisabled && (thread === undefined || thread.archivedAt != null))
  );
}

interface WorkbenchThreadRowMenu {
  readonly disabled: boolean;
  readonly onUnlink: () => void;
  readonly onDelete: () => void;
}

/** Opens Unlink and Delete at a point, as a native sidebar row's context menu does. */
function openWorkbenchThreadRowMenu(
  menu: WorkbenchThreadRowMenu,
  position: { x: number; y: number },
) {
  const api = readLocalApi();
  if (!api) return;
  void api.contextMenu
    .show(
      [
        { id: "unlink", label: "Unlink from Ticket", disabled: menu.disabled },
        {
          id: "delete",
          label: "Delete Thread",
          icon: "trash",
          destructive: true,
          disabled: menu.disabled,
        },
      ],
      position,
    )
    .then((selected) => {
      if (selected === "unlink") menu.onUnlink();
      if (selected === "delete") menu.onDelete();
    })
    .catch(() => {
      toastManager.add({ type: "error", title: "Could not open Thread actions" });
    });
}

function WorkbenchThreadRowIcon({
  executionStatus,
  thread,
  unread,
}: {
  readonly executionStatus: WorkbenchThreadExecutionStatusData | null | undefined;
  readonly thread: EnvironmentThreadShell | undefined;
  readonly unread: boolean;
}) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
      {executionStatus ? (
        <WorkbenchThreadExecutionStatusIcon status={executionStatus.presentation} />
      ) : unread ? (
        <span aria-hidden className="size-2 rounded-full bg-success" />
      ) : (
        <WorkbenchThreadProviderIcon shell={thread} />
      )}
    </span>
  );
}

/** The row's state, then its time or run status, which the quick action replaces on hover or focus. */
function WorkbenchThreadRowTrailing({
  thread,
  executionStatus,
  quickAction,
  recencyLabel,
  stateLabel,
}: {
  readonly thread: EnvironmentThreadShell | undefined;
  readonly executionStatus: WorkbenchThreadExecutionStatusData | null | undefined;
  readonly quickAction: ReactNode;
  readonly recencyLabel: string | null;
  readonly stateLabel: string | null;
}) {
  const time = executionStatus ? (
    <WorkbenchThreadExecutionStatus
      status={executionStatus.presentation}
      startedAt={executionStatus.startedAt}
    />
  ) : recencyLabel ? (
    <span>{recencyLabel}</span>
  ) : null;
  return (
    <span className="relative z-10 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <WorkbenchThreadRowMachineLabel thread={thread} />
      {!executionStatus && stateLabel ? <span>{stateLabel}</span> : null}
      {time && quickAction ? (
        <span className="relative flex items-center">
          <span className="transition-opacity group-focus-within/thread-row:opacity-0 group-hover/thread-row:opacity-0 motion-reduce:transition-none">
            {time}
          </span>
          <span className="absolute inset-y-0 end-0 flex items-center opacity-0 transition-opacity group-focus-within/thread-row:opacity-100 group-hover/thread-row:opacity-100 motion-reduce:transition-none">
            {quickAction}
          </span>
        </span>
      ) : (
        (quickAction ?? time)
      )}
    </span>
  );
}

const VISIBLE_THREAD_ROW_ACTIONS = new Set(["Restore and open", "Create replacement Thread"]);

/** Unlink and Delete open on right-click, or from the keyboard as on Workbench sidebar rows. */
const getWorkbenchThreadRowMenuHandlers = (menu: WorkbenchThreadRowMenu | undefined) =>
  menu
    ? {
        row: {
          onContextMenu: (event: ReactMouseEvent) => {
            event.preventDefault();
            openWorkbenchThreadRowMenu(menu, { x: event.clientX, y: event.clientY });
          },
        },
        button: {
          onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) =>
            handleWorkbenchSidebarMenuKeyDown(event, (position) =>
              openWorkbenchThreadRowMenu(menu, position),
            ),
        },
      }
    : { row: {}, button: {} };

function useWorkbenchThreadRowState({
  thread,
  actionLabel,
  ariaLabel,
  title,
}: {
  thread: EnvironmentThreadShell | undefined;
  actionLabel: string | undefined;
  ariaLabel: string | undefined;
  title: string;
}) {
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  // The page's floating chat shows this Thread, as the native sidebar marks the open one.
  const showing = useWorkbenchFloatingChatStore(
    (state) =>
      thread !== undefined &&
      state.shownThread?.environmentId === thread.environmentId &&
      state.shownThread.threadId === thread.id,
  );
  const openLabel = useWorkbenchThreadOpenLabel();
  const label = actionLabel ?? openLabel;
  return {
    unread: thread ? hasWorkbenchUnreadReply(thread, localVisits) : false,
    showing,
    label,
    accessibleName: ariaLabel ?? `${label} ${title}`,
  };
}

/** A row that opens its Thread names no action; the row's default label says how it opens. */
const getWorkbenchThreadRowAction = (thread: ReturnType<typeof getWorkbenchThreadPresentation>) =>
  thread.state === "linked" ? undefined : thread.actionLabel;

/** A Ticket's Thread laid out like a native sidebar row: hover for details, right-click for more. */
function WorkbenchThreadRow({
  actionLabel,
  ariaLabel,
  disabled,
  executionStatus,
  heading,
  menu,
  onClick,
  quickAction,
  recencyLabel,
  stateLabel,
  thread,
  title,
}: {
  /** Replaces opening the Thread, such as restoring it first; also its accessible name. */
  readonly actionLabel?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly disabled: boolean;
  readonly executionStatus?: WorkbenchThreadExecutionStatusData | null;
  /** The page's Ticket title, which the row leaves out of a Thread title that repeats it. */
  readonly heading: string;
  /** Unlink and Delete, on right-click or the context-menu key. */
  readonly menu?: WorkbenchThreadRowMenu | undefined;
  readonly onClick: () => void;
  /** Takes the recency label's place on hover, as Settle does on native rows. */
  readonly quickAction?: ReactNode;
  readonly recencyLabel: string | null;
  readonly stateLabel: string | null;
  /** The Thread to preview on hover; absent while it loads or once deleted. */
  readonly thread: EnvironmentThreadShell | undefined;
  readonly title: string;
}) {
  const { unread, showing, label, accessibleName } = useWorkbenchThreadRowState({
    thread,
    actionLabel,
    ariaLabel,
    title,
  });
  // Native rows recede settled and running Threads and emphasize ones that need the user.
  const recede = shouldRecedeSidebarThread({
    status: executionStatus?.kind ?? "ready",
    isUnread: unread,
    isWoke: false,
    isActive: showing,
    isSelected: false,
  });
  const row = (
    <div
      className={cn(
        "group/thread-row relative isolate flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm",
        showing
          ? "bg-sidebar-row-active light:ring-1 light:ring-inset light:ring-sidebar-border/70"
          : "hover:bg-sidebar-row-hover",
      )}
      {...getWorkbenchThreadRowMenuHandlers(menu).row}
    >
      <button
        aria-current={showing || undefined}
        aria-label={accessibleName}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring disabled:cursor-default disabled:opacity-50"
        disabled={disabled}
        onClick={onClick}
        {...getWorkbenchThreadRowMenuHandlers(menu).button}
        type="button"
      >
        <WorkbenchThreadRowIcon executionStatus={executionStatus} thread={thread} unread={unread} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            recede
              ? "font-normal text-foreground/75 group-focus-within/thread-row:text-foreground group-hover/thread-row:text-foreground"
              : "font-medium text-foreground",
          )}
        >
          {titleUnderHeading(title, heading)}
        </span>
        <span
          className={
            VISIBLE_THREAD_ROW_ACTIONS.has(label)
              ? "shrink-0 text-xs text-muted-foreground"
              : "sr-only"
          }
        >
          {label}
        </span>
      </button>
      <WorkbenchThreadRowTrailing
        thread={thread}
        executionStatus={executionStatus}
        quickAction={quickAction}
        recencyLabel={recencyLabel}
        stateLabel={stateLabel}
      />
    </div>
  );
  return thread ? (
    <WorkbenchThreadHoverPreview
      environmentId={thread.environmentId}
      threadId={thread.id}
      title={title}
      shell={thread}
    >
      {row}
    </WorkbenchThreadHoverPreview>
  ) : (
    row
  );
}

function WorkbenchThreadSettlementButton({
  archived = false,
  disabled,
  onClick,
  pending,
  settled,
  title,
}: {
  readonly archived?: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly settled: boolean;
  readonly title: string;
}) {
  const actionLabel = settled ? "Un-settle" : "Settle";
  const pendingLabel = settled ? "Un-settling…" : "Settling…";
  const explanation = archived
    ? `Restore this archived Thread before ${settled ? "un-settling" : "settling"} it.`
    : `${actionLabel} Thread`;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={archived ? 0 : undefined} />}>
        <Button
          aria-busy={pending}
          aria-label={`${actionLabel} Thread ${title}`}
          disabled={disabled || pending}
          onClick={onClick}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {pending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : settled ? (
            <RotateCcwIcon />
          ) : (
            <CheckIcon />
          )}
          <span className="sr-only">{pending ? pendingLabel : actionLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{explanation}</TooltipPopup>
    </Tooltip>
  );
}

function getWorkbenchThreadRecencyLabel(thread: EnvironmentThreadShell): string {
  return formatRelativeTimeLabel(
    thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );
}

export function WorkbenchInlineError({
  message,
  onRetry,
}: {
  readonly message: string | null;
  readonly onRetry?: (() => void) | undefined;
}) {
  if (message === null) return null;
  return (
    <Alert variant="error" controlAlignment="first-line">
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button onClick={onRetry} size="xs" variant="outline">
            <RefreshCwIcon /> Retry
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

type WorkbenchTicketHeaderProps = {
  executionStatus: WorkbenchThreadExecutionStatusData | null;
  onBack: () => void;
  workspaceTitle: string;
  displayedTitle: string;
  ticket: WorkbenchTicket;
  /** The Ticket's first issue Reference, which identifies it. */
  issue: WorkbenchParsedReferenceUrl | null;
  isArchived: boolean;
  environmentId: EnvironmentId;
  actionableTicket: WorkbenchTicket;
  pending: boolean;
  editing: boolean;
  onUpdate: (
    ticket: WorkbenchTicket,
    patch: Partial<
      Pick<WorkbenchTicket, "title" | "markdown" | "repositoryProjectIds" | "status" | "blocked">
    >,
  ) => void;
  lifecycleActionsEnabled: boolean;
  onArchive: (ticket: WorkbenchTicket, archivedAt: string | null) => Promise<boolean>;
  setDeleteConfirmationOpen: Dispatch<SetStateAction<boolean>>;
  /** The title's word diff while a review shows one. */
  titleWords: ReadonlyArray<WordDiffSegment> | null;
};
function WorkbenchTicketHeader({
  actions,
  presentation,
  records,
  context,
}: {
  actions: Pick<
    WorkbenchTicketHeaderProps,
    "onBack" | "onUpdate" | "onArchive" | "setDeleteConfirmationOpen"
  >;
  presentation: Pick<
    WorkbenchTicketHeaderProps,
    | "executionStatus"
    | "workspaceTitle"
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "editing"
    | "lifecycleActionsEnabled"
    | "titleWords"
  >;
  records: Pick<WorkbenchTicketHeaderProps, "ticket" | "issue" | "actionableTicket">;
  context: Pick<WorkbenchTicketHeaderProps, "environmentId">;
}) {
  const { onBack, onUpdate, onArchive, setDeleteConfirmationOpen } = actions;
  const {
    executionStatus,
    workspaceTitle,
    displayedTitle,
    isArchived,
    pending,
    editing,
    lifecycleActionsEnabled,
    titleWords,
  } = presentation;
  const { ticket, issue, actionableTicket } = records;
  const { environmentId } = context;
  const controlsHostRef = useWorkbenchControlsHostRef();
  return (
    <WorkspacePageHeader
      electron={isElectron}
      className="h-auto! min-h-0! max-h-none! items-start border-b border-border py-4"
    >
      <div className="mx-auto grid w-full min-w-0 max-w-7xl grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 @min-[48rem]/ticket:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeftIcon data-icon="inline-start" />
          Board
        </Button>
        <WorkbenchTicketHeading
          presentation={{
            executionStatus,
            workspaceTitle: workspaceTitle,
            displayedTitle: displayedTitle,
            isArchived: isArchived,
            pending: pending,
            editing: editing,
            titleWords,
          }}
          records={{
            ticket: ticket,
            issue,
            actionableTicket: actionableTicket,
          }}
          context={{ environmentId: environmentId }}
          actions={{
            onUpdate: onUpdate,
          }}
        />
        <div className="col-start-2 row-start-1 flex min-w-0 justify-end @min-[48rem]/ticket:col-start-3">
          <WorkbenchTicketActionsMenu
            isArchived={isArchived}
            pending={pending}
            ticket={ticket}
            issue={issue}
            lifecycleActionsEnabled={lifecycleActionsEnabled}
            onArchive={onArchive}
            setDeleteConfirmationOpen={setDeleteConfirmationOpen}
          />
        </div>
      </div>
      <div
        ref={controlsHostRef}
        data-workbench-chat-controls=""
        className="flex shrink-0 self-start"
      />
    </WorkspacePageHeader>
  );
}

function WorkbenchTicketSummaryHeading({
  summary,
}: {
  summary: ReturnType<typeof getWorkbenchTicketSummaryPresentation>;
}) {
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-1.5">
        <span
          id="workbench-ticket-generated-summary"
          role="heading"
          aria-level={2}
          className="text-sm font-medium text-muted-foreground"
        >
          Generated summary
        </span>
        {summary.error ? (
          <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-warning-foreground" />
        ) : null}
      </span>
    </span>
  );
}

function WorkbenchTicketSummaryPanel({
  summaryHeaderLabel,
  initiallyCollapsed,
  hasUnsavedChanges,
  summary,
  ticket,
  displayedTitle,
  pending,
  isArchived,
  onRegenerateSummary,
}: {
  summaryHeaderLabel: string | null;
  initiallyCollapsed: boolean;
  hasUnsavedChanges: boolean;
  summary: ReturnType<typeof getWorkbenchTicketSummaryPresentation>;
  ticket: WorkbenchTicket;
  displayedTitle: string;
  pending: boolean;
  isArchived: boolean;
  onRegenerateSummary: (ticket: WorkbenchTicket) => void;
}) {
  const [summaryPanelCollapsed, setSummaryPanelCollapsed] = useState(initiallyCollapsed);
  return (
    <section
      aria-labelledby="workbench-ticket-generated-summary"
      className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30"
    >
      <WorkbenchTicketPanelHeader
        title="Generated summary"
        heading={<WorkbenchTicketSummaryHeading summary={summary} />}
        description={
          summaryHeaderLabel || hasUnsavedChanges ? (
            <>
              {summaryHeaderLabel ? (
                <span
                  className={summary.error ? "text-warning-foreground" : undefined}
                  role="status"
                >
                  {summaryHeaderLabel}
                </span>
              ) : null}
              {hasUnsavedChanges ? (
                <span className="block truncate text-warning-foreground" role="status">
                  Save changes to update summary.
                </span>
              ) : null}
            </>
          ) : undefined
        }
        collapsed={summaryPanelCollapsed}
        onToggle={() => setSummaryPanelCollapsed((collapsed) => !collapsed)}
        contentId="workbench-ticket-generated-summary-content"
      />
      <div id="workbench-ticket-generated-summary-content" hidden={summaryPanelCollapsed}>
        <WorkbenchTicketSummaryContent
          hasUnsavedChanges={hasUnsavedChanges}
          summary={summary}
          ticket={ticket}
          displayedTitle={displayedTitle}
          pending={pending}
          isArchived={isArchived}
          onRegenerateSummary={onRegenerateSummary}
        />
      </div>
    </section>
  );
}

type WorkbenchTicketDescriptionPanelProps = {
  editing: boolean;
  isArchived: boolean;
  pending: boolean;
  startEditing: () => void;
  draft: WorkbenchTicketDraft | undefined;
  setDraft: (
    environmentId: EnvironmentId,
    ticketId: WorkbenchTicketId,
    draft: WorkbenchTicketDraft,
  ) => void;
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
  cancelEditing: () => void;
  dirty: boolean;
  displayedMarkdown: string;
};
function WorkbenchTicketDescriptionPanel({
  presentation,
  actions,
  context,
  records,
}: {
  presentation: Pick<
    WorkbenchTicketDescriptionPanelProps,
    | "editing"
    | "isArchived"
    | "pending"
    | "startEditing"
    | "draft"
    | "cancelEditing"
    | "dirty"
    | "displayedMarkdown"
  >;
  actions: Pick<WorkbenchTicketDescriptionPanelProps, "setDraft"> & {
    readonly onOpenThread: (threadId: ThreadId) => void;
  };
  context: Pick<WorkbenchTicketDescriptionPanelProps, "environmentId">;
  records: Pick<WorkbenchTicketDescriptionPanelProps, "ticket"> & {
    readonly updatedBy: WorkbenchProvenanceSource | null;
    readonly briefReview: ReturnType<typeof useWorkbenchTicketBriefReview>;
  };
}) {
  const {
    editing,
    isArchived,
    pending,
    startEditing,
    draft,
    cancelEditing,
    dirty,
    displayedMarkdown,
  } = presentation;
  const { setDraft, onOpenThread } = actions;
  const { environmentId } = context;
  const { ticket, updatedBy, briefReview } = records;
  const { review } = briefReview;
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold">Brief</h2>
            {updatedBy !== null ? (
              <WorkbenchProvenanceBadge
                source={updatedBy}
                pressed={briefReview.diffShown}
                onToggle={briefReview.toggleDiff}
              />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Goal, constraints, and acceptance criteria.
          </p>
        </div>
        {!editing && !isArchived ? (
          <div className="flex shrink-0 items-center gap-2">
            {ticket.markdown.trim() ? (
              <WorkbenchBriefAskButton briefReview={briefReview} variant="outline" />
            ) : null}
            <Button
              disabled={pending}
              onClick={startEditing}
              size="xs"
              type="button"
              variant="outline"
            >
              <PencilIcon /> Edit
            </Button>
          </div>
        ) : null}
      </div>
      {review && !editing ? (
        <WorkbenchReviewBar
          review={review}
          source={updatedBy}
          editedAt={briefReview.contentUpdatedAt}
          permitted={briefReview.permitted}
          onOpenThread={onOpenThread}
          disabled={pending}
          className="border-b border-border/50 px-4 py-2"
        />
      ) : null}
      {editing && draft ? (
        <>
          <div className="min-w-0 space-y-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-workbench-ticket-title">Title</Label>
              <Input
                id="edit-workbench-ticket-title"
                value={draft.title}
                onChange={(event) => {
                  setDraft(environmentId, ticket.id, {
                    ...draft,
                    title: event.currentTarget.value,
                  });
                }}
              />
            </div>
            <WorkbenchTicketDescriptionEditor
              key={`${environmentId}:${ticket.id}`}
              autoFocus
              markdown={draft.markdown}
              onChange={(markdown) => {
                setDraft(environmentId, ticket.id, {
                  ...draft,
                  markdown,
                });
              }}
            />
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
            <Button disabled={pending} onClick={cancelEditing} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={pending || !dirty || draft.title.trim().length === 0} type="submit">
              Save Ticket
            </Button>
          </div>
        </>
      ) : (
        <div className="min-h-40 min-w-0 p-4 @min-[40rem]/ticket:p-5">
          <WorkbenchBriefBody briefReview={briefReview} markdown={displayedMarkdown} />
        </div>
      )}
    </section>
  );
}

type WorkbenchTicketThreadsPanelProps = {
  threadPanelCollapsed: boolean;
  threadMutationsDisabled: boolean;
  setThreadPanelCollapsed: Dispatch<SetStateAction<boolean>>;
  canOpenThread: boolean;
  displayedThread: EnvironmentThreadShell | undefined;
  threadActionPending: boolean;
  /** The current start stage, such as preparing the worktree, while one runs. */
  threadActionLabel: string | null | undefined;
  thread: ReturnType<typeof getWorkbenchThreadPresentation>;
  displayedTitle: string;
  pending: boolean;
  assignment: WorkbenchAssignment | undefined;
  settledAssignments: ReadonlyArray<WorkbenchAssignment>;
  onNewThread: (ticket: WorkbenchTicket) => void;
  actionableTicket: WorkbenchTicket;
  onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  nativeThread: EnvironmentThreadShell | undefined;
  nativeStatus: WorkbenchThreadExecutionStatusData | null;

  agentTitle: string;
  isArchived: boolean;
  onUnlinkThread: (threadId: ThreadId) => void;
  supportsSettlement: boolean;
  archivedThread: EnvironmentThreadShell | undefined;
  toggleThreadSettlement: (thread: EnvironmentThreadShell) => Promise<void>;
  settlementPendingThreadId: ThreadId | null;
  onDeleteThread: (threadId: ThreadId) => void;
  activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  ticket: WorkbenchTicket;
  threadLookupReady: boolean;
  onOpenAssignedThread: (threadId: ThreadId) => void;
  onReplaceThread: (ticket: WorkbenchTicket, previousThreadId: ThreadId) => void;
  historicalAssignments: ReadonlyArray<WorkbenchAssignment>;
  onAttachThread: (ticket: WorkbenchTicket) => void;
};
function WorkbenchTicketThreadsPanel({
  planningRow,
  expansion,
  actions,
  presentation,
  context,
  records,
}: {
  planningRow?: ReactNode;
  expansion: Pick<WorkbenchTicketThreadsPanelProps, "threadPanelCollapsed">;
  actions: Pick<
    WorkbenchTicketThreadsPanelProps,
    | "setThreadPanelCollapsed"
    | "settledAssignments"
    | "onNewThread"
    | "onOpenThread"
    | "onUnlinkThread"
    | "toggleThreadSettlement"
    | "settlementPendingThreadId"
    | "onDeleteThread"
    | "onOpenAssignedThread"
    | "onReplaceThread"
    | "onAttachThread"
  >;
  presentation: Pick<
    WorkbenchTicketThreadsPanelProps,
    | "canOpenThread"
    | "threadActionPending"
    | "threadActionLabel"
    | "thread"
    | "displayedTitle"
    | "pending"
    | "nativeStatus"
    | "agentTitle"
    | "isArchived"
    | "supportsSettlement"
  >;
  context: Pick<
    WorkbenchTicketThreadsPanelProps,
    "threadMutationsDisabled" | "threadsById" | "archivedThreadsById" | "threadLookupReady"
  >;
  records: Pick<
    WorkbenchTicketThreadsPanelProps,
    | "displayedThread"
    | "assignment"
    | "actionableTicket"
    | "nativeThread"
    | "archivedThread"
    | "activeAssignments"
    | "ticket"
    | "historicalAssignments"
  >;
}) {
  const { threadPanelCollapsed } = expansion;
  const {
    setThreadPanelCollapsed,
    settledAssignments,
    onNewThread,
    onOpenThread,
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
    onReplaceThread,
    onAttachThread,
  } = actions;
  const {
    canOpenThread,
    threadActionPending,
    threadActionLabel,
    thread,
    displayedTitle,
    pending,
    nativeStatus,

    agentTitle,
    isArchived,
    supportsSettlement,
  } = presentation;
  const { threadMutationsDisabled, threadsById, archivedThreadsById, threadLookupReady } = context;
  const {
    displayedThread,
    assignment,
    actionableTicket,
    nativeThread,
    archivedThread,
    activeAssignments,
    ticket,
    historicalAssignments,
  } = records;
  const [sectionToggles, setSectionToggles] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { environmentStates: remoteEnvironmentStates } = useWorkbenchRemoteRefs();
  const isOffline = (rowAssignment: WorkbenchAssignment) =>
    getWorkbenchThreadLookupState({
      assignment: rowAssignment,
      threadLookupReady,
      remoteEnvironmentStates,
    }) === "offline";
  // Offline Threads are still open; they are listed under Offline.
  const openThreadCount = new Set(
    activeAssignments
      .filter(
        (activeAssignment) =>
          threadsById.has(activeAssignment.threadId) ||
          archivedThreadsById.has(activeAssignment.threadId) ||
          isOffline(activeAssignment),
      )
      .map(({ threadId }) => threadId),
  ).size;
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const liveStatus = (threadId: ThreadId) => {
    const liveThread = threadsById.get(threadId);
    return liveThread
      ? {
          status: getWorkbenchThreadExecutionStatus(liveThread),
          unread: hasWorkbenchUnreadReply(liveThread, localVisits),
        }
      : { status: null, unread: false };
  };
  // A primary Thread the user cannot open gives way to the notice below, as do its actions.
  const listedAssignments = canOpenThread
    ? activeAssignments
    : activeAssignments.filter((activeAssignment) => activeAssignment.id !== assignment?.id);
  const sections = getWorkbenchThreadStatusSections({
    active: listedAssignments.map((activeAssignment) => ({
      threadId: activeAssignment.threadId,
      ...liveStatus(activeAssignment.threadId),
      offline: isOffline(activeAssignment),
      assignment: activeAssignment,
    })),
    settled: settledAssignments.map((settledAssignment) => ({
      threadId: settledAssignment.threadId,
      status: null,
      unread: false,
      offline: false,
      assignment: settledAssignment,
    })),
    showingThreadId: assignment?.threadId ?? null,
  });
  const primaryThread = (
    <WorkbenchTicketPrimaryThread
      context={{ threadMutationsDisabled }}
      records={{
        displayedThread: displayedThread,
        assignment: assignment,
        actionableTicket: actionableTicket,
        nativeThread: nativeThread,
        archivedThread: archivedThread,
      }}
      presentation={{
        threadActionPending: threadActionPending,
        threadActionLabel: threadActionLabel,
        thread: thread,
        displayedTitle: displayedTitle,
        pending: pending,
        nativeStatus: nativeStatus,
        agentTitle: agentTitle,
        isArchived: isArchived,
        supportsSettlement: supportsSettlement,
      }}
      actions={{
        settledAssignments: settledAssignments,
        onNewThread: onNewThread,
        onOpenThread: onOpenThread,
        onUnlinkThread: onUnlinkThread,
        toggleThreadSettlement: toggleThreadSettlement,
        settlementPendingThreadId: settlementPendingThreadId,
        onDeleteThread: onDeleteThread,
      }}
    />
  );
  const activeThreadRow = (activeAssignment: WorkbenchAssignment) =>
    activeAssignment.id === assignment?.id ? (
      <div key={activeAssignment.id}>{primaryThread}</div>
    ) : (
      <WorkbenchTicketActiveThreadRow
        key={activeAssignment.id}
        context={{
          threadMutationsDisabled,
          threadsById: threadsById,
          archivedThreadsById: archivedThreadsById,
          threadLookupReady: threadLookupReady,
        }}
        presentation={{
          pending: pending,
          isArchived: isArchived,
          supportsSettlement: supportsSettlement,
          activeAssignment: activeAssignment,
        }}
        actions={{
          onUnlinkThread: onUnlinkThread,
          toggleThreadSettlement: toggleThreadSettlement,
          settlementPendingThreadId: settlementPendingThreadId,
          onDeleteThread: onDeleteThread,
          onOpenAssignedThread: onOpenAssignedThread,
          onReplaceThread: onReplaceThread,
        }}
        records={{ ticket: ticket }}
      />
    );
  const settledThreadRow = (settledAssignment: WorkbenchAssignment) => (
    <WorkbenchTicketSettledThreadRow
      key={settledAssignment.id}
      threadMutationsDisabled={threadMutationsDisabled}
      pending={pending}
      isArchived={isArchived}
      onUnlinkThread={onUnlinkThread}
      supportsSettlement={supportsSettlement}
      toggleThreadSettlement={toggleThreadSettlement}
      settlementPendingThreadId={settlementPendingThreadId}
      onDeleteThread={onDeleteThread}
      threadsById={threadsById}
      archivedThreadsById={archivedThreadsById}
      onOpenAssignedThread={onOpenAssignedThread}
      settledAssignment={settledAssignment}
      heading={ticket.title}
    />
  );
  const renderPrimaryNotice = () => {
    if (!canOpenThread)
      return (
        <p className="px-4 pb-3 text-sm text-muted-foreground">
          No Thread is available for this Ticket.
        </p>
      );
    if (assignment) return null;
    // A starting Thread shows its progress here until it is listed.
    if (threadActionPending) return <div className="px-2 pb-2">{primaryThread}</div>;
    return <p className="px-4 pb-3 text-sm text-muted-foreground">{agentTitle}</p>;
  };
  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title="Threads"
        count={openThreadCount}
        collapsed={threadPanelCollapsed}
        onToggle={() => setThreadPanelCollapsed((collapsed) => !collapsed)}
        contentId="workbench-ticket-agent-threads"
      />
      <div id="workbench-ticket-agent-threads" hidden={threadPanelCollapsed}>
        <div className="min-w-0">
          {planningRow ?? renderPrimaryNotice()}
          {(planningRow ? [] : sections).map((section) => {
            const open = sectionToggles.get(section.id) ?? section.openByDefault;
            return (
              <WorkbenchTicketThreadSection
                key={section.id}
                id={section.id}
                label={section.label}
                count={section.threads.length}
                open={open}
                onToggle={() =>
                  setSectionToggles((current) => new Map(current).set(section.id, !open))
                }
              >
                {section.threads.map(({ assignment: rowAssignment }) =>
                  section.id === "settled"
                    ? settledThreadRow(rowAssignment)
                    : activeThreadRow(rowAssignment),
                )}
              </WorkbenchTicketThreadSection>
            );
          })}
          {historicalAssignments.length > 0 ? (
            <WorkbenchTicketHistoricalThreads
              threadMutationsDisabled={threadMutationsDisabled}

              pending={pending}
              isArchived={isArchived}
              onUnlinkThread={onUnlinkThread}
              supportsSettlement={supportsSettlement}
              toggleThreadSettlement={toggleThreadSettlement}
              settlementPendingThreadId={settlementPendingThreadId}
              onDeleteThread={onDeleteThread}
              threadsById={threadsById}
              archivedThreadsById={archivedThreadsById}
              ticket={ticket}
              threadLookupReady={threadLookupReady}
              onOpenAssignedThread={onOpenAssignedThread}
              historicalAssignments={historicalAssignments}
            />
          ) : null}
        </div>
        {!planningRow && (
          <WorkbenchTicketThreadCreationActions
            onNewThread={onNewThread}
            onAttachThread={onAttachThread}
            pending={pending || threadMutationsDisabled}
            isArchived={isArchived}
            ticket={ticket}
          />
        )}
      </div>
    </section>
  );
}

type WorkbenchTicketWorkspacePanelProps = Pick<
  WorkbenchTicketDetailProps,
  | "environmentId"
  | "keybindings"
  | "availableEditors"
  | "ticketWorkspace"
  | "linkedProjects"
  | "ticket"
  | "pending"
  | "preparationPending"
  | "repositoryScopeDraft"
  | "onEditRepositories"
  | "onRepositoryScopeChange"
  | "onCancelRepositories"
  | "onSaveRepositories"
> & {
  repositoryScopePanelCollapsed: boolean;
  workspaceStatusLabel:
    | "Preparing"
    | "Preparation failed"
    | "Not prepared"
    | "Releasing"
    | "Released"
    | "Ready"
    | "Needs preparation";
  workspaceIsReady: boolean;
  workspaceIsPreparing: boolean;
  isArchived: boolean;
  repositoryScopeLocked: boolean;
  workspacePreparationActionLabel:
    | "Preparing worktrees…"
    | "Retry preparation"
    | "Prepare worktrees";
  setRepositoryScopePanelCollapsed: Dispatch<SetStateAction<boolean>>;
  repositories: ReadonlyArray<WorkbenchTicketRepositoryEntry>;
  retainedRepositories: ReadonlyArray<WorkbenchTicketRepositoryEntry>;
  workspaceHasSelectedRepositories: boolean;
  advancedWorkspaceSettingsCollapsed: boolean;
  setAdvancedWorkspaceSettingsCollapsed: Dispatch<SetStateAction<boolean>>;
  activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  setResetConfirmationOpen: Dispatch<SetStateAction<boolean>>;
};
type WorkbenchTicketWorkspacePanelInput = {
  expansion: Pick<
    WorkbenchTicketWorkspacePanelProps,
    "repositoryScopePanelCollapsed" | "advancedWorkspaceSettingsCollapsed"
  >;
  presentation: Pick<
    WorkbenchTicketWorkspacePanelProps,
    | "workspaceStatusLabel"
    | "workspaceIsReady"
    | "workspaceIsPreparing"
    | "pending"
    | "preparationPending"
    | "isArchived"
    | "repositoryScopeLocked"
    | "workspacePreparationActionLabel"
    | "workspaceHasSelectedRepositories"
  >;
  actions: Pick<
    WorkbenchTicketWorkspacePanelProps,
    | "onEditRepositories"
    | "onRepositoryScopeChange"
    | "onCancelRepositories"
    | "onSaveRepositories"
    | "setRepositoryScopePanelCollapsed"
    | "setAdvancedWorkspaceSettingsCollapsed"
    | "setResetConfirmationOpen"
  >;
  records: Pick<
    WorkbenchTicketWorkspacePanelProps,
    | "ticket"
    | "repositories"
    | "ticketWorkspace"
    | "retainedRepositories"
    | "activeAssignments"
    | "repositoryScopeDraft"
  >;
  context: Pick<
    WorkbenchTicketWorkspacePanelProps,
    "environmentId" | "keybindings" | "availableEditors" | "linkedProjects"
  >;
};

function WorkbenchTicketWorkspacePanel({
  expansion,
  presentation,
  actions,
  records,
  context,
}: WorkbenchTicketWorkspacePanelInput) {
  const { repositoryScopePanelCollapsed, advancedWorkspaceSettingsCollapsed } = expansion;
  const {
    workspaceIsPreparing,
    pending,
    preparationPending,
    isArchived,
    repositoryScopeLocked,
    workspaceHasSelectedRepositories,
  } = presentation;
  const {
    onEditRepositories,
    onRepositoryScopeChange,
    setRepositoryScopePanelCollapsed,
    setAdvancedWorkspaceSettingsCollapsed,
    setResetConfirmationOpen,
  } = actions;
  const {
    ticket,
    repositories,
    ticketWorkspace,
    retainedRepositories,
    activeAssignments,
    repositoryScopeDraft,
  } = records;
  const { environmentId, keybindings, availableEditors, linkedProjects } = context;
  const draft =
    repositoryScopeDraft?.ticket.id === ticket.id &&
    repositoryScopeDraft.environmentId === environmentId
      ? repositoryScopeDraft
      : null;
  const collapsed = repositoryScopePanelCollapsed && draft === null;
  const disabled = pending || preparationPending || isArchived || repositoryScopeLocked;
  const openRepositoryReview = (prepare: boolean) => {
    setRepositoryScopePanelCollapsed(false);
    onEditRepositories({ ticket, prepare });
  };
  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketWorkspaceHeader
        presentation={presentation}
        actions={actions}
        draft={draft}
        disabled={disabled}
        collapsed={collapsed}
        openRepositoryReview={openRepositoryReview}
      />
      <div
        id="workbench-ticket-repositories"
        className="min-w-0 space-y-3 px-4 pb-4"
        hidden={collapsed}
      >
        {draft ? (
          <WorkbenchTicketWorkspaceRepositoryEditor
            draft={draft}
            ticketWorkspace={ticketWorkspace}
            linkedProjects={linkedProjects}
            disabled={disabled}
            onRepositoryScopeChange={onRepositoryScopeChange}
          >
            <WorkbenchTicketWorkspaceReviewActions
              draft={draft}
              presentation={presentation}
              actions={actions}
              disabled={disabled}
              linkedProjects={linkedProjects}
            />
          </WorkbenchTicketWorkspaceRepositoryEditor>
        ) : (
          <WorkbenchTicketWorkspaceRepositories
            ticket={ticket}
            repositories={repositories}
            environmentId={environmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            isArchived={isArchived}
            ticketWorkspace={ticketWorkspace}
            workspaceIsPreparing={workspaceIsPreparing}
            retainedRepositories={retainedRepositories}
          />
        )}
        {draft ? null : (
          <p className="text-xs text-muted-foreground">
            {getWorkbenchWorkspaceDescription({
              workspaceIsPreparing,
              ticketWorkspace,
              workspaceHasSelectedRepositories,
            })}
          </p>
        )}
        {ticketWorkspace?.errorMessage ? (
          <p className="break-words text-xs text-destructive" role="alert">
            {ticketWorkspace.errorMessage}
          </p>
        ) : null}
        {ticketWorkspace ? (
          <WorkbenchTicketAdvancedWorkspace
            advancedWorkspaceSettingsCollapsed={advancedWorkspaceSettingsCollapsed}
            setAdvancedWorkspaceSettingsCollapsed={setAdvancedWorkspaceSettingsCollapsed}
            activeAssignments={activeAssignments}
            ticketWorkspace={ticketWorkspace}
            pending={pending}
            isArchived={isArchived}
            setResetConfirmationOpen={setResetConfirmationOpen}
          />
        ) : null}
      </div>
    </section>
  );
}

function WorkbenchTicketWorkspaceHeader({
  presentation,
  actions,
  draft,
  disabled,
  collapsed,
  openRepositoryReview,
}: Pick<WorkbenchTicketWorkspacePanelInput, "presentation" | "actions"> & {
  readonly draft: WorkbenchRepositoryScopeDraft | null;
  readonly disabled: boolean;
  readonly collapsed: boolean;
  readonly openRepositoryReview: (prepare: boolean) => void;
}) {
  const {
    workspaceStatusLabel,
    workspaceIsReady,
    workspaceIsPreparing,
    pending,
    workspacePreparationActionLabel,
  } = presentation;
  return (
    <>
      <WorkbenchTicketPanelHeader
        title="Repositories"
        description={
          <Badge
            size="sm"
            variant={
              workspaceStatusLabel === "Preparation failed" ||
              workspaceStatusLabel === "Needs preparation"
                ? "warning"
                : "outline"
            }
          >
            {workspaceStatusLabel}
          </Badge>
        }
        collapsed={collapsed}
        onToggle={() => actions.setRepositoryScopePanelCollapsed((value) => !value)}
        contentId="workbench-ticket-repositories"
        toggleDisabled={draft !== null}
        actions={
          draft ? undefined : (
            <>
              {workspaceIsReady ? null : (
                <Button
                  aria-busy={workspaceIsPreparing || pending}
                  disabled={disabled}
                  onClick={() => openRepositoryReview(true)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <FolderGit2Icon /> {workspacePreparationActionLabel}
                </Button>
              )}
              <Button
                aria-label="Edit repositories"
                disabled={disabled}
                onClick={() => openRepositoryReview(false)}
                size="xs"
                type="button"
                variant="ghost"
              >
                <PencilIcon /> Edit
              </Button>
            </>
          )
        }
      />
    </>
  );
}

function WorkbenchTicketWorkspaceReviewActions({
  draft,
  presentation,
  actions,
  disabled,
  linkedProjects,
}: Pick<WorkbenchTicketWorkspacePanelInput, "presentation" | "actions"> & {
  readonly draft: WorkbenchRepositoryScopeDraft;
  readonly disabled: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
}) {
  const { pending, preparationPending, workspaceIsPreparing, workspacePreparationActionLabel } =
    presentation;
  const repositoryOptions = useWorkbenchBoardRepositoryOptions(linkedProjects);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={actions.onCancelRepositories}
        size="xs"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
      <Button
        aria-busy={pending || preparationPending || workspaceIsPreparing}
        disabled={
          disabled ||
          !isWorkbenchRepositoryScopeValid({ scope: draft.value, projects: repositoryOptions })
        }
        onClick={() => {
          void actions.onSaveRepositories();
        }}
        size="xs"
        type="button"
      >
        {preparationPending
          ? "Preparing worktrees…"
          : draft.prepare
            ? workspacePreparationActionLabel
            : "Save changes"}
      </Button>
    </>
  );
}

function WorkbenchTicketWorkspaceRepositoryEditor({
  draft,
  ticketWorkspace,
  linkedProjects,
  disabled,
  onRepositoryScopeChange,
  children,
}: Pick<WorkbenchTicketWorkspacePanelProps, "ticketWorkspace" | "onRepositoryScopeChange"> & {
  readonly draft: WorkbenchRepositoryScopeDraft;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly disabled: boolean;
  readonly children: ReactNode;
}) {
  const repositoryOptions = useWorkbenchBoardRepositoryOptions(linkedProjects);
  return (
    <div className="space-y-3">
      <WorkbenchRepositoryScopeFields
        projects={repositoryOptions}
        value={draft.value}
        savedScope={getWorkbenchRepositoryScope(draft.ticket)}
        workspace={ticketWorkspace}
        onChange={onRepositoryScopeChange}
        disabled={disabled}
      />
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Changes apply to future threads. Existing threads and worktrees stay unchanged.
        </p>
        <div className="flex flex-wrap justify-end gap-1">{children}</div>
      </div>
    </div>
  );
}

function WorkbenchTicketAdvancedWorkspace({
  advancedWorkspaceSettingsCollapsed,
  setAdvancedWorkspaceSettingsCollapsed,
  activeAssignments,
  ticketWorkspace,
  pending,
  isArchived,
  setResetConfirmationOpen,
}: Pick<
  WorkbenchTicketWorkspacePanelProps,
  | "advancedWorkspaceSettingsCollapsed"
  | "setAdvancedWorkspaceSettingsCollapsed"
  | "activeAssignments"
  | "ticketWorkspace"
  | "pending"
  | "isArchived"
  | "setResetConfirmationOpen"
> & { ticketWorkspace: WorkbenchTicketWorkspace }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="workbench-ticket-advanced-settings-heading" className="text-xs font-medium">
            Advanced repository settings
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Reset or remove this Ticket&apos;s prepared worktrees.
          </p>
        </div>
        <Button
          aria-controls="workbench-ticket-advanced-settings"
          aria-expanded={!advancedWorkspaceSettingsCollapsed}
          aria-label={
            advancedWorkspaceSettingsCollapsed
              ? "Expand Advanced repository settings"
              : "Collapse Advanced repository settings"
          }
          onClick={() => setAdvancedWorkspaceSettingsCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={
            advancedWorkspaceSettingsCollapsed
              ? "Expand Advanced repository settings"
              : "Collapse Advanced repository settings"
          }
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={advancedWorkspaceSettingsCollapsed ? "" : "rotate-180"} />
        </Button>
      </div>
      {!advancedWorkspaceSettingsCollapsed ? (
        <div
          id="workbench-ticket-advanced-settings"
          className="mt-3 space-y-2"
          aria-labelledby="workbench-ticket-advanced-settings-heading"
        >
          <p className="text-xs text-muted-foreground">
            Remove prepared worktrees when you are done. The Ticket, Git branches, and commits are
            kept. Removal is refused while linked Threads or native Threads using these worktrees
            exist, or any worktree has local changes.
          </p>
          {activeAssignments.length > 0 ? (
            <p className="text-xs text-warning-foreground">
              Removal is currently blocked by {activeAssignments.length} linked{" "}
              {activeAssignments.length === 1 ? "Thread" : "Threads"}.
            </p>
          ) : null}
          {ticketWorkspace.status !== "released" ? (
            <Button
              disabled={pending || isArchived}
              onClick={() => setResetConfirmationOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcwIcon /> Remove prepared worktrees
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              No prepared worktrees to remove. Prepare the worktrees when you are ready to work on
              this Ticket.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchTicketWorkspaceRepositories({
  ticket,
  repositories,
  environmentId,
  keybindings,
  availableEditors,
  isArchived,
  ticketWorkspace,
  workspaceIsPreparing,
  retainedRepositories,
}: Pick<
  WorkbenchTicketWorkspacePanelProps,
  | "ticket"
  | "repositories"
  | "environmentId"
  | "keybindings"
  | "availableEditors"
  | "isArchived"
  | "ticketWorkspace"
  | "workspaceIsPreparing"
  | "retainedRepositories"
>) {
  const worktrees = useWorkbenchTicketWorktrees({ environmentId, ticketId: ticket.id });
  return (
    <div className="divide-y divide-border/50">
      {repositories.map((entry) => (
        <WorkbenchTicketRepositoryRow
          key={entry.id}
          environmentId={environmentId}
          ticketId={ticket.id}
          entry={entry}
          worktrees={worktrees.filter((worktree) => worktree.projectId === entry.id)}
          keybindings={keybindings}
          availableEditors={availableEditors}
          isArchived={isArchived}
          canOpen={ticketWorkspace?.status === "ready" && !workspaceIsPreparing}
        />
      ))}
      {retainedRepositories.length > 0 ? (
        <details className="pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline focus-visible:outline-ring">
            Retained worktrees ({retainedRepositories.length})
          </summary>
          <p className="py-2 text-xs text-muted-foreground">
            Kept for existing threads. Excluded from new thread context.
          </p>
          <div className="divide-y divide-border/50">
            {retainedRepositories.map((entry) => (
              <WorkbenchTicketRepositoryRow
                key={entry.id}
                environmentId={environmentId}
                ticketId={ticket.id}
                entry={entry}
                worktrees={NO_TICKET_WORKTREES}
                keybindings={keybindings}
                availableEditors={availableEditors}
                isArchived={isArchived}
                canOpen={ticketWorkspace?.status === "ready" && !workspaceIsPreparing}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function getWorkbenchWorkspaceDescription({
  workspaceIsPreparing,
  ticketWorkspace,
  workspaceHasSelectedRepositories,
}: Pick<
  WorkbenchTicketWorkspacePanelProps,
  "workspaceIsPreparing" | "ticketWorkspace" | "workspaceHasSelectedRepositories"
>) {
  if (workspaceIsPreparing) return "Preparing the selected repositories.";
  if (ticketWorkspace === undefined)
    return "Review repositories and prepare worktrees for your editor or first Thread.";
  if (ticketWorkspace.status === "ready" && !workspaceHasSelectedRepositories)
    return "Repository selection changed. Prepare worktrees for the missing repositories; existing worktrees stay available.";
  if (ticketWorkspace.status === "released")
    return "No active worktrees. Review repositories before preparing worktrees or creating a Thread.";
  if (ticketWorkspace.status === "failed")
    return "Preparation failed. Retry preparation after resolving the reported repository error.";
  if (ticketWorkspace.status === "releasing") return "Removing prepared worktrees.";
  return "Threads in the same worktree share files and branch changes. Use a separate native worktree for independent work.";
}

type WorkbenchTicketPrimaryThreadProps = Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadMutationsDisabled"
  | "displayedThread"
  | "threadActionPending"
  | "threadActionLabel"
  | "thread"
  | "displayedTitle"
  | "pending"
  | "assignment"
  | "settledAssignments"
  | "onNewThread"
  | "actionableTicket"
  | "onOpenThread"
  | "nativeThread"
  | "nativeStatus"
  | "agentTitle"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "archivedThread"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
>;
/** A row with a Thread is named by it; a start in progress shows in place of its run status. */
function getWorkbenchPrimaryThreadRowLabels({
  thread,
  threadActionPending,
  threadActionLabel,
  displayedThread,
  nativeThread,
  nativeStatus,
  ticketTitle,
}: {
  thread: ReturnType<typeof getWorkbenchThreadPresentation>;
  threadActionPending: boolean;
  threadActionLabel: string | null | undefined;
  displayedThread: EnvironmentThreadShell | undefined;
  nativeThread: EnvironmentThreadShell | undefined;
  nativeStatus: WorkbenchThreadExecutionStatusData | null;
  ticketTitle: string;
}) {
  const progressLabel = threadActionPending
    ? (threadActionLabel ?? thread.pendingActionLabel)
    : null;
  return {
    actionLabel: getWorkbenchThreadRowAction(thread),
    ariaLabel:
      progressLabel === null && displayedThread
        ? undefined
        : `${progressLabel ?? thread.actionLabel} for ${ticketTitle}`,
    executionStatus: progressLabel === null ? nativeStatus : null,
    stateLabel: progressLabel ?? (nativeThread ? null : thread.stateLabel),
  };
}

function WorkbenchTicketPrimaryThread({
  context,
  records,
  presentation,
  actions,
}: {
  context: Pick<WorkbenchTicketPrimaryThreadProps, "threadMutationsDisabled">;
  records: Pick<
    WorkbenchTicketPrimaryThreadProps,
    "displayedThread" | "assignment" | "actionableTicket" | "nativeThread" | "archivedThread"
  >;
  presentation: Pick<
    WorkbenchTicketPrimaryThreadProps,
    | "threadActionPending"
    | "threadActionLabel"
    | "thread"
    | "displayedTitle"
    | "pending"
    | "nativeStatus"
    | "agentTitle"
    | "isArchived"
    | "supportsSettlement"
  >;
  actions: Pick<
    WorkbenchTicketPrimaryThreadProps,
    | "settledAssignments"
    | "onNewThread"
    | "onOpenThread"
    | "onUnlinkThread"
    | "toggleThreadSettlement"
    | "settlementPendingThreadId"
    | "onDeleteThread"
  >;
}) {
  const { threadMutationsDisabled } = context;
  const { displayedThread, assignment, actionableTicket, nativeThread, archivedThread } = records;
  const {
    threadActionPending,
    threadActionLabel,
    thread,
    displayedTitle,
    pending,
    nativeStatus,
    agentTitle,
    isArchived,
    supportsSettlement,
  } = presentation;
  const {
    settledAssignments,
    onNewThread,
    onOpenThread,
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
  } = actions;
  const labels = getWorkbenchPrimaryThreadRowLabels({
    thread,
    threadActionPending,
    threadActionLabel,
    displayedThread,
    nativeThread,
    nativeStatus,
    ticketTitle: displayedTitle,
  });
  return (
    <WorkbenchThreadRow
      thread={displayedThread}
      actionLabel={labels.actionLabel}
      ariaLabel={labels.ariaLabel}
      heading={displayedTitle}
      disabled={isWorkbenchThreadOpenDisabled({
        pending,
        threadMutationsDisabled,
        thread: displayedThread,
      })}
      recencyLabel={displayedThread ? getWorkbenchThreadRecencyLabel(displayedThread) : null}
      onClick={() => {
        if (!assignment && settledAssignments.length > 0) {
          onNewThread(actionableTicket);
          return;
        }
        onOpenThread(actionableTicket, assignment?.threadId);
      }}
      stateLabel={labels.stateLabel}
      executionStatus={labels.executionStatus}
      title={agentTitle}
      menu={
        assignment && displayedThread
          ? {
              disabled: pending || threadMutationsDisabled || isArchived,
              onUnlink: () => onUnlinkThread(assignment.threadId),
              onDelete: () => onDeleteThread(assignment.threadId),
            }
          : undefined
      }
      quickAction={
        assignment && displayedThread && supportsSettlement ? (
          <WorkbenchThreadSettlementButton
            archived={archivedThread !== undefined}
            disabled={
              pending || threadMutationsDisabled || isArchived || archivedThread !== undefined
            }
            onClick={() => void toggleThreadSettlement(displayedThread)}
            pending={settlementPendingThreadId === displayedThread.id}
            settled={displayedThread.settledOverride === "settled"}
            title={displayedThread.title}
          />
        ) : undefined
      }
    />
  );
}

type WorkbenchTicketOtherThreadsProps = Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadMutationsDisabled"
  | "pending"
  | "assignment"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "activeAssignments"
  | "threadsById"
  | "archivedThreadsById"
  | "ticket"
  | "threadLookupReady"
  | "onOpenAssignedThread"
  | "onReplaceThread"
>;
/** A status section of the Ticket's Threads, as in the floating chat's picker. */
function WorkbenchTicketThreadSection({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const panelId = `workbench-ticket-threads-${id}`;
  return (
    <section aria-label={label} className="px-2 pb-2">
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/45"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0", open && "rotate-90")} />
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums">{count}</span>
      </button>
      <div id={panelId} hidden={!open} className="space-y-1">
        {open ? children : null}
      </div>
    </section>
  );
}

function WorkbenchTicketHistoricalThreads({
  threadMutationsDisabled,
  pending,
  isArchived,
  onUnlinkThread,
  supportsSettlement,
  toggleThreadSettlement,
  settlementPendingThreadId,
  onDeleteThread,
  threadsById,
  archivedThreadsById,
  ticket,
  threadLookupReady,
  onOpenAssignedThread,
  historicalAssignments,
}: Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadMutationsDisabled"
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "threadsById"
  | "archivedThreadsById"
  | "ticket"
  | "threadLookupReady"
  | "onOpenAssignedThread"
  | "historicalAssignments"
>) {
  return (
    <div className="border-t border-border/60 px-2 py-3">
      <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Thread history</p>
      <div className="space-y-1">
        {historicalAssignments.map((historicalAssignment) => (
          <WorkbenchTicketHistoricalThreadRow
            key={historicalAssignment.id}
            context={{
              threadMutationsDisabled,
              threadsById: threadsById,
              archivedThreadsById: archivedThreadsById,
              threadLookupReady: threadLookupReady,
            }}
            presentation={{
              pending: pending,
              isArchived: isArchived,
              supportsSettlement: supportsSettlement,
              historicalAssignment: historicalAssignment,
            }}
            actions={{
              onUnlinkThread: onUnlinkThread,
              toggleThreadSettlement: toggleThreadSettlement,
              settlementPendingThreadId: settlementPendingThreadId,
              onDeleteThread: onDeleteThread,
              onOpenAssignedThread: onOpenAssignedThread,
            }}
            records={{ ticket: ticket }}
          />
        ))}
      </div>
    </div>
  );
}

type WorkbenchTicketActiveThreadRowProps = Pick<
  WorkbenchTicketOtherThreadsProps,
  | "threadMutationsDisabled"
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "threadsById"
  | "archivedThreadsById"
  | "ticket"
  | "threadLookupReady"
  | "onOpenAssignedThread"
  | "onReplaceThread"
> & { activeAssignment: WorkbenchAssignment };
function WorkbenchTicketActiveThreadRow({
  context,
  presentation,
  actions,
  records,
}: {
  context: Pick<
    WorkbenchTicketActiveThreadRowProps,
    "threadMutationsDisabled" | "threadsById" | "archivedThreadsById" | "threadLookupReady"
  >;
  presentation: Pick<
    WorkbenchTicketActiveThreadRowProps,
    "pending" | "isArchived" | "supportsSettlement" | "activeAssignment"
  >;
  actions: Pick<
    WorkbenchTicketActiveThreadRowProps,
    | "onUnlinkThread"
    | "toggleThreadSettlement"
    | "settlementPendingThreadId"
    | "onDeleteThread"
    | "onOpenAssignedThread"
    | "onReplaceThread"
  >;
  records: Pick<WorkbenchTicketActiveThreadRowProps, "ticket">;
}) {
  const { threadMutationsDisabled, threadsById, archivedThreadsById, threadLookupReady } = context;
  const { pending, isArchived, supportsSettlement, activeAssignment } = presentation;
  const {
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
    onReplaceThread,
  } = actions;
  const { ticket } = records;
  const remoteRefs = useWorkbenchRemoteRefs();
  const threadLookupState = getWorkbenchThreadLookupState({
    assignment: activeAssignment,
    threadLookupReady,
    remoteEnvironmentStates: remoteRefs.environmentStates,
  });
  const {
    archivedActiveThread,
    displayedActiveThread,
    activeAgentState,
    activeThreadState,
    activeThreadModel,
    activeThreadRecency,
  } = getWorkbenchActiveThreadRow({
    activeAssignment,
    threadsById,
    archivedThreadsById,
    ticket,
    threadLookupState,
  });
  const rowPresentation = getWorkbenchActiveThreadRowPresentation({
    displayedActiveThread,
    activeAgentState,
    activeThreadState,
    activeThreadModel,
    activeThreadRecency,
    missingTitle: getWorkbenchMissingThreadTitle({
      assignment: activeAssignment,
      threadLookupState,
      remoteRefs,
    }),
  });
  const mutationDisabled = pending || threadMutationsDisabled || isArchived;
  return (
    <WorkbenchThreadRow
      thread={displayedActiveThread}
      actionLabel={archivedActiveThread ? "Restore and open" : undefined}
      heading={ticket.title}
      disabled={
        pending ||
        displayedActiveThread === undefined ||
        (threadMutationsDisabled && displayedActiveThread.archivedAt != null)
      }
      recencyLabel={rowPresentation.recencyLabel}
      onClick={() => onOpenAssignedThread(activeAssignment.threadId)}
      stateLabel={rowPresentation.stateLabel}
      executionStatus={rowPresentation.executionStatus}
      title={rowPresentation.title}
      menu={
        displayedActiveThread
          ? {
              disabled: mutationDisabled,
              onUnlink: () => onUnlinkThread(activeAssignment.threadId),
              onDelete: () => onDeleteThread(activeAssignment.threadId),
            }
          : undefined
      }
      quickAction={
        displayedActiveThread ? (
          supportsSettlement ? (
            <WorkbenchThreadSettlementButton
              archived={archivedActiveThread !== undefined}
              disabled={mutationDisabled || archivedActiveThread !== undefined}
              onClick={() => void toggleThreadSettlement(displayedActiveThread)}
              pending={settlementPendingThreadId === displayedActiveThread.id}
              settled={displayedActiveThread.settledOverride === "settled"}
              title={displayedActiveThread.title}
            />
          ) : undefined
        ) : threadLookupState === "ready" ? (
          <Button
            aria-label={`Create replacement Thread for ${ticket.title}`}
            disabled={mutationDisabled}
            onClick={() => onReplaceThread(ticket, activeAssignment.threadId)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Create replacement Thread
          </Button>
        ) : (
          <WorkbenchUnreachableThreadUnlink
            assignment={activeAssignment}
            label={`Unlink ${rowPresentation.title} from ${ticket.title}`}
            disabled={mutationDisabled}
            onUnlinkThread={onUnlinkThread}
          />
        )
      }
    />
  );
}

/** The machine of a loaded Thread that runs off the Board host; an unloaded one names it in its title. */
function WorkbenchThreadRowMachineLabel({
  thread,
}: {
  thread: EnvironmentThreadShell | undefined;
}) {
  const { repositories, environmentStates, environmentLabels } = useWorkbenchRemoteRefs();
  // The page reads a state for each machine its remote Assignments name.
  if (thread === undefined || !environmentStates.has(thread.environmentId)) return null;
  return (
    <span className="max-w-32 truncate">
      {getWorkbenchAssignmentMachineLabel({ assignment: thread, repositories, environmentLabels })}
    </span>
  );
}

/** A Thread on a machine this client cannot reach can still leave the Ticket. */
function WorkbenchUnreachableThreadUnlink({
  assignment,
  label,
  disabled,
  onUnlinkThread,
}: {
  assignment: WorkbenchAssignment;
  label: string;
  disabled: boolean;
  onUnlinkThread: (threadId: ThreadId) => void;
}) {
  if (assignment.environmentId === undefined) return null;
  return (
    <Button
      aria-label={label}
      disabled={disabled}
      onClick={() => onUnlinkThread(assignment.threadId)}
      size="xs"
      type="button"
      variant="ghost"
    >
      Unlink
    </Button>
  );
}

type WorkbenchTicketHistoricalThreadRowProps = Pick<
  Parameters<typeof WorkbenchTicketHistoricalThreads>[0],
  | "threadMutationsDisabled"
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "threadsById"
  | "archivedThreadsById"
  | "ticket"
  | "threadLookupReady"
  | "onOpenAssignedThread"
> & { historicalAssignment: WorkbenchAssignment };
function WorkbenchTicketHistoricalThreadRow({
  context,
  presentation,
  actions,
  records,
}: {
  context: Pick<
    WorkbenchTicketHistoricalThreadRowProps,
    "threadMutationsDisabled" | "threadsById" | "archivedThreadsById" | "threadLookupReady"
  >;
  presentation: Pick<
    WorkbenchTicketHistoricalThreadRowProps,
    "pending" | "isArchived" | "supportsSettlement" | "historicalAssignment"
  >;
  actions: Pick<
    WorkbenchTicketHistoricalThreadRowProps,
    | "onUnlinkThread"
    | "toggleThreadSettlement"
    | "settlementPendingThreadId"
    | "onDeleteThread"
    | "onOpenAssignedThread"
  >;
  records: Pick<WorkbenchTicketHistoricalThreadRowProps, "ticket">;
}) {
  const { threadMutationsDisabled, threadsById, archivedThreadsById, threadLookupReady } = context;
  const { pending, isArchived, supportsSettlement, historicalAssignment } = presentation;
  const {
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
  } = actions;
  const { ticket } = records;
  const { historicalArchivedThread, displayedHistoricalThread, historicalAgentState } =
    getWorkbenchHistoricalThreadRow({
      historicalAssignment,
      threadsById,
      archivedThreadsById,
      ticket,
    });
  const remoteRefs = useWorkbenchRemoteRefs();
  const threadLookupState = getWorkbenchThreadLookupState({
    assignment: historicalAssignment,
    threadLookupReady,
    remoteEnvironmentStates: remoteRefs.environmentStates,
  });
  const rowPresentation = getWorkbenchHistoricalThreadRowPresentation({
    displayedHistoricalThread,
    historicalAgentState,
    threadLookupState,
    missingTitle: getWorkbenchMissingThreadTitle({
      assignment: historicalAssignment,
      threadLookupState,
      remoteRefs,
    }),
  });
  const mutationDisabled = pending || threadMutationsDisabled || isArchived;
  return (
    <WorkbenchThreadRow
      thread={displayedHistoricalThread}
      actionLabel={historicalArchivedThread ? "Restore and open" : "Open Thread"}
      ariaLabel={rowPresentation.ariaLabel}
      heading={ticket.title}
      disabled={
        pending ||
        !displayedHistoricalThread ||
        (threadMutationsDisabled && displayedHistoricalThread.archivedAt != null)
      }
      recencyLabel={rowPresentation.recencyLabel}
      onClick={() => onOpenAssignedThread(historicalAssignment.threadId)}
      stateLabel={rowPresentation.stateLabel}
      executionStatus={rowPresentation.executionStatus}
      title={rowPresentation.title}
      menu={
        displayedHistoricalThread
          ? {
              disabled: mutationDisabled,
              onUnlink: () => onUnlinkThread(historicalAssignment.threadId),
              onDelete: () => onDeleteThread(historicalAssignment.threadId),
            }
          : undefined
      }
      quickAction={
        displayedHistoricalThread ? (
          supportsSettlement ? (
            <WorkbenchThreadSettlementButton
              archived={historicalArchivedThread !== undefined}
              disabled={mutationDisabled || historicalArchivedThread !== undefined}
              onClick={() => void toggleThreadSettlement(displayedHistoricalThread)}
              pending={settlementPendingThreadId === displayedHistoricalThread.id}
              settled={displayedHistoricalThread.settledOverride === "settled"}
              title={displayedHistoricalThread.title}
            />
          ) : undefined
        ) : (
          <WorkbenchUnreachableThreadUnlink
            assignment={historicalAssignment}
            label={`Unlink ${rowPresentation.title} from ${ticket.title}`}
            disabled={mutationDisabled}
            onUnlinkThread={onUnlinkThread}
          />
        )
      }
    />
  );
}

function WorkbenchTicketSettledThreadRow({
  threadMutationsDisabled,
  pending,
  isArchived,
  onUnlinkThread,
  supportsSettlement,
  toggleThreadSettlement,
  settlementPendingThreadId,
  onDeleteThread,
  threadsById,
  archivedThreadsById,
  onOpenAssignedThread,
  settledAssignment,
  heading,
}: Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadMutationsDisabled"
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "threadsById"
  | "archivedThreadsById"
  | "onOpenAssignedThread"
> & { settledAssignment: WorkbenchAssignment; heading: string }) {
  const liveThread = threadsById.get(settledAssignment.threadId);
  const settledThread = liveThread ?? archivedThreadsById.get(settledAssignment.threadId);
  const executionStatus = liveThread ? getWorkbenchThreadExecutionStatus(liveThread) : null;
  if (!settledThread) return null;
  const thread = getWorkbenchThreadPresentation(
    true,
    true,
    "Settled",
    settledThread.archivedAt !== null,
  );
  const mutationDisabled = pending || threadMutationsDisabled || isArchived;
  return (
    <WorkbenchThreadRow
      thread={settledThread}
      actionLabel={getWorkbenchThreadRowAction(thread)}
      heading={heading}
      disabled={isWorkbenchThreadOpenDisabled({
        pending,
        threadMutationsDisabled,
        thread: settledThread,
      })}
      recencyLabel={getWorkbenchThreadRecencyLabel(settledThread)}
      onClick={() => onOpenAssignedThread(settledAssignment.threadId)}
      stateLabel={thread.stateLabel}
      executionStatus={executionStatus}
      title={settledThread.title}
      menu={{
        disabled: mutationDisabled,
        onUnlink: () => onUnlinkThread(settledAssignment.threadId),
        onDelete: () => onDeleteThread(settledAssignment.threadId),
      }}
      quickAction={
        supportsSettlement ? (
          <WorkbenchThreadSettlementButton
            archived={settledThread.archivedAt !== null}
            disabled={mutationDisabled || settledThread.archivedAt !== null}
            onClick={() => void toggleThreadSettlement(settledThread)}
            pending={settlementPendingThreadId === settledThread.id}
            settled
            title={settledThread.title}
          />
        ) : undefined
      }
    />
  );
}

export function WorkbenchCreateTicketRepositories({
  linkedProjects,
  selectedRepositoryProjectIds,
  setRepositoryProjectIds,
}: Pick<Parameters<typeof WorkbenchTicketDialog>[0], "linkedProjects"> & {
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
  setRepositoryProjectIds: Dispatch<SetStateAction<ReadonlyArray<ProjectId>>>;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">Repository scope</legend>
      <p className="text-xs text-muted-foreground">
        Select every repository this Ticket may need. Each Thread works in one of them.
      </p>
      {linkedProjects.length > 0 ? (
        <div className="space-y-3">
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {linkedProjects.map((project) => {
              const checked = selectedRepositoryProjectIds.includes(project.id);
              const inputId = `workbench-ticket-repository-${project.id}`;
              return (
                <label
                  key={project.id}
                  htmlFor={inputId}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
                >
                  <Checkbox
                    id={inputId}
                    className="mt-0.5"
                    checked={checked}
                    disabled={checked && selectedRepositoryProjectIds.length === 1}
                    onCheckedChange={(nextChecked) =>
                      setRepositoryProjectIds(
                        nextChecked
                          ? [...selectedRepositoryProjectIds, project.id]
                          : selectedRepositoryProjectIds.filter((id) => id !== project.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.title}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {project.workspaceRoot}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground">
          This Board has no available linked repositories.
        </div>
      )}
    </fieldset>
  );
}

function WorkbenchWorkspaceRepositories({
  options,
  pending,
  editing,
  initialKeys,
  linkedKeys,
  setAddedKeys,
  needsHostProject,
}: {
  options: ReadonlyArray<WorkbenchBoardProjectOption & { readonly workspaceRoot: string }>;
  pending: boolean;
  editing: boolean;
  initialKeys: ReadonlySet<string>;
  linkedKeys: ReadonlySet<string>;
  setAddedKeys: Dispatch<SetStateAction<ReadonlySet<string>>>;
  needsHostProject: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Linked repositories</legend>
      <p className="text-xs text-muted-foreground">
        {editing
          ? "Already-linked repositories stay selected. Add a directory as a T3 Project first if it is not listed here."
          : "Tickets can target any selected T3 Project, on this machine or another connected one."}
      </p>
      {options.length > 0 ? (
        <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
          {options.map((option) => {
            const key = workbenchBoardProjectOptionKey(option);
            const inputId = `workbench-project-${key}`;
            const unavailable = getWorkbenchBoardProjectUnavailableReason({
              option,
              options,
              selectedKeys: linkedKeys,
            });
            return (
              <label
                key={key}
                htmlFor={inputId}
                className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
              >
                <Checkbox
                  id={inputId}
                  className="mt-0.5"
                  checked={linkedKeys.has(key)}
                  disabled={pending || initialKeys.has(key) || unavailable !== null}
                  onCheckedChange={(checked) =>
                    setAddedKeys((current) => {
                      const next = new Set(current);
                      if (checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{option.title}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {option.environmentLabel === null
                      ? option.workspaceRoot
                      : `${option.environmentLabel} · ${option.workspaceRoot}`}
                  </span>
                  {unavailable ? (
                    <span className="block text-xs text-muted-foreground">{unavailable}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {editing
            ? "No T3 Projects are available to add. Existing repository links are preserved."
            : "Create a T3 Project before creating a Board."}
        </div>
      )}
      {needsHostProject ? (
        <p role="status" className="text-xs text-muted-foreground">
          Select at least one Project on this machine. Ticket planning runs here.
        </p>
      ) : null}
    </fieldset>
  );
}

function WorkbenchTicketSummaryContent({
  hasUnsavedChanges,
  summary,
  ticket,
  displayedTitle,
  pending,
  isArchived,
  onRegenerateSummary,
}: Pick<
  Parameters<typeof WorkbenchTicketSummaryPanel>[0],
  | "hasUnsavedChanges"
  | "summary"
  | "ticket"
  | "displayedTitle"
  | "pending"
  | "isArchived"
  | "onRegenerateSummary"
>) {
  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm leading-relaxed text-muted-foreground">{summary.text}</p>
          {summary.error ? (
            <p className="mt-1 break-words text-xs text-warning-foreground" role="status">
              {summary.error}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={`${getWorkbenchTicketSummaryActionLabel(ticket.generatedSummary)} for ${displayedTitle}`}
          disabled={
            pending ||
            isArchived ||
            ticket.generatedSummary?.status === "pending" ||
            hasUnsavedChanges
          }
          onClick={() => onRegenerateSummary(ticket)}
          size="xs"
          type="button"
          variant="outline"
        >
          {getWorkbenchTicketSummaryActionLabel(ticket.generatedSummary)}
        </Button>
      </div>
    </div>
  );
}

type WorkbenchTicketHeadingProps = Pick<
  WorkbenchTicketHeaderProps,
  | "executionStatus"
  | "workspaceTitle"
  | "displayedTitle"
  | "ticket"
  | "issue"
  | "isArchived"
  | "environmentId"
  | "actionableTicket"
  | "pending"
  | "editing"
  | "onUpdate"
  | "titleWords"
>;
function WorkbenchTicketHeading({
  presentation,
  records,
  context,
  actions,
}: {
  presentation: Pick<
    WorkbenchTicketHeadingProps,
    | "executionStatus"
    | "workspaceTitle"
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "editing"
    | "titleWords"
  >;
  records: Pick<WorkbenchTicketHeadingProps, "ticket" | "issue" | "actionableTicket">;
  context: Pick<WorkbenchTicketHeadingProps, "environmentId">;
  actions: Pick<WorkbenchTicketHeadingProps, "onUpdate">;
}) {
  const {
    executionStatus,
    workspaceTitle,
    displayedTitle,
    isArchived,
    pending,
    editing,
    titleWords,
  } = presentation;
  const { ticket, issue, actionableTicket } = records;
  const { environmentId } = context;
  const { onUpdate } = actions;
  return (
    <div className="col-span-2 row-start-2 min-w-0 @min-[48rem]/ticket:col-span-1 @min-[48rem]/ticket:col-start-2 @min-[48rem]/ticket:row-start-1">
      <p className="text-xs font-medium text-muted-foreground">{workspaceTitle} · Ticket</p>
      <h1 className="mt-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">
        {titleWords ? (
          <WorkbenchWordDiff segments={titleWords} />
        ) : (
          displayedTitle.trim() || ticket.title
        )}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <WorkbenchThreadExecutionStatus
          status={executionStatus?.presentation}
          startedAt={executionStatus?.startedAt}
        />
        <WorkbenchTicketAttentionBadge
          environmentId={environmentId}
          ticketId={ticket.id}
          ticketTitle={ticket.title}
        />
        {issue ? <WorkbenchReferenceBadge reference={issue} size="control" /> : null}
        {ticket.archivedAt != null ? (
          <Badge size="control" variant="outline">
            Archived
          </Badge>
        ) : null}
        <WorkbenchTicketStatusMenu
          ticket={actionableTicket}
          disabled={pending || isArchived || editing}
          onStatusChange={(status) => onUpdate(actionableTicket, { status })}
          trigger={
            <Button size="xs" variant="outline" className="max-w-48">
              <span className="truncate">{WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}</span>
              <ChevronDownIcon />
            </Button>
          }
        />
      </div>
    </div>
  );
}

function getWorkbenchActiveThreadRow({
  activeAssignment,
  threadsById,
  archivedThreadsById,
  threadLookupState,
}: Pick<
  WorkbenchTicketActiveThreadRowProps,
  "activeAssignment" | "threadsById" | "archivedThreadsById" | "ticket"
> & { threadLookupState: WorkbenchThreadLookupState }) {
  const liveThread = threadsById.get(activeAssignment.threadId);
  const archivedActiveThread = isWorkbenchThreadArchived(
    activeAssignment.threadId,
    threadsById,
    archivedThreadsById,
  )
    ? archivedThreadsById.get(activeAssignment.threadId)
    : undefined;
  const displayedActiveThread = liveThread ?? archivedActiveThread;
  const activeAgentState = liveThread ? getWorkbenchThreadExecutionStatus(liveThread) : null;
  const activeThreadState = getWorkbenchThreadPresentation(
    true,
    liveThread !== undefined,
    null,
    archivedActiveThread !== undefined,
    threadLookupState,
  ).stateLabel;
  const activeThreadModel = getWorkbenchThreadModelLabel(displayedActiveThread);
  const activeThreadRecency = displayedActiveThread
    ? getWorkbenchThreadRecencyLabel(displayedActiveThread)
    : null;
  return {
    archivedActiveThread,
    displayedActiveThread,
    activeAgentState,
    activeThreadState,
    activeThreadModel,
    activeThreadRecency,
  };
}

function getWorkbenchHistoricalThreadRow({
  historicalAssignment,
  threadsById,
  archivedThreadsById,
}: Pick<
  WorkbenchTicketHistoricalThreadRowProps,
  "historicalAssignment" | "threadsById" | "archivedThreadsById" | "ticket"
>) {
  const historicalThread = threadsById.get(historicalAssignment.threadId);
  const historicalArchivedThread = isWorkbenchThreadArchived(
    historicalAssignment.threadId,
    threadsById,
    archivedThreadsById,
  )
    ? archivedThreadsById.get(historicalAssignment.threadId)
    : undefined;
  const displayedHistoricalThread = historicalThread ?? historicalArchivedThread;
  const historicalAgentState = historicalThread
    ? getWorkbenchThreadExecutionStatus(historicalThread)
    : null;
  return {
    historicalArchivedThread,
    displayedHistoricalThread,
    historicalAgentState,
  };
}

function useWorkbenchTicketDraftEditor({
  environmentId,
  ticket,
  workspaceReadOnly,
}: Pick<WorkbenchTicketDetailProps, "environmentId" | "ticket" | "workspaceReadOnly">) {
  const storedDraft = useWorkbenchDraftStore((state) =>
    state.drafts.get(environmentId)?.get(ticket.id),
  );
  const draftProjected = isWorkbenchDraftProjected({ draft: storedDraft, ticket });
  const draft =
    draftProjected || (workspaceReadOnly && storedDraft?.mode === "editing")
      ? undefined
      : storedDraft;
  const setDraft = useWorkbenchDraftStore((state) => state.setDraft);
  const markDraftSaved = useWorkbenchDraftStore((state) => state.markDraftSaved);
  const clearDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  const {
    isArchived,
    editing,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    summaryFailedEmpty,
    hasUnsavedChanges,
  } = getWorkbenchTicketDraftPresentation({
    ticket,
    draft,
    workspaceReadOnly: workspaceReadOnly ?? false,
  });
  const cancelEditing = () => {
    clearDraft(environmentId, ticket.id);
  };
  const startEditing = () => {
    setDraft(environmentId, ticket.id, {
      title: displayedTitle,
      markdown: displayedMarkdown,
      mode: "editing",
      revision: ticket.revision,
    });
  };

  return {
    draft,
    setDraft,
    markDraftSaved,
    isArchived,
    editing,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    summaryFailedEmpty,
    hasUnsavedChanges,
    cancelEditing,
    startEditing,
  };
}

function getWorkbenchDetailAssignments({
  assignments,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  remoteEnvironmentStates,
  ticket,
}: Pick<
  WorkbenchTicketDetailProps,
  "assignments" | "threadsById" | "archivedThreadsById" | "threadLookupReady" | "ticket"
> & {
  remoteEnvironmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState>;
}) {
  const visibleAssignments = assignments.filter(
    (assignment) =>
      assignment.supersededAt === null ||
      getWorkbenchThreadLookupState({ assignment, threadLookupReady, remoteEnvironmentStates }) !==
        "ready" ||
      threadsById.has(assignment.threadId) ||
      archivedThreadsById.has(assignment.threadId),
  );
  const threadSections = getWorkbenchTicketThreadSections({
    assignments: visibleAssignments,
    threadsById,
    archivedThreadsById,
  });
  const activeAssignments = threadSections.active;
  const historicalAssignments = threadSections.history;
  const settledAssignments = threadSections.settled;
  const associatedPullRequests = getWorkbenchTicketPullRequests({
    assignments: visibleAssignments,
    threadsById,
    archivedThreadsById,
  });
  const assignment = getActiveAssignmentsByTicket({
    assignments: activeAssignments,
    liveThreadIds: new Set(threadsById.keys()),
    archivedThreadIds: new Set(archivedThreadsById.keys()),
    workingThreadIds: new Set(
      [...threadsById.values()]
        .filter((thread) => getWorkbenchThreadExecutionStatus(thread)?.kind === "working")
        .map((thread) => thread.id),
    ),
  }).get(ticket.id);
  return {
    activeAssignments,
    historicalAssignments,
    settledAssignments,
    associatedPullRequests,
    assignment,
    // The floating chat talks to the Board host; a Thread on another machine opens on its own page.
    chatAssignments: {
      active: activeAssignments.filter(isWorkbenchHostAssignment),
      settled: settledAssignments.filter(isWorkbenchHostAssignment),
      primary: assignment && isWorkbenchHostAssignment(assignment) ? assignment : undefined,
    },
  };
}

function getWorkbenchDetailWorkspace({
  ticket,
  ticketWorkspace,
  preparationPending,
  preparationFailed,
  linkedProjects,
  remoteRepositoryIds,
}: Pick<
  WorkbenchTicketDetailProps,
  "ticket" | "ticketWorkspace" | "preparationPending" | "preparationFailed" | "linkedProjects"
> & {
  /** Repositories on other machines, which get no worktrees on the Board host. */
  remoteRepositoryIds: ReadonlySet<ProjectId>;
}) {
  const repositoryScopeLocked =
    preparationPending ||
    ticketWorkspace?.status === "preparing" ||
    ticketWorkspace?.status === "releasing";
  const selectedRepositoryProjectIds = ticket.repositoryProjectIds;
  const workspaceHasSelectedRepositories = selectedRepositoryProjectIds
    .filter((projectId) => !remoteRepositoryIds.has(projectId))
    .every((projectId) =>
      ticketWorkspace?.repositories.some(
        (repository) => repository.projectId === projectId && repository.status === "ready",
      ),
    );
  const selectedRepositoryProjectIdSet = new Set(selectedRepositoryProjectIds);
  const workspaceIsReady = ticketWorkspace?.status === "ready" && workspaceHasSelectedRepositories;
  const workspaceIsPreparing = preparationPending || ticketWorkspace?.status === "preparing";
  const workspaceHasFailure =
    !workspaceIsReady && (preparationFailed || ticketWorkspace?.status === "failed");
  const workspaceStatusLabel = getWorkbenchWorkspaceStatusLabel({
    workspaceIsPreparing,
    workspaceHasFailure,
    ticketWorkspace,
    workspaceIsReady,
  });
  const workspacePreparationActionLabel: WorkbenchTicketWorkspacePanelProps["workspacePreparationActionLabel"] =
    workspaceIsPreparing
      ? "Preparing worktrees…"
      : workspaceHasFailure
        ? "Retry preparation"
        : "Prepare worktrees";
  const repositories = selectedRepositoryProjectIds.map((id) => {
    const repository = linkedProjects.find((project) => project.id === id);
    const workspaceRepository = ticketWorkspace?.repositories.find(
      (candidate) => candidate.projectId === id,
    );
    const preparedRepository =
      workspaceRepository?.status === "ready" ? workspaceRepository : undefined;
    return {
      id,
      repository,
      openInCwd: preparedRepository?.worktreePath ?? null,
      workspaceRepository,
    };
  });
  const retainedRepositories = (ticketWorkspace?.repositories ?? [])
    .filter(
      (repository) =>
        repository.status === "ready" && !selectedRepositoryProjectIdSet.has(repository.projectId),
    )
    .map((workspaceRepository) => ({
      id: workspaceRepository.projectId,
      repository: linkedProjects.find((project) => project.id === workspaceRepository.projectId),
      openInCwd: workspaceRepository.worktreePath,
      workspaceRepository,
    }));
  return {
    repositoryScopeLocked,
    selectedRepositoryProjectIds,
    workspaceHasSelectedRepositories,
    workspaceIsReady,
    workspaceIsPreparing,
    workspaceStatusLabel,
    workspacePreparationActionLabel,
    repositories,
    retainedRepositories,
  };
}

function useWorkbenchTicketDetailPanels() {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [threadPanelCollapsed, setThreadPanelCollapsed] =
    useWorkbenchTicketPanelCollapsed("threads");
  const [repositoryScopePanelCollapsed, setRepositoryScopePanelCollapsed] = useState(false);
  const [advancedWorkspaceSettingsCollapsed, setAdvancedWorkspaceSettingsCollapsed] =
    useState(true);
  return {
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    resetConfirmationOpen,
    setResetConfirmationOpen,
    threadPanelCollapsed,
    setThreadPanelCollapsed,
    repositoryScopePanelCollapsed,
    setRepositoryScopePanelCollapsed,
    advancedWorkspaceSettingsCollapsed,
    setAdvancedWorkspaceSettingsCollapsed,
  };
}

function getWorkbenchDetailThread({
  assignment,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  remoteEnvironmentStates,
}: Pick<
  WorkbenchTicketDetailProps,
  "threadsById" | "archivedThreadsById" | "threadLookupReady" | "ticket"
> & {
  assignment: WorkbenchAssignment | undefined;
  remoteEnvironmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState>;
}) {
  const nativeThread = assignment ? threadsById.get(assignment.threadId) : undefined;
  const archivedThread =
    assignment && isWorkbenchThreadArchived(assignment.threadId, threadsById, archivedThreadsById)
      ? archivedThreadsById.get(assignment.threadId)
      : undefined;
  const displayedThread = nativeThread ?? archivedThread;
  const nativeStatus = nativeThread ? getWorkbenchThreadExecutionStatus(nativeThread) : null;
  const thread = getWorkbenchThreadPresentation(
    assignment !== undefined,
    nativeThread !== undefined,
    nativeStatus?.presentation.label ?? null,
    archivedThread !== undefined,
    assignment === undefined
      ? "ready"
      : getWorkbenchThreadLookupState({ assignment, threadLookupReady, remoteEnvironmentStates }),
  );
  return {
    nativeThread,
    archivedThread,
    displayedThread,
    nativeStatus,

    thread,
  };
}

function WorkbenchTicketActionsMenu({
  isArchived,
  pending,
  ticket,
  issue,
  lifecycleActionsEnabled,
  onArchive,
  setDeleteConfirmationOpen,
}: Pick<
  WorkbenchTicketHeaderProps,
  | "isArchived"
  | "pending"
  | "ticket"
  | "issue"
  | "lifecycleActionsEnabled"
  | "onArchive"
  | "setDeleteConfirmationOpen"
>) {
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Ticket actions" size="icon-sm" variant="ghost" />}>
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <WorkbenchTicketCopyMenuItems ticketId={ticket.id} issue={issue} />
        </MenuGroup>
        {lifecycleActionsEnabled ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem
                disabled={pending}
                onClick={() => void onArchive(ticket, isArchived ? null : new Date().toISOString())}
              >
                {isArchived ? <RotateCcwIcon /> : <ArchiveIcon />}
                {isArchived ? "Restore Ticket" : "Archive Ticket"}
              </MenuItem>
              <MenuItem
                disabled={pending}
                onClick={() => setDeleteConfirmationOpen(true)}
                variant="destructive"
              >
                <Trash2Icon /> Delete Ticket
              </MenuItem>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function WorkbenchTicketThreadCreationActions({
  onNewThread,
  onAttachThread,
  pending,
  isArchived,
  ticket,
}: Pick<
  WorkbenchTicketThreadsPanelProps,
  "onNewThread" | "onAttachThread" | "pending" | "isArchived" | "ticket"
>) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/60 px-4 py-3">
      <Button
        disabled={pending || isArchived}
        onClick={() => onNewThread(ticket)}
        size="xs"
        type="button"
        variant="outline"
      >
        <PlusIcon /> Create Thread
      </Button>
      <Button
        disabled={pending || isArchived}
        onClick={() => onAttachThread(ticket)}
        size="xs"
        type="button"
        variant="outline"
      >
        <LinkIcon /> Link existing Thread
      </Button>
    </div>
  );
}

/** The Board's repositories a Ticket can scope: this machine's, then those on other machines. */
function useWorkbenchBoardRepositoryOptions(
  linkedProjects: ReadonlyArray<Project>,
): ReadonlyArray<Pick<Project, "id" | "title">> {
  const { repositories } = useWorkbenchRemoteRefs();
  return [
    ...linkedProjects,
    ...[...repositories.values()].map((repository) => ({
      id: repository.id,
      title: formatWorkbenchRemoteRepositoryTitle(repository),
    })),
  ];
}

/** The row title of an assigned Thread that is not loaded: deleted, unchecked, or out of reach. */
function getWorkbenchMissingThreadTitle({
  assignment,
  threadLookupState,
  remoteRefs,
}: {
  assignment: WorkbenchAssignment;
  threadLookupState: WorkbenchThreadLookupState;
  remoteRefs: ReturnType<typeof useWorkbenchRemoteRefs>;
}) {
  if (threadLookupState === "ready") return "Thread deleted";
  if (assignment.environmentId === undefined) return "Checking Thread…";
  return `Thread on ${getWorkbenchAssignmentMachineLabel({
    assignment,
    repositories: remoteRefs.repositories,
    environmentLabels: remoteRefs.environmentLabels,
  })}`;
}

function getWorkbenchActiveThreadRowPresentation({
  displayedActiveThread,
  activeAgentState,
  activeThreadState,
  activeThreadModel,
  activeThreadRecency,
  missingTitle,
}: Pick<
  ReturnType<typeof getWorkbenchActiveThreadRow>,
  | "displayedActiveThread"
  | "activeAgentState"
  | "activeThreadState"
  | "activeThreadModel"
  | "activeThreadRecency"
> & { missingTitle: string }) {
  return {
    modelLabel: activeThreadModel,
    recencyLabel: activeThreadRecency,
    stateLabel: displayedActiveThread?.archivedAt
      ? "Archived"
      : displayedActiveThread
        ? null
        : activeThreadState,
    executionStatus: activeAgentState,
    title: displayedActiveThread?.title ?? missingTitle,
  };
}

function getWorkbenchHistoricalThreadRowPresentation({
  displayedHistoricalThread,
  historicalAgentState,
  threadLookupState,
  missingTitle,
}: Pick<
  ReturnType<typeof getWorkbenchHistoricalThreadRow>,
  "displayedHistoricalThread" | "historicalAgentState"
> & { threadLookupState: WorkbenchThreadLookupState; missingTitle: string }) {
  return {
    ariaLabel: `${displayedHistoricalThread?.archivedAt ? "Restore and open" : displayedHistoricalThread ? "Open" : "Checking"} ${displayedHistoricalThread?.title ?? missingTitle}`,
    modelLabel: getWorkbenchThreadModelLabel(displayedHistoricalThread),
    recencyLabel: displayedHistoricalThread
      ? getWorkbenchThreadRecencyLabel(displayedHistoricalThread)
      : null,
    stateLabel: displayedHistoricalThread
      ? displayedHistoricalThread.archivedAt
        ? "Archived"
        : "Historical"
      : threadLookupState === "ready"
        ? "Thread deleted"
        : threadLookupState === "offline"
          ? "Offline"
          : "Checking…",
    executionStatus: historicalAgentState,
    title: displayedHistoricalThread?.title ?? missingTitle,
  };
}

function getWorkbenchWorkspaceStatusLabel({
  workspaceIsPreparing,
  workspaceHasFailure,
  ticketWorkspace,
  workspaceIsReady,
}: {
  workspaceIsPreparing: boolean;
  workspaceHasFailure: boolean;
  ticketWorkspace: WorkbenchTicketWorkspace | undefined;
  workspaceIsReady: boolean;
}): WorkbenchTicketWorkspacePanelProps["workspaceStatusLabel"] {
  if (workspaceIsPreparing) return "Preparing";
  if (workspaceHasFailure) return "Preparation failed";
  if (ticketWorkspace === undefined) return "Not prepared";
  if (ticketWorkspace.status === "releasing") return "Releasing";
  if (ticketWorkspace.status === "released") return "Released";
  return workspaceIsReady ? "Ready" : "Needs preparation";
}

function getWorkbenchThreadModelLabel(thread: EnvironmentThreadShell | undefined) {
  return thread?.modelSelection
    ? `${thread.modelSelection.instanceId} · ${thread.modelSelection.model}`
    : null;
}

function useWorkbenchCreateTicketDraft({
  pending,
  onOpenChange,
}: Pick<Parameters<typeof WorkbenchTicketDialog>[0], "pending" | "onOpenChange">) {
  const [requestId, setRequestId] = useState(() => WorkbenchTicketId.make(randomUUID()));
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState(WORKBENCH_TICKET_TEMPLATE);
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [references, setReferences] = useState<ReadonlyArray<WorkbenchReferenceDraft>>([]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) {
      setReferences([]);
      setRequestId(WorkbenchTicketId.make(randomUUID()));
      setTitle("");
      setMarkdown(WORKBENCH_TICKET_TEMPLATE);
      setRepositoryProjectIds([]);
    }
    onOpenChange(nextOpen);
  };
  return {
    requestId,
    title,
    setTitle,
    markdown,
    setMarkdown,
    repositoryProjectIds,
    setRepositoryProjectIds,
    references,
    setReferences,
    handleOpenChange,
  };
}

function getWorkbenchCreateTicketRepositories({
  linkedProjects,
  repositoryProjectIds,
}: {
  linkedProjects: ReadonlyArray<Project>;
  repositoryProjectIds: ReadonlyArray<ProjectId>;
}) {
  const availableProjectIds = new Set(linkedProjects.map((project) => project.id));
  const selectedRepositoryProjectIds = repositoryProjectIds.filter((id) =>
    availableProjectIds.has(id),
  );
  if (selectedRepositoryProjectIds.length === 0 && linkedProjects[0]) {
    selectedRepositoryProjectIds.push(linkedProjects[0].id);
  }
  return { selectedRepositoryProjectIds };
}

function getWorkbenchTicketDraftPresentation({
  ticket,
  draft,
  workspaceReadOnly,
}: Pick<WorkbenchTicketDetailProps, "ticket" | "workspaceReadOnly"> & {
  draft: WorkbenchTicketDraft | undefined;
}) {
  const isArchived = ticket.archivedAt != null || workspaceReadOnly === true;
  const editing = !isArchived && draft?.mode === "editing";
  const displayedTitle = draft?.title ?? ticket.title;
  const displayedMarkdown = draft?.markdown ?? ticket.markdown;
  const actionableTicket =
    draft?.mode === "saved"
      ? { ...ticket, title: displayedTitle, markdown: displayedMarkdown }
      : ticket;
  const dirty = editing && (draft.title !== ticket.title || draft.markdown !== ticket.markdown);
  const summary = getWorkbenchTicketSummaryPresentation(ticket.generatedSummary);
  const summaryFailedEmpty = Boolean(summary.error && !summary.hasText);
  const summaryHeaderLabel = summaryFailedEmpty
    ? "Summary generation failed"
    : (summary.statusLabel ?? (!summary.hasText ? summary.text : null));
  const hasUnsavedChanges = dirty;

  return {
    isArchived,
    editing,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    summaryFailedEmpty,
    hasUnsavedChanges,
  };
}

function WorkbenchTicketDeleteConfirmation({
  displayedTitle,
  error,
  pending,
  disabled,
  ticket,
  onDelete,
  deleteConfirmationOpen,
  setDeleteConfirmationOpen,
}: Pick<WorkbenchTicketDetailProps, "error" | "pending" | "ticket" | "onDelete"> & {
  disabled: boolean;
  displayedTitle: string;
  deleteConfirmationOpen: boolean;
  setDeleteConfirmationOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <AlertDialog open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{displayedTitle}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the local Ticket from Workbench. Its Threads and prepared worktrees are
            kept.
          </AlertDialogDescription>
          {error ? <WorkbenchInlineError message={error} /> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            disabled={disabled || pending}
            onClick={() => {
              void (async () => {
                if (!(await onDelete(ticket))) return;
                setDeleteConfirmationOpen(false);
              })();
            }}
            variant="destructive"
          >
            <Trash2Icon /> Delete Ticket
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function WorkbenchTicketResetConfirmation({
  displayedTitle,
  error,
  pending,
  disabled,
  ticket,
  onResetWorkspace,
  resetConfirmationOpen,
  setResetConfirmationOpen,
}: Pick<WorkbenchTicketDetailProps, "error" | "pending" | "ticket" | "onResetWorkspace"> & {
  disabled: boolean;
  displayedTitle: string;
  resetConfirmationOpen: boolean;
  setResetConfirmationOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <AlertDialog open={resetConfirmationOpen} onOpenChange={setResetConfirmationOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove prepared worktrees for “{displayedTitle}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes this Ticket&apos;s prepared repository worktrees. The Ticket, Git branches,
            and commits are kept. Removal is refused while linked Threads or native Threads using
            these worktrees exist, or any worktree has local changes. Prepare the worktrees again
            whenever you need it.
          </AlertDialogDescription>
          {error ? <WorkbenchInlineError message={error} /> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={pending} variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            disabled={disabled || pending}
            onClick={() => {
              void (async () => {
                if (!(await onResetWorkspace(ticket))) return;
                setResetConfirmationOpen(false);
              })();
            }}
            variant="destructive"
          >
            <RotateCcwIcon /> {pending ? "Removing worktrees…" : "Remove prepared worktrees"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function getWorkbenchAgentTitle({
  displayedThread,
  assignment,
  threadState,
  settledCount,
}: {
  displayedThread: EnvironmentThreadShell | undefined;
  assignment: WorkbenchAssignment | undefined;
  threadState: ReturnType<typeof getWorkbenchThreadPresentation>["state"];
  settledCount: number;
}) {
  if (displayedThread) return displayedThread.title;
  if (assignment && threadState === "checking") return "Checking Thread…";
  if (assignment && threadState === "offline") return "Thread on another machine";
  return settledCount > 0 ? "No active Threads" : "No Threads yet";
}
