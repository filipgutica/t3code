import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  type EditorId,
  ProjectId,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchEpic,
  WorkbenchEpicId,
  type WorkbenchJiraIssueLink,
  type WorkbenchTicket,
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
  ExternalLinkIcon,
  FolderGit2Icon,
  LinkIcon,
  Layers3Icon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";

import { Badge } from "../components/ui/badge";
import { OpenInPicker } from "../components/chat/OpenInPicker";
import { Button } from "../components/ui/button";
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
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  getWorkbenchAgentPresentation,
  getWorkbenchEpicProgress,
  getActiveAssignmentsByTicket,
  getWorkbenchTicketRepositoryProjectIds,
  getWorkbenchTicketSummaryActionLabel,
  getWorkbenchTicketSummaryPresentation,
  getVisibleWorkbenchAssignments,
  isWorkbenchTicketStatus,
  isWorkbenchThreadArchived,
  resolveWorkbenchRepositoryOpenCwd,
  WORKBENCH_TICKET_STATUSES,
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
} from "./workbenchDraftStore";
import { WorkbenchDescription } from "./WorkbenchDescription";
import {
  useWorkbenchCheckoutStatusRefresh,
  WorkbenchCheckoutDetails,
  WorkbenchThreadCheckoutDetails,
} from "./WorkbenchCheckoutDetails";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { resolveWorkbenchTicketContent } from "./workbenchJira.logic";

const NO_EPIC_VALUE = "__workbench_no_epic__";

export function WorkbenchEpicDetail({
  workspaceTitle,
  epic,
  jiraManagedTitle,
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
  readonly jiraManagedTitle: boolean;
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
            <h1 className="mt-1 break-words text-balance font-heading text-xl font-semibold leading-tight sm:text-2xl">
              {epic.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Epic</Badge>
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
          </div>
          <Button disabled={pending || epic.archivedAt !== null} onClick={onCreateTicket} size="sm">
            <PlusIcon /> New Ticket
          </Button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            {error ? <WorkbenchInlineError message={error} /> : null}
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
                    const normalizedTitle = jiraManagedTitle ? epic.title : title.trim();
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
                      {jiraManagedTitle ? (
                        <Badge size="sm" variant="outline">
                          Managed by Jira
                        </Badge>
                      ) : null}
                    </div>
                    <Input
                      id="edit-workbench-epic-title"
                      autoFocus={!jiraManagedTitle}
                      disabled={jiraManagedTitle}
                      value={title}
                      onChange={(event) => setTitle(event.currentTarget.value)}
                    />
                    {jiraManagedTitle ? (
                      <p className="text-xs text-muted-foreground">
                        Jira keeps the Epic title in sync. The local description remains editable.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-workbench-epic-description">Description</Label>
                    <Textarea
                      id="edit-workbench-epic-description"
                      autoFocus={jiraManagedTitle}
                      className="min-h-48"
                      placeholder="Context, scope, and intended outcome…"
                      value={markdown}
                      onChange={(event) => setMarkdown(event.currentTarget.value)}
                    />
                  </div>
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Button
                      disabled={pending}
                      onClick={cancelEditing}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={
                        pending ||
                        (!jiraManagedTitle && title.trim().length === 0) ||
                        ((jiraManagedTitle || title.trim() === epic.title) &&
                          markdown.trim() === epic.markdown)
                      }
                      type="submit"
                    >
                      Save Epic
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="min-h-32 break-words p-4">
                  <WorkbenchDescription markdown={epic.markdown} />
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Child Tickets</h2>
                  <p className="text-xs text-muted-foreground">
                    Stories and bugs that deliver this Epic.
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
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {progress.percent}%
                  </span>
                </div>
              </div>
              {tickets.length > 0 ? (
                <div className="divide-y divide-border border-t border-border">
                  {tickets.map((ticket) => {
                    const repository = repositoriesById.get(ticket.primaryT3ProjectId);
                    const assignment = assignmentsByTicket.get(ticket.id);
                    const jiraIssueLink = jiraIssueLinksByTicketId.get(ticket.id);
                    return (
                      <button
                        key={ticket.id}
                        className="grid min-w-0 w-full gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        onClick={() => onOpenTicket(ticket)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge size="sm" variant="secondary">
                              {WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}
                            </Badge>
                            {jiraIssueLink ? (
                              <Badge
                                aria-label={`Jira issue ${jiraIssueLink.issue.key}`}
                                className="shrink-0"
                                size="sm"
                                title={`Jira issue ${jiraIssueLink.issue.key}`}
                                variant="outline"
                              >
                                <WorkbenchJiraIcon className="size-3" />
                                <span>{jiraIssueLink.issue.key}</span>
                              </Badge>
                            ) : null}
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="min-w-0 truncate text-sm font-medium" />}
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
                            <Badge size="sm" variant="warning">
                              Jira flagged
                            </Badge>
                          ) : null}
                          <Badge size="sm" variant="outline">
                            {jiraIssueLink?.issue.status.name ??
                              WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
                          </Badge>
                          <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No child Tickets yet. Add the first Story or Bug for this Epic.
                </div>
              )}
            </section>
          </div>

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
                <dt className="text-muted-foreground">Jira flagged</dt>
                <dd className="text-right font-medium">{blockedCount}</dd>
              </dl>
            </section>
          </aside>
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
                          disabled={
                            pending || initialWorkspace?.linkedProjectIds.includes(project.id)
                          }
                          onCheckedChange={(checked) =>
                            setLinkedProjectIds((current) =>
                              checked
                                ? [...current, project.id]
                                : current.filter((id) => id !== project.id),
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {project.title}
                          </span>
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
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
          <Button onClick={() => handleOpenChange(false)} variant="outline">
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

export function WorkbenchTicketDialog({
  open,
  linkedProjects,
  epics,
  initialEpicId,
  pending,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly initialEpicId: WorkbenchEpicId | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (
    title: string,
    markdown: string,
    kind: WorkbenchTicketKind,
    epicId: WorkbenchEpicId | null,
    repositoryProjectIds: ReadonlyArray<ProjectId>,
    primaryProjectId: ProjectId,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkbenchTicketKind>("story");
  const [epicId, setEpicId] = useState<WorkbenchEpicId | null>(initialEpicId);
  const [markdown, setMarkdown] = useState(() => getWorkbenchTicketTemplate("story"));
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(null);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setKind("story");
      setEpicId(initialEpicId);
      setMarkdown(getWorkbenchTicketTemplate("story"));
      setRepositoryProjectIds([]);
      setPrimaryProjectId(null);
    }
    onOpenChange(nextOpen);
  };
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 || selectedProjectId === null) return;
    void (async () => {
      if (
        !(await onCreate(
          title,
          markdown,
          kind,
          epicId,
          selectedRepositoryProjectIds,
          selectedProjectId,
        ))
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
          <DialogDescription>
            Capture the work and choose the repository where its Agent Thread will run.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-ticket" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label>Ticket type</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (!isWorkbenchTicketKind(value)) return;
                  if (
                    markdown.trim().length === 0 ||
                    markdown === getWorkbenchTicketTemplate(kind)
                  ) {
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
              <Label>Epic</Label>
              <Select
                value={epicId ?? NO_EPIC_VALUE}
                onValueChange={(value) =>
                  setEpicId(!value || value === NO_EPIC_VALUE ? null : WorkbenchEpicId.make(value))
                }
              >
                <SelectTrigger aria-label="Epic">
                  <SelectValue>
                    {epics.find((epic) => epic.id === epicId)?.title ?? "No Epic"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NO_EPIC_VALUE}>No Epic</SelectItem>
                  {epics.map((epic) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Repository scope</legend>
              <p className="text-xs text-muted-foreground">
                Select every repository this Ticket may need. Its primary repository hosts the Agent
                Thread.
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
                              if (
                                selectedProjectId === null ||
                                !nextIds.includes(selectedProjectId)
                              ) {
                                setPrimaryProjectId(nextIds[0] ?? null);
                              }
                            }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {project.title}
                            </span>
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
                      onValueChange={(value) =>
                        setPrimaryProjectId(value ? ProjectId.make(value) : null)
                      }
                    >
                      <SelectTrigger aria-label="Primary repository">
                        <SelectValue>
                          {linkedProjects.find((project) => project.id === selectedProjectId)
                            ?.title ?? "Select a repository"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {linkedProjects
                          .filter((project) => selectedRepositoryProjectIds.includes(project.id))
                          .map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.title}
                            </SelectItem>
                          ))}
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
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button
            form="create-workbench-ticket"
            disabled={pending || title.trim().length === 0 || selectedProjectId === null}
            type="submit"
          >
            <PlusIcon /> Create Ticket
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function WorkbenchTicketDetail({
  environmentId,
  workspaceTitle,
  ticket,
  ticketWorkspace,
  linkedProjects,
  epics,
  jiraIssueLink,
  jiraFieldsManaged,
  keybindings,
  availableEditors,
  assignments,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  pending,
  threadActionPending,
  error,
  onBack,
  onSave,
  onRegenerateSummary,
  onUpdate,
  onOpenEpic,
  onOpenThread,
  onOpenAssignedThread,
  onNewThread,
  onAttachThread,
  onDeleteThread,
  onReplaceThread,
  onArchive,
  onDelete,
  onResetWorkspace,
  lifecycleActionsEnabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspaceTitle: string;
  readonly ticket: WorkbenchTicket;
  readonly ticketWorkspace: WorkbenchTicketWorkspace | undefined;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraIssueLink: WorkbenchJiraIssueLink | null;
  readonly jiraFieldsManaged: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly threadActionPending: boolean;
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
  readonly onOpenEpic: (epicId: WorkbenchEpicId) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket, threadId?: ThreadId) => void;
  readonly onOpenAssignedThread: (threadId: ThreadId) => void;
  readonly onNewThread: (ticket: WorkbenchTicket) => void;
  readonly onAttachThread: (ticket: WorkbenchTicket) => void;
  readonly onDeleteThread: (threadId: ThreadId) => void;
  readonly onReplaceThread: (ticket: WorkbenchTicket, previousThreadId: ThreadId) => void;
  readonly onArchive: (ticket: WorkbenchTicket, archivedAt: string | null) => Promise<boolean>;
  readonly onDelete: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly onResetWorkspace: (ticket: WorkbenchTicket) => Promise<boolean>;
  readonly lifecycleActionsEnabled: boolean;
}) {
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
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [threadPanelCollapsed, setThreadPanelCollapsed] = useState(false);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const visibleAssignments = getVisibleWorkbenchAssignments(
    assignments,
    new Set(threadsById.keys()),
    new Set(archivedThreadsById.keys()),
    threadLookupReady,
  );
  const activeAssignments = visibleAssignments.filter(
    (candidate) => candidate.supersededAt === null,
  );
  // Match the Workbench page's callback map for available assignments. Missing
  // assignments stay in that map so a Create Thread action can replace stale
  // persisted state even after the detail view hides the unavailable row.
  const assignment = getActiveAssignmentsByTicket(
    visibleAssignments,
    new Set(threadsById.keys()),
    new Set(archivedThreadsById.keys()),
  ).get(ticket.id);
  const historicalAssignments = visibleAssignments.filter(
    (candidate) => candidate.supersededAt !== null,
  );
  const repositoryScopeLocked =
    ticketWorkspace?.status === "preparing" || ticketWorkspace?.status === "releasing";
  const selectedRepositoryProjectIds = getWorkbenchTicketRepositoryProjectIds(ticket);
  const workspaceHasSelectedRepositories = selectedRepositoryProjectIds.every((projectId) =>
    ticketWorkspace?.repositories.some(
      (repository) => repository.projectId === projectId && repository.status === "ready",
    ),
  );
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
  const hasUnsavedChanges = dirty;

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

  const agentTitle =
    displayedThread?.title ?? (assignment ? "Thread unavailable" : "No Agent assigned");
  const repositories = selectedRepositoryProjectIds.map((id) => {
    const repository = linkedProjects.find((project) => project.id === id);
    const preparedRepository = ticketWorkspace?.repositories.find(
      (candidate) => candidate.projectId === id && candidate.status === "ready",
    );
    const openInCwd =
      preparedRepository?.worktreePath ??
      (repository
        ? resolveWorkbenchRepositoryOpenCwd({
            repositoryId: id,
            primaryProjectId: ticket.primaryT3ProjectId,
            repositoryWorkspaceRoot: repository.workspaceRoot,
            activeThreadWorktreePath:
              nativeThread?.projectId === id ? nativeThread.worktreePath : undefined,
          })
        : null);
    return { id, repository, openInCwd };
  });
  useWorkbenchCheckoutStatusRefresh({
    environmentId,
    cwds: [
      ...repositories.map((repository) => repository.openInCwd),
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
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex min-w-0 max-w-6xl flex-wrap items-start gap-3">
          <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
            <ArrowLeftIcon />
            <span className="hidden sm:inline">Board</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{workspaceTitle} · Ticket</p>
            <h1 className="mt-1 break-words text-balance font-heading text-xl font-semibold leading-tight sm:text-2xl">
              {displayedTitle.trim() || ticket.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}</Badge>
              {jiraIssueLink ? (
                <Button
                  aria-label={`Open Jira issue ${jiraIssueLink.issue.key}`}
                  render={
                    <a href={jiraIssueLink.issue.url} rel="noopener noreferrer" target="_blank" />
                  }
                  size="xs"
                  title={`Open ${jiraIssueLink.issue.key} in Jira`}
                  variant="outline"
                >
                  <WorkbenchJiraIcon className="size-3.5" />
                  <span>{jiraIssueLink.issue.key}</span>
                  <ExternalLinkIcon />
                </Button>
              ) : null}
              {isArchived ? <Badge variant="outline">Archived</Badge> : null}
              <Badge variant="outline">
                {jiraIssueLink?.issue.status.name ?? WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
              {jiraIssueLink?.issue.flagged ? (
                <Badge variant="warning">
                  <CircleAlertIcon /> Jira flagged
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap justify-end gap-2">
            {lifecycleActionsEnabled ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void onArchive(ticket, isArchived ? null : new Date().toISOString())
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isArchived ? <RotateCcwIcon /> : <ArchiveIcon />}
                  <span className="hidden sm:inline">{isArchived ? "Restore" : "Archive"}</span>
                </Button>
                <Button
                  aria-label={`Delete ${displayedTitle}`}
                  disabled={pending}
                  onClick={() => setDeleteConfirmationOpen(true)}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2Icon />
                </Button>
              </>
            ) : null}
            {canOpenThread ? (
              <Button
                aria-label={`${
                  threadActionPending ? thread.pendingActionLabel : thread.actionLabel
                } for ${displayedTitle}`}
                disabled={pending}
                onClick={() => {
                  if (assignment && thread.state === "missing") {
                    onReplaceThread(ticket, assignment.threadId);
                    return;
                  }
                  onOpenThread(actionableTicket, assignment?.threadId);
                }}
                size="sm"
                type="button"
              >
                <BotIcon />
                <span className="hidden sm:inline">
                  {threadActionPending ? thread.pendingActionLabel : thread.actionLabel}
                </span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <form
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:overflow-y-hidden"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editing) return;
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
        <div className="mx-auto grid min-h-0 min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            {error ? <WorkbenchInlineError message={error} /> : null}
            <section
              aria-labelledby="workbench-ticket-generated-summary"
              className="rounded-xl border border-border bg-card"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 id="workbench-ticket-generated-summary" className="text-sm font-semibold">
                    Generated summary
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    A short overview of the saved Ticket.
                  </p>
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
              <div className="px-4 py-3">
                <p className="text-sm leading-relaxed text-muted-foreground">{summary.text}</p>
                {summary.statusLabel ? (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {summary.statusLabel}
                  </p>
                ) : null}
                {summary.error ? (
                  <p className="mt-1 break-words text-xs text-warning-foreground" role="status">
                    {summary.error}
                  </p>
                ) : null}
                {hasUnsavedChanges ? (
                  <p className="mt-2 text-xs text-warning-foreground" role="status">
                    Save changes to update summary.
                  </p>
                ) : null}
              </div>
            </section>
            <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card max-h-[min(70vh,42rem)] lg:max-h-none lg:flex-1">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
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
              {editing ? (
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
                    <Button
                      disabled={pending}
                      onClick={cancelEditing}
                      type="button"
                      variant="outline"
                    >
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
                <div className="min-h-40 min-w-0 flex-1 overflow-y-auto p-4">
                  <WorkbenchDescription markdown={displayedMarkdown} jira={jiraFieldsManaged} />
                </div>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            <section
              className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card max-h-[min(70vh,42rem)] lg:flex-[0_1_auto] ${
                threadPanelCollapsed || detailsPanelCollapsed ? "lg:max-h-full" : "lg:max-h-[50%]"
              }`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Agent Threads</h2>
                  <p className="text-xs text-muted-foreground">
                    Continue this work in its native T3 conversation.
                  </p>
                </div>
                <Button
                  aria-controls="workbench-ticket-agent-threads"
                  aria-expanded={!threadPanelCollapsed}
                  aria-label={
                    threadPanelCollapsed ? "Expand Agent Threads" : "Collapse Agent Threads"
                  }
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
                <div id="workbench-ticket-agent-threads" className="min-h-0 overflow-y-auto">
                  {canOpenThread ? (
                    <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                      <button
                        aria-label={`${
                          threadActionPending ? thread.pendingActionLabel : thread.actionLabel
                        } for ${displayedTitle}`}
                        className="group flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        disabled={pending}
                        onClick={() => onOpenThread(actionableTicket, assignment?.threadId)}
                        type="button"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          {thread.state === "missing" ? (
                            <CircleAlertIcon className="size-4 text-warning-foreground" />
                          ) : (
                            <BotIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{agentTitle}</span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            {nativeThread ? (
                              <span
                                aria-hidden
                                className={`size-2 shrink-0 rounded-full ${
                                  nativeStatus?.dotClass ??
                                  (nativeThreadFailed ? "bg-destructive" : "bg-muted-foreground/60")
                                }`}
                              />
                            ) : null}
                            <span>
                              {assignment ? thread.stateLabel : "Create a native T3 Thread"}
                            </span>
                          </span>
                          {displayedThread?.modelSelection ? (
                            <span className="mt-1 block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                              {displayedThread.modelSelection.instanceId} ·{" "}
                              {displayedThread.modelSelection.model}
                            </span>
                          ) : null}
                          {displayedThread ? (
                            <WorkbenchThreadCheckoutDetails
                              environmentId={environmentId}
                              thread={displayedThread}
                              projects={linkedProjects}
                              workspace={ticketWorkspace}
                            />
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                          <span className="sr-only">
                            {threadActionPending ? thread.pendingActionLabel : thread.actionLabel}
                          </span>
                          <ArrowRightIcon className="size-3.5" />
                        </span>
                      </button>
                      {assignment && displayedThread ? (
                        <Button
                          aria-label={`Delete native Thread ${displayedThread.title}`}
                          disabled={pending || isArchived}
                          onClick={() => onDeleteThread(assignment.threadId)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      This archived Ticket has no native Thread.
                    </p>
                  )}
                  {activeAssignments.length > 1 ? (
                    <div className="border-t border-border px-4 py-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Other active Threads
                      </p>
                      <div className="space-y-1">
                        {activeAssignments
                          .filter((activeAssignment) => activeAssignment.id !== assignment?.id)
                          .map((activeAssignment) => {
                            const liveThread = threadsById.get(activeAssignment.threadId);
                            const archivedActiveThread = isWorkbenchThreadArchived(
                              activeAssignment.threadId,
                              threadsById,
                              archivedThreadsById,
                            )
                              ? archivedThreadsById.get(activeAssignment.threadId)
                              : undefined;
                            const displayedActiveThread = liveThread ?? archivedActiveThread;
                            const activeAgentState = liveThread
                              ? getWorkbenchAgentPresentation({
                                  nativeLabel: resolveThreadStatusPill({ thread: liveThread })
                                    ?.label,
                                  sessionStatus: liveThread.session?.status,
                                  turnState: liveThread.latestTurn?.state,
                                })
                              : null;
                            const activeThreadState = liveThread
                              ? "Open"
                              : archivedActiveThread
                                ? "Restore"
                                : threadLookupReady
                                  ? "Missing"
                                  : "Checking…";
                            const activeThreadModel = displayedActiveThread?.modelSelection
                              ? `${displayedActiveThread.modelSelection.instanceId} · ${displayedActiveThread.modelSelection.model}`
                              : null;
                            return (
                              <div
                                key={activeAssignment.id}
                                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                              >
                                <button
                                  aria-label={`${activeThreadState} ${displayedActiveThread?.title ?? "Thread unavailable"}`}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                  disabled={pending || displayedActiveThread === undefined}
                                  onClick={() => onOpenAssignedThread(activeAssignment.threadId)}
                                  type="button"
                                >
                                  {displayedActiveThread ? (
                                    <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <CircleAlertIcon className="size-3.5 shrink-0 text-warning-foreground" />
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">
                                      {displayedActiveThread?.title ?? "Thread unavailable"}
                                    </span>
                                    <span className="block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                                      {activeThreadModel ?? activeThreadState}
                                    </span>
                                    {displayedActiveThread ? (
                                      <WorkbenchThreadCheckoutDetails
                                        environmentId={environmentId}
                                        thread={displayedActiveThread}
                                        projects={linkedProjects}
                                        workspace={ticketWorkspace}
                                      />
                                    ) : null}
                                    {activeAgentState ? (
                                      <span
                                        className={`block text-xs ${activeAgentState.colorClass}`}
                                      >
                                        {activeAgentState.label}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {activeThreadState}
                                  </span>
                                </button>
                                {displayedActiveThread ? (
                                  <Button
                                    aria-label={`Delete native Thread ${displayedActiveThread.title}`}
                                    disabled={pending || isArchived}
                                    onClick={() => onDeleteThread(activeAssignment.threadId)}
                                    size="icon-xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <Trash2Icon />
                                  </Button>
                                ) : threadLookupReady ? (
                                  <Button
                                    aria-label={`Replace missing native Thread for ${ticket.title}`}
                                    disabled={pending || isArchived}
                                    onClick={() =>
                                      onReplaceThread(ticket, activeAssignment.threadId)
                                    }
                                    size="xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    Replace
                                  </Button>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                    <Button
                      disabled={pending || isArchived}
                      onClick={() => onNewThread(ticket)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <PlusIcon /> New Thread
                    </Button>
                    <Button
                      disabled={pending || isArchived}
                      onClick={() => onAttachThread(ticket)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <LinkIcon /> Attach existing
                    </Button>
                  </div>
                  {historicalAssignments.length > 0 ? (
                    <div className="border-t border-border px-4 py-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Thread history
                      </p>
                      <div className="space-y-1">
                        {historicalAssignments.map((historicalAssignment) => {
                          const historicalThread = threadsById.get(historicalAssignment.threadId);
                          const historicalArchivedThread = isWorkbenchThreadArchived(
                            historicalAssignment.threadId,
                            threadsById,
                            archivedThreadsById,
                          )
                            ? archivedThreadsById.get(historicalAssignment.threadId)
                            : undefined;
                          const displayedHistoricalThread =
                            historicalThread ?? historicalArchivedThread;
                          return (
                            <div
                              key={historicalAssignment.id}
                              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                            >
                              <button
                                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                disabled={pending || !displayedHistoricalThread}
                                onClick={() => onOpenAssignedThread(historicalAssignment.threadId)}
                                type="button"
                              >
                                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">
                                  {displayedHistoricalThread?.title ?? "Thread unavailable"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {historicalArchivedThread
                                    ? "Restore"
                                    : historicalThread
                                      ? "Open"
                                      : "Unavailable"}
                                </span>
                              </button>
                              {displayedHistoricalThread ? (
                                <Button
                                  aria-label={`Delete native Thread ${displayedHistoricalThread.title}`}
                                  disabled={pending || isArchived}
                                  onClick={() => onDeleteThread(historicalAssignment.threadId)}
                                  size="icon-xs"
                                  type="button"
                                  variant="ghost"
                                >
                                  <Trash2Icon />
                                </Button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section
              className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card max-h-[min(70vh,42rem)] lg:max-h-none ${
                detailsPanelCollapsed ? "lg:flex-none" : "lg:flex-1"
              }`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Details</h2>
                  {jiraFieldsManaged ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Jira manages type, Epic, flagged state, and Board status.
                    </p>
                  ) : null}
                </div>
                <Button
                  aria-controls="workbench-ticket-details"
                  aria-expanded={!detailsPanelCollapsed}
                  aria-label={
                    detailsPanelCollapsed ? "Expand Ticket Details" : "Collapse Ticket Details"
                  }
                  onClick={() => setDetailsPanelCollapsed((collapsed) => !collapsed)}
                  size="icon-xs"
                  title={
                    detailsPanelCollapsed ? "Expand Ticket Details" : "Collapse Ticket Details"
                  }
                  type="button"
                  variant="ghost"
                >
                  <ChevronDownIcon className={detailsPanelCollapsed ? "" : "rotate-180"} />
                </Button>
              </div>
              {!detailsPanelCollapsed ? (
                <div id="workbench-ticket-details" className="min-h-0 overflow-y-auto">
                  <div className="space-y-4 p-4">
                    <div className="space-y-1.5">
                      <Label>Ticket type</Label>
                      <Select
                        disabled={pending || jiraFieldsManaged || isArchived}
                        value={ticket.kind}
                        onValueChange={(value) => {
                          if (isWorkbenchTicketKind(value))
                            onUpdate(actionableTicket, { kind: value });
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
                        disabled={pending || jiraFieldsManaged || isArchived}
                        value={ticket.epicId ?? NO_EPIC_VALUE}
                        onValueChange={(value) =>
                          onUpdate(actionableTicket, {
                            epicId:
                              !value || value === NO_EPIC_VALUE
                                ? null
                                : WorkbenchEpicId.make(value),
                          })
                        }
                      >
                        <SelectTrigger aria-label="Epic">
                          <SelectValue>
                            {epics.find((epic) => epic.id === ticket.epicId)?.title ?? "No Epic"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value={NO_EPIC_VALUE}>No Epic</SelectItem>
                          {epics.map((epic) => (
                            <SelectItem
                              key={epic.id}
                              disabled={epic.archivedAt !== null}
                              value={epic.id}
                            >
                              {epic.title}
                              {epic.archivedAt !== null ? " (Archived)" : ""}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <div className="flex min-w-0 items-start gap-3">
                      <FolderGit2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">Repository scope</p>
                        <div className="mt-1.5 space-y-1">
                          {repositories.map(({ id, repository, openInCwd }) => {
                            return (
                              <div key={id} className="flex min-w-0 items-center gap-2 text-sm">
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate font-medium">
                                      {repository?.title ?? "Repository unavailable"}
                                    </span>
                                    {id === ticket.primaryT3ProjectId ? (
                                      <Badge size="sm" variant="outline">
                                        Primary
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {openInCwd ? (
                                    <WorkbenchCheckoutDetails
                                      environmentId={environmentId}
                                      cwd={openInCwd}
                                    />
                                  ) : null}
                                </div>
                                {repository && !isArchived ? (
                                  <OpenInPicker
                                    environmentId={repository.environmentId}
                                    keybindings={keybindings}
                                    availableEditors={availableEditors}
                                    openInCwd={openInCwd}
                                    compact
                                    enableShortcut={false}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        {ticketWorkspace ? (
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge
                              size="sm"
                              variant={ticketWorkspace.status === "failed" ? "warning" : "outline"}
                            >
                              {ticketWorkspace.status === "ready"
                                ? workspaceHasSelectedRepositories
                                  ? "Workspace prepared"
                                  : "Workspace updates pending"
                                : ticketWorkspace.status === "preparing"
                                  ? "Preparing workspace"
                                  : ticketWorkspace.status === "releasing"
                                    ? "Releasing workspace"
                                    : ticketWorkspace.status === "released"
                                      ? "Workspace reset"
                                      : "Workspace failed"}
                            </Badge>
                          </div>
                        ) : null}
                        {ticketWorkspace?.status === "ready" ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Threads in the same worktree share files and branch changes. Use a
                            separate native worktree for independent work.
                          </p>
                        ) : null}
                        {ticketWorkspace && ticketWorkspace.status !== "released" ? (
                          <Button
                            className="mt-2"
                            disabled={pending || isArchived}
                            onClick={() => setResetConfirmationOpen(true)}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcwIcon /> Reset ticket workspace
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <fieldset className="space-y-2 border-t border-border pt-4">
                      <legend className="text-xs font-medium text-muted-foreground">
                        Edit repository scope
                      </legend>
                      {repositoryScopeLocked ? (
                        <p className="text-xs text-muted-foreground">
                          Wait for workspace preparation or release to finish before changing
                          repositories.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Repository changes apply when you create another Thread. Existing Threads
                          and worktrees stay in place.
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
                                  : selectedRepositoryProjectIds.filter(
                                      (id) => id !== repository.id,
                                    );
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
                            <span className="min-w-0 flex-1 truncate">{repository.title}</span>
                          </label>
                        );
                      })}
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
                        <SelectTrigger aria-label="Primary repository">
                          <SelectValue>
                            {linkedProjects.find(
                              (repository) => repository.id === ticket.primaryT3ProjectId,
                            )?.title ?? "Select primary repository"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {linkedProjects
                            .filter((repository) =>
                              selectedRepositoryProjectIds.includes(repository.id),
                            )
                            .map((repository) => (
                              <SelectItem key={repository.id} value={repository.id}>
                                {repository.title}
                              </SelectItem>
                            ))}
                        </SelectPopup>
                      </Select>
                    </fieldset>
                    <div className="space-y-1.5 border-t border-border pt-4">
                      <Label>Status</Label>
                      <Select
                        disabled={pending || isArchived}
                        value={ticket.status}
                        onValueChange={(value) => {
                          if (isWorkbenchTicketStatus(value)) {
                            onUpdate(actionableTicket, { status: value });
                          }
                        }}
                      >
                        <SelectTrigger aria-label="Ticket status">
                          <SelectValue>
                            {jiraIssueLink?.issue.status.name ??
                              WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {WORKBENCH_TICKET_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {WORKBENCH_TICKET_STATUS_LABELS[status]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      {jiraFieldsManaged ? (
                        <p className="text-xs text-muted-foreground">
                          Status changes are sent to Jira for this mirrored Ticket.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </form>
      <AlertDialog open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{displayedTitle}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the local Ticket from Workbench. Its native T3 Threads and prepared
              worktrees are kept.
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
      <AlertDialog open={resetConfirmationOpen} onOpenChange={setResetConfirmationOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset workspace for “{displayedTitle}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This destructive action removes this Ticket's repository worktrees. The Ticket, Git
              branches, and commits are kept. Reset is refused while linked Threads exist or any
              worktree has local changes. The next Create Thread prepares the workspace again.
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
              <RotateCcwIcon /> {pending ? "Resetting workspace…" : "Reset ticket workspace"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </article>
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
