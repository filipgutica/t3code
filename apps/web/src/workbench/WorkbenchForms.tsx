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
import { WorkbenchRepositorySelectOptions } from "./WorkbenchRepositorySelectOptions";
import {
  WorkbenchTicketAttentionBadge,
  WorkbenchTicketAttentionPanel,
} from "./WorkbenchTicketAttention";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  type EditorId,
  ProjectId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchCreateTicketInput,
  type WorkbenchEpic,
  WorkbenchEpicId,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchReference,
  type WorkbenchTicket,
  WorkbenchTicketId,
  type WorkbenchReferenceDraft,
  type WorkbenchTicketKind,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArchiveIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CheckIcon,
  FolderGit2Icon,
  LinkIcon,
  Layers3Icon,
  ListChecksIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import {
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
  type ReactNode,
} from "react";
import { WorkbenchTicketStatusMenu } from "./WorkbenchTicketStatusMenu";

import { WorkbenchThreadExecutionStatus } from "./WorkbenchThreadExecutionStatus";
import {
  getWorkbenchThreadExecutionStatus,
  getWorkbenchTicketExecutionStatuses,
  type WorkbenchThreadExecutionStatus as WorkbenchThreadExecutionStatusData,
} from "./workbenchThreadStatus.logic";
import { getWorkbenchThreadStatusSections } from "./workbenchFloatingChat.logic";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { cn } from "../lib/utils";
import type { WorkbenchFloatingChatPlanning } from "./WorkbenchFloatingChat";
import {
  getWorkbenchFloatingChatInset,
  WorkbenchTicketFloatingChat,
} from "./WorkbenchTicketFloatingChat";
import { isElectron } from "../env";

import { Badge } from "../components/ui/badge";
import { OpenInPicker } from "../components/chat/OpenInPicker";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useThreadActions } from "../hooks/useThreadActions";
import { randomUUID } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  getWorkbenchEpicProgress,
  getActiveAssignmentsByTicket,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  getWorkbenchTicketThreadSections,
  isWorkbenchThreadArchived,
  WORKBENCH_TICKET_KINDS,
  WORKBENCH_TICKET_KIND_LABELS,
  WORKBENCH_TICKET_STATUS_LABELS,
  getWorkbenchTicketTemplate,
  isWorkbenchTicketKind,
} from "./workbench.logic";
import {
  isWorkbenchDraftProjected,
  useWorkbenchDraftStore,
  type WorkbenchTicketSavedVersion,
  type WorkbenchTicketDraft,
} from "./workbenchDraftStore";
import { WorkbenchDescription } from "./WorkbenchDescription";
import {
  useWorkbenchCheckoutStatusRefresh,
  WorkbenchCheckoutDirectory,
  WorkbenchCheckoutDetails,
  WorkbenchThreadCheckoutDetails,
} from "./WorkbenchCheckoutDetails";
import {
  WorkbenchJiraIssueKeyLink,
  WorkbenchTicketTypeBadge,
  WorkbenchTicketCopyMenuItems,
} from "./WorkbenchTicketMetadata";
import { WorkbenchEpicJiraIssueLinkField } from "./WorkbenchJiraIssueLink";
import {
  WorkbenchProvenanceBadge,
  WorkbenchReferenceBadge,
  WorkbenchStagedReferences,
  WorkbenchTicketReferencesPanel,
  workbenchThreadTitle,
} from "./WorkbenchReferences";
import {
  getReferenceFileCwd,
  getTicketIssue,
  hasJiraReference,
  splitWorkbenchReferences,
} from "./workbenchReferences.logic";
import { WorkbenchTicketPullRequests } from "./WorkbenchTicketPullRequests";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import {
  getWorkbenchTicketPullRequests,
  getWorkbenchTicketPullRequestCheckouts,
} from "./workbenchPullRequests.logic";

const NO_EPIC_VALUE = "__workbench_no_epic__";
const CREATE_EPIC_VALUE = "__workbench_create_epic__";

function useWorkbenchEpicEditor(epic: WorkbenchEpic) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const cancelEditing = () => setEditing(false);
  const startEditing = () => {
    setTitle(epic.title);
    setMarkdown(epic.markdown);
    setEditing(true);
  };
  return {
    editing,
    title,
    markdown,
    setTitle,
    setMarkdown,
    setEditing,
    cancelEditing,
    startEditing,
  };
}

export function WorkbenchEpicDetail({
  environmentId,
  workspaceTitle,
  readOnly = false,
  epic,
  tickets,
  repositoriesById,
  assignmentsByTicket,
  pending,
  error,
  onBack,
  actions,
  onOpenTicket,
  onCreateTicket,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspaceTitle: string;
  readonly readOnly?: boolean;
  readonly epic: WorkbenchEpic;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly repositoriesById: ReadonlyMap<Project["id"], Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicket["id"], WorkbenchAssignment>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly actions: {
    readonly lifecycleSupported: boolean;
    readonly canArchive: boolean;
    readonly onArchive: (epic: WorkbenchEpic, archivedAt: string | null) => Promise<boolean>;
    readonly onSave: (epic: WorkbenchEpic, title: string, markdown: string) => Promise<boolean>;
  };
  readonly onBack: () => void;
  readonly onOpenTicket: (ticketId: WorkbenchTicket["id"]) => void;
  readonly onCreateTicket: () => void;
}) {
  const {
    editing,
    title,
    markdown,
    setTitle,
    setMarkdown,
    setEditing,
    cancelEditing,
    startEditing,
  } = useWorkbenchEpicEditor(epic);
  const progress = getWorkbenchEpicProgress(tickets);
  const mutationDisabled = pending || readOnly;
  const descriptionEditing = editing && !readOnly;

  return (
    <article className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkbenchEpicHeader
        workspaceTitle={workspaceTitle}
        epic={epic}
        pending={mutationDisabled}
        onBack={onBack}
        actions={actions}
        onCreateTicket={onCreateTicket}
        progress={progress}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-gutter-both p-4 sm:p-6">
        <div className="mx-auto grid min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <WorkbenchInlineError message={error} />
            <WorkbenchEpicDescription
              presentation={{
                epic: epic,
                pending: mutationDisabled,
                editing: descriptionEditing,
                startEditing: startEditing,
                cancelEditing: cancelEditing,
                title: title,
                markdown: markdown,
              }}
              actions={{
                onSave: actions.onSave,
                setTitle: setTitle,
                setMarkdown: setMarkdown,
                setEditing: setEditing,
              }}
            />

            <WorkbenchEpicTickets
              epic={epic}
              tickets={tickets}
              repositoriesById={repositoriesById}
              assignmentsByTicket={assignmentsByTicket}
              pending={mutationDisabled}
              onOpenTicket={onOpenTicket}
              onCreateTicket={onCreateTicket}
              progress={progress}
            />
          </div>

          <WorkbenchEpicCounts
            progress={progress}
            linkField={
              <WorkbenchEpicJiraIssueLinkField
                environmentId={environmentId}
                epic={epic}
                disabled={mutationDisabled || epic.archivedAt !== null}
              />
            }
          />
        </div>
      </div>
    </article>
  );
}

export function WorkbenchWorkspaceDialog({
  open,
  projects,
  pending,
  disabled,
  error,
  onOpenChange,
  onSave,
  initialWorkspace,
}: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialWorkspace?: {
    readonly title: string;
    readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  };
  readonly onSave: (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(initialWorkspace?.title ?? "");
  const [linkedProjectIds, setLinkedProjectIds] = useState<ReadonlyArray<ProjectId>>(
    initialWorkspace?.linkedProjectIds ?? [],
  );
  const saveLabel = pending ? "Saving…" : "Save changes";
  const cannotSave =
    disabled || pending || title.trim().length === 0 || linkedProjectIds.length === 0;
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    onOpenChange(nextOpen);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cannotSave) return;
    void (async () => {
      if (!(await onSave(title.trim(), linkedProjectIds))) return;
      onOpenChange(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {initialWorkspace ? "Edit Workspace" : "Create Workbench Workspace"}
          </DialogTitle>
          <DialogDescription>
            {initialWorkspace
              ? "Rename this Workspace or add repositories. Existing Tickets and Threads keep their repository scope."
              : "Group related tickets around one or more existing T3 Projects."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="workbench-workspace" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="workbench-workspace-title">Workspace title</Label>
              <Input
                id="workbench-workspace-title"
                disabled={pending}
                autoFocus
                placeholder="Workspace title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <WorkbenchWorkspaceRepositories
              projects={projects}
              pending={pending}
              {...(initialWorkspace === undefined ? {} : { initialWorkspace })}
              linkedProjectIds={linkedProjectIds}
              setLinkedProjectIds={setLinkedProjectIds}
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
                <PlusIcon /> Create Workspace
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function WorkbenchEpicDialog({
  open,
  pending,
  disabled,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (title: string, markdown: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setMarkdown("");
    }
    onOpenChange(nextOpen);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || pending || title.trim().length === 0) return;
    void (async () => {
      if (!(await onCreate(title.trim(), markdown.trim()))) return;
      handleOpenChange(false);
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) handleOpenChange(nextOpen);
      }}
    >
      <DialogPopup showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Create Epic</DialogTitle>
          <DialogDescription>
            Group related Tickets across the Board without changing their delivery status.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-epic" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="workbench-epic-title">Epic title</Label>
              <Input
                id="workbench-epic-title"
                autoFocus
                placeholder="What outcome does this Epic deliver?"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workbench-epic-description">Description</Label>
              <Textarea
                id="workbench-epic-description"
                className="min-h-32"
                placeholder="Context, scope, and intended outcome…"
                value={markdown}
                onChange={(event) => setMarkdown(event.currentTarget.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={pending} onClick={() => handleOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button
            form="create-workbench-epic"
            disabled={disabled || pending || title.trim().length === 0}
            type="submit"
          >
            <PlusIcon /> Create Epic
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
  onCreateEpic,
  open,
  linkedProjects,
  epics,
  initialEpicId,
  pending,
  disabled,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly initialEpicId: WorkbenchEpicId | null;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
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
    kind,
    setKind,
    epicId,
    setEpicId,
    markdown,
    setMarkdown,
    repositoryProjectIds,
    setRepositoryProjectIds,
    primaryProjectId,
    setPrimaryProjectId,
    references,
    setReferences,
    handleOpenChange,
  } = useWorkbenchCreateTicketDraft({ initialEpicId, pending, onOpenChange });
  const selectedEpicId = epics.some((epic) => epic.id === epicId) ? epicId : null;
  const { selectedRepositoryProjectIds, selectedProjectId } = getWorkbenchCreateTicketRepositories({
    linkedProjects,
    repositoryProjectIds,
    primaryProjectId,
  });
  const createLabel = pending ? "Creating Ticket…" : "Create Ticket";
  const mutationDisabled = disabled || pending;
  const cannotCreate = mutationDisabled || title.trim().length === 0 || selectedProjectId === null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (cannotCreate || selectedProjectId === null) return;
    const created = await onCreate({
      id: requestId,
      title,
      markdown,
      kind,
      epicId: selectedEpicId,
      repositoryProjectIds: selectedRepositoryProjectIds,
      primaryT3ProjectId: selectedProjectId,
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
            Capture the work and choose the repository where its Agent Thread will run.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-ticket" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <WorkbenchCreateTicketKind
              kind={kind}
              markdown={markdown}
              setKind={setKind}
              setMarkdown={setMarkdown}
            />
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
            <WorkbenchCreateTicketEpic
              onCreateEpic={onCreateEpic}
              epics={epics}
              pending={mutationDisabled}
              epicId={selectedEpicId}
              setEpicId={setEpicId}
            />
            <div className="space-y-1.5">
              <Label htmlFor="workbench-ticket-context">Description</Label>
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
              selectedProjectId={selectedProjectId}
              setRepositoryProjectIds={setRepositoryProjectIds}
              setPrimaryProjectId={setPrimaryProjectId}
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
  readonly epics: ReadonlyArray<WorkbenchEpic>;
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
      Pick<
        WorkbenchTicket,
        | "title"
        | "markdown"
        | "kind"
        | "epicId"
        | "repositoryProjectIds"
        | "primaryT3ProjectId"
        | "status"
        | "blocked"
      >
    >,
  ) => void;
  readonly onOpenEpic: (epicId: WorkbenchEpicId) => void;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
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
        epics: props.epics,
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
        onOpenEpic: props.onOpenEpic,
        onCreateEpic: props.onCreateEpic,
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
    | "epics"
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
    | "onOpenEpic"
    | "onCreateEpic"
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
  const {
    workspaceTitle,
    ticket,
    references,
    epics,
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
    onOpenEpic,
    onCreateEpic,
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
    useWorkbenchTicketSettlement(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const providerEntries = deriveProviderInstanceEntries(providers ?? []);
  const threadProviderKind = (thread: EnvironmentThreadShell | undefined) => {
    const instanceId = thread?.runtime?.providerInstanceId ?? thread?.modelSelection.instanceId;
    return providerEntries.find((entry) => entry.instanceId === instanceId)?.driverKind;
  };
  const {
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    resetConfirmationOpen,
    setResetConfirmationOpen,
    threadPanelCollapsed,
    setThreadPanelCollapsed,
    detailsPanelCollapsed,
    setDetailsPanelCollapsed,
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
  } = getWorkbenchDetailAssignments({
    assignments,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
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
    threadLookupReady,
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
  });
  useWorkbenchCheckoutStatusRefresh({
    environmentId,
    cwds: [
      ...repositories.map((repository) => repository.openInCwd),
      ...retainedRepositories.map((repository) => repository.openInCwd),
      ...activeAssignments.map(({ threadId }) => {
        const linkedThread = threadsById.get(threadId) ?? archivedThreadsById.get(threadId);
        return linkedThread
          ? (linkedThread.worktreePath ??
              linkedProjects.find((project) => project.id === linkedThread.projectId)
                ?.workspaceRoot)
          : null;
      }),
    ],
  });
  const floatingChatInset = getWorkbenchFloatingChatInset(floatingChat);
  const executionStatus =
    getWorkbenchTicketExecutionStatuses({ environmentId, assignments, threadsById }).get(
      ticket.id,
    ) ?? null;
  const linkedEpicId = ticket.epicId;
  const canOpenThread = workspaceReadOnly
    ? assignment !== undefined && displayedThread !== undefined
    : !isArchived || assignment !== undefined;

  return (
    <article className="@container/ticket relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&_[data-slot=button]>svg]:mx-0">
      <WorkbenchTicketHeader
        actions={{
          onBack: onBack,
          onUpdate: onUpdate,
          onReplaceThread: onReplaceThread,
          settledAssignments: settledAssignments,
          onNewThread: onNewThread,
          onOpenThread: onOpenThread,
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
          canOpenThread: canOpenThread,
          threadActionPending: threadActionPending,
          threadActionLabel: threadActionLabel,
          thread: thread,
          selectedThreadTitle: displayedThread?.title,
          lifecycleActionsEnabled: lifecycleActionsEnabled,
          executionStatus,
        }}
        records={{
          ticket: ticket,
          issue: getTicketIssue(references),
          actionableTicket: actionableTicket,
          assignment: assignment,
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
          Description
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
                actions={{ setDraft: setDraft }}
                context={{ environmentId: environmentId }}
                records={{
                  ticket: ticket,
                  jira: hasJiraReference(references),
                  updatedBy: workbenchThreadTitle(
                    ticket.updatedByThreadId,
                    threadsById,
                    archivedThreadsById,
                  ),
                }}
              />
              <WorkbenchTicketReferencesPanel
                environmentId={environmentId}
                ticketId={ticket.id}
                references={references}
                threadsById={threadsById}
                archivedThreadsById={archivedThreadsById}
                readOnly={workspaceReadOnly}
                fileCwd={getReferenceFileCwd(linkedProjects, [
                  ticket.primaryT3ProjectId,
                  ...ticket.repositoryProjectIds,
                ])}
                fileThreadId={(assignment ?? activeAssignments[0])?.threadId ?? null}
              />
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
                updatedBy={workbenchThreadTitle(
                  ticket.progressUpdatedByThreadId,
                  threadsById,
                  archivedThreadsById,
                )}
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
                onOpenThread={onOpenAssignedThread}
              />
              <WorkbenchTicketThreadsPanel
                expansion={{ threadPanelCollapsed: threadPanelCollapsed }}
                actions={{
                  setThreadPanelCollapsed: setThreadPanelCollapsed,
                  settledAssignments: settledAssignments,
                  onNewThread: onNewThread,
                  onOpenThread: onOpenThread,
                  onUnlinkThread: onUnlinkThread,
                  toggleThreadSettlement: toggleThreadSettlement,
                  settlementPendingThreadId: settlementPendingThreadId,
                  onDeleteThread: onDeleteThread,
                  onOpenAssignedThread: onOpenAssignedThread,
                  onReplaceThread: onReplaceThread,
                  onAttachThread: onAttachThread,
                }}
                presentation={{
                  canOpenThread: canOpenThread,
                  threadActionPending: threadActionPending,
                  thread: thread,
                  displayedTitle: displayedTitle,
                  pending: pending,
                  nativeStatus: nativeStatus,

                  agentTitle: agentTitle,
                  isArchived: isArchived,
                  supportsSettlement: supportsSettlement,
                }}
                context={{
                  threadProviderKind: threadProviderKind,
                  threadMutationsDisabled,
                  environmentId: environmentId,
                  linkedProjects: linkedProjects,
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
                  ticketWorkspace: ticketWorkspace,
                  activeAssignments: activeAssignments,
                  ticket: ticket,
                  historicalAssignments: historicalAssignments,
                }}
              />

              <WorkbenchTicketPullRequests
                readOnly={workspaceReadOnly ?? false}
                onOpenThread={onOpenAssignedThread}
                environmentId={environmentId}
                ticketId={ticket.id}
                assignments={activeAssignments}
                threadsById={threadsById}
                references={splitWorkbenchReferences(references).pullRequests.map(
                  (view) => view.reference,
                )}
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

              <WorkbenchTicketDetailsPanel
                presentation={{
                  collapsed: detailsPanelCollapsed,
                  epics: epics,
                  isArchived: isArchived,
                  linkedEpicId: linkedEpicId,
                  pending: pending,
                }}
                actions={{
                  onCreateEpic: onCreateEpic,
                  onOpenEpic: onOpenEpic,
                  onToggle: () => setDetailsPanelCollapsed((collapsed) => !collapsed),
                  onUpdate: onUpdate,
                }}
                records={{
                  ticket: ticket,
                  actionableTicket: actionableTicket,
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
        activeAssignments={activeAssignments}
        settledAssignments={settledAssignments}
        primaryAssignment={assignment}
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

type WorkbenchTicketUpdatePatch = Partial<
  Pick<
    WorkbenchTicket,
    | "title"
    | "markdown"
    | "kind"
    | "epicId"
    | "repositoryProjectIds"
    | "primaryT3ProjectId"
    | "status"
    | "blocked"
  >
>;

type WorkbenchTicketDetailsPanelProps = {
  readonly collapsed: boolean;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly isArchived: boolean;
  readonly linkedEpicId: WorkbenchEpicId | null;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
  readonly onOpenEpic: (epicId: WorkbenchEpicId) => void;
  readonly onToggle: () => void;
  readonly onUpdate: (ticket: WorkbenchTicket, patch: WorkbenchTicketUpdatePatch) => void;
  readonly pending: boolean;
  readonly ticket: WorkbenchTicket;
  readonly actionableTicket: WorkbenchTicket;
};
function WorkbenchTicketDetailsPanel({
  presentation,
  actions,
  records,
}: {
  presentation: Pick<
    WorkbenchTicketDetailsPanelProps,
    "collapsed" | "epics" | "isArchived" | "linkedEpicId" | "pending"
  >;
  actions: Pick<
    WorkbenchTicketDetailsPanelProps,
    "onCreateEpic" | "onOpenEpic" | "onToggle" | "onUpdate"
  >;
  records: Pick<WorkbenchTicketDetailsPanelProps, "ticket" | "actionableTicket">;
}) {
  const { collapsed, epics, isArchived, linkedEpicId, pending } = presentation;
  const { onCreateEpic, onOpenEpic, onToggle, onUpdate } = actions;
  const { ticket, actionableTicket } = records;
  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title="Details"
        collapsed={collapsed}
        onToggle={onToggle}
        contentId="workbench-ticket-details"
      />
      <div id="workbench-ticket-details" className="min-w-0" hidden={collapsed}>
        <WorkbenchTicketLocalDetails
          epics={epics}
          isArchived={isArchived}
          linkedEpicId={linkedEpicId}
          onCreateEpic={onCreateEpic}
          onOpenEpic={onOpenEpic}
          onUpdate={onUpdate}
          pending={pending}
          ticket={ticket}
          actionableTicket={actionableTicket}
        />
      </div>
    </section>
  );
}

type WorkbenchTicketRepositoryEntry = {
  readonly id: ProjectId;
  readonly isPrimary: boolean;
  readonly repository: Project | undefined;
  readonly openInCwd: string | null;
  readonly workspaceRepository: WorkbenchTicketWorkspace["repositories"][number] | undefined;
};

function WorkbenchTicketRepositoryRow({
  environmentId,
  entry,
  keybindings,
  availableEditors,
  isArchived,
  isRetained,
  canOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: WorkbenchTicketRepositoryEntry;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly isArchived: boolean;
  readonly isRetained: boolean;
  readonly canOpen: boolean;
}) {
  const { repository, openInCwd } = entry;
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 py-2 text-sm">
      <WorkbenchTicketRepositoryIdentity entry={entry} isRetained={isRetained} />
      {repository && !isArchived && canOpen && openInCwd ? (
        <OpenInPicker
          environmentId={repository.environmentId}
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={openInCwd}
          compact
          enableShortcut={false}
        />
      ) : null}
      {entry.workspaceRepository?.errorMessage ? (
        <p className="min-w-0 basis-full break-words text-xs text-destructive" role="alert">
          {entry.workspaceRepository.errorMessage}
        </p>
      ) : null}
      {openInCwd ? (
        <div className="min-w-0 basis-full">
          <WorkbenchCheckoutDetails
            environmentId={environmentId}
            cwd={openInCwd}
            showDirectory={false}
            showPullRequest={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchTicketRepositoryIdentity({
  entry,
  isRetained,
}: {
  readonly entry: WorkbenchTicketRepositoryEntry;
  readonly isRetained: boolean;
}) {
  const repositoryTitle = entry.repository?.title ?? "Repository unavailable";
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
        {entry.isPrimary && !isRetained ? (
          <Badge size="default" variant="outline">
            Primary
          </Badge>
        ) : null}
        <WorkbenchTicketRepositoryStatus repository={entry.workspaceRepository} />
      </div>
    </div>
  );
}

function WorkbenchThreadTitle({
  className,
  title,
}: {
  readonly className: string;
  readonly title: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>{title}</TooltipTrigger>
      <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
        {title}
      </TooltipPopup>
    </Tooltip>
  );
}

function WorkbenchThreadMetadataRow({
  actions,
  modelLabel,
  recencyLabel,
}: {
  readonly actions?: ReactNode;
  readonly modelLabel: string | null;
  readonly recencyLabel: string | null;
}) {
  if (!modelLabel && !recencyLabel && !actions) return null;
  return (
    <div className="relative z-10 mt-0.5 flex min-w-0 items-center gap-2 ps-9 text-muted-foreground">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs">
        {modelLabel ? (
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{modelLabel}</span>
        ) : null}
        {recencyLabel ? (
          <span className="shrink-0 whitespace-nowrap">
            {modelLabel ? <span aria-hidden>· </span> : null}
            {recencyLabel}
          </span>
        ) : null}
      </span>
      {actions ? <span className="flex shrink-0 items-center gap-0.5">{actions}</span> : null}
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

function WorkbenchThreadOpenButton({
  actions,
  actionLabel,
  ariaLabel,
  disabled,
  modelLabel,
  onClick,
  providerKind,
  recencyLabel,
  stateLabel,
  executionStatus,
  title,
}: {
  readonly actions?: ReactNode;
  readonly actionLabel?: string | undefined;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly modelLabel: string | null;
  readonly onClick: () => void;
  readonly providerKind: ProviderDriverKind | undefined;
  readonly recencyLabel: string | null;
  readonly stateLabel: string | null;
  readonly executionStatus?: WorkbenchThreadExecutionStatusData | null;
  readonly title: string;
}) {
  return (
    <div className="min-w-0 flex-1 basis-full">
      <button
        aria-label={ariaLabel}
        className="group relative flex w-full min-w-0 cursor-pointer items-start gap-2 text-left text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring enabled:after:absolute enabled:after:inset-0 enabled:after:content-[''] disabled:cursor-default disabled:opacity-50"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          {providerKind ? (
            <ProviderInstanceIcon
              driverKind={providerKind}
              displayName={providerKind}
              iconClassName="size-3.5"
              badgeContent="none"
            />
          ) : (
            <BotIcon aria-hidden className="size-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <WorkbenchThreadTitle
            className="relative z-10 line-clamp-2 break-words font-medium [overflow-wrap:anywhere]"
            title={title}
          />
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {executionStatus ? (
              <WorkbenchThreadExecutionStatus
                status={executionStatus.presentation}
                startedAt={executionStatus.startedAt}
              />
            ) : stateLabel ? (
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{stateLabel}</span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center text-muted-foreground group-hover:text-foreground">
          <span
            className={
              actionLabel === "Restore and open" || actionLabel === "Create replacement Thread"
                ? "text-xs"
                : "sr-only"
            }
          >
            {actionLabel ?? "Open Thread"}
          </span>
          <ArrowRightIcon className="size-3.5" />
        </span>
      </button>
      <WorkbenchThreadMetadataRow
        actions={actions}
        modelLabel={modelLabel}
        recencyLabel={recencyLabel}
      />
    </div>
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
    <div
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground"
      role="alert"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <Button onClick={onRetry} size="xs" variant="outline">
          <RefreshCwIcon /> Retry
        </Button>
      ) : null}
    </div>
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
      Pick<
        WorkbenchTicket,
        | "title"
        | "markdown"
        | "kind"
        | "epicId"
        | "repositoryProjectIds"
        | "primaryT3ProjectId"
        | "status"
        | "blocked"
      >
    >,
  ) => void;
  canOpenThread: boolean;
  threadActionPending: boolean;
  threadActionLabel: string | null | undefined;
  thread: ReturnType<typeof getWorkbenchThreadPresentation>;
  selectedThreadTitle: string | undefined;
  assignment: WorkbenchAssignment | undefined;
  onReplaceThread: (ticket: WorkbenchTicket, previousThreadId: ThreadId) => void;
  settledAssignments: ReadonlyArray<WorkbenchAssignment>;
  onNewThread: (ticket: WorkbenchTicket) => void;
  onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  lifecycleActionsEnabled: boolean;
  onArchive: (ticket: WorkbenchTicket, archivedAt: string | null) => Promise<boolean>;
  setDeleteConfirmationOpen: Dispatch<SetStateAction<boolean>>;
};
function WorkbenchTicketHeader({
  actions,
  presentation,
  records,
  context,
}: {
  actions: Pick<
    WorkbenchTicketHeaderProps,
    | "onBack"
    | "onUpdate"
    | "onReplaceThread"
    | "settledAssignments"
    | "onNewThread"
    | "onOpenThread"
    | "onArchive"
    | "setDeleteConfirmationOpen"
  >;
  presentation: Pick<
    WorkbenchTicketHeaderProps,
    | "executionStatus"
    | "workspaceTitle"
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "editing"
    | "canOpenThread"
    | "threadActionPending"
    | "threadActionLabel"
    | "thread"
    | "selectedThreadTitle"
    | "lifecycleActionsEnabled"
  >;
  records: Pick<WorkbenchTicketHeaderProps, "ticket" | "issue" | "actionableTicket" | "assignment">;
  context: Pick<WorkbenchTicketHeaderProps, "environmentId">;
}) {
  const {
    onBack,
    onUpdate,
    onReplaceThread,
    settledAssignments,
    onNewThread,
    onOpenThread,
    onArchive,
    setDeleteConfirmationOpen,
  } = actions;
  const {
    executionStatus,
    workspaceTitle,
    displayedTitle,
    isArchived,
    pending,
    editing,
    canOpenThread,
    threadActionPending,
    threadActionLabel,
    thread,
    selectedThreadTitle,
    lifecycleActionsEnabled,
  } = presentation;
  const { ticket, issue, actionableTicket, assignment } = records;
  const { environmentId } = context;
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
        <WorkbenchTicketHeaderActions
          presentation={{
            displayedTitle: displayedTitle,
            isArchived: isArchived,
            pending: pending,
            canOpenThread: canOpenThread,
            threadActionPending: threadActionPending,
            threadActionLabel: threadActionLabel,
            thread: thread,
            selectedThreadTitle: selectedThreadTitle,
            lifecycleActionsEnabled: lifecycleActionsEnabled,
          }}
          records={{
            ticket: ticket,
            issue,
            actionableTicket: actionableTicket,
            assignment: assignment,
          }}
          actions={{
            onReplaceThread: onReplaceThread,
            settledAssignments: settledAssignments,
            onNewThread: onNewThread,
            onOpenThread: onOpenThread,
            onArchive: onArchive,
            setDeleteConfirmationOpen: setDeleteConfirmationOpen,
          }}
        />
      </div>
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
  /** Whether the Ticket has a Jira Reference, so its description may use Jira markup. */
  jira: boolean;
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
  actions: Pick<WorkbenchTicketDescriptionPanelProps, "setDraft">;
  context: Pick<WorkbenchTicketDescriptionPanelProps, "environmentId">;
  records: Pick<WorkbenchTicketDescriptionPanelProps, "ticket" | "jira"> & {
    readonly updatedBy: string | null;
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
  const { setDraft } = actions;
  const { environmentId } = context;
  const { ticket, jira, updatedBy } = records;
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-semibold">Description</h2>
            {updatedBy !== null ? (
              <WorkbenchProvenanceBadge text={`Updated by ${updatedBy}`} />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Goal, constraints, and acceptance criteria.
          </p>
        </div>
        {!editing && !isArchived ? (
          <Button
            disabled={pending}
            onClick={startEditing}
            size="xs"
            type="button"
            variant="outline"
          >
            <PencilIcon /> Edit
          </Button>
        ) : null}
      </div>
      {editing && draft ? (
        <>
          <div className="min-w-0 space-y-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-workbench-ticket-title">Title</Label>
              <Input
                id="edit-workbench-ticket-title"
                autoFocus
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
              markdown={draft.markdown}
              jira={jira}
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
          <WorkbenchDescription markdown={displayedMarkdown} jira={jira} />
        </div>
      )}
    </section>
  );
}

export function WorkbenchTicketDescriptionEditor({
  id = "edit-workbench-ticket-context",
  markdown,
  jira,
  updatedBy = null,
  onChange,
}: {
  id?: string;
  markdown: string;
  jira: boolean;
  /** The agent Thread that last wrote the description, if one did. */
  updatedBy?: string | null;
  onChange: (markdown: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Label htmlFor={id}>Description</Label>
          {updatedBy !== null ? (
            <WorkbenchProvenanceBadge text={`Updated by ${updatedBy}`} />
          ) : null}
        </div>
        <ToggleGroup
          aria-label="Ticket description editor mode"
          variant="segmented"
          value={[preview ? "preview" : "write"]}
          onValueChange={(next) => {
            const mode = next[0];
            if (mode === "write" || mode === "preview") setPreview(mode === "preview");
          }}
        >
          <Toggle value="write" type="button">
            Write
          </Toggle>
          <Toggle value="preview" type="button">
            Preview
          </Toggle>
        </ToggleGroup>
      </div>
      <div hidden={preview}>
        <Textarea
          id={id}
          className="min-h-72"
          placeholder="Goal, constraints, and acceptance criteria…"
          value={markdown}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      {preview ? (
        <div
          role="region"
          aria-label="Description preview"
          className="min-h-72 min-w-0 rounded-lg border border-border/60 p-3"
        >
          {markdown.trim() ? (
            <WorkbenchDescription markdown={markdown} jira={jira} />
          ) : (
            <p className="text-xs text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type WorkbenchTicketThreadsPanelProps = {
  threadPanelCollapsed: boolean;
  threadMutationsDisabled: boolean;
  setThreadPanelCollapsed: Dispatch<SetStateAction<boolean>>;
  canOpenThread: boolean;
  threadProviderKind: (
    thread: EnvironmentThreadShell | undefined,
  ) => ProviderDriverKind | undefined;
  displayedThread: EnvironmentThreadShell | undefined;
  threadActionPending: boolean;
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
  environmentId: EnvironmentId;
  linkedProjects: ReadonlyArray<Project>;
  ticketWorkspace: WorkbenchTicketWorkspace | undefined;
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
  expansion,
  actions,
  presentation,
  context,
  records,
}: {
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
    | "threadProviderKind"
    | "threadMutationsDisabled"
    | "environmentId"
    | "linkedProjects"
    | "threadsById"
    | "archivedThreadsById"
    | "threadLookupReady"
  >;
  records: Pick<
    WorkbenchTicketThreadsPanelProps,
    | "displayedThread"
    | "assignment"
    | "actionableTicket"
    | "nativeThread"
    | "archivedThread"
    | "ticketWorkspace"
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
    thread,
    displayedTitle,
    pending,
    nativeStatus,

    agentTitle,
    isArchived,
    supportsSettlement,
  } = presentation;
  const {
    threadProviderKind,
    threadMutationsDisabled,
    environmentId,
    linkedProjects,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
  } = context;
  const {
    displayedThread,
    assignment,
    actionableTicket,
    nativeThread,
    archivedThread,
    ticketWorkspace,
    activeAssignments,
    ticket,
    historicalAssignments,
  } = records;
  const [sectionToggles, setSectionToggles] = useState<ReadonlyMap<string, boolean>>(new Map());
  const openThreadCount = new Set(
    activeAssignments
      .filter(({ threadId }) => threadsById.has(threadId) || archivedThreadsById.has(threadId))
      .map(({ threadId }) => threadId),
  ).size;
  const liveStatus = (threadId: ThreadId) => {
    const liveThread = threadsById.get(threadId);
    return liveThread ? getWorkbenchThreadExecutionStatus(liveThread) : null;
  };
  // A primary Thread the user cannot open gives way to the notice below, as do its actions.
  const listedAssignments = canOpenThread
    ? activeAssignments
    : activeAssignments.filter((activeAssignment) => activeAssignment.id !== assignment?.id);
  const sections = getWorkbenchThreadStatusSections({
    active: listedAssignments.map((activeAssignment) => ({
      threadId: activeAssignment.threadId,
      status: liveStatus(activeAssignment.threadId),
      assignment: activeAssignment,
    })),
    settled: settledAssignments.map((settledAssignment) => ({
      threadId: settledAssignment.threadId,
      status: null,
      assignment: settledAssignment,
    })),
    showingThreadId: assignment?.threadId ?? null,
  });
  const primaryThread = (
    <WorkbenchTicketPrimaryThread
      context={{
        threadProviderKind: threadProviderKind,
        threadMutationsDisabled,
        environmentId: environmentId,
        linkedProjects: linkedProjects,
      }}
      records={{
        displayedThread: displayedThread,
        assignment: assignment,
        actionableTicket: actionableTicket,
        nativeThread: nativeThread,
        archivedThread: archivedThread,
        ticketWorkspace: ticketWorkspace,
      }}
      presentation={{
        threadActionPending: threadActionPending,
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
          threadProviderKind: threadProviderKind,
          threadMutationsDisabled,
          environmentId: environmentId,
          linkedProjects: linkedProjects,
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
        records={{ ticketWorkspace: ticketWorkspace, ticket: ticket }}
      />
    );
  const settledThreadRow = (settledAssignment: WorkbenchAssignment) => (
    <WorkbenchTicketSettledThreadRow
      key={settledAssignment.id}
      threadProviderKind={threadProviderKind}
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
    />
  );
  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title="Agent Threads"
        count={openThreadCount}
        collapsed={threadPanelCollapsed}
        onToggle={() => setThreadPanelCollapsed((collapsed) => !collapsed)}
        contentId="workbench-ticket-agent-threads"
      />
      <div id="workbench-ticket-agent-threads" hidden={threadPanelCollapsed}>
        <div className="min-w-0">
          {!canOpenThread ? (
            <p className="px-4 pb-3 text-sm text-muted-foreground">
              No Thread is available for this Ticket.
            </p>
          ) : assignment ? null : (
            <div className="px-2 pb-2">{primaryThread}</div>
          )}
          {sections.map((section) => {
            const open = sectionToggles.get(section.id) ?? section.openByDefault;
            return (
              <WorkbenchTicketThreadSection
                key={section.id}
                id={section.id}
                label={section.label}
                count={section.threads.length}
                hint={section.workingCount > 0 ? `${section.workingCount} working` : null}
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
              threadProviderKind={threadProviderKind}
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
        <WorkbenchTicketThreadCreationActions
          onNewThread={onNewThread}
          onAttachThread={onAttachThread}
          pending={pending || threadMutationsDisabled}
          isArchived={isArchived}
          ticket={ticket}
        />
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
    | "Preparing work area…"
    | "Retry preparation"
    | "Prepare work area";
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
        title="Work area"
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
          !isWorkbenchRepositoryScopeValid({ scope: draft.value, projects: linkedProjects })
        }
        onClick={() => {
          void actions.onSaveRepositories();
        }}
        size="xs"
        type="button"
      >
        {preparationPending
          ? "Preparing work area…"
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
  return (
    <div className="space-y-3">
      <WorkbenchRepositoryScopeFields
        projects={linkedProjects}
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
            Advanced work area settings
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
              ? "Expand Advanced work area settings"
              : "Collapse Advanced work area settings"
          }
          onClick={() => setAdvancedWorkspaceSettingsCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={
            advancedWorkspaceSettingsCollapsed
              ? "Expand Advanced work area settings"
              : "Collapse Advanced work area settings"
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
              No prepared worktrees to remove. Prepare the work area when you are ready to work on
              this Ticket.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchTicketWorkspaceRepositories({
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
  | "repositories"
  | "environmentId"
  | "keybindings"
  | "availableEditors"
  | "isArchived"
  | "ticketWorkspace"
  | "workspaceIsPreparing"
  | "retainedRepositories"
>) {
  return (
    <div className="divide-y divide-border/50">
      {[...repositories]
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map((entry) => (
          <WorkbenchTicketRepositoryRow
            key={entry.id}
            environmentId={environmentId}
            entry={entry}
            keybindings={keybindings}
            availableEditors={availableEditors}
            isArchived={isArchived}
            isRetained={false}
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
                entry={entry}
                keybindings={keybindings}
                availableEditors={availableEditors}
                isArchived={isArchived}
                isRetained
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
    return "Review repositories and prepare a work area for your editor or first thread.";
  if (ticketWorkspace.status === "ready" && !workspaceHasSelectedRepositories)
    return "Repository selection changed. Prepare the work area to add the missing repositories; existing worktrees stay available.";
  if (ticketWorkspace.status === "released")
    return "No active worktrees. Review repositories before preparing a work area or creating a thread.";
  if (ticketWorkspace.status === "failed")
    return "Preparation failed. Retry preparation after resolving the reported repository error.";
  if (ticketWorkspace.status === "releasing") return "Removing prepared worktrees.";
  return "Threads in the same worktree share files and branch changes. Use a separate native worktree for independent work.";
}

function WorkbenchTicketLocalDetails({
  epics,
  isArchived,
  linkedEpicId,
  onCreateEpic,
  onOpenEpic,
  onUpdate,
  pending,
  ticket,
  actionableTicket,
}: Pick<
  WorkbenchTicketDetailsPanelProps,
  | "epics"
  | "isArchived"
  | "linkedEpicId"
  | "onCreateEpic"
  | "onOpenEpic"
  | "onUpdate"
  | "pending"
  | "ticket"
  | "actionableTicket"
>) {
  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="space-y-1.5">
        <Label>Ticket type</Label>
        <Select
          disabled={pending || isArchived}
          value={ticket.kind}
          onValueChange={(value) => {
            if (isWorkbenchTicketKind(value)) onUpdate(actionableTicket, { kind: value });
          }}
        >
          <SelectTrigger aria-label="Ticket type">
            <SelectValue>{WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {WORKBENCH_TICKET_KINDS.map((ticketKind) => (
              <SelectItem key={ticketKind} value={ticketKind}>
                {WORKBENCH_TICKET_KIND_LABELS[ticketKind]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Epic</Label>
          {linkedEpicId ? (
            <Button
              onClick={() => onOpenEpic(linkedEpicId)}
              size="xs"
              type="button"
              variant="ghost"
            >
              View Epic <ArrowRightIcon />
            </Button>
          ) : null}
        </div>
        <Select
          disabled={pending || isArchived}
          value={ticket.epicId ?? NO_EPIC_VALUE}
          onValueChange={(value) => {
            if (value === CREATE_EPIC_VALUE) {
              onCreateEpic((epicId) => onUpdate(actionableTicket, { epicId }));
              return;
            }
            onUpdate(actionableTicket, {
              epicId: !value || value === NO_EPIC_VALUE ? null : WorkbenchEpicId.make(value),
            });
          }}
        >
          <SelectTrigger aria-label="Epic">
            <SelectValue>
              {epics.find((epic) => epic.id === ticket.epicId)?.title ?? "No Epic"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NO_EPIC_VALUE}>No Epic</SelectItem>
            {epics.map((epic) => (
              <SelectItem key={epic.id} disabled={epic.archivedAt !== null} value={epic.id}>
                {epic.title}
                {epic.archivedAt !== null ? " (Archived)" : ""}
              </SelectItem>
            ))}
            <SelectPrimitive.Separator className="mx-2 my-1 h-px bg-border" />
            <SelectItem value={CREATE_EPIC_VALUE}>Create Epic…</SelectItem>
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}

type WorkbenchTicketPrimaryThreadProps = Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadProviderKind"
  | "threadMutationsDisabled"
  | "displayedThread"
  | "threadActionPending"
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
  | "environmentId"
  | "linkedProjects"
  | "ticketWorkspace"
>;
function WorkbenchTicketPrimaryThread({
  context,
  records,
  presentation,
  actions,
}: {
  context: Pick<
    WorkbenchTicketPrimaryThreadProps,
    "threadProviderKind" | "threadMutationsDisabled" | "environmentId" | "linkedProjects"
  >;
  records: Pick<
    WorkbenchTicketPrimaryThreadProps,
    | "displayedThread"
    | "assignment"
    | "actionableTicket"
    | "nativeThread"
    | "archivedThread"
    | "ticketWorkspace"
  >;
  presentation: Pick<
    WorkbenchTicketPrimaryThreadProps,
    | "threadActionPending"
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
  const { threadProviderKind, threadMutationsDisabled, environmentId, linkedProjects } = context;
  const {
    displayedThread,
    assignment,
    actionableTicket,
    nativeThread,
    archivedThread,
    ticketWorkspace,
  } = records;
  const {
    threadActionPending,
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
  return (
    <div className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/45 focus-within:bg-muted/45">
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(displayedThread)}
        actionLabel={thread.actionLabel}
        ariaLabel={`${
          threadActionPending ? thread.pendingActionLabel : thread.actionLabel
        } for ${displayedTitle}`}
        disabled={isWorkbenchThreadOpenDisabled({
          pending,
          threadMutationsDisabled,
          thread: displayedThread,
        })}
        modelLabel={getWorkbenchThreadModelLabel(displayedThread)}
        recencyLabel={displayedThread ? getWorkbenchThreadRecencyLabel(displayedThread) : null}
        onClick={() => {
          if (!assignment && settledAssignments.length > 0) {
            onNewThread(actionableTicket);
            return;
          }
          onOpenThread(actionableTicket, assignment?.threadId);
        }}
        stateLabel={nativeThread ? null : assignment ? thread.stateLabel : "Create a Thread"}
        executionStatus={nativeStatus}
        title={agentTitle}
        actions={
          assignment && displayedThread ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`Unlink Thread ${displayedThread.title}`}
                      disabled={pending || threadMutationsDisabled || isArchived}
                      onClick={() => onUnlinkThread(assignment.threadId)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <UnlinkIcon />
                </TooltipTrigger>
                <TooltipPopup>Unlink Thread from Ticket</TooltipPopup>
              </Tooltip>
              {supportsSettlement ? (
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
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`Delete Thread ${displayedThread.title}`}
                      disabled={pending || threadMutationsDisabled || isArchived}
                      onClick={() => onDeleteThread(assignment.threadId)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Trash2Icon />
                </TooltipTrigger>
                <TooltipPopup>Delete Thread</TooltipPopup>
              </Tooltip>
            </>
          ) : null
        }
      />
      {displayedThread ? (
        <div className="pointer-events-none relative z-10 min-w-0 basis-full [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto">
          <WorkbenchThreadCheckoutDetails
            environmentId={environmentId}
            thread={displayedThread}
            projects={linkedProjects}
            workspace={ticketWorkspace}
          />
        </div>
      ) : null}
    </div>
  );
}

type WorkbenchTicketOtherThreadsProps = Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadProviderKind"
  | "threadMutationsDisabled"
  | "pending"
  | "assignment"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "environmentId"
  | "linkedProjects"
  | "ticketWorkspace"
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
  hint,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly hint: string | null;
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
        {hint ? <span className="ms-auto">{hint}</span> : null}
      </button>
      <div id={panelId} hidden={!open} className="space-y-1">
        {open ? children : null}
      </div>
    </section>
  );
}

function WorkbenchTicketHistoricalThreads({
  threadProviderKind,
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
  | "threadProviderKind"
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
              threadProviderKind: threadProviderKind,
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
  | "threadProviderKind"
  | "threadMutationsDisabled"
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "environmentId"
  | "linkedProjects"
  | "ticketWorkspace"
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
    | "threadProviderKind"
    | "threadMutationsDisabled"
    | "environmentId"
    | "linkedProjects"
    | "threadsById"
    | "archivedThreadsById"
    | "threadLookupReady"
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
  records: Pick<WorkbenchTicketActiveThreadRowProps, "ticketWorkspace" | "ticket">;
}) {
  const {
    threadProviderKind,
    threadMutationsDisabled,
    environmentId,
    linkedProjects,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
  } = context;
  const { pending, isArchived, supportsSettlement, activeAssignment } = presentation;
  const {
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
    onReplaceThread,
  } = actions;
  const { ticketWorkspace, ticket } = records;
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
    threadLookupReady,
  });
  const rowPresentation = getWorkbenchActiveThreadRowPresentation({
    displayedActiveThread,
    activeAgentState,
    activeThreadState,
    activeThreadModel,
    activeThreadRecency,
    threadLookupReady,
  });
  return (
    <div
      key={activeAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(displayedActiveThread)}
        actionLabel={archivedActiveThread ? "Restore and open" : undefined}
        ariaLabel={rowPresentation.ariaLabel}
        disabled={
          pending ||
          displayedActiveThread === undefined ||
          (threadMutationsDisabled && displayedActiveThread.archivedAt != null)
        }
        modelLabel={rowPresentation.modelLabel}
        recencyLabel={rowPresentation.recencyLabel}
        onClick={() => onOpenAssignedThread(activeAssignment.threadId)}
        stateLabel={rowPresentation.stateLabel}
        executionStatus={rowPresentation.executionStatus}
        title={rowPresentation.title}
        actions={
          displayedActiveThread ? (
            <WorkbenchActiveThreadActions
              pending={pending || threadMutationsDisabled}
              isArchived={isArchived}
              onUnlinkThread={onUnlinkThread}
              supportsSettlement={supportsSettlement}
              toggleThreadSettlement={toggleThreadSettlement}
              settlementPendingThreadId={settlementPendingThreadId}
              onDeleteThread={onDeleteThread}
              activeAssignment={activeAssignment}
              displayedActiveThread={displayedActiveThread}
              archivedActiveThread={archivedActiveThread}
            />
          ) : threadLookupReady ? (
            <Button
              aria-label={`Create replacement Thread for ${ticket.title}`}
              disabled={pending || threadMutationsDisabled || isArchived}
              onClick={() => onReplaceThread(ticket, activeAssignment.threadId)}
              size="xs"
              type="button"
              variant="ghost"
            >
              Create replacement Thread
            </Button>
          ) : null
        }
      />
      {displayedActiveThread ? (
        <div className="pointer-events-none relative z-10 min-w-0 basis-full [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto">
          <WorkbenchThreadCheckoutDetails
            environmentId={environmentId}
            thread={displayedActiveThread}
            projects={linkedProjects}
            workspace={ticketWorkspace}
          />
        </div>
      ) : null}
    </div>
  );
}

type WorkbenchTicketHistoricalThreadRowProps = Pick<
  Parameters<typeof WorkbenchTicketHistoricalThreads>[0],
  | "threadProviderKind"
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
    | "threadProviderKind"
    | "threadMutationsDisabled"
    | "threadsById"
    | "archivedThreadsById"
    | "threadLookupReady"
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
  const {
    threadProviderKind,
    threadMutationsDisabled,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
  } = context;
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
  const rowPresentation = getWorkbenchHistoricalThreadRowPresentation({
    displayedHistoricalThread,
    historicalAgentState,
    threadLookupReady,
  });
  return (
    <div
      key={historicalAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(displayedHistoricalThread)}
        actionLabel={historicalArchivedThread ? "Restore and open" : undefined}
        ariaLabel={rowPresentation.ariaLabel}
        disabled={
          pending ||
          !displayedHistoricalThread ||
          (threadMutationsDisabled && displayedHistoricalThread.archivedAt != null)
        }
        modelLabel={rowPresentation.modelLabel}
        recencyLabel={rowPresentation.recencyLabel}
        onClick={() => onOpenAssignedThread(historicalAssignment.threadId)}
        stateLabel={rowPresentation.stateLabel}
        executionStatus={rowPresentation.executionStatus}
        title={rowPresentation.title}
        actions={
          displayedHistoricalThread ? (
            <WorkbenchHistoricalThreadActions
              pending={pending || threadMutationsDisabled}
              isArchived={isArchived}
              onUnlinkThread={onUnlinkThread}
              supportsSettlement={supportsSettlement}
              toggleThreadSettlement={toggleThreadSettlement}
              settlementPendingThreadId={settlementPendingThreadId}
              onDeleteThread={onDeleteThread}
              historicalAssignment={historicalAssignment}
              displayedHistoricalThread={displayedHistoricalThread}
              historicalArchivedThread={historicalArchivedThread}
            />
          ) : null
        }
      />
    </div>
  );
}

function WorkbenchTicketSettledThreadRow({
  threadProviderKind,
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
}: Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadProviderKind"
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
> & { settledAssignment: WorkbenchAssignment }) {
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
    <div
      key={settledAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(settledThread)}
        actionLabel={thread.actionLabel}
        ariaLabel={`${thread.actionLabel} ${settledThread.title}`}
        disabled={isWorkbenchThreadOpenDisabled({
          pending,
          threadMutationsDisabled,
          thread: settledThread,
        })}
        modelLabel={getWorkbenchThreadModelLabel(settledThread)}
        recencyLabel={getWorkbenchThreadRecencyLabel(settledThread)}
        onClick={() => onOpenAssignedThread(settledAssignment.threadId)}
        stateLabel={thread.stateLabel}
        executionStatus={executionStatus}
        title={settledThread.title}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Unlink Thread ${settledThread.title}`}
                    disabled={mutationDisabled}
                    onClick={() => onUnlinkThread(settledAssignment.threadId)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <UnlinkIcon />
              </TooltipTrigger>
              <TooltipPopup>Unlink Thread from Ticket</TooltipPopup>
            </Tooltip>
            {supportsSettlement ? (
              <WorkbenchThreadSettlementButton
                archived={settledThread.archivedAt !== null}
                disabled={mutationDisabled || settledThread.archivedAt !== null}
                onClick={() => void toggleThreadSettlement(settledThread)}
                pending={settlementPendingThreadId === settledThread.id}
                settled
                title={settledThread.title}
              />
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Delete Thread ${settledThread.title}`}
                    disabled={mutationDisabled}
                    onClick={() => onDeleteThread(settledAssignment.threadId)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <Trash2Icon />
              </TooltipTrigger>
              <TooltipPopup>Delete Thread</TooltipPopup>
            </Tooltip>
          </>
        }
      />
    </div>
  );
}

function WorkbenchEpicHeader({
  workspaceTitle,
  epic,
  pending,
  onBack,
  actions,
  onCreateTicket,
  progress,
}: Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  "workspaceTitle" | "epic" | "pending" | "onBack" | "actions" | "onCreateTicket"
> & { progress: ReturnType<typeof getWorkbenchEpicProgress> }) {
  return (
    <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
      <div className="mx-auto flex min-w-0 max-w-7xl flex-wrap items-start gap-3">
        <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeftIcon />
          <span className="hidden sm:inline">Board</span>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers3Icon className="size-3.5" /> {workspaceTitle} · Epic
          </p>
          <h1 className="mt-1 break-words text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {epic.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Epic</Badge>
            <WorkbenchJiraIssueKeyLink jiraIssue={epic.jiraIssue} />
            <Badge variant="outline">
              {progress.completed} of {progress.total} done
            </Badge>
            {epic.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
          </div>
        </div>
        <Button disabled={pending || epic.archivedAt !== null} onClick={onCreateTicket} size="sm">
          <PlusIcon /> New Ticket
        </Button>
        <WorkbenchEpicActionsMenu epic={epic} actions={actions} pending={pending} />
      </div>
    </header>
  );
}

function WorkbenchEpicActionsMenu({
  epic,
  actions,
  pending,
}: Pick<Parameters<typeof WorkbenchEpicDetail>[0], "epic" | "actions" | "pending">) {
  if (!actions.lifecycleSupported) return null;
  const archived = epic.archivedAt !== null;
  return (
    <Menu>
      <MenuTrigger
        render={<Button aria-label={`Actions for ${epic.title}`} size="icon-sm" variant="ghost" />}
      >
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          disabled={pending || !actions.canArchive}
          onClick={() => void actions.onArchive(epic, archived ? null : new Date().toISOString())}
        >
          {archived ? <RotateCcwIcon /> : <ArchiveIcon />}
          {archived ? "Restore Epic" : "Archive Epic"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

type WorkbenchEpicDescriptionProps = Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  "epic" | "pending"
> &
  Pick<Parameters<typeof WorkbenchEpicDetail>[0]["actions"], "onSave"> & {
    editing: boolean;
    startEditing: () => void;
    cancelEditing: () => void;
    title: string;
    setTitle: Dispatch<SetStateAction<string>>;
    markdown: string;
    setMarkdown: Dispatch<SetStateAction<string>>;
    setEditing: Dispatch<SetStateAction<boolean>>;
  };
function WorkbenchEpicDescription({
  presentation,
  actions,
}: {
  presentation: Pick<
    WorkbenchEpicDescriptionProps,
    "epic" | "pending" | "editing" | "startEditing" | "cancelEditing" | "title" | "markdown"
  >;
  actions: Pick<
    WorkbenchEpicDescriptionProps,
    "onSave" | "setTitle" | "setMarkdown" | "setEditing"
  >;
}) {
  const { epic, pending, editing, startEditing, cancelEditing, title, markdown } = presentation;
  const { onSave, setTitle, setMarkdown, setEditing } = actions;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-xs text-muted-foreground">
            Outcome and scope shared by the child Tickets.
          </p>
        </div>
        {!editing ? (
          <Button
            disabled={pending || epic.archivedAt !== null}
            onClick={startEditing}
            size="xs"
            type="button"
            variant="outline"
          >
            <PencilIcon /> Edit
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="min-w-0 space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedTitle = title.trim();
            if (normalizedTitle.length === 0) return;
            void (async () => {
              if (!(await onSave(epic, normalizedTitle, markdown.trim()))) return;
              setEditing(false);
            })();
          }}
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="edit-workbench-epic-title">Title</Label>
            </div>
            <Input
              id="edit-workbench-epic-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-workbench-epic-description">Description</Label>
            <Textarea
              id="edit-workbench-epic-description"
              className="min-h-48"
              placeholder="Context, scope, and intended outcome…"
              value={markdown}
              onChange={(event) => setMarkdown(event.currentTarget.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button disabled={pending} onClick={cancelEditing} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                pending ||
                title.trim().length === 0 ||
                (title.trim() === epic.title && markdown.trim() === epic.markdown)
              }
              type="submit"
            >
              Save Epic
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-h-32 break-words p-4">
          <WorkbenchDescription markdown={epic.markdown} jira={Boolean(epic.jiraIssue)} />
        </div>
      )}
    </section>
  );
}

function WorkbenchEpicTickets({
  epic,
  tickets,
  repositoriesById,
  assignmentsByTicket,
  pending,
  onOpenTicket,
  onCreateTicket,
  progress,
}: Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  | "epic"
  | "tickets"
  | "repositoriesById"
  | "assignmentsByTicket"
  | "pending"
  | "onOpenTicket"
  | "onCreateTicket"
> & {
  progress: ReturnType<typeof getWorkbenchEpicProgress>;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Child Tickets</h2>
          <p className="text-xs text-muted-foreground">Stories and bugs that deliver this Epic.</p>
        </div>
        <Button
          disabled={pending || epic.archivedAt !== null}
          onClick={onCreateTicket}
          size="xs"
          type="button"
          variant="outline"
        >
          <PlusIcon /> Add Ticket
        </Button>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            aria-label={`${progress.percent}% of Epic Tickets complete`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress.percent}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{progress.percent}%</span>
        </div>
      </div>
      {tickets.length > 0 ? (
        <div className="divide-y divide-border border-t border-border">
          {tickets.map((ticket) => {
            const repository = repositoriesById.get(ticket.primaryT3ProjectId);
            const assignment = assignmentsByTicket.get(ticket.id);
            return (
              <div
                key={ticket.id}
                className="relative isolate grid min-w-0 w-full cursor-pointer gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <WorkbenchTicketTypeBadge kind={ticket.kind} />
                  </span>
                  <span className="mt-1 block min-w-0">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => onOpenTicket(ticket.id)}
                            className="min-w-0 cursor-pointer truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          />
                        }
                      >
                        {ticket.title}
                      </TooltipTrigger>
                      <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
                        {ticket.title}
                      </TooltipPopup>
                    </Tooltip>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{repository?.title ?? "Repository unavailable"}</span>
                    <span>{assignment ? "Agent assigned" : "Unassigned"}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge size="default" variant="outline">
                    {WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
                  </Badge>
                  <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No child Tickets yet. Add the first Story or Bug for this Epic.
        </div>
      )}
    </section>
  );
}

export function WorkbenchCreateTicketKind({
  kind,
  markdown,
  setKind,
  setMarkdown,
}: {
  kind: WorkbenchTicketKind;
  markdown: string;
  setKind: Dispatch<SetStateAction<WorkbenchTicketKind>>;
  setMarkdown: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Ticket type</Label>
      <Select
        value={kind}
        onValueChange={(value) => {
          if (!isWorkbenchTicketKind(value)) return;
          if (markdown.trim().length === 0 || markdown === getWorkbenchTicketTemplate(kind)) {
            setMarkdown(getWorkbenchTicketTemplate(value));
          }
          setKind(value);
        }}
      >
        <SelectTrigger aria-label="Ticket type">
          <SelectValue>{WORKBENCH_TICKET_KIND_LABELS[kind]}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {WORKBENCH_TICKET_KINDS.map((ticketKind) => (
            <SelectItem key={ticketKind} value={ticketKind}>
              {WORKBENCH_TICKET_KIND_LABELS[ticketKind]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

export function WorkbenchCreateTicketEpic({
  onCreateEpic,
  epics,
  pending,
  epicId,
  setEpicId,
}: Pick<Parameters<typeof WorkbenchTicketDialog>[0], "onCreateEpic" | "epics" | "pending"> & {
  epicId: WorkbenchEpicId | null;
  setEpicId: Dispatch<SetStateAction<WorkbenchEpicId | null>>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Epic</Label>
      <Select
        disabled={pending}
        value={epicId ?? NO_EPIC_VALUE}
        onValueChange={(value) => {
          if (value === CREATE_EPIC_VALUE) {
            onCreateEpic(setEpicId);
            return;
          }
          setEpicId(!value || value === NO_EPIC_VALUE ? null : WorkbenchEpicId.make(value));
        }}
      >
        <SelectTrigger aria-label="Epic">
          <SelectValue>{epics.find((epic) => epic.id === epicId)?.title ?? "No Epic"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={NO_EPIC_VALUE}>No Epic</SelectItem>
          {epics.map((epic) => (
            <SelectItem key={epic.id} value={epic.id}>
              {epic.title}
            </SelectItem>
          ))}
          <SelectPrimitive.Separator className="mx-2 my-1 h-px bg-border" />
          <SelectItem value={CREATE_EPIC_VALUE}>Create Epic…</SelectItem>
        </SelectPopup>
      </Select>
    </div>
  );
}

export function WorkbenchCreateTicketRepositories({
  linkedProjects,
  selectedRepositoryProjectIds,
  selectedProjectId,
  setRepositoryProjectIds,
  setPrimaryProjectId,
}: Pick<Parameters<typeof WorkbenchTicketDialog>[0], "linkedProjects"> & {
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
  selectedProjectId: ProjectId | null;
  setRepositoryProjectIds: Dispatch<SetStateAction<ReadonlyArray<ProjectId>>>;
  setPrimaryProjectId: Dispatch<SetStateAction<ProjectId | null>>;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">Repository scope</legend>
      <p className="text-xs text-muted-foreground">
        Select every repository this Ticket may need. Its primary repository hosts the Agent Thread.
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
                    onCheckedChange={(nextChecked) => {
                      const nextIds = nextChecked
                        ? [...selectedRepositoryProjectIds, project.id]
                        : selectedRepositoryProjectIds.filter((id) => id !== project.id);
                      setRepositoryProjectIds(nextIds);
                      if (selectedProjectId === null || !nextIds.includes(selectedProjectId)) {
                        setPrimaryProjectId(nextIds[0] ?? null);
                      }
                    }}
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
          <div className="space-y-1.5">
            <Label>Primary repository</Label>
            <Select
              value={selectedProjectId}
              onValueChange={(value) => setPrimaryProjectId(value ? ProjectId.make(value) : null)}
            >
              <SelectTrigger aria-label="Primary repository">
                <SelectValue>
                  {linkedProjects.find((project) => project.id === selectedProjectId)?.title ??
                    "Select a repository"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <WorkbenchRepositorySelectOptions
                  projects={linkedProjects}
                  selectedProjectIds={selectedRepositoryProjectIds}
                />
              </SelectPopup>
            </Select>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground">
          This Workbench Workspace has no available linked repositories.
        </div>
      )}
    </fieldset>
  );
}

function WorkbenchWorkspaceRepositories({
  projects,
  pending,
  initialWorkspace,
  linkedProjectIds,
  setLinkedProjectIds,
}: Pick<
  Parameters<typeof WorkbenchWorkspaceDialog>[0],
  "projects" | "pending" | "initialWorkspace"
> & {
  linkedProjectIds: ReadonlyArray<ProjectId>;
  setLinkedProjectIds: Dispatch<SetStateAction<ReadonlyArray<ProjectId>>>;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Linked repositories</legend>
      <p className="text-xs text-muted-foreground">
        {initialWorkspace
          ? "Already-linked repositories stay selected. Add a directory as a T3 Project first if it is not listed here."
          : "Tickets can target any selected T3 Project."}
      </p>
      {projects.length > 0 ? (
        <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
          {projects.map((project) => {
            const inputId = `workbench-project-${project.id}`;
            return (
              <label
                key={project.id}
                htmlFor={inputId}
                className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
              >
                <Checkbox
                  id={inputId}
                  className="mt-0.5"
                  checked={linkedProjectIds.includes(project.id)}
                  disabled={pending || initialWorkspace?.linkedProjectIds.includes(project.id)}
                  onCheckedChange={(checked) =>
                    setLinkedProjectIds((current) =>
                      checked
                        ? [...current, project.id]
                        : current.filter((id) => id !== project.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{project.title}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {project.workspaceRoot}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {initialWorkspace
            ? "No T3 Projects are available to add. Existing repository links are preserved."
            : "Create a T3 Project before creating a Workbench Workspace."}
        </div>
      )}
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
>;
function WorkbenchTicketHeading({
  presentation,
  records,
  context,
  actions,
}: {
  presentation: Pick<
    WorkbenchTicketHeadingProps,
    "executionStatus" | "workspaceTitle" | "displayedTitle" | "isArchived" | "pending" | "editing"
  >;
  records: Pick<WorkbenchTicketHeadingProps, "ticket" | "issue" | "actionableTicket">;
  context: Pick<WorkbenchTicketHeadingProps, "environmentId">;
  actions: Pick<WorkbenchTicketHeadingProps, "onUpdate">;
}) {
  const { executionStatus, workspaceTitle, displayedTitle, isArchived, pending, editing } =
    presentation;
  const { ticket, issue, actionableTicket } = records;
  const { environmentId } = context;
  const { onUpdate } = actions;
  return (
    <div className="col-span-2 row-start-2 min-w-0 @min-[48rem]/ticket:col-span-1 @min-[48rem]/ticket:col-start-2 @min-[48rem]/ticket:row-start-1">
      <p className="text-xs font-medium text-muted-foreground">{workspaceTitle} · Ticket</p>
      <h1 className="mt-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">
        {displayedTitle.trim() || ticket.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <WorkbenchThreadExecutionStatus
          status={executionStatus?.presentation}
          startedAt={executionStatus?.startedAt}
        />
        <WorkbenchTicketTypeBadge kind={ticket.kind} size="control" />
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

type WorkbenchTicketHeaderActionsProps = Pick<
  WorkbenchTicketHeaderProps,
  | "displayedTitle"
  | "ticket"
  | "issue"
  | "isArchived"
  | "actionableTicket"
  | "pending"
  | "canOpenThread"
  | "threadActionPending"
  | "threadActionLabel"
  | "thread"
  | "selectedThreadTitle"
  | "assignment"
  | "onReplaceThread"
  | "settledAssignments"
  | "onNewThread"
  | "onOpenThread"
  | "lifecycleActionsEnabled"
  | "onArchive"
  | "setDeleteConfirmationOpen"
>;
function WorkbenchTicketHeaderActions({
  presentation,
  records,
  actions,
}: {
  presentation: Pick<
    WorkbenchTicketHeaderActionsProps,
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "canOpenThread"
    | "threadActionPending"
    | "threadActionLabel"
    | "thread"
    | "selectedThreadTitle"
    | "lifecycleActionsEnabled"
  >;
  records: Pick<
    WorkbenchTicketHeaderActionsProps,
    "ticket" | "issue" | "actionableTicket" | "assignment"
  >;
  actions: Pick<
    WorkbenchTicketHeaderActionsProps,
    | "onReplaceThread"
    | "settledAssignments"
    | "onNewThread"
    | "onOpenThread"
    | "onArchive"
    | "setDeleteConfirmationOpen"
  >;
}) {
  const {
    displayedTitle,
    isArchived,
    pending,
    canOpenThread,
    threadActionPending,
    threadActionLabel,
    thread,
    selectedThreadTitle,
    lifecycleActionsEnabled,
  } = presentation;
  const { ticket, issue, actionableTicket, assignment } = records;
  const {
    onReplaceThread,
    settledAssignments,
    onNewThread,
    onOpenThread,
    onArchive,
    setDeleteConfirmationOpen,
  } = actions;
  return (
    <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap justify-end gap-2 @min-[48rem]/ticket:col-start-3">
      {canOpenThread ? (
        <>
          {threadActionPending ? (
            <span aria-live="polite" className="sr-only" role="status">
              {threadActionLabel ?? thread.pendingActionLabel}
            </span>
          ) : null}
          <Button
            aria-busy={threadActionPending}
            aria-label={`${
              threadActionLabel ??
              (threadActionPending ? thread.pendingActionLabel : thread.actionLabel)
            } for ${selectedThreadTitle ?? displayedTitle}`}
            title={selectedThreadTitle}
            disabled={pending}
            onClick={() => {
              if (assignment && thread.state === "missing") {
                onReplaceThread(ticket, assignment.threadId);
                return;
              }
              if (!assignment && settledAssignments.length > 0) {
                onNewThread(actionableTicket);
                return;
              }
              onOpenThread(actionableTicket, assignment?.threadId);
            }}
            size="sm"
            type="button"
          >
            {threadActionPending ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <BotIcon data-icon="inline-start" />
            )}
            {threadActionLabel ??
              (threadActionPending ? thread.pendingActionLabel : thread.actionLabel)}
          </Button>
        </>
      ) : null}
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
  );
}

function getWorkbenchActiveThreadRow({
  activeAssignment,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
}: Pick<
  WorkbenchTicketActiveThreadRowProps,
  "activeAssignment" | "threadsById" | "archivedThreadsById" | "ticket" | "threadLookupReady"
>) {
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
    threadLookupReady,
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

function WorkbenchActiveThreadActions({
  pending,
  isArchived,
  onUnlinkThread,
  supportsSettlement,
  toggleThreadSettlement,
  settlementPendingThreadId,
  onDeleteThread,
  activeAssignment,
  displayedActiveThread,
  archivedActiveThread,
}: Pick<
  WorkbenchTicketActiveThreadRowProps,
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "activeAssignment"
> & {
  displayedActiveThread: EnvironmentThreadShell;
  archivedActiveThread: EnvironmentThreadShell | undefined;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Unlink Thread ${displayedActiveThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onUnlinkThread(activeAssignment.threadId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <UnlinkIcon />
        </TooltipTrigger>
        <TooltipPopup>Unlink Thread from Ticket</TooltipPopup>
      </Tooltip>
      {supportsSettlement ? (
        <WorkbenchThreadSettlementButton
          archived={archivedActiveThread !== undefined}
          disabled={pending || isArchived || archivedActiveThread !== undefined}
          onClick={() => void toggleThreadSettlement(displayedActiveThread)}
          pending={settlementPendingThreadId === displayedActiveThread.id}
          settled={displayedActiveThread.settledOverride === "settled"}
          title={displayedActiveThread.title}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Delete Thread ${displayedActiveThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onDeleteThread(activeAssignment.threadId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <Trash2Icon />
        </TooltipTrigger>
        <TooltipPopup>Delete Thread</TooltipPopup>
      </Tooltip>
    </>
  );
}

function WorkbenchHistoricalThreadActions({
  pending,
  isArchived,
  onUnlinkThread,
  supportsSettlement,
  toggleThreadSettlement,
  settlementPendingThreadId,
  onDeleteThread,
  historicalAssignment,
  displayedHistoricalThread,
  historicalArchivedThread,
}: Pick<
  WorkbenchTicketHistoricalThreadRowProps,
  | "pending"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "historicalAssignment"
> & {
  displayedHistoricalThread: EnvironmentThreadShell;
  historicalArchivedThread: EnvironmentThreadShell | undefined;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Unlink Thread ${displayedHistoricalThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onUnlinkThread(historicalAssignment.threadId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <UnlinkIcon />
        </TooltipTrigger>
        <TooltipPopup>Unlink Thread from Ticket</TooltipPopup>
      </Tooltip>
      {supportsSettlement ? (
        <WorkbenchThreadSettlementButton
          archived={historicalArchivedThread !== undefined}
          disabled={pending || isArchived || historicalArchivedThread !== undefined}
          onClick={() => void toggleThreadSettlement(displayedHistoricalThread)}
          pending={settlementPendingThreadId === displayedHistoricalThread.id}
          settled={displayedHistoricalThread.settledOverride === "settled"}
          title={displayedHistoricalThread.title}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Delete Thread ${displayedHistoricalThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onDeleteThread(historicalAssignment.threadId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <Trash2Icon />
        </TooltipTrigger>
        <TooltipPopup>Delete Thread</TooltipPopup>
      </Tooltip>
    </>
  );
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
  ticket,
}: Pick<
  WorkbenchTicketDetailProps,
  "assignments" | "threadsById" | "archivedThreadsById" | "threadLookupReady" | "ticket"
>) {
  const visibleAssignments = assignments.filter(
    (assignment) =>
      assignment.supersededAt === null ||
      !threadLookupReady ||
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
  };
}

function getWorkbenchDetailWorkspace({
  ticket,
  ticketWorkspace,
  preparationPending,
  preparationFailed,
  linkedProjects,
}: Pick<
  WorkbenchTicketDetailProps,
  "ticket" | "ticketWorkspace" | "preparationPending" | "preparationFailed" | "linkedProjects"
>) {
  const repositoryScopeLocked =
    preparationPending ||
    ticketWorkspace?.status === "preparing" ||
    ticketWorkspace?.status === "releasing";
  const selectedRepositoryProjectIds = getWorkbenchTicketRepositoryProjectIds(ticket);
  const workspaceHasSelectedRepositories = selectedRepositoryProjectIds.every((projectId) =>
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
      ? "Preparing work area…"
      : workspaceHasFailure
        ? "Retry preparation"
        : "Prepare work area";
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
      isPrimary: id === ticket.primaryT3ProjectId,
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
      isPrimary: workspaceRepository.isPrimary,
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

function useWorkbenchTicketSettlement(environmentId: EnvironmentId) {
  const { settleThread, unsettleThread } = useThreadActions();
  const [settlementPendingThreadId, setSettlementPendingThreadId] = useState<ThreadId | null>(null);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supportsSettlement = serverConfig?.environment.capabilities.threadSettlement === true;
  const toggleThreadSettlement = async (thread: EnvironmentThreadShell) => {
    if (!supportsSettlement || settlementPendingThreadId !== null) return;
    const wasSettled = thread.settledOverride === "settled";
    setSettlementPendingThreadId(thread.id);
    return (async () => {
      const result = wasSettled
        ? await unsettleThread(scopeThreadRef(environmentId, thread.id))
        : await settleThread(scopeThreadRef(environmentId, thread.id));
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: wasSettled ? "Failed to un-settle thread" : "Failed to settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })().finally(() => {
      setSettlementPendingThreadId((current) => (current === thread.id ? null : current));
    });
  };
  return { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement };
}

function useWorkbenchTicketDetailPanels() {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [threadPanelCollapsed, setThreadPanelCollapsed] =
    useWorkbenchTicketPanelCollapsed("threads");
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
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
    detailsPanelCollapsed,
    setDetailsPanelCollapsed,
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
}: Pick<
  WorkbenchTicketDetailProps,
  "threadsById" | "archivedThreadsById" | "ticket" | "threadLookupReady"
> & { assignment: WorkbenchAssignment | undefined }) {
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
    threadLookupReady,
  );
  return {
    nativeThread,
    archivedThread,
    displayedThread,
    nativeStatus,

    thread,
  };
}

function WorkbenchEpicCounts({
  progress,
  linkField,
}: {
  progress: ReturnType<typeof getWorkbenchEpicProgress>;
  linkField: ReactNode;
}) {
  return (
    <aside className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListChecksIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Details</h2>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-4 p-4 text-sm">
          <dt className="text-muted-foreground">Type</dt>
          <dd className="text-right font-medium">Epic</dd>
          <dt className="text-muted-foreground">Progress</dt>
          <dd className="text-right font-medium">{progress.percent}% done</dd>
          <dt className="text-muted-foreground">Child Tickets</dt>
          <dd className="text-right font-medium">{progress.total}</dd>
        </dl>
        <div className="border-t border-border p-4">{linkField}</div>
      </section>
    </aside>
  );
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
  WorkbenchTicketHeaderActionsProps,
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

function getWorkbenchActiveThreadRowPresentation({
  displayedActiveThread,
  activeAgentState,
  activeThreadState,
  activeThreadModel,
  activeThreadRecency,
  threadLookupReady,
}: Pick<
  ReturnType<typeof getWorkbenchActiveThreadRow>,
  | "displayedActiveThread"
  | "activeAgentState"
  | "activeThreadState"
  | "activeThreadModel"
  | "activeThreadRecency"
> & { threadLookupReady: boolean }) {
  return {
    ariaLabel: `${displayedActiveThread?.archivedAt ? "Restore and open" : "Open Thread"} ${displayedActiveThread?.title ?? (threadLookupReady ? "Thread deleted" : "Checking Thread…")}`,
    modelLabel: activeThreadModel,
    recencyLabel: activeThreadRecency,
    stateLabel: displayedActiveThread?.archivedAt
      ? "Archived"
      : displayedActiveThread
        ? null
        : activeThreadState,
    executionStatus: activeAgentState,
    title:
      displayedActiveThread?.title ?? (threadLookupReady ? "Thread deleted" : "Checking Thread…"),
  };
}

function getWorkbenchHistoricalThreadRowPresentation({
  displayedHistoricalThread,
  historicalAgentState,
  threadLookupReady,
}: Pick<
  ReturnType<typeof getWorkbenchHistoricalThreadRow>,
  "displayedHistoricalThread" | "historicalAgentState"
> & { threadLookupReady: boolean }) {
  return {
    ariaLabel: `${displayedHistoricalThread?.archivedAt ? "Restore and open" : displayedHistoricalThread ? "Open" : "Checking"} ${displayedHistoricalThread?.title ?? (threadLookupReady ? "Thread deleted" : "Checking Thread…")}`,
    modelLabel: getWorkbenchThreadModelLabel(displayedHistoricalThread),
    recencyLabel: displayedHistoricalThread
      ? getWorkbenchThreadRecencyLabel(displayedHistoricalThread)
      : null,
    stateLabel: displayedHistoricalThread
      ? displayedHistoricalThread.archivedAt
        ? "Archived"
        : "Historical"
      : threadLookupReady
        ? "Thread deleted"
        : "Checking…",
    executionStatus: historicalAgentState,
    title:
      displayedHistoricalThread?.title ??
      (threadLookupReady ? "Thread deleted" : "Checking Thread…"),
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
  initialEpicId,
  pending,
  onOpenChange,
}: Pick<
  Parameters<typeof WorkbenchTicketDialog>[0],
  "initialEpicId" | "pending" | "onOpenChange"
>) {
  const [requestId, setRequestId] = useState(() => WorkbenchTicketId.make(randomUUID()));
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkbenchTicketKind>("story");
  const [epicId, setEpicId] = useState<WorkbenchEpicId | null>(initialEpicId);
  const [markdown, setMarkdown] = useState(() => getWorkbenchTicketTemplate("story"));
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(null);
  const [references, setReferences] = useState<ReadonlyArray<WorkbenchReferenceDraft>>([]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) {
      setReferences([]);
      setRequestId(WorkbenchTicketId.make(randomUUID()));
      setTitle("");
      setKind("story");
      setEpicId(initialEpicId);
      setMarkdown(getWorkbenchTicketTemplate("story"));
      setRepositoryProjectIds([]);
      setPrimaryProjectId(null);
    }
    onOpenChange(nextOpen);
  };
  return {
    requestId,
    title,
    setTitle,
    kind,
    setKind,
    epicId,
    setEpicId,
    markdown,
    setMarkdown,
    repositoryProjectIds,
    setRepositoryProjectIds,
    primaryProjectId,
    setPrimaryProjectId,
    references,
    setReferences,
    handleOpenChange,
  };
}

export function getWorkbenchCreateTicketRepositories({
  linkedProjects,
  repositoryProjectIds,
  primaryProjectId,
}: {
  linkedProjects: ReadonlyArray<Project>;
  repositoryProjectIds: ReadonlyArray<ProjectId>;
  primaryProjectId: ProjectId | null;
}) {
  const availableProjectIds = new Set(linkedProjects.map((project) => project.id));
  const selectedRepositoryProjectIds = repositoryProjectIds.filter((id) =>
    availableProjectIds.has(id),
  );
  if (selectedRepositoryProjectIds.length === 0 && linkedProjects[0]) {
    selectedRepositoryProjectIds.push(linkedProjects[0].id);
  }
  const selectedProjectId =
    selectedRepositoryProjectIds.find((id) => id === primaryProjectId) ??
    selectedRepositoryProjectIds[0] ??
    null;
  return { selectedRepositoryProjectIds, selectedProjectId };
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
            these worktrees exist, or any worktree has local changes. Prepare the work area again
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
  threadLookupReady,
  settledCount,
}: {
  displayedThread: EnvironmentThreadShell | undefined;
  assignment: WorkbenchAssignment | undefined;
  threadLookupReady: boolean;
  settledCount: number;
}) {
  if (displayedThread) return displayedThread.title;
  if (assignment && !threadLookupReady) return "Checking Thread…";
  return settledCount > 0 ? "No active Threads" : "No Thread";
}
