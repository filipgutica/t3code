import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  type EditorId,
  ProjectId,
  type ProviderDriverKind,
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
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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
  getVisibleWorkbenchAssignments,
  isWorkbenchThreadArchived,
  resolveWorkbenchRepositoryOpenCwd,
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
  WorkbenchCheckoutDirectory,
  WorkbenchCheckoutDetails,
  WorkbenchThreadCheckoutDetails,
} from "./WorkbenchCheckoutDetails";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { WorkbenchTicketPullRequests } from "./WorkbenchTicketPullRequests";
import { resolveWorkbenchTicketContent } from "./workbenchJira.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";

const NO_EPIC_VALUE = "__workbench_no_epic__";

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
                Jira imports only tickets assigned to you in the selected sprints. Counts and
                progress reflect the tickets shown here, not the whole Jira epic.
              </p>
            ) : null}
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
                    {jiraManaged
                      ? "Synced from Jira. Edit the description in Jira, then refresh the board."
                      : "Outcome and scope shared by the child Tickets."}
                  </p>
                </div>
                {jiraManaged ? (
                  <Badge size="sm" variant="outline">
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
                  <WorkbenchDescription markdown={epic.markdown} />
                </div>
              )}
            </section>

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
                      <div
                        key={ticket.id}
                        className="relative grid min-w-0 w-full gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge size="sm" variant="secondary">
                              {WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}
                            </Badge>
                            {jiraIssueLink ? (
                              <Badge
                                aria-label={`Open Jira issue ${jiraIssueLink.issue.key}`}
                                render={
                                  <a
                                    href={jiraIssueLink.issue.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                }
                                className="relative z-10 shrink-0"
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
                                render={
                                  <button
                                    type="button"
                                    onClick={() => onOpenTicket(ticket)}
                                    className="min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
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
                <dt className="text-muted-foreground">
                  {jiraManaged ? "Shown progress" : "Progress"}
                </dt>
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
                      Child tickets marked as flagged in Jira, based on the latest sync. This is not
                      a flag on the Epic itself.
                    </TooltipPopup>
                  </Tooltip>
                </dt>
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
  jiraRefreshing,
  jiraRefreshDisabled,
  onRefreshJira,
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
  onJiraTransition,
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
  readonly onJiraTransition: (selection: WorkbenchJiraTransitionSelection) => void;
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
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const providerEntries = deriveProviderInstanceEntries(providers ?? []);
  const threadProviderKind = (thread: EnvironmentThreadShell | undefined) => {
    const instanceId = thread?.session?.providerInstanceId ?? thread?.modelSelection.instanceId;
    return providerEntries.find((entry) => entry.instanceId === instanceId)?.driverKind;
  };
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [summaryPanelCollapsed, setSummaryPanelCollapsed] = useState(false);
  const [threadPanelCollapsed, setThreadPanelCollapsed] = useState(false);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const [repositoryScopePanelCollapsed, setRepositoryScopePanelCollapsed] = useState(false);
  const [repositoryScopeEditorCollapsed, setRepositoryScopeEditorCollapsed] = useState(true);
  const [advancedWorkspaceSettingsCollapsed, setAdvancedWorkspaceSettingsCollapsed] =
    useState(true);
  const visibleAssignments = getVisibleWorkbenchAssignments(
    assignments,
    new Set(threadsById.keys()),
    new Set(archivedThreadsById.keys()),
    threadLookupReady,
  );
  const activeAssignments = visibleAssignments.filter(
    (candidate) => candidate.supersededAt === null,
  );
  const associatedPullRequests = getWorkbenchTicketPullRequests({
    assignments: visibleAssignments,
    threadsById,
    archivedThreadsById,
  });
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
    displayedThread?.title ?? (assignment && !threadLookupReady ? "Checking Thread…" : "No Thread");
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
      <WorkspacePageHeader
        electron={isElectron}
        className="h-auto items-start border-b border-border py-3"
      >
        <div className="mx-auto grid w-full min-w-0 max-w-6xl grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
            <ArrowLeftIcon data-icon="inline-start" />
            Board
          </Button>
          <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
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
                      {jiraIssueLink?.issue.status.name ??
                        WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
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
          <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap justify-end gap-2 sm:col-start-3">
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
                <BotIcon data-icon="inline-start" />
                {threadActionPending ? thread.pendingActionLabel : thread.actionLabel}
              </Button>
            ) : null}
            {lifecycleActionsEnabled ? (
              <Menu>
                <MenuTrigger
                  render={<Button aria-label="Ticket actions" size="icon-sm" variant="ghost" />}
                >
                  <MoreHorizontalIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuItem
                      disabled={pending}
                      onClick={() =>
                        void onArchive(ticket, isArchived ? null : new Date().toISOString())
                      }
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
            ) : null}
          </div>
        </div>
      </WorkspacePageHeader>

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
        <div className="mx-auto grid min-h-0 min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            {error ? <WorkbenchInlineError message={error} /> : null}
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
                      <span
                        className="block truncate text-xs text-warning-foreground"
                        role="status"
                      >
                        Save changes to update summary.
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>
              {!summaryPanelCollapsed ? (
                <div
                  id="workbench-ticket-generated-summary-content"
                  className="max-h-48 overflow-y-auto border-t border-border/50 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {summary.text}
                      </p>
                      {summary.error ? (
                        <p
                          className="mt-1 break-words text-xs text-warning-foreground"
                          role="status"
                        >
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
              ) : null}
            </section>
            <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 max-h-[min(70vh,42rem)] lg:max-h-none lg:flex-1">
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

          <aside className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
            <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
              <div className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2.5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Agent Threads</h2>
                  <p className="text-xs text-muted-foreground">
                    Create or open a Thread to work on this Ticket.
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
                <div id="workbench-ticket-agent-threads" className="min-h-0">
                  {canOpenThread ? (
                    <div className="border-b border-border/60 px-3 py-2.5">
                      <div className="relative isolate flex min-w-0 flex-wrap items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45 [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-10">
                        <WorkbenchThreadOpenButton
                          providerKind={threadProviderKind(displayedThread)}
                          ariaLabel={`${
                            threadActionPending ? thread.pendingActionLabel : thread.actionLabel
                          } for ${displayedTitle}`}
                          disabled={pending}
                          modelLabel={
                            displayedThread?.modelSelection
                              ? `${displayedThread.modelSelection.instanceId} · ${displayedThread.modelSelection.model}`
                              : null
                          }
                          recencyLabel={
                            displayedThread ? getWorkbenchThreadRecencyLabel(displayedThread) : null
                          }
                          onClick={() => onOpenThread(actionableTicket, assignment?.threadId)}
                          stateLabel={assignment ? thread.stateLabel : "Create a Thread"}
                          statusDotClassName={
                            nativeThread
                              ? (nativeStatus?.dotClass ??
                                (nativeThreadFailed ? "bg-destructive" : "bg-muted-foreground/60"))
                              : undefined
                          }
                          title={agentTitle}
                        />
                        {assignment && displayedThread ? (
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
                        ) : null}
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
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">
                      This archived Ticket has no Thread.
                    </p>
                  )}
                  {activeAssignments.length > 1 ? (
                    <div className="border-t border-border px-3 py-2.5">
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
                            const activeStatusPill = displayedActiveThread
                              ? resolveThreadStatusPill({ thread: displayedActiveThread })
                              : null;
                            const activeAgentState = liveThread
                              ? getWorkbenchAgentPresentation({
                                  nativeLabel: resolveThreadStatusPill({ thread: liveThread })
                                    ?.label,
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
                            const activeThreadModel = displayedActiveThread?.modelSelection
                              ? `${displayedActiveThread.modelSelection.instanceId} · ${displayedActiveThread.modelSelection.model}`
                              : null;
                            const activeThreadRecency = displayedActiveThread
                              ? getWorkbenchThreadRecencyLabel(displayedActiveThread)
                              : null;
                            return (
                              <div
                                key={activeAssignment.id}
                                className="relative isolate flex min-w-0 flex-wrap items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45 [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-10"
                              >
                                <WorkbenchThreadOpenButton
                                  providerKind={threadProviderKind(displayedActiveThread)}
                                  ariaLabel={`${activeThreadState} ${displayedActiveThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…")}`}
                                  disabled={pending || displayedActiveThread === undefined}
                                  modelLabel={activeThreadModel}
                                  recencyLabel={activeThreadRecency}
                                  onClick={() => onOpenAssignedThread(activeAssignment.threadId)}
                                  stateLabel={
                                    activeAgentState?.label ??
                                    activeStatusPill?.label ??
                                    (displayedActiveThread ? "Idle" : activeThreadState)
                                  }
                                  statusDotClassName={
                                    activeAgentState?.dotClass ??
                                    activeStatusPill?.dotClass ??
                                    (displayedActiveThread ? "bg-muted-foreground/60" : undefined)
                                  }
                                  title={
                                    displayedActiveThread?.title ??
                                    (threadLookupReady ? "No Thread" : "Checking Thread…")
                                  }
                                />
                                {displayedActiveThread ? (
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
                                ) : threadLookupReady ? (
                                  <Button
                                    aria-label={`Create Thread for ${ticket.title}`}
                                    disabled={pending || isArchived}
                                    onClick={() =>
                                      onReplaceThread(ticket, activeAssignment.threadId)
                                    }
                                    size="xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    Create Thread
                                  </Button>
                                ) : null}
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
                          })}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2.5">
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
                    <div className="border-t border-border px-3 py-2.5">
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
                          const historicalStatusPill = displayedHistoricalThread
                            ? resolveThreadStatusPill({ thread: displayedHistoricalThread })
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
                          return (
                            <div
                              key={historicalAssignment.id}
                              className="relative isolate flex min-w-0 flex-wrap items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/45 focus-within:bg-muted/45 [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-10"
                            >
                              <WorkbenchThreadOpenButton
                                providerKind={threadProviderKind(displayedHistoricalThread)}
                                ariaLabel={`${displayedHistoricalThread ? "Open" : "Checking"} ${displayedHistoricalThread?.title ?? (threadLookupReady ? "No Thread" : "Checking Thread…")}`}
                                disabled={pending || !displayedHistoricalThread}
                                modelLabel={
                                  displayedHistoricalThread?.modelSelection
                                    ? `${displayedHistoricalThread.modelSelection.instanceId} · ${displayedHistoricalThread.modelSelection.model}`
                                    : null
                                }
                                recencyLabel={
                                  displayedHistoricalThread
                                    ? getWorkbenchThreadRecencyLabel(displayedHistoricalThread)
                                    : null
                                }
                                onClick={() => onOpenAssignedThread(historicalAssignment.threadId)}
                                stateLabel={
                                  historicalAgentState?.label ??
                                  historicalStatusPill?.label ??
                                  (displayedHistoricalThread
                                    ? "Historical"
                                    : threadLookupReady
                                      ? "No Thread"
                                      : "Checking…")
                                }
                                statusDotClassName={
                                  historicalAgentState?.dotClass ??
                                  historicalStatusPill?.dotClass ??
                                  (displayedHistoricalThread ? "bg-muted-foreground/60" : undefined)
                                }
                                title={
                                  displayedHistoricalThread?.title ??
                                  (threadLookupReady ? "No Thread" : "Checking Thread…")
                                }
                              />
                              {displayedHistoricalThread ? (
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

            <WorkbenchTicketPullRequests
              environmentId={environmentId}
              ticketKey={jiraIssueLink?.issue.key ?? null}
              repositoryProjectIds={selectedRepositoryProjectIds}
              pullRequests={associatedPullRequests}
              checkouts={repositories.flatMap(({ id, repository, openInCwd }) =>
                openInCwd
                  ? [
                      {
                        projectId: id,
                        title: repository?.title ?? "Repository",
                        cwd: openInCwd,
                      },
                    ]
                  : [],
              )}
            />

            <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
              <div className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2.5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Details</h2>
                </div>
                {jiraFieldsManaged ? (
                  <Badge size="sm" variant="outline">
                    Managed by Jira
                  </Badge>
                ) : null}
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
                <div id="workbench-ticket-details" className="min-h-0">
                  {jiraFieldsManaged ? (
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
                          <Button
                            onClick={() => onOpenEpic(linkedEpicId)}
                            size="xs"
                            type="button"
                            variant="ghost"
                          >
                            View Epic <ArrowRightIcon />
                          </Button>
                        ) : null}
                      </dd>
                    </dl>
                  ) : (
                    <div className="space-y-3 p-3">
                      <div className="space-y-1.5">
                        <Label>Ticket type</Label>
                        <Select
                          disabled={pending || isArchived}
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
                          disabled={pending || isArchived}
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
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
              <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
                <h2 className="text-sm font-semibold">Repository scope</h2>
                <Button
                  aria-controls="workbench-ticket-repositories"
                  aria-expanded={!repositoryScopePanelCollapsed}
                  aria-label={
                    repositoryScopePanelCollapsed
                      ? "Expand Repository scope"
                      : "Collapse Repository scope"
                  }
                  onClick={() => setRepositoryScopePanelCollapsed((collapsed) => !collapsed)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ChevronDownIcon className={repositoryScopePanelCollapsed ? "" : "rotate-180"} />
                </Button>
              </div>
              {!repositoryScopePanelCollapsed ? (
                <div id="workbench-ticket-repositories" className="space-y-3 p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="space-y-1">
                        {repositories.map(({ id, repository, openInCwd }) => {
                          return (
                            <div
                              key={id}
                              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  {openInCwd ? (
                                    <WorkbenchCheckoutDirectory
                                      cwd={openInCwd}
                                      icon={
                                        <FolderGit2Icon
                                          aria-hidden
                                          className="size-4 shrink-0 text-muted-foreground"
                                        />
                                      }
                                      value={repository?.title ?? "Repository unavailable"}
                                      valueClassName="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]"
                                    />
                                  ) : (
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <FolderGit2Icon
                                        aria-hidden
                                        className="size-4 shrink-0 text-muted-foreground"
                                      />
                                      <span className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]">
                                        {repository?.title ?? "Repository unavailable"}
                                      </span>
                                    </span>
                                  )}
                                  {id === ticket.primaryT3ProjectId ? (
                                    <Badge size="sm" variant="outline">
                                      Primary
                                    </Badge>
                                  ) : null}
                                </div>
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
                                    ? "No active workspace"
                                    : "Workspace failed"}
                          </Badge>
                        </div>
                      ) : null}
                      {ticketWorkspace?.errorMessage ? (
                        <p className="mt-2 break-words text-xs text-destructive" role="alert">
                          {ticketWorkspace.errorMessage}
                        </p>
                      ) : null}
                      {ticketWorkspace?.status === "ready" ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Threads in the same worktree share files and branch changes. Use a
                          separate native worktree for independent work.
                        </p>
                      ) : null}
                      {ticketWorkspace ? (
                        <div className="mt-3 border-t border-border pt-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3
                                id="workbench-ticket-advanced-settings-heading"
                                className="text-xs font-medium"
                              >
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
                              onClick={() =>
                                setAdvancedWorkspaceSettingsCollapsed((collapsed) => !collapsed)
                              }
                              size="icon-xs"
                              title={
                                advancedWorkspaceSettingsCollapsed
                                  ? "Expand Advanced workspace settings"
                                  : "Collapse Advanced workspace settings"
                              }
                              type="button"
                              variant="ghost"
                            >
                              <ChevronDownIcon
                                className={advancedWorkspaceSettingsCollapsed ? "" : "rotate-180"}
                              />
                            </Button>
                          </div>
                          {!advancedWorkspaceSettingsCollapsed ? (
                            <div
                              id="workbench-ticket-advanced-settings"
                              className="mt-3 space-y-2"
                              aria-labelledby="workbench-ticket-advanced-settings-heading"
                            >
                              <p className="text-xs text-muted-foreground">
                                Reset removes this Ticket&apos;s repository worktrees. The Ticket,
                                Git branches, and commits are kept. Reset is refused while linked
                                Threads exist or any worktree has local changes.
                              </p>
                              {ticketWorkspace.status !== "released" ? (
                                <Button
                                  disabled={pending || isArchived}
                                  onClick={() => setResetConfirmationOpen(true)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <RotateCcwIcon /> Reset ticket workspace
                                </Button>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No active workspace to reset. The next Create Thread prepares the
                                  workspace again.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
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
                        <ChevronDownIcon
                          className={repositoryScopeEditorCollapsed ? "" : "rotate-180"}
                        />
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
                            Wait for workspace preparation or release to finish before changing
                            repositories.
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Choose repository context for new Threads. Existing Threads stay
                            unchanged.
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
                              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                                {repository.title}
                              </span>
                            </label>
                          );
                        })}
                        <Label htmlFor={`primary-repository-${ticket.id}`}>
                          Primary repository
                        </Label>
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
                    ) : null}
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

function WorkbenchThreadOpenButton({
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
    <button
      aria-label={ariaLabel}
      className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring enabled:after:absolute enabled:after:inset-0 enabled:after:content-[''] disabled:cursor-default disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ThreadIcon aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <WorkbenchThreadTitle className="relative z-10 block truncate font-medium" title={title} />
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {statusDotClassName ? (
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${statusDotClassName}`} />
          ) : null}
          <span>{stateLabel}</span>
          {modelLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{modelLabel}</span>
            </>
          ) : null}
          {recencyLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{recencyLabel}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center text-muted-foreground group-hover:text-foreground">
        <span className="sr-only">Open Thread</span>
        <ArrowRightIcon className="size-3.5" />
      </span>
    </button>
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
