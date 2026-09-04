import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProjectId,
  type ThreadId,
  type WorkbenchEpic,
  WorkbenchEpicId,
  type WorkbenchJiraBinding,
  WorkbenchJiraBindingId,
  type WorkbenchJiraBoardConfiguration,
  type WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
  type WorkbenchTicketKind,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  BlocksIcon,
  FolderGit2Icon,
  Layers3Icon,
  LinkIcon,
  LayoutDashboardIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { isElectron } from "../env";
import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { randomUUID } from "../lib/utils";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  primaryServerProvidersAtom,
} from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorkbenchSearch } from "../routes/workbench";
import { openWorkbenchAssignedThread as openAssignedThreadWithRestore } from "./openWorkbenchAssignedThread";
import { workbenchEnvironment } from "./state";
import { useStartWorkbenchTicket } from "./useStartWorkbenchTicket";
import {
  getActiveAssignmentsByTicket,
  getAssignmentsForTicket,
  isWorkbenchThreadArchived,
} from "./workbench.logic";
import {
  WorkbenchTicketDetail,
  WorkbenchTicketDialog,
  WorkbenchEpicDetail,
  WorkbenchEpicDialog,
  WorkbenchWorkspaceDialog,
} from "./WorkbenchForms";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";
import { useWorkbenchDraftStore } from "./workbenchDraftStore";
import {
  WorkbenchJiraDialog,
  type WorkbenchJiraCreateDraft,
  type WorkbenchJiraUpdateDraft,
} from "./WorkbenchJiraDialog";
import {
  resolveWorkbenchJiraOAuthCallback,
  resolveWorkbenchTicketUpdateFields,
} from "./workbenchJira.logic";

interface WorkbenchPageProps {
  readonly createWorkspace: boolean;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly initialEpicId: WorkbenchEpicId | undefined;
  readonly jiraOAuthCode: string | undefined;
  readonly jiraOAuthState: string | undefined;
  readonly jiraOAuthError: string | undefined;
}

const JIRA_OAUTH_WORKSPACE_STORAGE_KEY = "t3code:workbench:jira-oauth-workspace";
const JIRA_BOARD_REFRESH_INTERVAL_MS = 15_000;

const jiraOAuthRedirectUri = () => new URL("/workbench", window.location.origin).toString();

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
  initialEpicId,
  jiraOAuthCode,
  jiraOAuthState,
  jiraOAuthError,
}: WorkbenchPageProps) {
  const environmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const allThreadShells = useThreadShells();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const navigate = useNavigate({ from: "/workbench" });
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const jiraQuery = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.jiraSnapshot({ environmentId, input: {} }),
  );
  const refreshWorkbenchSnapshot = query.refresh;
  const refreshJiraSnapshot = jiraQuery.refresh;
  const createProject = useAtomCommand(workbenchEnvironment.createProject, {
    reportFailure: false,
  });
  const createEpic = useAtomCommand(workbenchEnvironment.createEpic, { reportFailure: false });
  const updateEpic = useAtomCommand(workbenchEnvironment.updateEpic, { reportFailure: false });
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const updateTicket = useAtomCommand(workbenchEnvironment.updateTicket, { reportFailure: false });
  const jiraBeginAuth = useAtomCommand(workbenchEnvironment.jiraBeginAuth, {
    reportFailure: false,
  });
  const jiraCompleteAuth = useAtomCommand(workbenchEnvironment.jiraCompleteAuth, {
    reportFailure: false,
  });
  const jiraListProjects = useAtomCommand(workbenchEnvironment.jiraListProjects, {
    reportFailure: false,
  });
  const jiraListBoards = useAtomCommand(workbenchEnvironment.jiraListBoards, {
    reportFailure: false,
  });
  const jiraListSprints = useAtomCommand(workbenchEnvironment.jiraListSprints, {
    reportFailure: false,
  });
  const jiraGetBoardConfiguration = useAtomCommand(workbenchEnvironment.jiraGetBoardConfiguration, {
    reportFailure: false,
  });
  const jiraCreateBinding = useAtomCommand(workbenchEnvironment.jiraCreateBinding, {
    reportFailure: false,
  });
  const jiraUpdateBinding = useAtomCommand(workbenchEnvironment.jiraUpdateBinding, {
    reportFailure: false,
  });
  const jiraSyncBinding = useAtomCommand(workbenchEnvironment.jiraSyncBinding, {
    reportFailure: false,
  });
  const unarchiveThread = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const ticketDrafts = useWorkbenchDraftStore((state) => state.drafts);
  const clearTicketDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const repositoriesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const archivedEnvironmentIds = useMemo(
    () => (environmentId === null ? [] : [environmentId]),
    [environmentId],
  );
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const [selectedProjectId, setSelectedProjectId] = useState<WorkbenchProjectId | null>(
    initialProjectId ?? null,
  );
  const [selectedTicketId, setSelectedTicketId] = useState<WorkbenchTicketId | null>(
    initialTicketId ?? null,
  );
  const [selectedEpicId, setSelectedEpicId] = useState<WorkbenchEpicId | null>(
    initialEpicId ?? null,
  );
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketDialogEpicId, setTicketDialogEpicId] = useState<WorkbenchEpicId | null>(null);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [jiraDialogOpen, setJiraDialogOpen] = useState(false);
  const [boardGroupMode, setBoardGroupMode] = useState<"none" | "epic">("none");
  const [error, setError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraPendingAction, setJiraPendingAction] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [awaitingProjectId, setAwaitingProjectId] = useState<WorkbenchProjectId | null>(null);
  const [awaitingTicketId, setAwaitingTicketId] = useState<WorkbenchTicketId | null>(null);
  const [awaitingEpicId, setAwaitingEpicId] = useState<WorkbenchEpicId | null>(null);
  const handledJiraOAuthCallbackRef = useRef<string | null>(null);

  const snapshot = query.data;
  const snapshotProjects = snapshot?.projects ?? null;
  const jiraSnapshot = jiraQuery.data;
  useEffect(() => {
    for (const [ticketId, draft] of ticketDrafts) {
      if (draft.mode !== "saved") continue;
      const projectedTicket = snapshot?.tickets.find((ticket) => ticket.id === ticketId);
      if (projectedTicket?.title === draft.title && projectedTicket.markdown === draft.markdown) {
        clearTicketDraft(ticketId);
      }
    }
  }, [clearTicketDraft, snapshot?.tickets, ticketDrafts]);

  const awaitingSelectedProject =
    awaitingProjectId !== null &&
    awaitingProjectId === selectedProjectId &&
    !snapshot?.projects.some((project) => project.id === selectedProjectId);
  const selectedProject = awaitingSelectedProject
    ? null
    : (snapshot?.projects.find((project) => project.id === selectedProjectId) ??
      snapshot?.projects[0] ??
      null);
  const awaitingSelectedEpic =
    awaitingEpicId !== null &&
    awaitingEpicId === selectedEpicId &&
    !snapshot?.epics.some((epic) => epic.id === selectedEpicId);
  const selectedEpic = awaitingSelectedEpic
    ? null
    : (snapshot?.epics.find(
        (epic) => epic.id === selectedEpicId && epic.projectId === selectedProject?.id,
      ) ?? null);
  const jiraIssueLinksByTicketId = useMemo(
    () => new Map((jiraSnapshot?.issueLinks ?? []).map((link) => [link.ticketId, link])),
    [jiraSnapshot?.issueLinks],
  );
  const isTicketVisible = useCallback(
    (ticketId: WorkbenchTicketId) => jiraIssueLinksByTicketId.get(ticketId)?.active !== false,
    [jiraIssueLinksByTicketId],
  );
  const selectedTicket =
    snapshot?.tickets.find(
      (ticket) => ticket.id === selectedTicketId && ticket.projectId === selectedProject?.id,
    ) ?? null;
  const projectTickets = useMemo(
    () =>
      snapshot?.tickets.filter(
        (ticket) => ticket.projectId === selectedProject?.id && isTicketVisible(ticket.id),
      ) ?? [],
    [isTicketVisible, selectedProject?.id, snapshot?.tickets],
  );
  const selectedEpicTickets = useMemo(
    () => projectTickets.filter((ticket) => ticket.epicId === selectedEpic?.id),
    [projectTickets, selectedEpic?.id],
  );
  const assignmentsByTicket = useMemo(
    () => getActiveAssignmentsByTicket(snapshot?.assignments ?? []),
    [snapshot?.assignments],
  );
  const threadsById = useMemo(
    () =>
      new Map(
        allThreadShells
          .filter((thread) => thread.environmentId === environmentId)
          .map((thread) => [thread.id, thread]),
      ),
    [allThreadShells, environmentId],
  );
  const archivedThreadsById = useMemo(
    () =>
      new Map(
        archivedSnapshots.flatMap(({ environmentId: archivedEnvironmentId, snapshot }) =>
          snapshot.threads.map((thread) => [
            thread.id,
            { ...thread, environmentId: archivedEnvironmentId },
          ]),
        ),
      ),
    [archivedSnapshots],
  );
  const existingThreadIds = useMemo(
    () => new Set([...threadsById.keys(), ...archivedThreadsById.keys()]),
    [archivedThreadsById, threadsById],
  );
  const threadLookupReady = !archivedThreadsLoading && archivedThreadsError === null;
  const openAssignedThread = useCallback(
    async (threadId: ThreadId) => {
      if (environmentId === null) return;
      const archived = isWorkbenchThreadArchived(threadId, threadsById, archivedThreadsById);
      if (archived) {
        setPendingAction(`restore:${threadId}`);
        setError(null);
      }
      let result: Awaited<ReturnType<typeof openAssignedThreadWithRestore>>;
      try {
        result = await openAssignedThreadWithRestore(
          { environmentId, threadId, archived },
          {
            unarchive: unarchiveThread,
            refreshArchived: refreshArchivedThreads,
            navigate: () =>
              navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId },
              }),
          },
        );
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Workbench could not open the assigned Thread.",
        );
        return;
      } finally {
        if (archived) setPendingAction(null);
      }
      if (result.state === "restore-failed" && !isAtomCommandInterrupted(result.failure)) {
        refreshArchivedThreads();
        setError(failureMessage(result.failure));
        return;
      }
      if (result.state === "navigation-failed") {
        setError(
          result.cause instanceof Error && result.cause.message.trim().length > 0
            ? result.cause.message
            : "The Thread is ready, but Workbench could not open it.",
        );
      }
    },
    [
      archivedThreadsById,
      environmentId,
      navigate,
      refreshArchivedThreads,
      threadsById,
      unarchiveThread,
    ],
  );
  const openTicketThread = useStartWorkbenchTicket({
    environmentId,
    projects,
    providers,
    assignmentsByTicket,
    existingThreadIds,
    threadLookupReady,
    onRefreshThreadLookup: refreshArchivedThreads,
    onOpenAssignedThread: openAssignedThread,
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

  const updateEpicRouteSelection = (projectId: WorkbenchProjectId, epicId: WorkbenchEpicId) => {
    return navigate({
      to: "/workbench",
      search: { projectId, epicId },
      replace: true,
    });
  };

  const closeWorkItem = () => {
    setAwaitingTicketId(null);
    setAwaitingEpicId(null);
    setSelectedTicketId(null);
    setSelectedEpicId(null);
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
    setSelectedTicketId(null);
    setSelectedEpicId(null);
    await updateRouteSelection(id);
    return true;
  };

  const submitTicket = async (
    title: string,
    markdown: string,
    kind: WorkbenchTicketKind,
    epicId: WorkbenchEpicId | null,
    repositoryProjectIds: ReadonlyArray<ProjectId>,
    primaryProjectId: ProjectId,
  ) => {
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
        epicId,
        title,
        markdown,
        kind,
        repositoryProjectIds,
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
    setAwaitingEpicId(null);
    setSelectedTicketId(id);
    setSelectedEpicId(null);
    await updateRouteSelection(selectedProject.id, id);
    return true;
  };

  const updateTicketFields = async (
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
  ) => {
    if (environmentId === null) return false;
    const fields = resolveWorkbenchTicketUpdateFields({
      ticket,
      patch,
      jiraFieldsManaged: jiraManagedTicketIds.has(ticket.id),
    });
    setPendingAction(`update:${ticket.id}`);
    setError(null);
    const result = await updateTicket({
      environmentId,
      input: {
        id: ticket.id,
        ...fields,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return false;
    }
    return true;
  };

  const saveEpicContent = async (epic: WorkbenchEpic, title: string, markdown: string) => {
    if (environmentId === null || title.trim().length === 0) return false;
    setPendingAction(`update-epic:${epic.id}`);
    setError(null);
    const result = await updateEpic({
      environmentId,
      input: {
        id: epic.id,
        title: title.trim(),
        markdown: markdown.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return false;
    }
    return true;
  };

  const changeTicket = (
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
  ) => {
    void updateTicketFields(ticket, patch);
  };

  const ticketForBoardAction = (ticket: WorkbenchTicket) => {
    const draft = ticketDrafts.get(ticket.id);
    return draft?.mode === "saved"
      ? {
          ...ticket,
          title: jiraManagedTicketIds.has(ticket.id) ? ticket.title : draft.title,
          markdown: draft.markdown,
        }
      : ticket;
  };

  const saveTicketContent = (ticket: WorkbenchTicket, title: string, markdown: string) => {
    if (title.trim().length === 0) return Promise.resolve(false);
    return updateTicketFields(ticket, { title: title.trim(), markdown: markdown.trim() });
  };

  const submitEpic = async (title: string, markdown: string) => {
    if (environmentId === null || selectedProject === null) return false;
    setPendingAction("create-epic");
    setError(null);
    const id = WorkbenchEpicId.make(randomUUID());
    const result = await createEpic({
      environmentId,
      input: {
        id,
        projectId: selectedProject.id,
        title,
        markdown,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return false;
    }
    setAwaitingEpicId(id);
    setAwaitingTicketId(null);
    setSelectedEpicId(id);
    setSelectedTicketId(null);
    await updateEpicRouteSelection(selectedProject.id, id);
    return true;
  };

  const beginJiraAuthFlow = async () => {
    if (environmentId === null) return;
    setJiraPendingAction("authorize");
    setJiraError(null);
    const result = await jiraBeginAuth({
      environmentId,
      input: { redirectUri: jiraOAuthRedirectUri() },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return;
    }
    if (selectedProject) {
      sessionStorage.setItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY, selectedProject.id);
    }
    window.location.assign(result.value.authorizationUrl);
  };

  const listJiraProjectsForConnection = async (connectionId: WorkbenchJiraConnectionId) => {
    if (environmentId === null) return null;
    setJiraPendingAction("projects");
    setJiraError(null);
    const result = await jiraListProjects({ environmentId, input: { connectionId } });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const listJiraBoardsForProject = async (
    connectionId: WorkbenchJiraConnectionId,
    projectKeyOrId: string,
  ) => {
    if (environmentId === null) return null;
    setJiraPendingAction("boards");
    setJiraError(null);
    const result = await jiraListBoards({
      environmentId,
      input: { connectionId, projectKeyOrId },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const listJiraSprintsForBoard = async (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ) => {
    if (environmentId === null) return null;
    setJiraPendingAction("sprints");
    setJiraError(null);
    const result = await jiraListSprints({ environmentId, input: { connectionId, boardId } });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const getJiraBoardConfiguration = async (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ): Promise<WorkbenchJiraBoardConfiguration | null> => {
    if (environmentId === null) return null;
    setJiraPendingAction("configuration");
    setJiraError(null);
    const result = await jiraGetBoardConfiguration({
      environmentId,
      input: { connectionId, boardId },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const createJiraBindingForWorkspace = async (draft: WorkbenchJiraCreateDraft) => {
    if (environmentId === null || selectedProject === null) return false;
    setJiraPendingAction("create-binding");
    setJiraError(null);
    const result = await jiraCreateBinding({
      environmentId,
      input: {
        id: WorkbenchJiraBindingId.make(randomUUID()),
        projectId: selectedProject.id,
        connectionId: draft.connectionId,
        jiraProjectId: draft.jiraProject.id,
        jiraProjectKey: draft.jiraProject.key,
        jiraProjectName: draft.jiraProject.name,
        boardId: draft.board.id,
        boardName: draft.board.name,
        sprintId: draft.sprint.id,
        sprintName: draft.sprint.name,
        defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
        statusMappings: draft.statusMappings,
        createdAt: new Date().toISOString(),
      },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return false;
    }
    return true;
  };

  const updateJiraBindingForWorkspace = async (draft: WorkbenchJiraUpdateDraft) => {
    if (environmentId === null) return false;
    setJiraPendingAction("update-binding");
    setJiraError(null);
    const result = await jiraUpdateBinding({
      environmentId,
      input: {
        id: draft.binding.id,
        sprintId: draft.sprint.id,
        sprintName: draft.sprint.name,
        defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
        statusMappings: draft.statusMappings,
        active: draft.binding.active,
        updatedAt: new Date().toISOString(),
      },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return false;
    }
    return true;
  };

  const setJiraBindingActive = async (binding: WorkbenchJiraBinding, active: boolean) => {
    if (environmentId === null) return false;
    setJiraPendingAction(active ? "resume-binding" : "pause-binding");
    setJiraError(null);
    const result = await jiraUpdateBinding({
      environmentId,
      input: {
        id: binding.id,
        sprintId: binding.sprintId,
        sprintName: binding.sprintName,
        defaultPrimaryT3ProjectId: binding.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: binding.defaultRepositoryProjectIds,
        statusMappings: binding.statusMappings,
        active,
        updatedAt: new Date().toISOString(),
      },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return false;
    }
    return true;
  };

  const linkedT3Projects = selectedProject
    ? projects.filter((project) => selectedProject.linkedProjectIds.includes(project.id))
    : [];
  const projectEpics = selectedProject
    ? (snapshot?.epics.filter((epic) => epic.projectId === selectedProject.id) ?? [])
    : [];
  const activeProjectEpics = projectEpics.filter((epic) => epic.archivedAt === null);
  const effectiveBoardGroupMode = projectEpics.length > 0 ? boardGroupMode : "none";
  const jiraBinding =
    jiraSnapshot?.bindings.find((binding) => binding.projectId === selectedProject?.id) ?? null;
  const activeJiraTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).filter((link) => link.active).map((link) => link.ticketId),
  );
  const jiraManagedTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).map((link) => link.ticketId),
  );
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  const pending = pendingAction !== null;
  const boardIsOpen = selectedTicket === null && selectedEpic === null;

  useEffect(() => {
    if (!jiraBinding?.active || !boardIsOpen) return;
    const intervalId = window.setInterval(() => {
      refreshWorkbenchSnapshot();
      refreshJiraSnapshot();
    }, JIRA_BOARD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [boardIsOpen, jiraBinding?.active, refreshJiraSnapshot, refreshWorkbenchSnapshot]);

  const syncJiraBinding = async (binding: WorkbenchJiraBinding) => {
    if (environmentId === null) return;
    setJiraPendingAction("sync");
    setJiraError(null);
    const result = await jiraSyncBinding({
      environmentId,
      input: { bindingId: binding.id },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setJiraError(failureMessage(result));
    }
  };

  useEffect(() => {
    const callback = resolveWorkbenchJiraOAuthCallback({
      code: jiraOAuthCode,
      state: jiraOAuthState,
      error: jiraOAuthError,
    });
    if (callback === null) return;
    if (environmentId === null) return;
    if (snapshotProjects === null) return;
    const callbackKey = `${jiraOAuthCode ?? ""}:${jiraOAuthState ?? ""}:${jiraOAuthError ?? ""}`;
    if (handledJiraOAuthCallbackRef.current === callbackKey) return;
    handledJiraOAuthCallbackRef.current = callbackKey;

    void (async () => {
      setJiraPendingAction("complete-auth");
      setJiraError(null);
      let succeeded = false;
      if ("error" in callback) {
        setJiraError(callback.error);
      } else {
        const result = await jiraCompleteAuth({
          environmentId,
          input: {
            code: callback.code,
            state: callback.state,
            redirectUri: jiraOAuthRedirectUri(),
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
        } else {
          succeeded = true;
        }
      }
      setJiraPendingAction(null);

      const storedProjectId = sessionStorage.getItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      sessionStorage.removeItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      const callbackProject = snapshotProjects.find((project) => project.id === storedProjectId);
      if (callbackProject) setSelectedProjectId(callbackProject.id);
      await navigate({
        to: "/workbench",
        search: (previous: WorkbenchSearch): WorkbenchSearch => ({
          ...(callbackProject?.id || previous.projectId
            ? { projectId: callbackProject?.id ?? previous.projectId }
            : {}),
          ...(previous.ticketId
            ? { ticketId: previous.ticketId }
            : previous.epicId
              ? { epicId: previous.epicId }
              : {}),
          ...(previous.create ? { create: previous.create } : {}),
        }),
        replace: true,
      });
      if (succeeded || callbackProject) setJiraDialogOpen(true);
    })();
  }, [
    environmentId,
    jiraCompleteAuth,
    jiraOAuthCode,
    jiraOAuthError,
    jiraOAuthState,
    navigate,
    snapshotProjects,
  ]);

  useEffect(() => {
    // Route search is an external selection source and can change through browser history.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedProjectId(initialProjectId ?? null);
    setSelectedTicketId(initialTicketId ?? null);
    setSelectedEpicId(initialEpicId ?? null);
  }, [initialEpicId, initialProjectId, initialTicketId]);

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
    if (
      awaitingEpicId !== null &&
      awaitingEpicId === selectedEpicId &&
      !snapshot.epics.some((epic) => epic.id === awaitingEpicId)
    )
      return;
    if (selectedProject === null || pendingAction === "create-project") return;
    const ticketId = selectedTicket?.id ?? null;
    const epicId = ticketId === null ? (selectedEpic?.id ?? null) : null;
    if (
      selectedProject.id === selectedProjectId &&
      ticketId === selectedTicketId &&
      epicId === selectedEpicId
    )
      return;
    void navigate({
      to: "/workbench",
      search: ticketId
        ? { projectId: selectedProject.id, ticketId }
        : epicId
          ? { projectId: selectedProject.id, epicId }
          : { projectId: selectedProject.id },
      replace: true,
    });
  }, [
    navigate,
    awaitingProjectId,
    awaitingEpicId,
    awaitingTicketId,
    pendingAction,
    selectedProject,
    selectedProjectId,
    selectedEpic,
    selectedEpicId,
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
  const openTicketDialog = (epicId: WorkbenchEpicId | null = null) => {
    setError(null);
    setTicketDialogEpicId(epicId);
    setTicketDialogOpen(true);
  };
  const openEpicDialog = () => {
    setError(null);
    setEpicDialogOpen(true);
  };
  const openJiraDialog = () => {
    setJiraError(null);
    setJiraDialogOpen(true);
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
        ...(previous.ticketId
          ? { ticketId: previous.ticketId }
          : previous.epicId
            ? { epicId: previous.epicId }
            : {}),
      }),
      replace: true,
    });
  };
  const handleTicketDialogOpenChange = (open: boolean) => {
    setTicketDialogOpen(open);
    if (!open) setError(null);
  };
  const handleEpicDialogOpenChange = (open: boolean) => {
    setEpicDialogOpen(open);
    if (!open) setError(null);
  };
  const handleJiraDialogOpenChange = (open: boolean) => {
    setJiraDialogOpen(open);
    if (!open) setJiraError(null);
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
      ) : jiraSnapshot === null && jiraQuery.error ? (
        <WorkbenchRefreshError message={jiraQuery.error} onRetry={jiraQuery.refresh} />
      ) : jiraSnapshot === null ? (
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
          {selectedTicket ? (
            <WorkbenchTicketDetail
              key={selectedTicket.id}
              workspaceTitle={selectedProject.title}
              ticket={selectedTicket}
              ticketWorkspace={snapshot?.ticketWorkspaces.find(
                (workspace) => workspace.ticketId === selectedTicket.id,
              )}
              linkedProjects={linkedT3Projects}
              epics={projectEpics}
              jiraIssueLink={jiraIssueLinksByTicketId.get(selectedTicket.id) ?? null}
              jiraFieldsManaged={jiraManagedTicketIds.has(selectedTicket.id)}
              keybindings={keybindings}
              availableEditors={availableEditors}
              assignments={selectedAssignments}
              threadsById={threadsById}
              archivedThreadsById={archivedThreadsById}
              threadLookupReady={threadLookupReady}
              pending={pending}
              threadActionPending={
                pendingAction === `start:${selectedTicket.id}` ||
                (assignmentsByTicket.get(selectedTicket.id) !== undefined &&
                  pendingAction ===
                    `restore:${assignmentsByTicket.get(selectedTicket.id)?.threadId}`)
              }
              error={error ?? query.error ?? archivedThreadsError}
              onBack={() => {
                setError(null);
                closeWorkItem();
              }}
              onSave={saveTicketContent}
              onUpdate={changeTicket}
              onOpenEpic={(epicId) => {
                setAwaitingTicketId(null);
                setAwaitingEpicId(null);
                setSelectedTicketId(null);
                setSelectedEpicId(epicId);
                void updateEpicRouteSelection(selectedProject.id, epicId);
              }}
              onOpenThread={openTicketThread}
              onOpenAssignedThread={openAssignedThread}
            />
          ) : selectedEpic ? (
            <WorkbenchEpicDetail
              key={selectedEpic.id}
              workspaceTitle={selectedProject.title}
              epic={selectedEpic}
              jiraManagedTitle={
                jiraBinding !== null && selectedEpic.id.startsWith(`jira:${jiraBinding.id}:epic:`)
              }
              tickets={selectedEpicTickets}
              repositoriesById={repositoriesById}
              assignmentsByTicket={assignmentsByTicket}
              jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
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
          ) : (
            <>
              <WorkspacePageHeader
                electron={isElectron}
                className="h-auto min-h-20 items-start border-b border-border py-3"
              >
                <div className="flex w-full min-w-0 items-start justify-between gap-3">
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
                        <span
                          key={project.id}
                          className="flex min-w-0 max-w-72 items-center gap-1.5"
                        >
                          <span className="truncate">{project.title}</span>
                          <OpenInPicker
                            environmentId={project.environmentId}
                            keybindings={keybindings}
                            availableEditors={availableEditors}
                            openInCwd={project.workspaceRoot}
                            compact
                            enableShortcut={false}
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {jiraBinding ? (
                      <>
                        <Button
                          aria-label="Configure Jira sprint mirror"
                          onClick={openJiraDialog}
                          size="sm"
                          title={`${jiraBinding.jiraProjectKey} · ${jiraBinding.sprintName}`}
                          variant="outline"
                        >
                          <LinkIcon />
                          <span className="hidden max-w-40 truncate md:inline">
                            {jiraBinding.jiraProjectKey} · {jiraBinding.sprintName}
                          </span>
                          <Badge size="sm" variant={jiraBinding.active ? "secondary" : "outline"}>
                            {jiraBinding.active ? "Jira" : "Jira paused"}
                          </Badge>
                        </Button>
                        <Button
                          aria-label="Sync Jira sprint"
                          disabled={jiraPendingAction !== null || !jiraBinding.active}
                          onClick={() => void syncJiraBinding(jiraBinding)}
                          size="icon-sm"
                          title={
                            jiraBinding.active ? "Sync Jira sprint" : "Jira mirror is inactive"
                          }
                          variant="outline"
                        >
                          <RefreshCwIcon />
                        </Button>
                      </>
                    ) : (
                      <Button
                        aria-label="Connect Jira"
                        onClick={openJiraDialog}
                        size="sm"
                        variant="outline"
                      >
                        <LinkIcon />
                        <span className="hidden md:inline">Connect Jira</span>
                      </Button>
                    )}
                    <Button
                      aria-label="New Epic"
                      onClick={openEpicDialog}
                      size="sm"
                      variant="outline"
                    >
                      <Layers3Icon />
                      <span className="hidden sm:inline">New Epic</span>
                    </Button>
                    <Button aria-label="New Ticket" onClick={() => openTicketDialog()} size="sm">
                      <PlusIcon />
                      <span className="hidden sm:inline">New Ticket</span>
                    </Button>
                  </div>
                </div>
              </WorkspacePageHeader>

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
                  {projectEpics.length > 0 ? (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="hidden text-xs text-muted-foreground sm:inline">Group</span>
                      <ToggleGroup
                        aria-label="Group Board tickets"
                        size="sm"
                        value={[effectiveBoardGroupMode]}
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
                <WorkbenchTicketBoard
                  projectId={selectedProject.id}
                  tickets={projectTickets}
                  epics={projectEpics}
                  groupMode={effectiveBoardGroupMode}
                  jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
                  activeJiraTicketIds={activeJiraTicketIds}
                  jiraManagedTicketIds={jiraManagedTicketIds}
                  selectedTicketId={null}
                  repositoriesById={repositoriesById}
                  assignmentsByTicket={assignmentsByTicket}
                  threadsById={threadsById}
                  archivedThreadsById={archivedThreadsById}
                  threadLookupReady={threadLookupReady}
                  pending={pending}
                  pendingAction={pendingAction}
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
                    if (jiraManagedTicketIds.has(ticket.id)) return;
                    changeTicket(ticketForBoardAction(ticket), { status });
                  }}
                  onOpenThread={(ticket) => openTicketThread(ticketForBoardAction(ticket))}
                  onCreateTicket={() => openTicketDialog()}
                />
              </div>
            </>
          )}
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
        <WorkbenchJiraDialog
          key={`${selectedProject.id}:${jiraBinding?.id ?? "new-jira-binding"}`}
          open={jiraDialogOpen}
          connections={jiraSnapshot?.connections ?? []}
          existingBinding={jiraBinding}
          linkedProjects={linkedT3Projects}
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
          initialEpicId={ticketDialogEpicId}
          pending={pending}
          error={error ?? query.error}
          onOpenChange={handleTicketDialogOpenChange}
          onCreate={submitTicket}
        />
      ) : null}
    </div>
  );
}
