import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  BlocksIcon,
  FolderGit2Icon,
  LayoutDashboardIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
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
import { isElectron } from "../env";
import { randomUUID } from "../lib/utils";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadRefs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { primaryServerProvidersAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorkbenchSearch } from "../routes/workbench";
import { workbenchEnvironment } from "./state";
import { useStartWorkbenchTicket } from "./useStartWorkbenchTicket";
import {
  WorkbenchTicketDetail,
  WorkbenchTicketDialog,
  WorkbenchWorkspaceDialog,
} from "./WorkbenchForms";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";

interface WorkbenchPageProps {
  readonly createWorkspace: boolean;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
}

const failureMessage = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Workbench request failed.";
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
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 p-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-full min-h-72 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function WorkbenchRefreshError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertCircleIcon />
        </EmptyMedia>
        <EmptyTitle>Workbench couldn&apos;t refresh</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onRetry} variant="outline">
          <RefreshCwIcon /> Retry
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function WorkbenchPage({
  createWorkspace,
  initialProjectId,
  initialTicketId,
}: WorkbenchPageProps) {
  const environmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const threadRefs = useThreadRefs();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const navigate = useNavigate({ from: "/workbench" });
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const createProject = useAtomCommand(workbenchEnvironment.createProject, {
    reportFailure: false,
  });
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const updateTicket = useAtomCommand(workbenchEnvironment.updateTicket, { reportFailure: false });
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const repositoriesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<WorkbenchProjectId | null>(
    initialProjectId ?? null,
  );
  const [selectedTicketId, setSelectedTicketId] = useState<WorkbenchTicketId | null>(
    initialTicketId ?? null,
  );
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [awaitingProjectId, setAwaitingProjectId] = useState<WorkbenchProjectId | null>(null);
  const [awaitingTicketId, setAwaitingTicketId] = useState<WorkbenchTicketId | null>(null);

  const snapshot = query.data;
  const awaitingSelectedProject =
    awaitingProjectId !== null &&
    awaitingProjectId === selectedProjectId &&
    !snapshot?.projects.some((project) => project.id === selectedProjectId);
  const selectedProject = awaitingSelectedProject
    ? null
    : (snapshot?.projects.find((project) => project.id === selectedProjectId) ??
      snapshot?.projects[0] ??
      null);
  const selectedTicket =
    snapshot?.tickets.find(
      (ticket) => ticket.id === selectedTicketId && ticket.projectId === selectedProject?.id,
    ) ?? null;
  const projectTickets = useMemo(
    () => snapshot?.tickets.filter((ticket) => ticket.projectId === selectedProject?.id) ?? [],
    [selectedProject?.id, snapshot?.tickets],
  );
  const assignmentsByTicket = useMemo(
    () =>
      new Map(snapshot?.assignments.map((assignment) => [assignment.ticketId, assignment]) ?? []),
    [snapshot?.assignments],
  );
  const existingThreadIds = useMemo(
    () =>
      new Set(
        threadRefs.filter((ref) => ref.environmentId === environmentId).map((ref) => ref.threadId),
      ),
    [environmentId, threadRefs],
  );
  const openTicketThread = useStartWorkbenchTicket({
    environmentId,
    projects,
    providers,
    assignmentsByTicket,
    existingThreadIds,
    onPendingChange: setPendingAction,
    onError: setError,
  });

  const updateRouteSelection = (projectId: WorkbenchProjectId, ticketId?: WorkbenchTicketId) => {
    return navigate({
      to: "/workbench",
      search: ticketId === undefined ? { projectId } : { projectId, ticketId },
      replace: true,
    });
  };

  const closeTicket = () => {
    setAwaitingTicketId(null);
    setSelectedTicketId(null);
    if (selectedProject) void updateRouteSelection(selectedProject.id);
  };

  const submitProject = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (environmentId === null) return false;
    setPendingAction("create-project");
    setError(null);
    const id = WorkbenchProjectId.make(randomUUID());
    const result = await createProject({
      environmentId,
      input: {
        id,
        title,
        linkedProjectIds,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return false;
    }
    setAwaitingProjectId(id);
    setSelectedProjectId(id);
    await updateRouteSelection(id);
    return true;
  };

  const submitTicket = async (title: string, markdown: string, primaryProjectId: ProjectId) => {
    if (environmentId === null || selectedProject === null) return false;
    setPendingAction("create-ticket");
    setError(null);
    const id = WorkbenchTicketId.make(randomUUID());
    const primaryProject = projects.find((project) => project.id === primaryProjectId);
    if (!primaryProject) {
      setPendingAction(null);
      setError("The selected T3 Project is no longer available.");
      return false;
    }
    const result = await createTicket({
      environmentId,
      input: {
        id,
        projectId: selectedProject.id,
        title,
        markdown,
        primaryT3ProjectId: primaryProject.id,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return false;
    }
    setAwaitingTicketId(id);
    setSelectedTicketId(id);
    await updateRouteSelection(selectedProject.id, id);
    return true;
  };

  const updateTicketFields = (
    ticket: WorkbenchTicket,
    patch: Partial<Pick<WorkbenchTicket, "title" | "markdown" | "status" | "blocked">>,
  ) => {
    if (environmentId === null) return;
    void (async () => {
      setPendingAction(`update:${ticket.id}`);
      setError(null);
      const result = await updateTicket({
        environmentId,
        input: {
          id: ticket.id,
          title: patch.title ?? ticket.title,
          markdown: patch.markdown ?? ticket.markdown,
          status: patch.status ?? ticket.status,
          blocked: patch.blocked ?? ticket.blocked,
          updatedAt: new Date().toISOString(),
        },
      });
      setPendingAction(null);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setError(failureMessage(result));
      }
    })();
  };

  const changeTicket = (
    ticket: WorkbenchTicket,
    patch: Partial<Pick<WorkbenchTicket, "status" | "blocked">>,
  ) => updateTicketFields(ticket, patch);

  const saveTicketContent = (ticket: WorkbenchTicket, title: string, markdown: string) => {
    if (title.trim().length === 0) return;
    updateTicketFields(ticket, { title: title.trim(), markdown: markdown.trim() });
  };

  const linkedT3Projects = selectedProject
    ? projects.filter((project) => selectedProject.linkedProjectIds.includes(project.id))
    : [];
  const selectedAssignment = selectedTicket
    ? assignmentsByTicket.get(selectedTicket.id)
    : undefined;
  const selectedThreadExists = selectedAssignment
    ? existingThreadIds.has(selectedAssignment.threadId)
    : false;
  const pending = pendingAction !== null;

  useEffect(() => {
    // Route search is an external selection source and can change through browser history.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedProjectId(initialProjectId ?? null);
    setSelectedTicketId(initialTicketId ?? null);
  }, [initialProjectId, initialTicketId]);

  useEffect(() => {
    if (snapshot === null) return;
    if (
      awaitingProjectId !== null &&
      awaitingProjectId === selectedProjectId &&
      !snapshot.projects.some((project) => project.id === awaitingProjectId)
    )
      return;
    if (
      awaitingTicketId !== null &&
      awaitingTicketId === selectedTicketId &&
      !snapshot.tickets.some((ticket) => ticket.id === awaitingTicketId)
    )
      return;
    if (selectedProject === null || pendingAction === "create-project") return;
    const ticketId = selectedTicket?.id ?? null;
    if (selectedProject.id === selectedProjectId && ticketId === selectedTicketId) return;
    void navigate({
      to: "/workbench",
      search: ticketId
        ? { projectId: selectedProject.id, ticketId }
        : { projectId: selectedProject.id },
      replace: true,
    });
  }, [
    navigate,
    awaitingProjectId,
    awaitingTicketId,
    pendingAction,
    selectedProject,
    selectedProjectId,
    selectedTicket,
    selectedTicketId,
    snapshot,
  ]);

  const openWorkspaceDialog = () => {
    setError(null);
    void navigate({
      to: "/workbench",
      search: selectedProject
        ? { projectId: selectedProject.id, create: "workspace" }
        : { create: "workspace" },
      replace: true,
    });
  };
  const openTicketDialog = () => {
    setError(null);
    setTicketDialogOpen(true);
  };
  const handleWorkspaceDialogOpenChange = (open: boolean) => {
    if (open) {
      openWorkspaceDialog();
      return;
    }
    setError(null);
    void navigate({
      to: "/workbench",
      search: (previous: WorkbenchSearch): WorkbenchSearch => ({
        ...(previous.projectId ? { projectId: previous.projectId } : {}),
        ...(previous.ticketId ? { ticketId: previous.ticketId } : {}),
      }),
      replace: true,
    });
  };
  const handleTicketDialogOpenChange = (open: boolean) => {
    setTicketDialogOpen(open);
    if (!open) setError(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {environmentId === null ? (
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
      ) : query.isPending && snapshot === null ? (
        <WorkbenchLoading />
      ) : awaitingSelectedProject && query.error ? (
        <WorkbenchRefreshError message={query.error} onRetry={query.refresh} />
      ) : awaitingSelectedProject ? (
        <WorkbenchLoading />
      ) : selectedProject === null ? (
        <div className="relative min-h-0 flex-1">
          {query.error ? (
            <div className="absolute inset-x-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground">
              <AlertCircleIcon className="size-4" />
              <span className="min-w-0 flex-1">{query.error}</span>
              <Button onClick={query.refresh} size="xs" variant="outline">
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : null}
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboardIcon />
              </EmptyMedia>
              <EmptyTitle>Create your first Workbench Workspace</EmptyTitle>
              <EmptyDescription>
                Group tickets around the repositories and native Agent Threads that deliver them.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openWorkspaceDialog}>
                <PlusIcon /> Create Workspace
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspacePageHeader
            electron={isElectron}
            className="h-auto min-h-20 items-start border-b border-border py-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate font-heading text-xl font-semibold">
                    {selectedProject.title}
                  </h2>
                  <Badge variant="secondary">{projectTickets.length} tickets</Badge>
                </div>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium">
                    <FolderGit2Icon className="size-3.5" /> Repositories
                  </span>
                  {linkedT3Projects.map((project) => (
                    <span key={project.id} className="max-w-60 truncate">
                      {project.title}
                    </span>
                  ))}
                </div>
              </div>
              <Button aria-label="New Ticket" onClick={openTicketDialog} size="sm">
                <PlusIcon />
                <span className="hidden sm:inline">New Ticket</span>
              </Button>
            </div>
          </WorkspacePageHeader>

          {query.error || error ? (
            <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground sm:mx-4">
              <AlertCircleIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error ?? query.error}</span>
              {query.error ? (
                <Button onClick={query.refresh} size="xs" variant="outline">
                  <RefreshCwIcon /> Retry
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-4 text-sm sm:px-5">
              <LayoutDashboardIcon className="size-4 text-muted-foreground" />
              <span className="font-semibold">Board</span>
              {projectTickets.some((ticket) => ticket.blocked) ? (
                <Badge className="ml-1" variant="warning">
                  <AlertCircleIcon />
                  {projectTickets.filter((ticket) => ticket.blocked).length} blocked
                </Badge>
              ) : null}
            </div>
            <WorkbenchTicketBoard
              projectId={selectedProject.id}
              tickets={projectTickets}
              selectedTicketId={selectedTicket?.id ?? null}
              repositoriesById={repositoriesById}
              assignmentsByTicket={assignmentsByTicket}
              existingThreadIds={existingThreadIds}
              pending={pending}
              onSelect={(projectId, ticketId) => {
                setAwaitingTicketId(null);
                setSelectedTicketId(ticketId);
                void updateRouteSelection(projectId, ticketId);
              }}
              onOpenThread={openTicketThread}
              onCreateTicket={openTicketDialog}
            />
          </div>
        </main>
      )}

      <WorkbenchWorkspaceDialog
        open={createWorkspace}
        projects={projects}
        pending={pending}
        error={error ?? query.error}
        onOpenChange={handleWorkspaceDialogOpenChange}
        onCreate={submitProject}
      />
      {selectedProject ? (
        <WorkbenchTicketDialog
          open={ticketDialogOpen}
          linkedProjects={linkedT3Projects}
          pending={pending}
          error={error ?? query.error}
          onOpenChange={handleTicketDialogOpenChange}
          onCreate={submitTicket}
        />
      ) : null}
      {selectedTicket ? (
        <WorkbenchTicketDetail
          key={selectedTicket.id}
          ticket={selectedTicket}
          repository={repositoriesById.get(selectedTicket.primaryT3ProjectId)}
          assignment={selectedAssignment}
          threadExists={selectedThreadExists}
          pending={pending}
          error={error ?? query.error}
          onOpenChange={(open) => {
            if (!open) {
              setError(null);
              closeTicket();
            }
          }}
          onSave={saveTicketContent}
          onUpdate={changeTicket}
          onOpenThread={openTicketThread}
        />
      ) : null}
    </div>
  );
}
