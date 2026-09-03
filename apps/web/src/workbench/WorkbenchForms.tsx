import { ProjectId, type WorkbenchAssignment, type WorkbenchTicket } from "@t3tools/contracts";
import {
  BotIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "../components/ui/badge";
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
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { Textarea } from "../components/ui/textarea";
import type { Project } from "../types";
import {
  getWorkbenchThreadPresentation,
  isWorkbenchTicketStatus,
  WORKBENCH_TICKET_STATUSES,
  WORKBENCH_TICKET_STATUS_LABELS,
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
    primaryProjectId: ProjectId,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(null);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setMarkdown("");
      setPrimaryProjectId(null);
    }
    onOpenChange(nextOpen);
  };
  const selectedProjectId =
    linkedProjects.find((project) => project.id === primaryProjectId)?.id ??
    linkedProjects[0]?.id ??
    null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 || selectedProjectId === null) return;
    void (async () => {
      if (!(await onCreate(title, markdown, selectedProjectId))) return;
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
          <form id="create-workbench-ticket" className="space-y-4" onSubmit={submit}>
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
              <Label htmlFor="workbench-ticket-context">Context</Label>
              <Textarea
                id="workbench-ticket-context"
                className="min-h-32"
                placeholder="Goal, constraints, and acceptance criteria…"
                value={markdown}
                onChange={(event) => setMarkdown(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Primary repository</Label>
              {linkedProjects.length > 0 ? (
                <Select
                  value={selectedProjectId}
                  onValueChange={(value) =>
                    setPrimaryProjectId(value ? ProjectId.make(value) : null)
                  }
                >
                  <SelectTrigger aria-label="Primary repository">
                    <SelectValue>
                      {linkedProjects.find((project) => project.id === selectedProjectId)?.title ??
                        "Select a repository"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {linkedProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : (
                <div className="rounded-lg border border-dashed border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground">
                  This Workbench Workspace has no available linked repositories.
                </div>
              )}
            </div>
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
  ticket,
  repository,
  assignment,
  threadExists,
  pending,
  error,
  onOpenChange,
  onSave,
  onUpdate,
  onOpenThread,
}: {
  readonly ticket: WorkbenchTicket;
  readonly repository: Project | undefined;
  readonly assignment: WorkbenchAssignment | undefined;
  readonly threadExists: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (ticket: WorkbenchTicket, title: string, markdown: string) => Promise<boolean>;
  readonly onUpdate: (
    ticket: WorkbenchTicket,
    patch: Partial<Pick<WorkbenchTicket, "title" | "markdown" | "status" | "blocked">>,
  ) => void;
  readonly onOpenThread: (ticket: WorkbenchTicket) => void;
}) {
  const draft = useWorkbenchDraftStore((state) => state.drafts.get(ticket.id));
  const setDraft = useWorkbenchDraftStore((state) => state.setDraft);
  const markDraftSaved = useWorkbenchDraftStore((state) => state.markDraftSaved);
  const clearDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  const thread = getWorkbenchThreadPresentation(assignment !== undefined, threadExists);
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

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetPopup className="max-w-xl max-sm:w-full max-sm:max-w-none">
        <form
          className="flex min-h-0 flex-1 flex-col"
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
          <SheetHeader className="border-b border-border pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}</Badge>
              {ticket.blocked ? (
                <Badge variant="warning">
                  <CircleAlertIcon /> Blocked
                </Badge>
              ) : null}
            </div>
            <SheetTitle className="leading-tight">
              {displayedTitle.trim() || ticket.title}
            </SheetTitle>
            <SheetDescription>Ticket delivery workspace</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
            {error ? <WorkbenchInlineError message={error} /> : null}
            <section className="space-y-3" aria-labelledby="ticket-details-heading">
              <div className="flex items-center justify-between gap-3">
                <h3 id="ticket-details-heading" className="text-sm font-semibold">
                  Overview
                </h3>
                {!editing ? (
                  <Button
                    disabled={pending}
                    onClick={startEditing}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <PencilIcon /> Edit
                  </Button>
                ) : null}
              </div>
              {editing ? (
                <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
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
                    <Label htmlFor="edit-workbench-ticket-context">Context</Label>
                    <Textarea
                      id="edit-workbench-ticket-context"
                      className="min-h-52"
                      placeholder="Goal, constraints, and acceptance criteria…"
                      value={draft.markdown}
                      onChange={(event) => {
                        setDraft(ticket.id, { ...draft, markdown: event.currentTarget.value });
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p
                    className={`whitespace-pre-wrap text-sm leading-relaxed ${
                      displayedMarkdown.trim().length > 0
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {displayedMarkdown.trim() || "No context added yet."}
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-3" aria-labelledby="ticket-delivery-heading">
              <h3 id="ticket-delivery-heading" className="text-sm font-semibold">
                Delivery
              </h3>
              <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <FolderGit2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Primary repository</p>
                    <p className="truncate text-sm font-medium">
                      {repository?.title ?? "Repository unavailable"}
                    </p>
                    {repository ? (
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {repository.workspaceRoot}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex min-w-0 items-start gap-3 border-t border-border pt-3">
                  {thread.state === "linked" ? (
                    <LinkIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
                  ) : thread.state === "missing" ? (
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                  ) : (
                    <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Agent Thread</p>
                    <p className="text-sm font-medium">{thread.stateLabel}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
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
          </div>

          <SheetFooter>
            {editing ? (
              <>
                <Button disabled={pending} onClick={cancelEditing} type="button" variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={pending || !dirty || draft.title.trim().length === 0}
                  type="submit"
                >
                  Save Ticket
                </Button>
              </>
            ) : (
              <Button
                disabled={pending}
                onClick={() => onOpenThread(actionableTicket)}
                type="button"
              >
                {thread.actionLabel}
                {thread.state === "linked" ? <LinkIcon /> : <BotIcon />}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetPopup>
    </Sheet>
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
