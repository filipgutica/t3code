import { WorkbenchRepositorySelectOptions } from "./WorkbenchRepositorySelectOptions";
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
  type WorkbenchJiraBinding,
  type WorkbenchEpic,
  WorkbenchEpicId,
  type WorkbenchJiraIssueLink,
  type WorkbenchTicket,
  WorkbenchTicketId,
  type WorkbenchTicketKind,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArchiveIcon,
  BotIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CheckIcon,
  ExternalLinkIcon,
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
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  WorkbenchTicketStatusMenu,
  type WorkbenchJiraTransitionSelection,
} from "./WorkbenchTicketStatusMenu";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { PROVIDER_ICON_BY_PROVIDER } from "../components/chat/providerIconUtils";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";

import { Badge } from "../components/ui/badge";
import { OpenInPicker } from "../components/chat/OpenInPicker";
import { Button } from "../components/ui/button";
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useThreadActions } from "../hooks/useThreadActions";
import { randomUUID } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  getWorkbenchAgentPresentation,
  getWorkbenchEpicProgress,
  getActiveAssignmentsByTicket,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  getWorkbenchTicketThreadSections,
  getVisibleWorkbenchAssignments,
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
import { WorkbenchJiraIssueKey, WorkbenchTicketKindBadge } from "./WorkbenchTicketMetadata";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { WorkbenchTicketPullRequests } from "./WorkbenchTicketPullRequests";
import { resolveWorkbenchTicketContent } from "./workbenchJira.logic";
import {
  getWorkbenchTicketPullRequests,
  getWorkbenchTicketPullRequestCheckouts,
} from "./workbenchPullRequests.logic";

const NO_EPIC_VALUE = "__workbench_no_epic__";
const CREATE_EPIC_VALUE = "__workbench_create_epic__";

export function WorkbenchEpicDetail({
  workspaceTitle,
  epic,
  jiraManaged,
  jiraUrl,
  tickets,
  repositoriesById,
  assignmentsByTicket,
  jiraIssueLinksByTicketId,
  pending,
  error,
  onBack,
  onSave,
  onOpenTicket,
  onCreateTicket,
}: {
  readonly workspaceTitle: string;
  readonly epic: WorkbenchEpic;
  readonly jiraManaged: boolean;
  readonly jiraUrl: string | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly repositoriesById: ReadonlyMap<Project["id"], Project>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicket["id"], WorkbenchAssignment>;
  readonly jiraIssueLinksByTicketId: ReadonlyMap<WorkbenchTicket["id"], WorkbenchJiraIssueLink>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onSave: (epic: WorkbenchEpic, title: string, markdown: string) => Promise<boolean>;
  readonly onOpenTicket: (ticket: WorkbenchTicket) => void;
  readonly onCreateTicket: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const progress = getWorkbenchEpicProgress(tickets);
  const blockedCount = tickets.filter(
    (ticket) => jiraIssueLinksByTicketId.get(ticket.id)?.issue.flagged,
  ).length;

  const cancelEditing = () => {
    setEditing(false);
  };
  const startEditing = () => {
    setTitle(epic.title);
    setMarkdown(epic.markdown);
    setEditing(true);
  };

  return (
    <article className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkbenchEpicHeader
        workspaceTitle={workspaceTitle}
        epic={epic}
        jiraManaged={jiraManaged}
        jiraUrl={jiraUrl}
        tickets={tickets}
        pending={pending}
        onBack={onBack}
        onCreateTicket={onCreateTicket}
        progress={progress}
        blockedCount={blockedCount}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            {error ? <WorkbenchInlineError message={error} /> : null}
            <WorkbenchEpicDescription
              presentation={{
                epic: epic,
                jiraManaged: jiraManaged,
                pending: pending,
                editing: editing,
                startEditing: startEditing,
                cancelEditing: cancelEditing,
                title: title,
                markdown: markdown,
              }}
              actions={{
                onSave: onSave,
                setTitle: setTitle,
                setMarkdown: setMarkdown,
                setEditing: setEditing,
              }}
            />

            <WorkbenchEpicTickets
              epic={epic}
              jiraManaged={jiraManaged}
              tickets={tickets}
              repositoriesById={repositoriesById}
              assignmentsByTicket={assignmentsByTicket}
              jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
              pending={pending}
              onOpenTicket={onOpenTicket}
              onCreateTicket={onCreateTicket}
              progress={progress}
            />
          </div>

          <WorkbenchEpicCounts
            jiraManaged={jiraManaged}
            tickets={tickets}
            progress={progress}
            blockedCount={blockedCount}
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
  error,
  onOpenChange,
  onSave,
  initialWorkspace,
}: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly pending: boolean;
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
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    onOpenChange(nextOpen);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || title.trim().length === 0 || linkedProjectIds.length === 0) return;
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
          <Button
            form="workbench-workspace"
            disabled={pending || title.trim().length === 0 || linkedProjectIds.length === 0}
            type="submit"
          >
            {initialWorkspace ? (
              pending ? (
                "Saving…"
              ) : (
                "Save changes"
              )
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
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly pending: boolean;
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
    if (title.trim().length === 0) return;
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
            disabled={pending || title.trim().length === 0}
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
  jiraBinding = null,
  pending,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly initialEpicId: WorkbenchEpicId | null;
  readonly jiraBinding?: WorkbenchJiraBinding | null;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (draft: WorkbenchCreateTicketDraft) => Promise<boolean>;
}) {
  const {
    requestId,
    jiraSprintId,
    setJiraSprintId,
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
    handleOpenChange,
  } = useWorkbenchCreateTicketDraft({ initialEpicId, pending, onOpenChange });
  const { selectedRepositoryProjectIds, selectedProjectId } = getWorkbenchCreateTicketRepositories({
    linkedProjects,
    repositoryProjectIds,
    primaryProjectId,
  });
  const { jiraSprints, selectedSprintId, createLabel, description } =
    getWorkbenchCreateTicketJiraPresentation({
      jiraBinding,
      jiraSprintId,
      pending,
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      pending ||
      title.trim().length === 0 ||
      selectedProjectId === null ||
      (jiraBinding !== null && (!jiraBinding.active || selectedSprintId === undefined))
    )
      return;
    void (async () => {
      if (
        !(await onCreate({
          id: requestId,
          title,
          markdown,
          kind,
          epicId,
          repositoryProjectIds: selectedRepositoryProjectIds,
          primaryT3ProjectId: selectedProjectId,
          ...(selectedSprintId === undefined ? {} : { jiraSprintId: selectedSprintId }),
        }))
      )
        return;
      handleOpenChange(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Ticket</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-ticket" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            {jiraBinding && !jiraBinding.active ? (
              <WorkbenchInlineError message="Resume the Jira connection before creating a Ticket." />
            ) : null}
            {jiraBinding ? (
              <WorkbenchCreateTicketSprint
                pending={pending}
                jiraSprints={jiraSprints}
                selectedSprintId={selectedSprintId}
                setJiraSprintId={setJiraSprintId}
              />
            ) : null}
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
              jiraBinding={jiraBinding}
              onCreateEpic={onCreateEpic}
              epics={epics}
              pending={pending}
              epicId={epicId}
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
            disabled={
              pending ||
              title.trim().length === 0 ||
              selectedProjectId === null ||
              (jiraBinding !== null && (!jiraBinding.active || selectedSprintId === undefined))
            }
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

type WorkbenchTicketDetailProps = {
  readonly environmentId: EnvironmentId;
  readonly workspaceTitle: string;
  readonly ticket: WorkbenchTicket;
  readonly ticketWorkspace: WorkbenchTicketWorkspace | undefined;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraIssueLink: WorkbenchJiraIssueLink | null;
  readonly jiraFieldsManaged: boolean;
  readonly jiraRefreshing: boolean;
  readonly jiraRefreshDisabled: boolean;
  readonly onRefreshJira: (() => void) | null;
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
  readonly onJiraTransition: (selection: WorkbenchJiraTransitionSelection) => void;
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
  readonly onPrepareWorkspace: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly onResetWorkspace: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly lifecycleActionsEnabled: boolean;
};
export function WorkbenchTicketDetail(props: WorkbenchTicketDetailProps) {
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
        ticket: props.ticket,
        epics: props.epics,
        jiraIssueLink: props.jiraIssueLink,
        jiraFieldsManaged: props.jiraFieldsManaged,
        jiraRefreshing: props.jiraRefreshing,
        jiraRefreshDisabled: props.jiraRefreshDisabled,
        pending: props.pending,
        error: props.error,
        lifecycleActionsEnabled: props.lifecycleActionsEnabled,
      }}
      workspace={{
        ticketWorkspace: props.ticketWorkspace,
        linkedProjects: props.linkedProjects,
        preparationFailed: props.preparationFailed,
        preparationPending: props.preparationPending,
      }}
      actions={{
        onRefreshJira: props.onRefreshJira,
        onBack: props.onBack,
        onSave: props.onSave,
        onRegenerateSummary: props.onRegenerateSummary,
        onUpdate: props.onUpdate,
        onJiraTransition: props.onJiraTransition,
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
        onPrepareWorkspace: props.onPrepareWorkspace,
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
    | "ticket"
    | "epics"
    | "jiraIssueLink"
    | "jiraFieldsManaged"
    | "jiraRefreshing"
    | "jiraRefreshDisabled"
    | "pending"
    | "error"
    | "lifecycleActionsEnabled"
  >;
  workspace: Pick<
    WorkbenchTicketDetailProps,
    "ticketWorkspace" | "linkedProjects" | "preparationFailed" | "preparationPending"
  >;
  actions: Pick<
    WorkbenchTicketDetailProps,
    | "onRefreshJira"
    | "onBack"
    | "onSave"
    | "onRegenerateSummary"
    | "onUpdate"
    | "onJiraTransition"
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
    | "onPrepareWorkspace"
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
    epics,
    jiraIssueLink,
    jiraFieldsManaged,
    jiraRefreshing,
    jiraRefreshDisabled,
    pending,
    error,
    lifecycleActionsEnabled,
  } = content;
  const { ticketWorkspace, linkedProjects, preparationFailed, preparationPending } = workspace;
  const {
    onRefreshJira,
    onBack,
    onSave,
    onRegenerateSummary,
    onUpdate,
    onJiraTransition,
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
    onPrepareWorkspace,
    onResetWorkspace,
  } = actions;
  const { assignments, threadActionPending, threadActionLabel } = threads;
  const { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement } =
    useWorkbenchTicketSettlement(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const providerEntries = deriveProviderInstanceEntries(providers ?? []);
  const threadProviderKind = (thread: EnvironmentThreadShell | undefined) => {
    const instanceId = thread?.session?.providerInstanceId ?? thread?.modelSelection.instanceId;
    return providerEntries.find((entry) => entry.instanceId === instanceId)?.driverKind;
  };
  const {
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    resetConfirmationOpen,
    setResetConfirmationOpen,
    summaryPanelCollapsed,
    setSummaryPanelCollapsed,
    threadPanelCollapsed,
    setThreadPanelCollapsed,
    settledThreadsCollapsed,
    setSettledThreadsCollapsed,
    detailsPanelCollapsed,
    setDetailsPanelCollapsed,
    repositoryScopePanelCollapsed,
    setRepositoryScopePanelCollapsed,
    repositoryScopeEditorCollapsed,
    setRepositoryScopeEditorCollapsed,
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
    nativeThreadFailed,
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
    projectedContent,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    hasUnsavedChanges,
    cancelEditing,
    startEditing,
  } = useWorkbenchTicketDraftEditor({ environmentId, ticket, jiraIssueLink, jiraFieldsManaged });
  const agentTitle =
    displayedThread?.title ??
    (assignment && !threadLookupReady
      ? "Checking Thread…"
      : settledAssignments.length > 0
        ? "No active Threads"
        : "No Thread");
  const {
    repositoryScopeLocked,
    selectedRepositoryProjectIds,
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
  const linkedEpicId = ticket.epicId;
  const canOpenThread = !isArchived || assignment !== undefined;

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&_[data-slot=button]>svg]:mx-0">
      <WorkbenchTicketHeader
        actions={{
          onBack: onBack,
          onUpdate: onUpdate,
          onJiraTransition: onJiraTransition,
          onRefreshJira: onRefreshJira,
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
          pending: pending,
          editing: editing,
          jiraRefreshDisabled: jiraRefreshDisabled,
          jiraRefreshing: jiraRefreshing,
          canOpenThread: canOpenThread,
          threadActionPending: threadActionPending,
          threadActionLabel: threadActionLabel,
          thread: thread,
          lifecycleActionsEnabled: lifecycleActionsEnabled,
        }}
        records={{
          ticket: ticket,
          jiraIssueLink: jiraIssueLink,
          actionableTicket: actionableTicket,
          assignment: assignment,
        }}
        context={{ environmentId: environmentId }}
      />

      <form
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 xl:overflow-y-hidden [&_[data-slot=button]>svg]:mx-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editing || !draft) return;
          const normalizedTitle = jiraFieldsManaged ? projectedContent.title : draft.title.trim();
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
        <div className="mx-auto grid min-h-0 min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-4 xl:h-full xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-4 xl:space-y-0">
            {error ? <WorkbenchInlineError message={error} /> : null}
            <WorkbenchTicketSummaryPanel
              summaryPanelCollapsed={summaryPanelCollapsed}
              summaryHeaderLabel={summaryHeaderLabel}
              hasUnsavedChanges={hasUnsavedChanges}
              setSummaryPanelCollapsed={setSummaryPanelCollapsed}
              summary={summary}
              ticket={ticket}
              displayedTitle={displayedTitle}
              pending={pending}
              isArchived={isArchived}
              onRegenerateSummary={onRegenerateSummary}
            />
            <WorkbenchTicketDescriptionPanel
              presentation={{
                jiraFieldsManaged: jiraFieldsManaged,
                editing: editing,
                isArchived: isArchived,
                pending: pending,
                startEditing: startEditing,
                projectedContent: projectedContent,
                draft: draft,
                cancelEditing: cancelEditing,
                dirty: dirty,
                displayedMarkdown: displayedMarkdown,
              }}
              actions={{ setDraft: setDraft }}
              context={{ environmentId: environmentId }}
              records={{ ticket: ticket }}
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-3 xl:h-full xl:min-h-0 xl:overflow-hidden">
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
                settledThreadsCollapsed: settledThreadsCollapsed,
                setSettledThreadsCollapsed: setSettledThreadsCollapsed,
                onAttachThread: onAttachThread,
              }}
              presentation={{
                canOpenThread: canOpenThread,
                threadActionPending: threadActionPending,
                thread: thread,
                displayedTitle: displayedTitle,
                pending: pending,
                nativeStatus: nativeStatus,
                nativeThreadFailed: nativeThreadFailed,
                agentTitle: agentTitle,
                isArchived: isArchived,
                supportsSettlement: supportsSettlement,
              }}
              context={{
                threadProviderKind: threadProviderKind,
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
              onOpenThread={onOpenAssignedThread}
              environmentId={environmentId}
              ticketKey={jiraIssueLink?.issue.key ?? null}
              workspaceRepositoryProjectIds={linkedProjects.map((project) => project.id)}
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
                repositoryScopeEditorCollapsed: repositoryScopeEditorCollapsed,
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
                onPrepareWorkspace: onPrepareWorkspace,
                setRepositoryScopePanelCollapsed: setRepositoryScopePanelCollapsed,
                setAdvancedWorkspaceSettingsCollapsed: setAdvancedWorkspaceSettingsCollapsed,
                setResetConfirmationOpen: setResetConfirmationOpen,
                setRepositoryScopeEditorCollapsed: setRepositoryScopeEditorCollapsed,
                onUpdate: onUpdate,
              }}
              records={{
                ticket: ticket,
                repositories: repositories,
                ticketWorkspace: ticketWorkspace,
                retainedRepositories: retainedRepositories,
                activeAssignments: activeAssignments,
                selectedRepositoryProjectIds: selectedRepositoryProjectIds,
                actionableTicket: actionableTicket,
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
                jiraFieldsManaged: jiraFieldsManaged,
                linkedEpicId: linkedEpicId,
                pending: pending,
              }}
              actions={{
                onCreateEpic: onCreateEpic,
                onOpenEpic: onOpenEpic,
                onToggle: () => setDetailsPanelCollapsed((collapsed) => !collapsed),
                onUpdate: onUpdate,
              }}
              records={{ ticket: ticket, actionableTicket: actionableTicket }}
            />
          </aside>
        </div>
      </form>
      <WorkbenchTicketDeleteConfirmation
        displayedTitle={displayedTitle}
        error={error}
        pending={pending}
        ticket={ticket}
        onDelete={onDelete}
        deleteConfirmationOpen={deleteConfirmationOpen}
        setDeleteConfirmationOpen={setDeleteConfirmationOpen}
      />
      <WorkbenchTicketResetConfirmation
        displayedTitle={displayedTitle}
        error={error}
        pending={pending}
        ticket={ticket}
        onResetWorkspace={onResetWorkspace}
        resetConfirmationOpen={resetConfirmationOpen}
        setResetConfirmationOpen={setResetConfirmationOpen}
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
  readonly jiraFieldsManaged: boolean;
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
    "collapsed" | "epics" | "isArchived" | "jiraFieldsManaged" | "linkedEpicId" | "pending"
  >;
  actions: Pick<
    WorkbenchTicketDetailsPanelProps,
    "onCreateEpic" | "onOpenEpic" | "onToggle" | "onUpdate"
  >;
  records: Pick<WorkbenchTicketDetailsPanelProps, "ticket" | "actionableTicket">;
}) {
  const { collapsed, epics, isArchived, jiraFieldsManaged, linkedEpicId, pending } = presentation;
  const { onCreateEpic, onOpenEpic, onToggle, onUpdate } = actions;
  const { ticket, actionableTicket } = records;
  return (
    <section
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 ${collapsed ? "" : "xl:min-h-0 xl:flex-1"}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Details</h2>
        </div>
        {jiraFieldsManaged ? (
          <Badge size="default" variant="outline">
            Managed by Jira
          </Badge>
        ) : null}
        <Button
          aria-controls="workbench-ticket-details"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand Ticket Details" : "Collapse Ticket Details"}
          onClick={onToggle}
          size="icon-xs"
          title={collapsed ? "Expand Ticket Details" : "Collapse Ticket Details"}
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={collapsed ? "" : "rotate-180"} />
        </Button>
      </div>
      {!collapsed ? (
        <div
          id="workbench-ticket-details"
          className="min-h-0 xl:overflow-y-auto xl:overscroll-contain"
        >
          {jiraFieldsManaged ? (
            <WorkbenchTicketJiraDetails
              epics={epics}
              linkedEpicId={linkedEpicId}
              onOpenEpic={onOpenEpic}
              ticket={ticket}
            />
          ) : (
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
          )}
        </div>
      ) : null}
    </section>
  );
}

type WorkbenchTicketRepositoryEntry = {
  readonly id: ProjectId;
  readonly isPrimary: boolean;
  readonly repository: Project | undefined;
  readonly openInCwd: string | null;
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
  const repositoryTitle = repository?.title ?? "Repository unavailable";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {openInCwd ? (
            <WorkbenchCheckoutDirectory
              cwd={openInCwd}
              icon={
                <FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              }
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
          {isRetained ? (
            <Badge size="sm" variant="outline">
              Retained · outside ticket context
            </Badge>
          ) : null}
        </div>
      </div>
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

function WorkbenchThreadOpenButton({
  actions,
  ariaLabel,
  disabled,
  modelLabel,
  onClick,
  providerKind,
  recencyLabel,
  stateLabel,
  statusDotClassName,
  title,
}: {
  readonly actions?: ReactNode;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly modelLabel: string | null;
  readonly onClick: () => void;
  readonly providerKind: ProviderDriverKind | undefined;
  readonly recencyLabel: string | null;
  readonly stateLabel: string;
  readonly statusDotClassName: string | undefined;
  readonly title: string;
}) {
  const ThreadIcon = (providerKind && PROVIDER_ICON_BY_PROVIDER[providerKind]) || BotIcon;
  return (
    <div className="min-w-0 flex-1 basis-full">
      <button
        aria-label={ariaLabel}
        className="group relative flex w-full min-w-0 cursor-pointer items-start gap-2 text-left text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring enabled:after:absolute enabled:after:inset-0 enabled:after:content-[''] disabled:cursor-default disabled:opacity-50"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ThreadIcon aria-hidden className="size-3.5 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <WorkbenchThreadTitle
            className="relative z-10 line-clamp-2 break-words font-medium [overflow-wrap:anywhere]"
            title={title}
          />
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {statusDotClassName ? (
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${statusDotClassName}`} />
            ) : null}
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{stateLabel}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center text-muted-foreground group-hover:text-foreground">
          <span className="sr-only">Open Thread</span>
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
  disabled,
  onClick,
  pending,
  settled,
  title,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly settled: boolean;
  readonly title: string;
}) {
  const actionLabel = settled ? "Un-settle" : "Settle";
  const pendingLabel = settled ? "Un-settling…" : "Settling…";
  return (
    <Button
      aria-busy={pending}
      aria-label={`${actionLabel} Thread ${title}`}
      disabled={disabled || pending}
      onClick={onClick}
      size="icon-xs"
      title={`${actionLabel} Thread`}
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
  );
}

function getWorkbenchThreadRecencyLabel(thread: EnvironmentThreadShell): string {
  return formatRelativeTimeLabel(
    thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );
}

function WorkbenchInlineError({ message }: { readonly message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground"
      role="alert"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

type WorkbenchTicketHeaderProps = {
  onBack: () => void;
  workspaceTitle: string;
  displayedTitle: string;
  ticket: WorkbenchTicket;
  jiraIssueLink: WorkbenchJiraIssueLink | null;
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
  onJiraTransition: (selection: WorkbenchJiraTransitionSelection) => void;
  onRefreshJira: (() => void) | null;
  jiraRefreshDisabled: boolean;
  jiraRefreshing: boolean;
  canOpenThread: boolean;
  threadActionPending: boolean;
  threadActionLabel: string | null | undefined;
  thread: ReturnType<typeof getWorkbenchThreadPresentation>;
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
    | "onJiraTransition"
    | "onRefreshJira"
    | "onReplaceThread"
    | "settledAssignments"
    | "onNewThread"
    | "onOpenThread"
    | "onArchive"
    | "setDeleteConfirmationOpen"
  >;
  presentation: Pick<
    WorkbenchTicketHeaderProps,
    | "workspaceTitle"
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "editing"
    | "jiraRefreshDisabled"
    | "jiraRefreshing"
    | "canOpenThread"
    | "threadActionPending"
    | "threadActionLabel"
    | "thread"
    | "lifecycleActionsEnabled"
  >;
  records: Pick<
    WorkbenchTicketHeaderProps,
    "ticket" | "jiraIssueLink" | "actionableTicket" | "assignment"
  >;
  context: Pick<WorkbenchTicketHeaderProps, "environmentId">;
}) {
  const {
    onBack,
    onUpdate,
    onJiraTransition,
    onRefreshJira,
    onReplaceThread,
    settledAssignments,
    onNewThread,
    onOpenThread,
    onArchive,
    setDeleteConfirmationOpen,
  } = actions;
  const {
    workspaceTitle,
    displayedTitle,
    isArchived,
    pending,
    editing,
    jiraRefreshDisabled,
    jiraRefreshing,
    canOpenThread,
    threadActionPending,
    threadActionLabel,
    thread,
    lifecycleActionsEnabled,
  } = presentation;
  const { ticket, jiraIssueLink, actionableTicket, assignment } = records;
  const { environmentId } = context;
  return (
    <WorkspacePageHeader
      electron={isElectron}
      className="h-auto items-start border-b border-border py-3"
    >
      <div className="mx-auto grid w-full min-w-0 max-w-6xl grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeftIcon data-icon="inline-start" />
          Board
        </Button>
        <WorkbenchTicketHeading
          presentation={{
            workspaceTitle: workspaceTitle,
            displayedTitle: displayedTitle,
            isArchived: isArchived,
            pending: pending,
            editing: editing,
            jiraRefreshDisabled: jiraRefreshDisabled,
            jiraRefreshing: jiraRefreshing,
          }}
          records={{
            ticket: ticket,
            jiraIssueLink: jiraIssueLink,
            actionableTicket: actionableTicket,
          }}
          context={{ environmentId: environmentId }}
          actions={{
            onUpdate: onUpdate,
            onJiraTransition: onJiraTransition,
            onRefreshJira: onRefreshJira,
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
            lifecycleActionsEnabled: lifecycleActionsEnabled,
          }}
          records={{ ticket: ticket, actionableTicket: actionableTicket, assignment: assignment }}
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

function WorkbenchTicketSummaryPanel({
  summaryPanelCollapsed,
  summaryHeaderLabel,
  hasUnsavedChanges,
  setSummaryPanelCollapsed,
  summary,
  ticket,
  displayedTitle,
  pending,
  isArchived,
  onRegenerateSummary,
}: {
  summaryPanelCollapsed: boolean;
  summaryHeaderLabel: string | null;
  hasUnsavedChanges: boolean;
  setSummaryPanelCollapsed: Dispatch<SetStateAction<boolean>>;
  summary: ReturnType<typeof getWorkbenchTicketSummaryPresentation>;
  ticket: WorkbenchTicket;
  displayedTitle: string;
  pending: boolean;
  isArchived: boolean;
  onRegenerateSummary: (ticket: WorkbenchTicket) => void;
}) {
  return (
    <section
      aria-labelledby="workbench-ticket-generated-summary"
      className="shrink-0 rounded-xl border border-border/60 bg-card/40"
    >
      <div className="px-4 py-3">
        <button
          aria-controls="workbench-ticket-generated-summary-content"
          aria-expanded={!summaryPanelCollapsed}
          aria-label={`${summaryPanelCollapsed ? "Expand" : "Collapse"} Generated summary${summaryHeaderLabel ? `. ${summaryHeaderLabel}` : ""}${hasUnsavedChanges ? ". Save changes to update summary." : ""}`}
          className="flex w-full min-w-0 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setSummaryPanelCollapsed((collapsed) => !collapsed)}
          type="button"
        >
          <ChevronDownIcon
            aria-hidden
            className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${summaryPanelCollapsed ? "" : "rotate-180"}`}
          />
          <span className="min-w-0">
            <span
              id="workbench-ticket-generated-summary"
              role="heading"
              aria-level={2}
              className="block text-sm font-semibold"
            >
              Generated summary
            </span>
            {summaryHeaderLabel ? (
              <span
                className={`block truncate text-xs ${summary.error ? "text-warning-foreground" : "text-muted-foreground"}`}
                role="status"
              >
                {summaryHeaderLabel}
              </span>
            ) : null}
            {hasUnsavedChanges ? (
              <span className="block truncate text-xs text-warning-foreground" role="status">
                Save changes to update summary.
              </span>
            ) : null}
          </span>
        </button>
      </div>
      {!summaryPanelCollapsed ? (
        <WorkbenchTicketSummaryContent
          hasUnsavedChanges={hasUnsavedChanges}
          summary={summary}
          ticket={ticket}
          displayedTitle={displayedTitle}
          pending={pending}
          isArchived={isArchived}
          onRegenerateSummary={onRegenerateSummary}
        />
      ) : null}
    </section>
  );
}

type WorkbenchTicketDescriptionPanelProps = {
  jiraFieldsManaged: boolean;
  editing: boolean;
  isArchived: boolean;
  pending: boolean;
  startEditing: () => void;
  projectedContent: ReturnType<typeof resolveWorkbenchTicketContent>;
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
    | "jiraFieldsManaged"
    | "editing"
    | "isArchived"
    | "pending"
    | "startEditing"
    | "projectedContent"
    | "draft"
    | "cancelEditing"
    | "dirty"
    | "displayedMarkdown"
  >;
  actions: Pick<WorkbenchTicketDescriptionPanelProps, "setDraft">;
  context: Pick<WorkbenchTicketDescriptionPanelProps, "environmentId">;
  records: Pick<WorkbenchTicketDescriptionPanelProps, "ticket">;
}) {
  const {
    jiraFieldsManaged,
    editing,
    isArchived,
    pending,
    startEditing,
    projectedContent,
    draft,
    cancelEditing,
    dirty,
    displayedMarkdown,
  } = presentation;
  const { setDraft } = actions;
  const { environmentId } = context;
  const { ticket } = records;
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 xl:min-h-0 xl:flex-1">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-xs text-muted-foreground">
            {jiraFieldsManaged
              ? "Synced with Jira; edits update the mirrored issue."
              : "Intent, constraints, and acceptance criteria for this work."}
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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-workbench-ticket-title">Title</Label>
              <Input
                id="edit-workbench-ticket-title"
                autoFocus={!jiraFieldsManaged}
                disabled={jiraFieldsManaged}
                value={jiraFieldsManaged ? projectedContent.title : draft.title}
                onChange={(event) => {
                  setDraft(environmentId, ticket.id, {
                    ...draft,
                    title: event.currentTarget.value,
                  });
                }}
              />
              {jiraFieldsManaged ? (
                <p className="text-xs text-muted-foreground">Summary is managed by Jira.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-workbench-ticket-context">Description</Label>
              <Textarea
                id="edit-workbench-ticket-context"
                className="min-h-72"
                placeholder="Goal, constraints, and acceptance criteria…"
                value={draft.markdown}
                onChange={(event) => {
                  setDraft(environmentId, ticket.id, {
                    ...draft,
                    markdown: event.currentTarget.value,
                  });
                }}
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
            <Button disabled={pending} onClick={cancelEditing} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                pending || !dirty || (!jiraFieldsManaged && draft.title.trim().length === 0)
              }
              type="submit"
            >
              Save Ticket
            </Button>
          </div>
        </>
      ) : (
        <div className="min-h-40 min-w-0 p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
          <WorkbenchDescription markdown={displayedMarkdown} jira={jiraFieldsManaged} />
        </div>
      )}
    </section>
  );
}

type WorkbenchTicketThreadsPanelProps = {
  threadPanelCollapsed: boolean;
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
  nativeStatus: ReturnType<typeof getWorkbenchAgentPresentation> | null;
  nativeThreadFailed: boolean;
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
  settledThreadsCollapsed: boolean;
  setSettledThreadsCollapsed: Dispatch<SetStateAction<boolean>>;
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
    | "settledThreadsCollapsed"
    | "setSettledThreadsCollapsed"
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
    | "nativeThreadFailed"
    | "agentTitle"
    | "isArchived"
    | "supportsSettlement"
  >;
  context: Pick<
    WorkbenchTicketThreadsPanelProps,
    | "threadProviderKind"
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
    settledThreadsCollapsed,
    setSettledThreadsCollapsed,
    onAttachThread,
  } = actions;
  const {
    canOpenThread,
    threadActionPending,
    thread,
    displayedTitle,
    pending,
    nativeStatus,
    nativeThreadFailed,
    agentTitle,
    isArchived,
    supportsSettlement,
  } = presentation;
  const {
    threadProviderKind,
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
  return (
    <section
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 ${threadPanelCollapsed ? "" : "xl:min-h-0 xl:flex-[1.25]"}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Agent Threads</h2>
        </div>
        <Button
          aria-controls="workbench-ticket-agent-threads"
          aria-expanded={!threadPanelCollapsed}
          aria-label={threadPanelCollapsed ? "Expand Agent Threads" : "Collapse Agent Threads"}
          onClick={() => setThreadPanelCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={threadPanelCollapsed ? "Expand Agent Threads" : "Collapse Agent Threads"}
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={threadPanelCollapsed ? "" : "rotate-180"} />
        </Button>
      </div>
      {!threadPanelCollapsed ? (
        <>
          <div
            id="workbench-ticket-agent-threads"
            className="min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain"
          >
            {canOpenThread ? (
              <WorkbenchTicketPrimaryThread
                context={{
                  threadProviderKind: threadProviderKind,
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
                  nativeThreadFailed: nativeThreadFailed,
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
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                This archived Ticket has no Thread.
              </p>
            )}
            {activeAssignments.length > 1 ? (
              <WorkbenchTicketOtherThreads
                context={{
                  threadProviderKind: threadProviderKind,
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
                }}
                records={{
                  assignment: assignment,
                  ticketWorkspace: ticketWorkspace,
                  activeAssignments: activeAssignments,
                  ticket: ticket,
                }}
                actions={{
                  onUnlinkThread: onUnlinkThread,
                  toggleThreadSettlement: toggleThreadSettlement,
                  settlementPendingThreadId: settlementPendingThreadId,
                  onDeleteThread: onDeleteThread,
                  onOpenAssignedThread: onOpenAssignedThread,
                  onReplaceThread: onReplaceThread,
                }}
              />
            ) : null}
            {settledAssignments.length > 0 ? (
              <WorkbenchTicketSettledThreads
                threadProviderKind={threadProviderKind}
                pending={pending}
                settledAssignments={settledAssignments}
                isArchived={isArchived}
                onUnlinkThread={onUnlinkThread}
                supportsSettlement={supportsSettlement}
                toggleThreadSettlement={toggleThreadSettlement}
                settlementPendingThreadId={settlementPendingThreadId}
                onDeleteThread={onDeleteThread}
                threadsById={threadsById}
                archivedThreadsById={archivedThreadsById}

                onOpenAssignedThread={onOpenAssignedThread}
                settledThreadsCollapsed={settledThreadsCollapsed}
                setSettledThreadsCollapsed={setSettledThreadsCollapsed}
              />
            ) : null}
            {historicalAssignments.length > 0 ? (
              <WorkbenchTicketHistoricalThreads
                threadProviderKind={threadProviderKind}

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
            pending={pending}
            isArchived={isArchived}
            ticket={ticket}
          />
        </>
      ) : null}
    </section>
  );
}

type WorkbenchTicketWorkspacePanelProps = {
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
  pending: boolean;
  preparationPending: boolean;
  isArchived: boolean;
  repositoryScopeLocked: boolean;
  onPrepareWorkspace: (ticket: WorkbenchTicket) => Promise<boolean>;
  ticket: WorkbenchTicket;
  workspacePreparationActionLabel:
    | "Preparing workspace…"
    | "Retry preparation"
    | "Prepare workspace";
  setRepositoryScopePanelCollapsed: Dispatch<SetStateAction<boolean>>;
  repositories: ReadonlyArray<WorkbenchTicketRepositoryEntry>;
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  ticketWorkspace: WorkbenchTicketWorkspace | undefined;
  retainedRepositories: ReadonlyArray<WorkbenchTicketRepositoryEntry>;
  workspaceHasSelectedRepositories: boolean;
  advancedWorkspaceSettingsCollapsed: boolean;
  setAdvancedWorkspaceSettingsCollapsed: Dispatch<SetStateAction<boolean>>;
  activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  setResetConfirmationOpen: Dispatch<SetStateAction<boolean>>;
  repositoryScopeEditorCollapsed: boolean;
  setRepositoryScopeEditorCollapsed: Dispatch<SetStateAction<boolean>>;
  linkedProjects: ReadonlyArray<Project>;
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
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
  actionableTicket: WorkbenchTicket;
};
function WorkbenchTicketWorkspacePanel({
  expansion,
  presentation,
  actions,
  records,
  context,
}: {
  expansion: Pick<
    WorkbenchTicketWorkspacePanelProps,
    | "repositoryScopePanelCollapsed"
    | "advancedWorkspaceSettingsCollapsed"
    | "repositoryScopeEditorCollapsed"
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
    | "onPrepareWorkspace"
    | "setRepositoryScopePanelCollapsed"
    | "setAdvancedWorkspaceSettingsCollapsed"
    | "setResetConfirmationOpen"
    | "setRepositoryScopeEditorCollapsed"
    | "onUpdate"
  >;
  records: Pick<
    WorkbenchTicketWorkspacePanelProps,
    | "ticket"
    | "repositories"
    | "ticketWorkspace"
    | "retainedRepositories"
    | "activeAssignments"
    | "selectedRepositoryProjectIds"
    | "actionableTicket"
  >;
  context: Pick<
    WorkbenchTicketWorkspacePanelProps,
    "environmentId" | "keybindings" | "availableEditors" | "linkedProjects"
  >;
}) {
  const {
    repositoryScopePanelCollapsed,
    advancedWorkspaceSettingsCollapsed,
    repositoryScopeEditorCollapsed,
  } = expansion;
  const {
    workspaceStatusLabel,
    workspaceIsReady,
    workspaceIsPreparing,
    pending,
    preparationPending,
    isArchived,
    repositoryScopeLocked,
    workspacePreparationActionLabel,
    workspaceHasSelectedRepositories,
  } = presentation;
  const {
    onPrepareWorkspace,
    setRepositoryScopePanelCollapsed,
    setAdvancedWorkspaceSettingsCollapsed,
    setResetConfirmationOpen,
    setRepositoryScopeEditorCollapsed,
    onUpdate,
  } = actions;
  const {
    ticket,
    repositories,
    ticketWorkspace,
    retainedRepositories,
    activeAssignments,
    selectedRepositoryProjectIds,
    actionableTicket,
  } = records;
  const { environmentId, keybindings, availableEditors, linkedProjects } = context;
  return (
    <section
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 ${repositoryScopePanelCollapsed ? "" : "xl:min-h-0 xl:flex-1"}`}
    >
      <WorkbenchTicketWorkspaceHeader
        workspaceStatusLabel={workspaceStatusLabel}
        workspaceIsReady={workspaceIsReady}
        workspaceIsPreparing={workspaceIsPreparing}
        pending={pending}
        preparationPending={preparationPending}
        isArchived={isArchived}
        repositoryScopeLocked={repositoryScopeLocked}
        onPrepareWorkspace={onPrepareWorkspace}
        ticket={ticket}
        workspacePreparationActionLabel={workspacePreparationActionLabel}
        repositoryScopePanelCollapsed={repositoryScopePanelCollapsed}
        setRepositoryScopePanelCollapsed={setRepositoryScopePanelCollapsed}
      />
      {!repositoryScopePanelCollapsed ? (
        <div
          id="workbench-ticket-repositories"
          className="min-h-0 space-y-3 px-3 pb-3 pt-1 xl:overflow-y-auto xl:overscroll-contain"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
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
              <p className="mt-2 text-xs text-muted-foreground">
                {getWorkbenchWorkspaceDescription({
                  workspaceIsPreparing,
                  ticketWorkspace,
                  workspaceHasSelectedRepositories,
                })}
              </p>
              {ticketWorkspace?.errorMessage ? (
                <p className="mt-2 break-words text-xs text-destructive" role="alert">
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
          </div>
          <WorkbenchTicketRepositoryScope
            repositoryScopeEditorCollapsed={repositoryScopeEditorCollapsed}
            setRepositoryScopeEditorCollapsed={setRepositoryScopeEditorCollapsed}
            repositoryScopeLocked={repositoryScopeLocked}
            linkedProjects={linkedProjects}
            selectedRepositoryProjectIds={selectedRepositoryProjectIds}
            pending={pending}
            isArchived={isArchived}
            ticket={ticket}
            onUpdate={onUpdate}
            actionableTicket={actionableTicket}
          />
        </div>
      ) : null}
    </section>
  );
}

function WorkbenchTicketWorkspaceHeader({
  workspaceStatusLabel,
  workspaceIsReady,
  workspaceIsPreparing,
  pending,
  preparationPending,
  isArchived,
  repositoryScopeLocked,
  onPrepareWorkspace,
  ticket,
  workspacePreparationActionLabel,
  repositoryScopePanelCollapsed,
  setRepositoryScopePanelCollapsed,
}: Pick<
  WorkbenchTicketWorkspacePanelProps,
  | "workspaceStatusLabel"
  | "workspaceIsReady"
  | "workspaceIsPreparing"
  | "pending"
  | "preparationPending"
  | "isArchived"
  | "repositoryScopeLocked"
  | "onPrepareWorkspace"
  | "ticket"
  | "workspacePreparationActionLabel"
  | "repositoryScopePanelCollapsed"
  | "setRepositoryScopePanelCollapsed"
>) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Ticket workspace</h2>
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
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!workspaceIsReady ? (
          <Button
            aria-busy={workspaceIsPreparing || pending}
            disabled={pending || preparationPending || isArchived || repositoryScopeLocked}
            onClick={() => {
              void onPrepareWorkspace(ticket);
            }}
            size="xs"
            type="button"
            variant="outline"
          >
            <FolderGit2Icon />
            {workspacePreparationActionLabel}
          </Button>
        ) : null}
        <Button
          aria-controls="workbench-ticket-repositories"
          aria-expanded={!repositoryScopePanelCollapsed}
          aria-label={
            repositoryScopePanelCollapsed ? "Expand Ticket workspace" : "Collapse Ticket workspace"
          }
          onClick={() => setRepositoryScopePanelCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={repositoryScopePanelCollapsed ? "" : "rotate-180"} />
        </Button>
      </div>
    </div>
  );
}

function WorkbenchTicketRepositoryScope({
  repositoryScopeEditorCollapsed,
  setRepositoryScopeEditorCollapsed,
  repositoryScopeLocked,
  linkedProjects,
  selectedRepositoryProjectIds,
  pending,
  isArchived,
  ticket,
  onUpdate,
  actionableTicket,
}: Pick<
  WorkbenchTicketWorkspacePanelProps,
  | "repositoryScopeEditorCollapsed"
  | "setRepositoryScopeEditorCollapsed"
  | "repositoryScopeLocked"
  | "linkedProjects"
  | "selectedRepositoryProjectIds"
  | "pending"
  | "isArchived"
  | "ticket"
  | "onUpdate"
  | "actionableTicket"
>) {
  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <h3
          id="workbench-ticket-repository-scope-heading"
          className="text-xs font-medium text-muted-foreground"
        >
          Edit repository scope
        </h3>
        <Button
          aria-controls="workbench-ticket-repository-scope-editor"
          aria-expanded={!repositoryScopeEditorCollapsed}
          aria-label={
            repositoryScopeEditorCollapsed
              ? "Expand Edit repository scope"
              : "Collapse Edit repository scope"
          }
          onClick={() => setRepositoryScopeEditorCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={
            repositoryScopeEditorCollapsed
              ? "Expand Edit repository scope"
              : "Collapse Edit repository scope"
          }
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={repositoryScopeEditorCollapsed ? "" : "rotate-180"} />
        </Button>
      </div>
      {!repositoryScopeEditorCollapsed ? (
        <fieldset
          id="workbench-ticket-repository-scope-editor"
          className="mt-3 space-y-2"
          aria-labelledby="workbench-ticket-repository-scope-heading"
        >
          <legend className="sr-only">Edit repository scope</legend>
          {repositoryScopeLocked ? (
            <p className="text-xs text-muted-foreground">
              Wait for workspace preparation or release to finish before changing repositories.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Choose repository context for new Threads. Existing Threads stay unchanged.
            </p>
          )}
          {linkedProjects.map((repository) => {
            const checked = selectedRepositoryProjectIds.includes(repository.id);
            return (
              <label key={repository.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={
                    pending ||
                    isArchived ||
                    repositoryScopeLocked ||
                    (checked && selectedRepositoryProjectIds.length === 1)
                  }
                  onCheckedChange={(nextChecked) => {
                    const nextRepositoryProjectIds = nextChecked
                      ? [...selectedRepositoryProjectIds, repository.id]
                      : selectedRepositoryProjectIds.filter((id) => id !== repository.id);
                    const primaryT3ProjectId = nextRepositoryProjectIds.includes(
                      ticket.primaryT3ProjectId,
                    )
                      ? ticket.primaryT3ProjectId
                      : nextRepositoryProjectIds[0];
                    if (primaryT3ProjectId === undefined) return;
                    onUpdate(actionableTicket, {
                      repositoryProjectIds: nextRepositoryProjectIds,
                      primaryT3ProjectId,
                    });
                  }}
                />
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                  {repository.title}
                </span>
              </label>
            );
          })}
          <Label htmlFor={`primary-repository-${ticket.id}`}>Primary repository</Label>
          <p
            id={`primary-repository-description-${ticket.id}`}
            className="text-xs text-muted-foreground"
          >
            Where new Threads start.
          </p>
          <Select
            disabled={pending || isArchived || repositoryScopeLocked}
            value={ticket.primaryT3ProjectId}
            onValueChange={(value) => {
              if (value) {
                onUpdate(actionableTicket, {
                  primaryT3ProjectId: ProjectId.make(value),
                });
              }
            }}
          >
            <SelectTrigger
              id={`primary-repository-${ticket.id}`}
              aria-label="Primary repository"
              aria-describedby={`primary-repository-description-${ticket.id}`}
            >
              <SelectValue>
                {linkedProjects.find((repository) => repository.id === ticket.primaryT3ProjectId)
                  ?.title ?? "Select primary repository"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {linkedProjects
                .filter((repository) => selectedRepositoryProjectIds.includes(repository.id))
                .map((repository) => (
                  <SelectItem key={repository.id} value={repository.id}>
                    {repository.title}
                  </SelectItem>
                ))}
            </SelectPopup>
          </Select>
        </fieldset>
      ) : null}
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
            Advanced workspace settings
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
              ? "Expand Advanced workspace settings"
              : "Collapse Advanced workspace settings"
          }
          onClick={() => setAdvancedWorkspaceSettingsCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={
            advancedWorkspaceSettingsCollapsed
              ? "Expand Advanced workspace settings"
              : "Collapse Advanced workspace settings"
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
              No prepared worktrees to remove. Prepare the workspace when you are ready to work on
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
    <div className="space-y-1">
      {repositories.map((entry) => (
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
        <div className="mt-3 border-t border-border/60 pt-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Retained worktrees</p>
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
    return "Prepare a workspace to work in your editor, or create a Thread to prepare it automatically.";
  if (ticketWorkspace.status === "ready" && !workspaceHasSelectedRepositories)
    return "Repository selection changed. Prepare the workspace to add the missing repositories; existing worktrees stay available.";
  if (ticketWorkspace.status === "released")
    return "No active worktrees. Prepare a workspace for your editor, or create a Thread to prepare it automatically.";
  if (ticketWorkspace.status === "failed")
    return "Preparation failed. Retry preparation after resolving the reported repository error.";
  if (ticketWorkspace.status === "releasing") return "Removing prepared worktrees.";
  return "Threads in the same worktree share files and branch changes. Use a separate native worktree for independent work.";
}

function WorkbenchTicketJiraDetails({
  epics,
  linkedEpicId,
  onOpenEpic,
  ticket,
}: Pick<WorkbenchTicketDetailsPanelProps, "epics" | "linkedEpicId" | "onOpenEpic" | "ticket">) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 p-3 text-sm">
      <dt className="text-muted-foreground">Type</dt>
      <dd className="min-w-0 break-words text-right font-medium [overflow-wrap:anywhere]">
        {WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}
      </dd>
      <dt className="text-muted-foreground">Epic</dt>
      <dd className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-right">
        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
          {epics.find((epic) => epic.id === ticket.epicId)?.title ?? "No Epic"}
        </span>
        {linkedEpicId ? (
          <Button onClick={() => onOpenEpic(linkedEpicId)} size="xs" type="button" variant="ghost">
            View Epic <ArrowRightIcon />
          </Button>
        ) : null}
      </dd>
    </dl>
  );
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
    <div className="space-y-3 p-3">
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
  | "nativeThreadFailed"
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
    "threadProviderKind" | "environmentId" | "linkedProjects"
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
    | "nativeThreadFailed"
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
  const { threadProviderKind, environmentId, linkedProjects } = context;
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
    nativeThreadFailed,
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
    <div className="border-b border-border/60 px-3 py-1.5">
      <div className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-2.5 py-1.5 hover:bg-muted/45 focus-within:bg-muted/45">
        <WorkbenchThreadOpenButton
          providerKind={threadProviderKind(displayedThread)}
          ariaLabel={`${
            threadActionPending ? thread.pendingActionLabel : thread.actionLabel
          } for ${displayedTitle}`}
          disabled={pending}
          modelLabel={getWorkbenchThreadModelLabel(displayedThread)}
          recencyLabel={displayedThread ? getWorkbenchThreadRecencyLabel(displayedThread) : null}
          onClick={() => {
            if (!assignment && settledAssignments.length > 0) {
              onNewThread(actionableTicket);
              return;
            }
            onOpenThread(actionableTicket, assignment?.threadId);
          }}
          stateLabel={assignment ? thread.stateLabel : "Create a Thread"}
          statusDotClassName={
            nativeThread
              ? (nativeStatus?.dotClass ??
                (nativeThreadFailed ? "bg-destructive" : "bg-muted-foreground/60"))
              : undefined
          }
          title={agentTitle}
          actions={
            assignment && displayedThread ? (
              <>
                <Button
                  aria-label={`Unlink Thread ${displayedThread.title}`}
                  disabled={pending || isArchived}
                  onClick={() => onUnlinkThread(assignment.threadId)}
                  size="icon-xs"
                  title="Unlink Thread from Ticket"
                  type="button"
                  variant="ghost"
                >
                  <UnlinkIcon />
                </Button>
                {supportsSettlement ? (
                  <WorkbenchThreadSettlementButton
                    disabled={pending || isArchived || archivedThread !== undefined}
                    onClick={() => void toggleThreadSettlement(displayedThread)}
                    pending={settlementPendingThreadId === displayedThread.id}
                    settled={displayedThread.settledOverride === "settled"}
                    title={displayedThread.title}
                  />
                ) : null}
                <Button
                  aria-label={`Delete Thread ${displayedThread.title}`}
                  disabled={pending || isArchived}
                  onClick={() => onDeleteThread(assignment.threadId)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
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
    </div>
  );
}

type WorkbenchTicketOtherThreadsProps = Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadProviderKind"
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
function WorkbenchTicketOtherThreads({
  context,
  presentation,
  records,
  actions,
}: {
  context: Pick<
    WorkbenchTicketOtherThreadsProps,
    | "threadProviderKind"
    | "environmentId"
    | "linkedProjects"
    | "threadsById"
    | "archivedThreadsById"
    | "threadLookupReady"
  >;
  presentation: Pick<
    WorkbenchTicketOtherThreadsProps,
    "pending" | "isArchived" | "supportsSettlement"
  >;
  records: Pick<
    WorkbenchTicketOtherThreadsProps,
    "assignment" | "ticketWorkspace" | "activeAssignments" | "ticket"
  >;
  actions: Pick<
    WorkbenchTicketOtherThreadsProps,
    | "onUnlinkThread"
    | "toggleThreadSettlement"
    | "settlementPendingThreadId"
    | "onDeleteThread"
    | "onOpenAssignedThread"
    | "onReplaceThread"
  >;
}) {
  const {
    threadProviderKind,
    environmentId,
    linkedProjects,
    threadsById,
    archivedThreadsById,
    threadLookupReady,
  } = context;
  const { pending, isArchived, supportsSettlement } = presentation;
  const { assignment, ticketWorkspace, activeAssignments, ticket } = records;
  const {
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
    onReplaceThread,
  } = actions;
  return (
    <div className="border-t border-border px-3 py-2.5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Other active Threads</p>
      <div className="space-y-1">
        {activeAssignments
          .filter((activeAssignment) => activeAssignment.id !== assignment?.id)
          .map((activeAssignment) => (
            <WorkbenchTicketActiveThreadRow
              key={activeAssignment.id}
              context={{
                threadProviderKind: threadProviderKind,
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
          ))}
      </div>
    </div>
  );
}

function WorkbenchTicketSettledThreads({
  threadProviderKind,
  pending,
  settledAssignments,
  isArchived,
  onUnlinkThread,
  supportsSettlement,
  toggleThreadSettlement,
  settlementPendingThreadId,
  onDeleteThread,
  threadsById,
  archivedThreadsById,
  onOpenAssignedThread,
  settledThreadsCollapsed,
  setSettledThreadsCollapsed,
}: Pick<
  WorkbenchTicketThreadsPanelProps,
  | "threadProviderKind"
  | "pending"
  | "settledAssignments"
  | "isArchived"
  | "onUnlinkThread"
  | "supportsSettlement"
  | "toggleThreadSettlement"
  | "settlementPendingThreadId"
  | "onDeleteThread"
  | "threadsById"
  | "archivedThreadsById"
  | "onOpenAssignedThread"
  | "settledThreadsCollapsed"
  | "setSettledThreadsCollapsed"
>) {
  return (
    <section className="border-t border-border/60">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-xs font-semibold">Settled Threads</h3>
          <Badge size="sm" variant="secondary">
            {settledAssignments.length}
          </Badge>
        </div>
        <Button
          aria-controls="workbench-ticket-settled-threads"
          aria-expanded={!settledThreadsCollapsed}
          aria-label={
            settledThreadsCollapsed ? "Expand Settled Threads" : "Collapse Settled Threads"
          }
          onClick={() => setSettledThreadsCollapsed((collapsed) => !collapsed)}
          size="icon-xs"
          title={settledThreadsCollapsed ? "Expand Settled Threads" : "Collapse Settled Threads"}
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className={settledThreadsCollapsed ? "" : "rotate-180"} />
        </Button>
      </div>
      {!settledThreadsCollapsed ? (
        <div id="workbench-ticket-settled-threads" className="space-y-1 px-3 pb-2.5">
          {settledAssignments.map((settledAssignment) => (
            <WorkbenchTicketSettledThreadRow
              key={settledAssignment.id}
              threadProviderKind={threadProviderKind}
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
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkbenchTicketHistoricalThreads({
  threadProviderKind,
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
    <div className="border-t border-border px-3 py-2.5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Thread history</p>
      <div className="space-y-1">
        {historicalAssignments.map((historicalAssignment) => (
          <WorkbenchTicketHistoricalThreadRow
            key={historicalAssignment.id}
            context={{
              threadProviderKind: threadProviderKind,
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
    activeStatusPill,
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
    activeStatusPill,
    activeAgentState,
    activeThreadState,
    activeThreadModel,
    activeThreadRecency,
    threadLookupReady,
  });
  return (
    <div
      key={activeAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(displayedActiveThread)}
        ariaLabel={rowPresentation.ariaLabel}
        disabled={pending || displayedActiveThread === undefined}
        modelLabel={rowPresentation.modelLabel}
        recencyLabel={rowPresentation.recencyLabel}
        onClick={() => onOpenAssignedThread(activeAssignment.threadId)}
        stateLabel={rowPresentation.stateLabel}
        statusDotClassName={rowPresentation.statusDotClassName}
        title={rowPresentation.title}
        actions={
          displayedActiveThread ? (
            <WorkbenchActiveThreadActions
              pending={pending}
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
              aria-label={`Create Thread for ${ticket.title}`}
              disabled={pending || isArchived}
              onClick={() => onReplaceThread(ticket, activeAssignment.threadId)}
              size="xs"
              type="button"
              variant="ghost"
            >
              Create Thread
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
    "threadProviderKind" | "threadsById" | "archivedThreadsById" | "threadLookupReady"
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
  const { threadProviderKind, threadsById, archivedThreadsById, threadLookupReady } = context;
  const { pending, isArchived, supportsSettlement, historicalAssignment } = presentation;
  const {
    onUnlinkThread,
    toggleThreadSettlement,
    settlementPendingThreadId,
    onDeleteThread,
    onOpenAssignedThread,
  } = actions;
  const { ticket } = records;
  const {
    historicalArchivedThread,
    displayedHistoricalThread,
    historicalStatusPill,
    historicalAgentState,
  } = getWorkbenchHistoricalThreadRow({
    historicalAssignment,
    threadsById,
    archivedThreadsById,
    ticket,
  });
  const rowPresentation = getWorkbenchHistoricalThreadRowPresentation({
    displayedHistoricalThread,
    historicalStatusPill,
    historicalAgentState,
    threadLookupReady,
  });
  return (
    <div
      key={historicalAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(displayedHistoricalThread)}
        ariaLabel={rowPresentation.ariaLabel}
        disabled={pending || !displayedHistoricalThread}
        modelLabel={rowPresentation.modelLabel}
        recencyLabel={rowPresentation.recencyLabel}
        onClick={() => onOpenAssignedThread(historicalAssignment.threadId)}
        stateLabel={rowPresentation.stateLabel}
        statusDotClassName={rowPresentation.statusDotClassName}
        title={rowPresentation.title}
        actions={
          displayedHistoricalThread ? (
            <WorkbenchHistoricalThreadActions
              pending={pending}
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
  Parameters<typeof WorkbenchTicketSettledThreads>[0],
  | "threadProviderKind"
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
  const settledThread =
    threadsById.get(settledAssignment.threadId) ??
    archivedThreadsById.get(settledAssignment.threadId);
  if (!settledThread) return null;
  return (
    <div
      key={settledAssignment.id}
      className="relative isolate flex min-w-0 flex-wrap items-start gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45"
    >
      <WorkbenchThreadOpenButton
        providerKind={threadProviderKind(settledThread)}
        ariaLabel={`Open Thread ${settledThread.title}`}
        disabled={pending}
        modelLabel={
          settledThread.modelSelection
            ? `${settledThread.modelSelection.instanceId} · ${settledThread.modelSelection.model}`
            : null
        }
        recencyLabel={getWorkbenchThreadRecencyLabel(settledThread)}
        onClick={() => onOpenAssignedThread(settledAssignment.threadId)}
        stateLabel="Settled"
        statusDotClassName="bg-muted-foreground/60"
        title={settledThread.title}
        actions={
          <>
            <Button
              aria-label={`Unlink Thread ${settledThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onUnlinkThread(settledAssignment.threadId)}
              size="icon-xs"
              title="Unlink Thread from Ticket"
              type="button"
              variant="ghost"
            >
              <UnlinkIcon />
            </Button>
            {supportsSettlement ? (
              <WorkbenchThreadSettlementButton
                disabled={pending || isArchived || settledThread.archivedAt !== null}
                onClick={() => void toggleThreadSettlement(settledThread)}
                pending={settlementPendingThreadId === settledThread.id}
                settled
                title={settledThread.title}
              />
            ) : null}
            <Button
              aria-label={`Delete Thread ${settledThread.title}`}
              disabled={pending || isArchived}
              onClick={() => onDeleteThread(settledAssignment.threadId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Trash2Icon />
            </Button>
          </>
        }
      />
    </div>
  );
}

function WorkbenchEpicHeader({
  workspaceTitle,
  epic,
  jiraManaged,
  jiraUrl,
  pending,
  onBack,
  onCreateTicket,
  progress,
  blockedCount,
}: Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  | "workspaceTitle"
  | "epic"
  | "jiraManaged"
  | "jiraUrl"
  | "tickets"
  | "pending"
  | "onBack"
  | "onCreateTicket"
> & { progress: ReturnType<typeof getWorkbenchEpicProgress>; blockedCount: number }) {
  return (
    <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-wrap items-start gap-3">
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
            {jiraUrl ? (
              <a
                href={jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <WorkbenchJiraIcon className="size-3.5" /> Open in Jira
                <ExternalLinkIcon aria-hidden className="size-3" />
              </a>
            ) : null}
            <Badge variant="outline">
              {progress.completed} of {progress.total} done
            </Badge>
            {blockedCount > 0 ? (
              <Badge variant="warning">
                <CircleAlertIcon /> {blockedCount} flagged in Jira
              </Badge>
            ) : null}
            {epic.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
          </div>
          {jiraManaged ? (
            <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
              Jira imports only tickets assigned to you in the selected sprints. Counts and progress
              reflect the tickets shown here, not the whole Jira epic.
            </p>
          ) : null}
        </div>
        <Button disabled={pending || epic.archivedAt !== null} onClick={onCreateTicket} size="sm">
          <PlusIcon /> New Ticket
        </Button>
      </div>
    </header>
  );
}

type WorkbenchEpicDescriptionProps = Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  "epic" | "jiraManaged" | "pending" | "onSave"
> & {
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
    | "epic"
    | "jiraManaged"
    | "pending"
    | "editing"
    | "startEditing"
    | "cancelEditing"
    | "title"
    | "markdown"
  >;
  actions: Pick<
    WorkbenchEpicDescriptionProps,
    "onSave" | "setTitle" | "setMarkdown" | "setEditing"
  >;
}) {
  const { epic, jiraManaged, pending, editing, startEditing, cancelEditing, title, markdown } =
    presentation;
  const { onSave, setTitle, setMarkdown, setEditing } = actions;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-xs text-muted-foreground">
            {jiraManaged
              ? "Synced from Jira. Edit the description in Jira, then refresh the board."
              : "Outcome and scope shared by the child Tickets."}
          </p>
        </div>
        {jiraManaged ? (
          <Badge size="default" variant="outline">
            Managed by Jira
          </Badge>
        ) : !editing ? (
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
      {editing && !jiraManaged ? (
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
          <WorkbenchDescription markdown={epic.markdown} jira={jiraManaged} />
        </div>
      )}
    </section>
  );
}

function WorkbenchEpicTickets({
  epic,
  jiraManaged,
  tickets,
  repositoriesById,
  assignmentsByTicket,
  jiraIssueLinksByTicketId,
  pending,
  onOpenTicket,
  onCreateTicket,
  progress,
}: Pick<
  Parameters<typeof WorkbenchEpicDetail>[0],
  | "epic"
  | "jiraManaged"
  | "tickets"
  | "repositoriesById"
  | "assignmentsByTicket"
  | "jiraIssueLinksByTicketId"
  | "pending"
  | "onOpenTicket"
  | "onCreateTicket"
> & { progress: ReturnType<typeof getWorkbenchEpicProgress> }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Child Tickets</h2>
          <p className="text-xs text-muted-foreground">
            {jiraManaged
              ? "Your imported work for this epic, plus any tickets added in Workbench."
              : "Stories and bugs that deliver this Epic."}
          </p>
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
            aria-label={`${progress.percent}% of ${jiraManaged ? "shown" : "Epic"} Tickets complete`}
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
            const jiraIssueLink = jiraIssueLinksByTicketId.get(ticket.id);
            return (
              <div
                key={ticket.id}
                className="relative isolate grid min-w-0 w-full cursor-pointer gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <WorkbenchTicketKindBadge kind={ticket.kind} />
                    {jiraIssueLink ? (
                      <WorkbenchJiraIssueKey issue={jiraIssueLink.issue} className="z-10" />
                    ) : null}
                  </span>
                  <span className="mt-1 block min-w-0">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => onOpenTicket(ticket)}
                            className="min-w-0 cursor-pointer truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
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
                  {jiraIssueLink?.issue.flagged ? (
                    <Badge size="default" variant="warning">
                      Jira flagged
                    </Badge>
                  ) : null}
                  <Badge size="default" variant="outline">
                    {jiraIssueLink?.issue.status.name ??
                      WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
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

function WorkbenchCreateTicketSprint({
  pending,
  jiraSprints,
  selectedSprintId,
  setJiraSprintId,
}: Pick<Parameters<typeof WorkbenchTicketDialog>[0], "pending"> & {
  jiraSprints: ReadonlyArray<{ id: number; name: string }>;
  selectedSprintId: number | undefined;
  setJiraSprintId: Dispatch<SetStateAction<number | null>>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Jira sprint</Label>
      <Select
        disabled={pending || jiraSprints.length === 1}
        value={selectedSprintId === undefined ? null : String(selectedSprintId)}
        onValueChange={(value) => setJiraSprintId(value ? Number(value) : null)}
      >
        <SelectTrigger aria-label="Jira sprint">
          <SelectValue>
            {jiraSprints.find((sprint) => sprint.id === selectedSprintId)?.name ??
              "Select a sprint"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {jiraSprints.map((sprint) => (
            <SelectItem key={sprint.id} value={String(sprint.id)}>
              {sprint.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function WorkbenchCreateTicketKind({
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

function WorkbenchCreateTicketEpic({
  jiraBinding,
  onCreateEpic,
  epics,
  pending,
  epicId,
  setEpicId,
}: Pick<
  Parameters<typeof WorkbenchTicketDialog>[0],
  "onCreateEpic" | "epics" | "pending" | "jiraBinding"
> & {
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
          {jiraBinding === null ? (
            <>
              <SelectPrimitive.Separator className="mx-2 my-1 h-px bg-border" />
              <SelectItem value={CREATE_EPIC_VALUE}>Create Epic…</SelectItem>
            </>
          ) : null}
        </SelectPopup>
      </Select>
    </div>
  );
}

function WorkbenchCreateTicketRepositories({
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
    <fieldset className="space-y-2">
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
                  className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
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
    <div
      id="workbench-ticket-generated-summary-content"
      className="max-h-48 overflow-y-auto border-t border-border/50 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
  | "workspaceTitle"
  | "displayedTitle"
  | "ticket"
  | "jiraIssueLink"
  | "isArchived"
  | "environmentId"
  | "actionableTicket"
  | "pending"
  | "editing"
  | "onUpdate"
  | "onJiraTransition"
  | "onRefreshJira"
  | "jiraRefreshDisabled"
  | "jiraRefreshing"
>;
function WorkbenchTicketHeading({
  presentation,
  records,
  context,
  actions,
}: {
  presentation: Pick<
    WorkbenchTicketHeadingProps,
    | "workspaceTitle"
    | "displayedTitle"
    | "isArchived"
    | "pending"
    | "editing"
    | "jiraRefreshDisabled"
    | "jiraRefreshing"
  >;
  records: Pick<WorkbenchTicketHeadingProps, "ticket" | "jiraIssueLink" | "actionableTicket">;
  context: Pick<WorkbenchTicketHeadingProps, "environmentId">;
  actions: Pick<WorkbenchTicketHeadingProps, "onUpdate" | "onJiraTransition" | "onRefreshJira">;
}) {
  const {
    workspaceTitle,
    displayedTitle,
    isArchived,
    pending,
    editing,
    jiraRefreshDisabled,
    jiraRefreshing,
  } = presentation;
  const { ticket, jiraIssueLink, actionableTicket } = records;
  const { environmentId } = context;
  const { onUpdate, onJiraTransition, onRefreshJira } = actions;
  return (
    <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
      <p className="text-xs font-medium text-muted-foreground">{workspaceTitle} · Ticket</p>
      <h1 className="mt-1 break-words text-balance text-xl font-semibold leading-tight sm:text-2xl">
        {displayedTitle.trim() || ticket.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <WorkbenchTicketKindBadge kind={ticket.kind} />
        {jiraIssueLink ? <WorkbenchJiraIssueKey issue={jiraIssueLink.issue} /> : null}
        {isArchived ? <Badge variant="outline">Archived</Badge> : null}
        <WorkbenchTicketStatusMenu
          key={`${environmentId}:${ticket.id}:${jiraIssueLink?.issue.remoteUpdatedAt ?? "local"}`}
          environmentId={environmentId}
          ticket={actionableTicket}
          jiraIssueLink={jiraIssueLink}
          disabled={pending || isArchived || editing}
          onStatusChange={(status) => onUpdate(actionableTicket, { status })}
          onJiraTransition={onJiraTransition}
          trigger={
            <Button size="xs" variant="outline" className="max-w-48">
              <span className="truncate">
                {jiraIssueLink?.issue.status.name ?? WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
              </span>
              <ChevronDownIcon />
            </Button>
          }
        />
        {jiraIssueLink?.issue.flagged ? (
          <Badge variant="warning">
            <CircleAlertIcon /> Jira flagged
          </Badge>
        ) : null}
        {jiraIssueLink && onRefreshJira ? (
          <Button
            disabled={jiraRefreshDisabled}
            onClick={onRefreshJira}
            size="xs"
            title="Refresh this Workspace's mirrored tickets from Jira"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon />
            {jiraRefreshing ? "Refreshing Jira…" : "Refresh from Jira"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type WorkbenchTicketHeaderActionsProps = Pick<
  WorkbenchTicketHeaderProps,
  | "displayedTitle"
  | "ticket"
  | "isArchived"
  | "actionableTicket"
  | "pending"
  | "canOpenThread"
  | "threadActionPending"
  | "threadActionLabel"
  | "thread"
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
    | "lifecycleActionsEnabled"
  >;
  records: Pick<WorkbenchTicketHeaderActionsProps, "ticket" | "actionableTicket" | "assignment">;
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
    lifecycleActionsEnabled,
  } = presentation;
  const { ticket, actionableTicket, assignment } = records;
  const {
    onReplaceThread,
    settledAssignments,
    onNewThread,
    onOpenThread,
    onArchive,
    setDeleteConfirmationOpen,
  } = actions;
  return (
    <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap justify-end gap-2 sm:col-start-3">
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
            } for ${displayedTitle}`}
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
      {lifecycleActionsEnabled ? (
        <WorkbenchTicketLifecycleMenu
          isArchived={isArchived}
          pending={pending}
          ticket={ticket}
          onArchive={onArchive}
          setDeleteConfirmationOpen={setDeleteConfirmationOpen}
        />
      ) : null}
    </div>
  );
}

function getWorkbenchActiveThreadRow({
  activeAssignment,
  threadsById,
  archivedThreadsById,
  ticket,
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
  const activeStatusPill = displayedActiveThread
    ? resolveThreadStatusPill({
        thread: displayedActiveThread,
      })
    : null;
  const activeAgentState = liveThread
    ? getWorkbenchAgentPresentation({
        nativeLabel: resolveThreadStatusPill({
          thread: liveThread,
        })?.label,
        sessionStatus: liveThread.session?.status,
        turnState: liveThread.latestTurn?.state,
        settledOverride: liveThread.settledOverride,
        ticketStatus: ticket.status,
      })
    : null;
  const activeThreadState = displayedActiveThread
    ? "Open"
    : threadLookupReady
      ? "No Thread"
      : "Checking…";
  const activeThreadModel = getWorkbenchThreadModelLabel(displayedActiveThread);
  const activeThreadRecency = displayedActiveThread
    ? getWorkbenchThreadRecencyLabel(displayedActiveThread)
    : null;
  return {
    archivedActiveThread,
    displayedActiveThread,
    activeStatusPill,
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
  ticket,
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
  const historicalStatusPill = displayedHistoricalThread
    ? resolveThreadStatusPill({
        thread: displayedHistoricalThread,
      })
    : null;
  const historicalAgentState = displayedHistoricalThread
    ? getWorkbenchAgentPresentation({
        nativeLabel: resolveThreadStatusPill({
          thread: displayedHistoricalThread,
        })?.label,
        sessionStatus: displayedHistoricalThread.session?.status,
        turnState: displayedHistoricalThread.latestTurn?.state,
        settledOverride: displayedHistoricalThread.settledOverride,
        ticketStatus: ticket.status,
      })
    : null;
  return {
    historicalArchivedThread,
    displayedHistoricalThread,
    historicalStatusPill,
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
      <Button
        aria-label={`Unlink Thread ${displayedActiveThread.title}`}
        disabled={pending || isArchived}
        onClick={() => onUnlinkThread(activeAssignment.threadId)}
        size="icon-xs"
        title="Unlink Thread from Ticket"
        type="button"
        variant="ghost"
      >
        <UnlinkIcon />
      </Button>
      {supportsSettlement ? (
        <WorkbenchThreadSettlementButton
          disabled={pending || isArchived || archivedActiveThread !== undefined}
          onClick={() => void toggleThreadSettlement(displayedActiveThread)}
          pending={settlementPendingThreadId === displayedActiveThread.id}
          settled={displayedActiveThread.settledOverride === "settled"}
          title={displayedActiveThread.title}
        />
      ) : null}
      <Button
        aria-label={`Delete Thread ${displayedActiveThread.title}`}
        disabled={pending || isArchived}
        onClick={() => onDeleteThread(activeAssignment.threadId)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
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
      <Button
        aria-label={`Unlink Thread ${displayedHistoricalThread.title}`}
        disabled={pending || isArchived}
        onClick={() => onUnlinkThread(historicalAssignment.threadId)}
        size="icon-xs"
        title="Unlink Thread from Ticket"
        type="button"
        variant="ghost"
      >
        <UnlinkIcon />
      </Button>
      {supportsSettlement ? (
        <WorkbenchThreadSettlementButton
          disabled={pending || isArchived || historicalArchivedThread !== undefined}
          onClick={() => void toggleThreadSettlement(displayedHistoricalThread)}
          pending={settlementPendingThreadId === displayedHistoricalThread.id}
          settled={displayedHistoricalThread.settledOverride === "settled"}
          title={displayedHistoricalThread.title}
        />
      ) : null}
      <Button
        aria-label={`Delete Thread ${displayedHistoricalThread.title}`}
        disabled={pending || isArchived}
        onClick={() => onDeleteThread(historicalAssignment.threadId)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </>
  );
}

function useWorkbenchTicketDraftEditor({
  environmentId,
  ticket,
  jiraIssueLink,
  jiraFieldsManaged,
}: Pick<
  WorkbenchTicketDetailProps,
  "environmentId" | "ticket" | "jiraIssueLink" | "jiraFieldsManaged"
>) {
  const storedDraft = useWorkbenchDraftStore((state) =>
    state.drafts.get(environmentId)?.get(ticket.id),
  );
  const draftProjected = isWorkbenchDraftProjected({
    draft: storedDraft,
    ticket,
    jiraRemoteUpdatedAt: jiraIssueLink?.issue.remoteUpdatedAt,
  });
  const draft = draftProjected ? undefined : storedDraft;
  const setDraft = useWorkbenchDraftStore((state) => state.setDraft);
  const markDraftSaved = useWorkbenchDraftStore((state) => state.markDraftSaved);
  const clearDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  const {
    isArchived,
    editing,
    projectedContent,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    hasUnsavedChanges,
  } = getWorkbenchTicketDraftPresentation({ ticket, jiraIssueLink, jiraFieldsManaged, draft });
  useEffect(() => {
    if (draftProjected) {
      clearDraft(environmentId, ticket.id);
    }
  }, [clearDraft, draftProjected, environmentId, ticket.id]);

  const cancelEditing = () => {
    clearDraft(environmentId, ticket.id);
  };
  const startEditing = () => {
    setDraft(environmentId, ticket.id, {
      title: displayedTitle,
      markdown: displayedMarkdown,
      mode: "editing",
      revision: ticket.revision,
      jiraRemoteUpdatedAt: jiraIssueLink?.issue.remoteUpdatedAt ?? null,
    });
  };

  return {
    draft,
    setDraft,
    markDraftSaved,
    isArchived,
    editing,
    projectedContent,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
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
  const visibleAssignments = getVisibleWorkbenchAssignments(
    assignments,
    new Set(threadsById.keys()),
    new Set(archivedThreadsById.keys()),
    threadLookupReady,
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
  // Match the Workbench page's callback map for available assignments. Missing
  // assignments stay in that map so a Create Thread action can replace stale
  // persisted state even after the detail view hides the unavailable row.
  const assignment = getActiveAssignmentsByTicket({
    assignments: activeAssignments,
    liveThreadIds: new Set(threadsById.keys()),
    archivedThreadIds: new Set(archivedThreadsById.keys()),
    workingThreadIds: new Set(
      [...threadsById.values()]
        .filter((thread) => resolveThreadStatusPill({ thread })?.label === "Working")
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
      ? "Preparing workspace…"
      : workspaceHasFailure
        ? "Retry preparation"
        : "Prepare workspace";
  const repositories = selectedRepositoryProjectIds.map((id) => {
    const repository = linkedProjects.find((project) => project.id === id);
    const preparedRepository = ticketWorkspace?.repositories.find(
      (candidate) => candidate.projectId === id && candidate.status === "ready",
    );
    return {
      id,
      repository,
      openInCwd: preparedRepository?.worktreePath ?? null,
      isPrimary: id === ticket.primaryT3ProjectId,
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
    try {
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
    } finally {
      setSettlementPendingThreadId((current) => (current === thread.id ? null : current));
    }
  };
  return { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement };
}

function useWorkbenchTicketDetailPanels() {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [summaryPanelCollapsed, setSummaryPanelCollapsed] = useState(false);
  const [threadPanelCollapsed, setThreadPanelCollapsed] = useState(false);
  const [settledThreadsCollapsed, setSettledThreadsCollapsed] = useState(true);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const [repositoryScopePanelCollapsed, setRepositoryScopePanelCollapsed] = useState(false);
  const [repositoryScopeEditorCollapsed, setRepositoryScopeEditorCollapsed] = useState(true);
  const [advancedWorkspaceSettingsCollapsed, setAdvancedWorkspaceSettingsCollapsed] =
    useState(true);
  return {
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    resetConfirmationOpen,
    setResetConfirmationOpen,
    summaryPanelCollapsed,
    setSummaryPanelCollapsed,
    threadPanelCollapsed,
    setThreadPanelCollapsed,
    settledThreadsCollapsed,
    setSettledThreadsCollapsed,
    detailsPanelCollapsed,
    setDetailsPanelCollapsed,
    repositoryScopePanelCollapsed,
    setRepositoryScopePanelCollapsed,
    repositoryScopeEditorCollapsed,
    setRepositoryScopeEditorCollapsed,
    advancedWorkspaceSettingsCollapsed,
    setAdvancedWorkspaceSettingsCollapsed,
  };
}

function getWorkbenchDetailThread({
  assignment,
  threadsById,
  archivedThreadsById,
  ticket,
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
  const nativeStatus = nativeThread
    ? getWorkbenchAgentPresentation({
        nativeLabel: resolveThreadStatusPill({ thread: nativeThread })?.label,
        sessionStatus: nativeThread.session?.status,
        turnState: nativeThread.latestTurn?.state,
        settledOverride: nativeThread.settledOverride,
        ticketStatus: ticket.status,
      })
    : null;
  const nativeThreadFailed = nativeThread?.session?.status === "error";
  const thread = getWorkbenchThreadPresentation(
    assignment !== undefined,
    nativeThread !== undefined,
    nativeStatus?.label ?? (nativeThreadFailed ? "Failed" : null),
    archivedThread !== undefined,
    threadLookupReady,
  );
  return {
    nativeThread,
    archivedThread,
    displayedThread,
    nativeStatus,
    nativeThreadFailed,
    thread,
  };
}

function WorkbenchEpicCounts({
  jiraManaged,
  progress,
  blockedCount,
}: Pick<Parameters<typeof WorkbenchEpicDetail>[0], "jiraManaged" | "tickets"> & {
  progress: ReturnType<typeof getWorkbenchEpicProgress>;
  blockedCount: number;
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
          <dt className="text-muted-foreground">{jiraManaged ? "Shown progress" : "Progress"}</dt>
          <dd className="text-right font-medium">{progress.percent}% done</dd>
          <dt className="text-muted-foreground">
            {jiraManaged ? "Shown tickets" : "Child Tickets"}
          </dt>
          <dd className="text-right font-medium">{progress.total}</dd>
          <dt className="text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span className="cursor-help" />}>
                Flagged child tickets
              </TooltipTrigger>
              <TooltipPopup className="max-w-72">
                Child tickets marked as flagged in Jira, based on the latest sync. This is not a
                flag on the Epic itself.
              </TooltipPopup>
            </Tooltip>
          </dt>
          <dd className="text-right font-medium">{blockedCount}</dd>
        </dl>
      </section>
    </aside>
  );
}

function WorkbenchTicketLifecycleMenu({
  isArchived,
  pending,
  ticket,
  onArchive,
  setDeleteConfirmationOpen,
}: Pick<
  WorkbenchTicketHeaderActionsProps,
  "isArchived" | "pending" | "ticket" | "onArchive" | "setDeleteConfirmationOpen"
>) {
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Ticket actions" size="icon-sm" variant="ghost" />}>
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
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
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-3 py-2">
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
  activeStatusPill,
  activeAgentState,
  activeThreadState,
  activeThreadModel,
  activeThreadRecency,
  threadLookupReady,
}: Pick<
  ReturnType<typeof getWorkbenchActiveThreadRow>,
  | "displayedActiveThread"
  | "activeStatusPill"
  | "activeAgentState"
  | "activeThreadState"
  | "activeThreadModel"
  | "activeThreadRecency"
> & { threadLookupReady: boolean }) {
  return {
    ariaLabel: `${activeThreadState} ${displayedActiveThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…")}`,
    modelLabel: activeThreadModel,
    recencyLabel: activeThreadRecency,
    stateLabel:
      activeAgentState?.label ??
      activeStatusPill?.label ??
      (displayedActiveThread ? "Idle" : activeThreadState),
    statusDotClassName:
      activeAgentState?.dotClass ??
      activeStatusPill?.dotClass ??
      (displayedActiveThread ? "bg-muted-foreground/60" : undefined),
    title: displayedActiveThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…"),
  };
}

function getWorkbenchHistoricalThreadRowPresentation({
  displayedHistoricalThread,
  historicalStatusPill,
  historicalAgentState,
  threadLookupReady,
}: Pick<
  ReturnType<typeof getWorkbenchHistoricalThreadRow>,
  "displayedHistoricalThread" | "historicalStatusPill" | "historicalAgentState"
> & { threadLookupReady: boolean }) {
  return {
    ariaLabel: `${displayedHistoricalThread ? "Open" : "Checking"} ${displayedHistoricalThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…")}`,
    modelLabel: getWorkbenchThreadModelLabel(displayedHistoricalThread),
    recencyLabel: displayedHistoricalThread
      ? getWorkbenchThreadRecencyLabel(displayedHistoricalThread)
      : null,
    stateLabel:
      historicalAgentState?.label ??
      historicalStatusPill?.label ??
      (displayedHistoricalThread ? "Historical" : threadLookupReady ? "No Thread" : "Checking…"),
    statusDotClassName:
      historicalAgentState?.dotClass ??
      historicalStatusPill?.dotClass ??
      (displayedHistoricalThread ? "bg-muted-foreground/60" : undefined),
    title:
      displayedHistoricalThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…"),
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
  const [jiraSprintId, setJiraSprintId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkbenchTicketKind>("story");
  const [epicId, setEpicId] = useState<WorkbenchEpicId | null>(initialEpicId);
  const [markdown, setMarkdown] = useState(() => getWorkbenchTicketTemplate("story"));
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(null);
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) {
      setRequestId(WorkbenchTicketId.make(randomUUID()));
      setJiraSprintId(null);
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
    jiraSprintId,
    setJiraSprintId,
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
    handleOpenChange,
  };
}

function getWorkbenchCreateTicketRepositories({
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
  jiraIssueLink,
  jiraFieldsManaged,
  draft,
}: Pick<WorkbenchTicketDetailProps, "ticket" | "jiraIssueLink" | "jiraFieldsManaged"> & {
  draft: WorkbenchTicketDraft | undefined;
}) {
  const isArchived = ticket.archivedAt != null;
  const editing = !isArchived && draft?.mode === "editing";
  const projectedContent = resolveWorkbenchTicketContent({
    ticket,
    jiraIssue: jiraFieldsManaged ? jiraIssueLink?.issue : undefined,
  });
  const displayedTitle = jiraFieldsManaged
    ? projectedContent.title
    : (draft?.title ?? projectedContent.title);
  const displayedMarkdown = draft?.markdown ?? projectedContent.markdown;
  const actionableTicket =
    draft?.mode === "saved"
      ? { ...ticket, title: displayedTitle, markdown: displayedMarkdown }
      : { ...ticket, ...projectedContent };
  const dirty =
    editing &&
    ((!jiraFieldsManaged && draft.title !== projectedContent.title) ||
      draft.markdown !== projectedContent.markdown);
  const summary = getWorkbenchTicketSummaryPresentation(ticket.generatedSummary);
  const summaryHeaderLabel =
    summary.statusLabel ?? summary.error ?? (!summary.hasText ? summary.text : null);
  const hasUnsavedChanges = dirty;

  return {
    isArchived,
    editing,
    projectedContent,
    displayedTitle,
    displayedMarkdown,
    actionableTicket,
    dirty,
    summary,
    summaryHeaderLabel,
    hasUnsavedChanges,
  };
}

function getWorkbenchCreateTicketJiraPresentation({
  jiraBinding,
  jiraSprintId,
  pending,
}: {
  jiraBinding: WorkbenchJiraBinding | null;
  jiraSprintId: number | null;
  pending: boolean;
}) {
  const jiraSprints = jiraBinding
    ? jiraBinding.selectedSprints.length > 0
      ? jiraBinding.selectedSprints
      : [{ id: jiraBinding.sprintId, name: jiraBinding.sprintName }]
    : [];
  const selectedSprintId =
    jiraSprints.length === 1
      ? jiraSprints[0]!.id
      : jiraSprints.find((sprint) => sprint.id === jiraSprintId)?.id;
  const createLabel = pending
    ? jiraBinding
      ? "Creating in Jira…"
      : "Creating Ticket…"
    : "Create Ticket";
  return {
    jiraSprints,
    selectedSprintId,
    createLabel,
    description: jiraBinding
      ? `Create an issue in ${jiraBinding.jiraProjectKey}, assigned to your connected Jira account.`
      : "Capture the work and choose the repository where its Agent Thread will run.",
  };
}

function WorkbenchTicketDeleteConfirmation({
  displayedTitle,
  error,
  pending,
  ticket,
  onDelete,
  deleteConfirmationOpen,
  setDeleteConfirmationOpen,
}: Pick<WorkbenchTicketDetailProps, "error" | "pending" | "ticket" | "onDelete"> & {
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
            disabled={pending}
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
  ticket,
  onResetWorkspace,
  resetConfirmationOpen,
  setResetConfirmationOpen,
}: Pick<WorkbenchTicketDetailProps, "error" | "pending" | "ticket" | "onResetWorkspace"> & {
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
            these worktrees exist, or any worktree has local changes. Prepare the workspace again
            whenever you need it.
          </AlertDialogDescription>
          {error ? <WorkbenchInlineError message={error} /> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={pending} variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            disabled={pending}
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
