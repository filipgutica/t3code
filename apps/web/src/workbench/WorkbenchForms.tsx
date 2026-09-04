import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  ProjectId,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchTicketKind,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
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
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  getWorkbenchTicketRepositoryProjectIds,
  isWorkbenchTicketStatus,
  isWorkbenchThreadArchived,
  WORKBENCH_TICKET_STATUSES,
  WORKBENCH_TICKET_KINDS,
  WORKBENCH_TICKET_KIND_LABELS,
  WORKBENCH_TICKET_STATUS_LABELS,
  getWorkbenchTicketTemplate,
  isWorkbenchTicketKind,
} from "./workbench.logic";
import { useWorkbenchDraftStore } from "./workbenchDraftStore";

export function WorkbenchWorkspaceDialog({
  open,
  projects,
  pending,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (
    title: string,
    linkedProjectIds: ReadonlyArray<ProjectId>,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [linkedProjectIds, setLinkedProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setLinkedProjectIds([]);
    }
    onOpenChange(nextOpen);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 || linkedProjectIds.length === 0) return;
    void (async () => {
      if (!(await onCreate(title, linkedProjectIds))) return;
      handleOpenChange(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Workbench Workspace</DialogTitle>
          <DialogDescription>
            Group related tickets around one or more existing T3 Projects.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="create-workbench-workspace" className="space-y-5" onSubmit={submit}>
            {error ? <WorkbenchInlineError message={error} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="workbench-workspace-title">Workspace title</Label>
              <Input
                id="workbench-workspace-title"
                autoFocus
                placeholder="Workspace title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Linked repositories</legend>
              <p className="text-xs text-muted-foreground">
                Tickets can target any selected T3 Project.
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
                  Create a T3 Project before creating a Workbench Workspace.
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
            form="create-workbench-workspace"
            disabled={pending || title.trim().length === 0 || linkedProjectIds.length === 0}
            type="submit"
          >
            <PlusIcon /> Create Workspace
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function WorkbenchTicketDialog({
  open,
  linkedProjects,
  pending,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (
    title: string,
    markdown: string,
    kind: WorkbenchTicketKind,
    repositoryProjectIds: ReadonlyArray<ProjectId>,
    primaryProjectId: ProjectId,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkbenchTicketKind>("story");
  const [markdown, setMarkdown] = useState(() => getWorkbenchTicketTemplate("story"));
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(null);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setKind("story");
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
      if (!(await onCreate(title, markdown, kind, selectedRepositoryProjectIds, selectedProjectId)))
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
  workspaceTitle,
  ticket,
  linkedProjects,
  assignments,
  threadsById,
  archivedThreadsById,
  threadLookupReady,
  pending,
  threadActionPending,
  error,
  onBack,
  onSave,
  onUpdate,
  onOpenThread,
  onOpenAssignedThread,
}: {
  readonly workspaceTitle: string;
  readonly ticket: WorkbenchTicket;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadLookupReady: boolean;
  readonly pending: boolean;
  readonly threadActionPending: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onSave: (ticket: WorkbenchTicket, title: string, markdown: string) => Promise<boolean>;
  readonly onUpdate: (
    ticket: WorkbenchTicket,
    patch: Partial<
      Pick<
        WorkbenchTicket,
        | "title"
        | "markdown"
        | "kind"
        | "repositoryProjectIds"
        | "primaryT3ProjectId"
        | "status"
        | "blocked"
      >
    >,
  ) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket) => void;
  readonly onOpenAssignedThread: (threadId: ThreadId) => void;
}) {
  const draft = useWorkbenchDraftStore((state) => state.drafts.get(ticket.id));
  const setDraft = useWorkbenchDraftStore((state) => state.setDraft);
  const markDraftSaved = useWorkbenchDraftStore((state) => state.markDraftSaved);
  const clearDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  const assignment = assignments.find((candidate) => candidate.supersededAt === null);
  const historicalAssignments = assignments.filter((candidate) => candidate.supersededAt !== null);
  const repositoryScopeLocked = assignments.length > 0;
  const selectedRepositoryProjectIds = getWorkbenchTicketRepositoryProjectIds(ticket);
  const nativeThread = assignment ? threadsById.get(assignment.threadId) : undefined;
  const archivedThread =
    assignment && isWorkbenchThreadArchived(assignment.threadId, threadsById, archivedThreadsById)
      ? archivedThreadsById.get(assignment.threadId)
      : undefined;
  const displayedThread = nativeThread ?? archivedThread;
  const nativeStatus = nativeThread ? resolveThreadStatusPill({ thread: nativeThread }) : null;
  const nativeThreadFailed = nativeThread?.session?.status === "error";
  const thread = getWorkbenchThreadPresentation(
    assignment !== undefined,
    nativeThread !== undefined,
    nativeStatus?.label ?? (nativeThreadFailed ? "Failed" : null),
    archivedThread !== undefined,
    threadLookupReady,
  );
  const editing = draft?.mode === "editing";
  const displayedTitle = draft?.title ?? ticket.title;
  const displayedMarkdown = draft?.markdown ?? ticket.markdown;
  const actionableTicket =
    draft?.mode === "saved"
      ? { ...ticket, title: displayedTitle, markdown: displayedMarkdown }
      : ticket;
  const dirty = editing && (draft.title !== ticket.title || draft.markdown !== ticket.markdown);

  useEffect(() => {
    if (
      draft?.mode === "saved" &&
      draft.title === ticket.title &&
      draft.markdown === ticket.markdown
    ) {
      clearDraft(ticket.id);
    }
  }, [clearDraft, draft, ticket.id, ticket.markdown, ticket.title]);

  const cancelEditing = () => {
    clearDraft(ticket.id);
  };
  const startEditing = () => {
    setDraft(ticket.id, {
      title: displayedTitle,
      markdown: displayedMarkdown,
      mode: "editing",
    });
  };

  const agentTitle =
    displayedThread?.title ?? (assignment ? "Thread unavailable" : "No Agent assigned");
  const repositories = selectedRepositoryProjectIds.map((id) => ({
    id,
    repository: linkedProjects.find((project) => project.id === id),
  }));

  return (
    <article className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-start gap-3">
          <Button aria-label="Back to Board" onClick={onBack} size="sm" variant="ghost">
            <ArrowLeftIcon />
            <span className="hidden sm:inline">Board</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{workspaceTitle} · Ticket</p>
            <h1 className="mt-1 text-balance font-heading text-xl font-semibold leading-tight sm:text-2xl">
              {displayedTitle.trim() || ticket.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}</Badge>
              <Badge variant="outline">{WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}</Badge>
              {ticket.blocked ? (
                <Badge variant="warning">
                  <CircleAlertIcon /> Blocked
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <form
        className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editing) return;
          const normalizedTitle = draft.title.trim();
          const normalizedMarkdown = draft.markdown.trim();
          void (async () => {
            if (!(await onSave(ticket, normalizedTitle, normalizedMarkdown))) return;
            markDraftSaved(ticket.id, {
              title: normalizedTitle,
              markdown: normalizedMarkdown,
            });
          })();
        }}
      >
        <div className="mx-auto grid max-w-6xl items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            {error ? <WorkbenchInlineError message={error} /> : null}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Description</h2>
                  <p className="text-xs text-muted-foreground">
                    Intent, constraints, and acceptance criteria for this work.
                  </p>
                </div>
                {!editing ? (
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
                <div className="space-y-4 p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-workbench-ticket-title">Title</Label>
                    <Input
                      id="edit-workbench-ticket-title"
                      autoFocus
                      value={draft.title}
                      onChange={(event) => {
                        setDraft(ticket.id, { ...draft, title: event.currentTarget.value });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-workbench-ticket-context">Description</Label>
                    <Textarea
                      id="edit-workbench-ticket-context"
                      className="min-h-72"
                      placeholder="Goal, constraints, and acceptance criteria…"
                      value={draft.markdown}
                      onChange={(event) => {
                        setDraft(ticket.id, { ...draft, markdown: event.currentTarget.value });
                      }}
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
                      disabled={pending || !dirty || draft.title.trim().length === 0}
                      type="submit"
                    >
                      Save Ticket
                    </Button>
                  </div>
                </div>
              ) : (
                <p
                  className={`min-h-40 whitespace-pre-wrap p-4 text-sm leading-relaxed ${
                    displayedMarkdown.trim().length > 0
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {displayedMarkdown.trim() || "No description added yet."}
                </p>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Attached Agent</h2>
                <p className="text-xs text-muted-foreground">
                  Select the Agent to continue in its native T3 Thread.
                </p>
              </div>
              <button
                aria-label={`${
                  threadActionPending ? thread.pendingActionLabel : thread.actionLabel
                } for ${displayedTitle}`}
                className="group flex w-full min-w-0 items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                disabled={pending}
                onClick={() => onOpenThread(actionableTicket)}
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
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {nativeThread ? (
                      <span
                        aria-hidden
                        className={`size-2 shrink-0 rounded-full ${
                          nativeStatus?.dotClass ??
                          (nativeThreadFailed ? "bg-destructive" : "bg-muted-foreground/60")
                        }`}
                      />
                    ) : null}
                    {assignment ? `Assigned · ${thread.stateLabel}` : "Start a native T3 Thread"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                  <span className="hidden sm:inline">
                    {threadActionPending ? thread.pendingActionLabel : thread.actionLabel}
                  </span>
                  <ArrowRightIcon className="size-3.5" />
                </span>
              </button>
              {historicalAssignments.length > 0 ? (
                <div className="border-t border-border px-4 py-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Thread history</p>
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
                        <button
                          key={historicalAssignment.id}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                          disabled={!displayedHistoricalThread}
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
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Ticket fields</h2>
              </div>
              <div className="space-y-4 p-4">
                <div className="space-y-1.5">
                  <Label>Ticket type</Label>
                  <Select
                    disabled={pending}
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
                <div className="flex min-w-0 items-start gap-3">
                  <FolderGit2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Repository scope</p>
                    <div className="mt-1.5 space-y-1">
                      {repositories.map(({ id, repository }) => (
                        <div key={id} className="flex min-w-0 items-center gap-1.5 text-sm">
                          <span className="truncate font-medium">
                            {repository?.title ?? "Repository unavailable"}
                          </span>
                          {id === ticket.primaryT3ProjectId ? (
                            <Badge size="sm" variant="outline">
                              Primary
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <fieldset className="space-y-2 border-t border-border pt-4">
                  <legend className="text-xs font-medium text-muted-foreground">
                    Edit repository scope
                  </legend>
                  {repositoryScopeLocked ? (
                    <p className="text-xs text-muted-foreground">
                      Repository scope is locked after work starts so every Thread keeps its
                      original repository context.
                    </p>
                  ) : null}
                  {linkedProjects.map((repository) => {
                    const checked = selectedRepositoryProjectIds.includes(repository.id);
                    return (
                      <label key={repository.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          disabled={
                            pending ||
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
                        <span className="min-w-0 flex-1 truncate">{repository.title}</span>
                      </label>
                    );
                  })}
                  <Select
                    disabled={pending || repositoryScopeLocked}
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
                    disabled={pending}
                    value={ticket.status}
                    onValueChange={(value) => {
                      if (isWorkbenchTicketStatus(value)) {
                        onUpdate(actionableTicket, { status: value });
                      }
                    }}
                  >
                    <SelectTrigger aria-label="Ticket status">
                      <SelectValue>{WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {WORKBENCH_TICKET_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {WORKBENCH_TICKET_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Delivery state</Label>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm">
                    <Checkbox
                      checked={ticket.blocked}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        onUpdate(actionableTicket, { blocked: checked === true })
                      }
                    />
                    Blocked
                  </label>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </form>
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
