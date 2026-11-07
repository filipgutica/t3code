import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { CheckIcon, LinkIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
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
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import {
  WorkbenchThreadRepositoryPicker,
  getWorkbenchRepositoryTitle,
} from "./WorkbenchThreadRepositoryPicker";

type LinkableThread = Pick<
  EnvironmentThreadShell,
  "id" | "title" | "projectId" | "branch" | "worktreePath"
>;
type RepositoryProject = Pick<EnvironmentProject, "id" | "title" | "workspaceRoot">;
type LinkTicket = Pick<WorkbenchTicket, "repositoryProjectIds">;

/**
 * What Link does with the Thread; the server decides again. A Thread in a Ticket worktree links as
 * it is. Any other is forked into its own repository's worktree, or one the user picks.
 */
const getWorkbenchLinkTarget = ({
  thread,
  ticket,
  workspace,
  pickedRepositoryId,
}: {
  readonly thread: LinkableThread;
  readonly ticket: LinkTicket;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly pickedRepositoryId: ProjectId | null;
}) => {
  const runsInTicketWorktree = (workspace?.repositories ?? []).some(
    (repository) =>
      repository.status === "ready" &&
      repository.projectId === thread.projectId &&
      repository.worktreePath === thread.worktreePath,
  );
  if (runsInTicketWorktree) {
    return { kind: "direct", repositoryProjectId: thread.projectId, picked: false } as const;
  }
  if (ticket.repositoryProjectIds.includes(thread.projectId)) {
    return { kind: "fork", repositoryProjectId: thread.projectId, picked: false } as const;
  }
  return {
    kind: "fork",
    repositoryProjectId: pickedRepositoryId ?? ticket.repositoryProjectIds[0] ?? null,
    picked: true,
  } as const;
};

/** Says that uncommitted changes stay behind, naming the source's branch when it has some. */
function WorkbenchForkSourceChanges({
  environmentId,
  cwd,
  branch,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly branch: string | null;
}) {
  const { data: status } = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId, input: { cwd } }),
  );
  if (!status?.hasWorkingTreeChanges) {
    return <p>Uncommitted changes in its worktree don’t move to the fork.</p>;
  }
  const name = status.refName ?? branch;
  return (
    <p role="status" className="text-warning">
      {name ? `${name} has uncommitted changes.` : "Its worktree has uncommitted changes."} They
      stay in the original worktree and don’t move to the fork.
    </p>
  );
}

function WorkbenchLinkDetails({
  environmentId,
  thread,
  ticket,
  workspace,
  projects,
  target,
  pending,
  onPickRepository,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: LinkableThread;
  readonly ticket: LinkTicket;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly target: ReturnType<typeof getWorkbenchLinkTarget>;
  readonly pending: boolean;
  readonly onPickRepository: (id: ProjectId) => void;
}) {
  const { repositoryProjectId, picked } = target;
  const ticketRepositories = projects.filter((project) =>
    ticket.repositoryProjectIds.includes(project.id),
  );
  const sourceCwd =
    thread.worktreePath ??
    projects.find((project) => project.id === thread.projectId)?.workspaceRoot;
  return (
    <>
      <WorkbenchLinkSource thread={thread} projects={projects} direct={target.kind === "direct"} />
      {target.kind === "fork" ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          {picked ? (
            <WorkbenchThreadRepositoryPicker
              ticketRepositoryIds={ticket.repositoryProjectIds}
              projects={ticketRepositories}
              workspace={workspace}
              value={repositoryProjectId}
              disabled={pending}
              onChange={onPickRepository}
            />
          ) : null}
          <p>
            Links a fork that works in the{" "}
            {getWorkbenchRepositoryTitle(ticketRepositories, repositoryProjectId)} Ticket worktree.
            The original Thread stays where it is.
          </p>
          <p>A fork needs a completed turn with a checkpoint.</p>
          {sourceCwd ? (
            <WorkbenchForkSourceChanges
              environmentId={environmentId}
              cwd={sourceCwd}
              branch={thread.branch}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function WorkbenchLinkThreadList({
  threads,
  projects,
  selectedId,
  pending,
  onSelect,
}: {
  readonly threads: ReadonlyArray<LinkableThread>;
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly selectedId: ThreadId | null;
  readonly pending: boolean;
  readonly onSelect: (id: ThreadId) => void;
}) {
  const [search, setSearch] = useState("");
  const matching = threads.filter((thread) =>
    thread.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Input
        aria-label="Find a Thread"
        placeholder="Find a Thread…"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="max-h-72 space-y-1 overflow-x-hidden overflow-y-auto">
        {matching.map((thread) => {
          const repository = getWorkbenchRepositoryTitle(projects, thread.projectId);
          const selected = selectedId === thread.id;
          return (
            <Button
              key={thread.id}
              className="w-full min-w-0 justify-start"
              aria-label={[thread.title, repository, thread.branch].filter(Boolean).join(", ")}
              aria-pressed={selected}
              variant={selected ? "secondary" : "ghost"}
              disabled={pending}
              onClick={() => onSelect(thread.id)}
            >
              <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
              <span className="max-w-32 truncate text-xs text-muted-foreground">{repository}</span>
              {selected ? <CheckIcon aria-hidden="true" /> : null}
            </Button>
          );
        })}
        {matching.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {threads.length === 0
              ? "No Threads are available to link. Create a Thread instead."
              : "No Threads match your search."}
          </p>
        ) : null}
      </div>
    </>
  );
}

function WorkbenchLinkSource({
  thread,
  projects,
  direct,
}: {
  readonly thread: LinkableThread;
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly direct: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <p className="text-muted-foreground">Selected Thread</p>
      <p className="break-words">{thread.title}</p>
      <p className="break-words text-muted-foreground">
        {[getWorkbenchRepositoryTitle(projects, thread.projectId), thread.branch]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {direct ? <p>Links this Thread as it is.</p> : null}
    </div>
  );
}

export function WorkbenchAttachThreadDialog({
  environmentId,
  ticket,
  workspace,
  projects,
  threads,
  pending,
  disabled,
  error,
  onClose,
  onAttach,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: LinkTicket;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly threads: ReadonlyArray<LinkableThread>;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onAttach: (threadId: ThreadId, repositoryProjectId?: ProjectId) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const [pickedRepositoryId, setPickedRepositoryId] = useState<ProjectId | null>(null);
  const selected = threads.find((thread) => thread.id === selectedId);
  const target = selected
    ? getWorkbenchLinkTarget({ thread: selected, ticket, workspace, pickedRepositoryId })
    : null;
  const repositoryProjectId = target?.repositoryProjectId ?? null;
  const canLink = !disabled && !pending && selected !== undefined && repositoryProjectId !== null;
  const attachSelectedThread = () => {
    if (!canLink) return;
    // Only a picked repository is sent; otherwise the server uses the Thread's own.
    void onAttach(selected.id, target?.picked ? repositoryProjectId : undefined);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="min-w-0 max-w-lg">
        <DialogHeader>
          <DialogTitle>Link existing Thread</DialogTitle>
          <DialogDescription>
            Choose an unassigned Thread. Threads outside this Ticket’s worktrees are forked; the
            original stays where it is. No prompt is sent.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-w-0">
          <div className="space-y-3">
            <WorkbenchLinkThreadList
              threads={threads}
              projects={projects}
              selectedId={selectedId}
              pending={pending}
              onSelect={setSelectedId}
            />
            {selected && target && (
              <WorkbenchLinkDetails
                environmentId={environmentId}
                thread={selected}
                ticket={ticket}
                workspace={workspace}
                projects={projects}
                target={target}
                pending={pending}
                onPickRepository={setPickedRepositoryId}
              />
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <p role="status" className="sr-only">
            {pending ? "Linking Thread…" : null}
          </p>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button className="[&_svg]:mx-0" disabled={!canLink} onClick={attachSelectedThread}>
            <LinkIcon /> {pending ? "Linking…" : "Link Thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
