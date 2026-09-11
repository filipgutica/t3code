import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProjectId,
  type WorkbenchAssignment,
  WorkbenchAssignmentId,
  type ModelSelection,
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
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  AlertCircleIcon,
  BlocksIcon,
  FolderGit2Icon,
  Layers3Icon,
  LinkIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Settings2Icon,
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
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useThreadActions } from "../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { randomUUID } from "../lib/utils";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorkbenchSearch } from "./workbenchSearch";
import { openWorkbenchAssignedThread as openAssignedThreadWithRestore } from "./openWorkbenchAssignedThread";
import { workbenchEnvironment } from "./state";
import { useStartWorkbenchTicket } from "./useStartWorkbenchTicket";
import { subscribeToWorkbenchRefresh } from "./workbenchRefresh";
import { withWorkbenchEnvironmentSearch } from "./workbenchNavigation";
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
import type { WorkbenchJiraTransitionSelection } from "./WorkbenchTicketStatusMenu";
import { WorkbenchAttachThreadDialog } from "./WorkbenchAttachThreadDialog";
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";
import {
  isWorkbenchDraftProjected,
  useWorkbenchDraftStore,
  type WorkbenchTicketDraft,
  type WorkbenchTicketSavedVersion,
} from "./workbenchDraftStore";
import {
  WorkbenchJiraDialog,
  type WorkbenchJiraCreateDraft,
  type WorkbenchJiraUpdateDraft,
} from "./WorkbenchJiraDialog";
import {
  getWorkbenchJiraBindingSprints,
  resolveWorkbenchJiraOAuthCallback,
  resolveWorkbenchJiraRedirectUri,
  resolveWorkbenchTicketContent,
  resolveWorkbenchTicketUpdateFields,
} from "./workbenchJira.logic";

interface WorkbenchPageProps {
  readonly initialEnvironmentId: EnvironmentId | undefined;
  readonly createWorkspace: boolean;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly initialEpicId: WorkbenchEpicId | undefined;
  readonly jiraOAuthCode: string | undefined;
  readonly jiraOAuthState: string | undefined;
  readonly jiraOAuthError: string | undefined;
}

const JIRA_OAUTH_WORKSPACE_STORAGE_KEY = "t3code:workbench:jira-oauth-workspace";
const JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY = "t3code:workbench:jira-oauth-environment";
const JIRA_REFRESH_INTERVAL_MS = 15_000;
const EMPTY_TICKET_DRAFTS = new Map<WorkbenchTicketId, WorkbenchTicketDraft>();
const isEnvironmentId = Schema.is(EnvironmentId);

const readPendingJiraEnvironmentId = (): EnvironmentId | null => {
  try {
    const value = sessionStorage.getItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY);
    return value !== null && isEnvironmentId(value) ? value : null;
  } catch {
    return null;
  }
};

const jiraOAuthRedirectUri = ({ serverHttpUrl }: { readonly serverHttpUrl: string }) =>
  resolveWorkbenchJiraRedirectUri({
    desktop: isElectron,
    browserOrigin: window.location.origin,
    serverHttpUrl,
  });

const failureMessage = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Workbench request failed.";
};

const reportWorkbenchCommandFailure = <A, E>(
  result: AtomCommandResult<A, E>,
  setError: (message: string) => void,
): result is Extract<AtomCommandResult<A, E>, { readonly _tag: "Failure" }> => {
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
  return true;
};

const launchJiraAuthorization = async ({
  authorizationUrl,
  environmentId,
  selectedProjectId,
  setError,
}: {
  readonly authorizationUrl: string;
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: WorkbenchProjectId | null;
  readonly setError: (message: string) => void;
}) => {
  if (isElectron) {
    try {
      const api = readLocalApi();
      if (!api) throw new Error("The desktop browser launcher is unavailable.");
      await api.shell.openExternal(authorizationUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open Jira authorization.");
    }
    return;
  }
  if (selectedProjectId !== null) {
    sessionStorage.setItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY, selectedProjectId);
  }
  sessionStorage.setItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY, environmentId);
  window.location.assign(authorizationUrl);
};

const resolveJiraOAuthReturnSearch = ({
  previous,
  environmentId,
  storedEnvironmentId,
  projectId,
}: {
  readonly previous: WorkbenchSearch;
  readonly environmentId: EnvironmentId;
  readonly storedEnvironmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | undefined;
}): WorkbenchSearch => {
  const nextEnvironmentId = environmentId ?? storedEnvironmentId ?? previous.environmentId;
  const nextProjectId = projectId ?? previous.workbenchProjectId;
  return {
    ...(nextEnvironmentId ? { environmentId: nextEnvironmentId } : {}),
    ...(nextProjectId ? { workbenchProjectId: nextProjectId } : {}),
    ...(previous.ticketId
      ? { ticketId: previous.ticketId }
      : previous.epicId
        ? { epicId: previous.epicId }
        : {}),
    ...(previous.create ? { create: previous.create } : {}),
  };
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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
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
  initialEnvironmentId,
  createWorkspace,
  initialProjectId,
  initialTicketId,
  initialEpicId,
  jiraOAuthCode,
  jiraOAuthState,
  jiraOAuthError,
}: WorkbenchPageProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hasJiraOAuthCallback =
    jiraOAuthCode !== undefined || jiraOAuthState !== undefined || jiraOAuthError !== undefined;
  const environmentId =
    initialEnvironmentId ??
    (hasJiraOAuthCallback ? readPendingJiraEnvironmentId() : null) ??
    primaryEnvironmentId;
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const resolveJiraOAuthRedirectUri = useCallback(() => {
    if (isElectron && environmentHttpBaseUrl === null) return null;
    return jiraOAuthRedirectUri({
      // Web callbacks use the browser origin. Desktop requires the selected
      // environment's server URL; never redirect a secondary environment to
      // the primary server by fallback.
      serverHttpUrl: environmentHttpBaseUrl ?? window.location.origin,
    });
  }, [environmentHttpBaseUrl]);
  const allProjects = useProjects();
  const allThreadShells = useThreadShells();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const providers = serverConfig?.providers ?? [];
  const keybindings = serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const availableEditors = serverConfig?.availableEditors ?? [];
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
  const updateProject = useAtomCommand(workbenchEnvironment.updateProject, {
    reportFailure: false,
  });
  const createEpic = useAtomCommand(workbenchEnvironment.createEpic, { reportFailure: false });
  const updateEpic = useAtomCommand(workbenchEnvironment.updateEpic, { reportFailure: false });
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const updateTicket = useAtomCommand(workbenchEnvironment.updateTicket, { reportFailure: false });
  const regenerateTicketSummary = useAtomCommand(workbenchEnvironment.regenerateTicketSummary, {
    reportFailure: false,
  });
  const updateJiraTicket = useAtomCommand(workbenchEnvironment.jiraUpdateTicket, {
    reportFailure: false,
  });
  const archiveTicket = useAtomCommand(workbenchEnvironment.archiveTicket, {
    reportFailure: false,
  });
  const deleteTicket = useAtomCommand(workbenchEnvironment.deleteTicket, {
    reportFailure: false,
  });
  const releaseTicketWorkspace = useAtomCommand(workbenchEnvironment.releaseTicketWorkspace, {
    reportFailure: false,
  });
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
  const attachAssignment = useAtomCommand(workbenchEnvironment.createAssignment, {
    reportFailure: false,
  });
  const { confirmAndDeleteThread } = useThreadActions();
  const ticketDrafts = useWorkbenchDraftStore((state) =>
    environmentId === null
      ? EMPTY_TICKET_DRAFTS
      : (state.drafts.get(environmentId) ?? EMPTY_TICKET_DRAFTS),
  );
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
  const [editWorkspaceOpen, setEditWorkspaceOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketDialogEpicId, setTicketDialogEpicId] = useState<WorkbenchEpicId | null>(null);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [jiraDialogOpen, setJiraDialogOpen] = useState(false);
  const [boardGroupMode, setBoardGroupMode] = useState<"none" | "epic">("none");
  const [error, setError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraPendingAction, setJiraPendingAction] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [startThreadRequest, setStartThreadRequest] = useState<{
    ticket: WorkbenchTicket;
    assignment?: WorkbenchAssignment;
    mode?: "additional" | "replace";
    previousThreadId?: ThreadId;
  } | null>(null);
  const [attachThreadTicket, setAttachThreadTicket] = useState<WorkbenchTicket | null>(null);
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
      if (
        isWorkbenchDraftProjected({
          draft,
          ticket: projectedTicket,
          jiraRemoteUpdatedAt: jiraSnapshot?.issueLinks.find((link) => link.ticketId === ticketId)
            ?.issue.remoteUpdatedAt,
        })
      ) {
        if (environmentId !== null) clearTicketDraft(environmentId, ticketId);
      }
    }
  }, [clearTicketDraft, environmentId, jiraSnapshot?.issueLinks, snapshot?.tickets, ticketDrafts]);

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
    (ticket: WorkbenchTicket) =>
      ticket.archivedAt == null && jiraIssueLinksByTicketId.get(ticket.id)?.active !== false,
    [jiraIssueLinksByTicketId],
  );
  const selectedTicket =
    snapshot?.tickets.find(
      (ticket) => ticket.id === selectedTicketId && ticket.projectId === selectedProject?.id,
    ) ?? null;
  const projectTickets = useMemo(
    () =>
      snapshot?.tickets.filter(
        (ticket) => ticket.projectId === selectedProject?.id && isTicketVisible(ticket),
      ) ?? [],
    [isTicketVisible, selectedProject?.id, snapshot?.tickets],
  );
  const selectedEpicTickets = useMemo(
    () => projectTickets.filter((ticket) => ticket.epicId === selectedEpic?.id),
    [projectTickets, selectedEpic?.id],
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
  const reservedThreadIds = useMemo(
    () => new Set(snapshot?.reservedThreadIds ?? []),
    [snapshot?.reservedThreadIds],
  );
  const assignmentsByTicket = useMemo(
    () =>
      getActiveAssignmentsByTicket(
        snapshot?.assignments ?? [],
        new Set(threadsById.keys()),
        new Set(archivedThreadsById.keys()),
      ),
    [archivedThreadsById, snapshot?.assignments, threadsById],
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
                search: { workbench: true },
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

  const requestTicketThread = (ticket: WorkbenchTicket, threadId?: ThreadId) => {
    if (pendingAction !== null) return;
    const assignment =
      threadId === undefined
        ? assignmentsByTicket.get(ticket.id)
        : snapshot?.assignments.find(
            (candidate) =>
              candidate.ticketId === ticket.id &&
              candidate.threadId === threadId &&
              candidate.supersededAt === null,
          );
    if (assignment && (!threadLookupReady || existingThreadIds.has(assignment.threadId))) {
      openTicketThread(ticket, { assignment });
      return;
    }
    setError(null);
    setStartThreadRequest({ ticket, ...(assignment ? { assignment } : {}) });
  };

  const requestNewThread = (ticket: WorkbenchTicket) => {
    if (pendingAction !== null || !threadLookupReady) return;
    const hasExistingThread = (snapshot?.assignments ?? []).some(
      (assignment) =>
        assignment.ticketId === ticket.id &&
        assignment.supersededAt === null &&
        existingThreadIds.has(assignment.threadId),
    );
    setError(null);
    setStartThreadRequest({
      ticket,
      ...(hasExistingThread ? { mode: "additional" as const } : {}),
    });
  };

  const deleteAssignedThread = async (threadId: ThreadId) => {
    if (environmentId === null || pendingAction !== null) return;
    setPendingAction(`delete-thread:${threadId}`);
    setError(null);
    try {
      const result = await confirmAndDeleteThread(scopeThreadRef(environmentId, threadId), {
        preserveWorktree: true,
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setError(failureMessage(result));
      }
    } finally {
      setPendingAction(null);
      refreshArchivedThreads();
      refreshWorkbenchSnapshot();
    }
  };

  const attachExistingThread = async (threadId: ThreadId) => {
    if (environmentId === null || attachThreadTicket === null || pendingAction !== null) return;
    setPendingAction(`attach-thread:${attachThreadTicket.id}`);
    setError(null);
    const result = await attachAssignment({
      environmentId,
      input: {
        id: WorkbenchAssignmentId.make(randomUUID()),
        ticketId: attachThreadTicket.id,
        threadId,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return;
    }
    setAttachThreadTicket(null);
    await openAssignedThread(threadId);
  };

  const startSelectedThread = (modelSelection: ModelSelection) => {
    if (startThreadRequest === null || pendingAction !== null) return;
    const ticket = snapshot?.tickets.find(
      (candidate) => candidate.id === startThreadRequest.ticket.id,
    );
    if (!ticket || ticket.archivedAt != null) {
      setError("This Ticket is no longer available for a new Thread.");
      setStartThreadRequest(null);
      return;
    }
    const request = startThreadRequest;
    const hasOtherThread = (snapshot?.assignments ?? []).some(
      (assignment) =>
        assignment.ticketId === ticket.id &&
        assignment.supersededAt === null &&
        assignment.threadId !== request.previousThreadId &&
        existingThreadIds.has(assignment.threadId),
    );
    setStartThreadRequest(null);
    openTicketThread(ticketForBoardAction(ticket), {
      ...(request.assignment ? { assignment: request.assignment } : {}),
      modelSelection,
      ...(request.mode === "replace"
        ? { mode: "replace" as const }
        : hasOtherThread
          ? { mode: "additional" as const }
          : {}),
      ...(request.previousThreadId ? { previousThreadId: request.previousThreadId } : {}),
    });
  };

  const updateRouteSelection = (projectId: WorkbenchProjectId, ticketId?: WorkbenchTicketId) => {
    return navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        ticketId === undefined
          ? { workbenchProjectId: projectId }
          : { workbenchProjectId: projectId, ticketId },
      ),
      replace: true,
    });
  };

  const updateEpicRouteSelection = (projectId: WorkbenchProjectId, epicId: WorkbenchEpicId) => {
    return navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(environmentId, {
        workbenchProjectId: projectId,
        epicId,
      }),
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
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    setAwaitingProjectId(id);
    setSelectedProjectId(id);
    setSelectedTicketId(null);
    setSelectedEpicId(null);
    await updateRouteSelection(id);
    return true;
  };

  const saveWorkspace = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (environmentId === null || !selectedProject) return false;
    setPendingAction("update-project");
    setError(null);
    const result = await updateProject({
      environmentId,
      input: {
        id: selectedProject.id,
        title,
        linkedProjectIds,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
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
    if (reportWorkbenchCommandFailure(result, setError)) return false;
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
  ): Promise<WorkbenchTicketSavedVersion | false> => {
    if (environmentId === null || pendingAction !== null) return false;
    const jiraFieldsChanged = patch.markdown !== undefined || patch.status !== undefined;
    if (jiraFieldsChanged && !jiraOwnershipKnown) {
      setError("Jira ownership is still loading. Try again in a moment.");
      return false;
    }
    const draft = ticketDrafts.get(ticket.id);
    if (patch.status !== undefined && draft?.mode === "editing") {
      setError("Save or cancel this Ticket's edits before changing its status.");
      return false;
    }
    const jiraIssueLink = jiraIssueLinksByTicketId.get(ticket.id);
    if (jiraIssueLink !== undefined && jiraFieldsChanged) {
      const expectedRemoteUpdatedAt =
        patch.markdown !== undefined && draft?.mode === "editing"
          ? (draft.jiraRemoteUpdatedAt ?? null)
          : jiraIssueLink.issue.remoteUpdatedAt;
      setPendingAction(`jira-update:${ticket.id}`);
      setError(null);
      const result = await updateJiraTicket({
        environmentId,
        input: {
          ticketId: ticket.id,
          ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          expectedRemoteUpdatedAt,
        },
      });
      setPendingAction(null);
      if (reportWorkbenchCommandFailure(result, setError)) return false;
      return { jiraRemoteUpdatedAt: result.value.remoteUpdatedAt };
    }
    const fields = resolveWorkbenchTicketUpdateFields({
      patch,
      jiraFieldsManaged: jiraManagedTicketIds.has(ticket.id),
    });
    setPendingAction(`update:${ticket.id}`);
    setError(null);
    const expectedRevision =
      (patch.title !== undefined || patch.markdown !== undefined) && draft?.mode === "editing"
        ? (draft.revision ?? ticket.revision)
        : ticket.revision;
    const result = await updateTicket({
      environmentId,
      input: {
        id: ticket.id,
        expectedRevision,
        ...fields,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    return { revision: result.value.revision };
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
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    return true;
  };

  const changeJiraTransition = async ({
    ticket,
    transitionId,
    expectedRemoteUpdatedAt,
  }: WorkbenchJiraTransitionSelection) => {
    if (environmentId === null || pendingAction !== null) return;
    if (!jiraOwnershipKnown || !jiraIssueLinksByTicketId.has(ticket.id)) {
      setError("Jira ownership changed. Refresh the Ticket and try again.");
      return;
    }
    if (ticketDrafts.get(ticket.id)?.mode === "editing") {
      setError("Save or cancel this Ticket's description edits before changing its status.");
      return;
    }
    setPendingAction(`jira-update:${ticket.id}`);
    setError(null);
    const result = await updateJiraTicket({
      environmentId,
      input: { ticketId: ticket.id, transitionId, expectedRemoteUpdatedAt },
    });
    setPendingAction(null);
    reportWorkbenchCommandFailure(result, setError);
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

  const setTicketArchived = async (ticket: WorkbenchTicket, archivedAt: string | null) => {
    if (
      environmentId === null ||
      !jiraOwnershipKnown ||
      jiraManagedTicketIds.has(ticket.id) ||
      pendingAction !== null
    )
      return false;
    setPendingAction(`archive:${ticket.id}`);
    setError(null);
    const result = await archiveTicket({
      environmentId,
      input: {
        ticketId: ticket.id,
        archivedAt,
        expectedRevision: ticket.revision,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    clearTicketDraft(environmentId, ticket.id);
    if (archivedAt !== null) closeWorkItem();
    return true;
  };

  const removeTicket = async (ticket: WorkbenchTicket) => {
    if (
      environmentId === null ||
      !jiraOwnershipKnown ||
      jiraManagedTicketIds.has(ticket.id) ||
      pendingAction !== null
    )
      return false;
    setPendingAction(`delete:${ticket.id}`);
    setError(null);
    const result = await deleteTicket({
      environmentId,
      input: {
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        deletedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    clearTicketDraft(environmentId, ticket.id);
    closeWorkItem();
    return true;
  };

  const resetTicketWorkspace = async (ticket: WorkbenchTicket) => {
    if (environmentId === null || pendingAction !== null) return false;
    setPendingAction(`reset-workspace:${ticket.id}`);
    setError(null);
    const result = await releaseTicketWorkspace({
      environmentId,
      input: { ticketId: ticket.id, releasedAt: new Date().toISOString() },
    });
    setPendingAction(null);
    return !reportWorkbenchCommandFailure(result, setError);
  };

  const ticketForBoardAction = (ticket: WorkbenchTicket) => {
    const draft = ticketDrafts.get(ticket.id);
    const projectedTicket = {
      ...ticket,
      ...resolveWorkbenchTicketContent({
        ticket,
        jiraIssue: jiraIssueLinksByTicketId.get(ticket.id)?.issue,
      }),
    };
    return draft?.mode === "saved" &&
      !isWorkbenchDraftProjected({
        draft,
        ticket: projectedTicket,
        jiraRemoteUpdatedAt: jiraIssueLinksByTicketId.get(ticket.id)?.issue.remoteUpdatedAt,
      })
      ? {
          ...projectedTicket,
          title: jiraManagedTicketIds.has(ticket.id) ? projectedTicket.title : draft.title,
          markdown: draft.markdown,
        }
      : projectedTicket;
  };

  const saveTicketContent = (ticket: WorkbenchTicket, title: string, markdown: string) => {
    if (title.trim().length === 0) return Promise.resolve(false as const);
    return updateTicketFields(ticket, { title: title.trim(), markdown: markdown.trim() });
  };

  const regenerateSummary = async (ticket: WorkbenchTicket) => {
    if (environmentId === null || pendingAction !== null || ticket.archivedAt != null) return;
    const draft = ticketDrafts.get(ticket.id);
    const projectedTicket = {
      ...ticket,
      ...resolveWorkbenchTicketContent({
        ticket,
        jiraIssue: jiraIssueLinksByTicketId.get(ticket.id)?.issue,
      }),
    };
    const hasUnsavedChanges =
      draft?.mode === "editing" &&
      (draft.markdown !== projectedTicket.markdown ||
        (!jiraManagedTicketIds.has(ticket.id) && draft.title !== projectedTicket.title));
    if (hasUnsavedChanges) {
      setError("Save changes to update summary.");
      return;
    }
    setPendingAction(`summary:${ticket.id}`);
    setError(null);
    const result = await regenerateTicketSummary({
      environmentId,
      input: { ticketId: ticket.id },
    });
    setPendingAction(null);
    reportWorkbenchCommandFailure(result, setError);
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
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    setAwaitingEpicId(id);
    setAwaitingTicketId(null);
    setSelectedEpicId(id);
    setSelectedTicketId(null);
    await updateEpicRouteSelection(selectedProject.id, id);
    return true;
  };

  const beginJiraAuthFlow = async () => {
    if (environmentId === null) return;
    const redirectUri = resolveJiraOAuthRedirectUri();
    if (redirectUri === null) {
      setJiraError("The selected environment URL is unavailable. Reconnect it and try again.");
      return;
    }
    setJiraPendingAction("authorize");
    setJiraError(null);
    const result = await jiraBeginAuth({
      environmentId,
      input: { redirectUri },
    });
    setJiraPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setJiraError)) return;
    await launchJiraAuthorization({
      authorizationUrl: result.value.authorizationUrl,
      environmentId,
      selectedProjectId: selectedProject?.id ?? null,
      setError: setJiraError,
    });
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
    const firstSprint = draft.sprints[0];
    if (environmentId === null || selectedProject === null || !firstSprint) return false;
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
        sprintId: firstSprint.id,
        sprintName: firstSprint.name,
        selectedSprints: draft.sprints.map(({ id, name }) => ({ id, name })),
        defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
        statusMappings: draft.statusMappings,
        followActiveSprint: draft.followActiveSprint,
        boardMode: draft.boardMode,
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
    const firstSprint = draft.sprints[0];
    if (environmentId === null || !firstSprint) return false;
    setJiraPendingAction("update-binding");
    setJiraError(null);
    const result = await jiraUpdateBinding({
      environmentId,
      input: {
        id: draft.binding.id,
        sprintId: firstSprint.id,
        sprintName: firstSprint.name,
        selectedSprints: draft.sprints.map(({ id, name }) => ({ id, name })),
        defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
        statusMappings: draft.statusMappings,
        followActiveSprint: draft.followActiveSprint,
        boardMode: draft.boardMode,
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
        selectedSprints: getWorkbenchJiraBindingSprints(binding),
        defaultPrimaryT3ProjectId: binding.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: binding.defaultRepositoryProjectIds,
        statusMappings: binding.statusMappings,
        followActiveSprint: binding.followActiveSprint,
        boardMode: binding.boardMode,
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
  const jiraSiteUrl = jiraSnapshot?.connections.find(
    (connection) => connection.id === jiraBinding?.connectionId,
  )?.siteUrl;
  const selectedJiraEpic =
    jiraBinding && selectedEpic
      ? jiraSnapshot?.issueLinks.find(
          (link) =>
            link.bindingId === jiraBinding.id &&
            link.issue.epic !== null &&
            selectedEpic.id === `jira:${jiraBinding.id}:epic:${link.issue.epic.id}`,
        )?.issue.epic
      : null;
  const selectedJiraEpicUrl =
    selectedJiraEpic && jiraSiteUrl
      ? new URL(`/browse/${encodeURIComponent(selectedJiraEpic.key)}`, jiraSiteUrl).toString()
      : null;
  const jiraSprintLinks =
    jiraBinding && jiraSiteUrl
      ? getWorkbenchJiraBindingSprints(jiraBinding).map((sprint) => {
          const url = new URL("/secure/RapidBoard.jspa", jiraSiteUrl);
          url.searchParams.set("rapidView", String(jiraBinding.boardId));
          url.searchParams.set("projectKey", jiraBinding.jiraProjectKey);
          url.searchParams.set("sprint", String(sprint.id));
          return { ...sprint, url: url.toString() };
        })
      : [];
  const activeJiraTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).filter((link) => link.active).map((link) => link.ticketId),
  );
  const jiraManagedTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).map((link) => link.ticketId),
  );
  const jiraOwnershipKnown = jiraSnapshot !== null && !jiraQuery.isPending;
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  const pending = pendingAction !== null;

  useEffect(() => {
    if (!isElectron || !jiraDialogOpen) return;
    const refresh = () => refreshJiraSnapshot();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [jiraDialogOpen, refreshJiraSnapshot]);

  useEffect(() => {
    const refresh = () => refreshWorkbenchSnapshot();
    return subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: JIRA_REFRESH_INTERVAL_MS,
    });
  }, [refreshWorkbenchSnapshot]);

  useEffect(() => {
    if (!jiraBinding?.active) return;
    const refresh = () => refreshJiraSnapshot();
    return subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: JIRA_REFRESH_INTERVAL_MS,
    });
  }, [jiraBinding?.active, refreshJiraSnapshot]);

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

    const completeAuthorization = async () => {
      setJiraPendingAction("complete-auth");
      setJiraError(null);
      try {
        if ("error" in callback) {
          setJiraError(callback.error);
          return false;
        }
        const redirectUri = resolveJiraOAuthRedirectUri();
        if (redirectUri === null) {
          setJiraError("The selected environment URL is unavailable. Reconnect it and try again.");
          return false;
        }
        const result = await jiraCompleteAuth({
          environmentId,
          input: {
            code: callback.code,
            state: callback.state,
            redirectUri,
          },
        });
        return !reportWorkbenchCommandFailure(result, setJiraError);
      } finally {
        setJiraPendingAction(null);
      }
    };

    void (async () => {
      const succeeded = await completeAuthorization();

      const storedProjectId = sessionStorage.getItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      const storedEnvironmentId = readPendingJiraEnvironmentId();
      sessionStorage.removeItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      sessionStorage.removeItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY);
      const callbackProject = snapshotProjects.find((project) => project.id === storedProjectId);
      if (callbackProject) setSelectedProjectId(callbackProject.id);
      await navigate({
        to: "/workbench",
        search: (previous: WorkbenchSearch) =>
          resolveJiraOAuthReturnSearch({
            previous,
            environmentId,
            storedEnvironmentId,
            projectId: callbackProject?.id,
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
    resolveJiraOAuthRedirectUri,
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
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        ticketId
          ? { workbenchProjectId: selectedProject.id, ticketId }
          : epicId
            ? { workbenchProjectId: selectedProject.id, epicId }
            : { workbenchProjectId: selectedProject.id },
      ),
      replace: true,
    });
  }, [
    navigate,
    environmentId,
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
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        selectedProject
          ? { workbenchProjectId: selectedProject.id, create: "workspace" as const }
          : { create: "workspace" as const },
      ),
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
        ...(environmentId ? { environmentId } : {}),
        ...(previous.workbenchProjectId ? { workbenchProjectId: previous.workbenchProjectId } : {}),
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
              environmentId={environmentId}
              workspaceTitle={selectedProject.title}
              ticket={selectedTicket}
              ticketWorkspace={snapshot?.ticketWorkspaces.find(
                (workspace) => workspace.ticketId === selectedTicket.id,
              )}
              linkedProjects={linkedT3Projects}
              epics={projectEpics}
              jiraIssueLink={jiraIssueLinksByTicketId.get(selectedTicket.id) ?? null}
              jiraFieldsManaged={jiraManagedTicketIds.has(selectedTicket.id)}
              jiraRefreshing={jiraPendingAction === "sync"}
              jiraRefreshDisabled={jiraPendingAction !== null || !jiraBinding?.active}
              onRefreshJira={jiraBinding ? () => void syncJiraBinding(jiraBinding) : null}
              lifecycleActionsEnabled={
                jiraOwnershipKnown && !jiraManagedTicketIds.has(selectedTicket.id)
              }
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
              error={error ?? query.error ?? archivedThreadsError ?? jiraError}
              onBack={() => {
                setError(null);
                closeWorkItem();
              }}
              onSave={saveTicketContent}
              onRegenerateSummary={(ticket) => {
                void regenerateSummary(ticket);
              }}
              onUpdate={changeTicket}
              onJiraTransition={(selection) => {
                void changeJiraTransition(selection);
              }}
              onOpenEpic={(epicId) => {
                setAwaitingTicketId(null);
                setAwaitingEpicId(null);
                setSelectedTicketId(null);
                setSelectedEpicId(epicId);
                void updateEpicRouteSelection(selectedProject.id, epicId);
              }}
              onOpenThread={requestTicketThread}
              onOpenAssignedThread={openAssignedThread}
              onNewThread={requestNewThread}
              onAttachThread={(ticket) => {
                setError(null);
                setAttachThreadTicket(ticket);
              }}
              onDeleteThread={(threadId) => {
                void deleteAssignedThread(threadId);
              }}
              onReplaceThread={(ticket, previousThreadId) => {
                setError(null);
                setStartThreadRequest({ ticket, mode: "replace", previousThreadId });
              }}
              onArchive={setTicketArchived}
              onDelete={removeTicket}
              onResetWorkspace={resetTicketWorkspace}
            />
          ) : selectedEpic ? (
            <WorkbenchEpicDetail
              key={selectedEpic.id}
              workspaceTitle={selectedProject.title}
              epic={selectedEpic}
              jiraUrl={selectedJiraEpicUrl}
              jiraManaged={
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
                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
                    <h2 className="min-w-0 truncate font-heading text-xl font-semibold">
                      {selectedProject.title}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {projectTickets.length} tickets
                    </span>
                    {jiraBinding && !jiraBinding.active ? (
                      <Badge variant="outline">Jira paused</Badge>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Popover>
                      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                        <FolderGit2Icon data-icon="inline-start" />
                        Repositories {linkedT3Projects.length}
                      </PopoverTrigger>
                      <PopoverPopup align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                        <PopoverTitle>Repositories</PopoverTitle>
                        <div className="mt-3 flex flex-col gap-2">
                          {linkedT3Projects.map((project) => (
                            <div
                              key={project.id}
                              className="flex min-w-0 items-center justify-between gap-3"
                            >
                              <span className="min-w-0 break-words text-sm">{project.title}</span>
                              <OpenInPicker
                                environmentId={project.environmentId}
                                keybindings={keybindings}
                                availableEditors={availableEditors}
                                openInCwd={project.workspaceRoot}
                                compact
                                enableShortcut={false}
                              />
                            </div>
                          ))}
                        </div>
                      </PopoverPopup>
                    </Popover>
                    <Button aria-label="New Ticket" onClick={() => openTicketDialog()} size="sm">
                      <PlusIcon data-icon="inline-start" />
                      New Ticket
                    </Button>
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button aria-label="Workspace actions" size="icon-sm" variant="ghost" />
                        }
                      >
                        <MoreHorizontalIcon />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuGroup>
                          <MenuItem onClick={openEpicDialog}>
                            <Layers3Icon /> New Epic
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              setError(null);
                              setEditWorkspaceOpen(true);
                            }}
                          >
                            <Settings2Icon /> Edit Workspace
                          </MenuItem>
                        </MenuGroup>
                        <MenuSeparator />
                        {jiraBinding ? (
                          <>
                            <MenuGroup>
                              <MenuGroupLabel>
                                {jiraBinding.boardName}
                                {!jiraBinding.active ? " · Paused" : ""}
                              </MenuGroupLabel>
                              <MenuItem onClick={openJiraDialog}>
                                <Settings2Icon /> Configure Jira sprint mirror
                              </MenuItem>
                              <MenuItem
                                disabled={jiraPendingAction !== null || !jiraBinding.active}
                                onClick={() => void syncJiraBinding(jiraBinding)}
                              >
                                <RefreshCwIcon />{" "}
                                {jiraPendingAction === "sync" ? "Syncing Jira…" : "Sync Jira"}
                              </MenuItem>
                            </MenuGroup>
                            {jiraSprintLinks.length > 0 ? (
                              <MenuGroup>
                                <MenuGroupLabel>Jira sprints</MenuGroupLabel>
                                {jiraSprintLinks.map((sprint) => (
                                  <MenuItem
                                    key={sprint.id}
                                    render={
                                      <a
                                        href={sprint.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      />
                                    }
                                  >
                                    <LinkIcon /> {sprint.name}
                                  </MenuItem>
                                ))}
                              </MenuGroup>
                            ) : null}
                          </>
                        ) : (
                          <MenuGroup>
                            <MenuItem onClick={openJiraDialog}>
                              <LinkIcon /> Connect Jira
                            </MenuItem>
                          </MenuGroup>
                        )}
                      </MenuPopup>
                    </Menu>
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
                  {projectTickets.some(
                    (ticket) => jiraIssueLinksByTicketId.get(ticket.id)?.issue.flagged,
                  ) ? (
                    <Badge className="ml-1" variant="warning">
                      <AlertCircleIcon />
                      {
                        projectTickets.filter(
                          (ticket) => jiraIssueLinksByTicketId.get(ticket.id)?.issue.flagged,
                        ).length
                      }{" "}
                      Jira flagged
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
                {jiraBinding?.lastSyncError ? (
                  <p
                    role="status"
                    className="border-b border-border px-4 py-2 text-sm text-warning-foreground"
                  >
                    {jiraBinding.lastSyncError}
                  </p>
                ) : null}
                <WorkbenchTicketBoard
                  environmentId={environmentId}
                  onJiraTransition={(selection) => {
                    void changeJiraTransition(selection);
                  }}
                  key={`${selectedProject.id}:${jiraBinding?.boardMode ?? "mapped"}`}
                  mirrorColumns={
                    jiraBinding?.boardMode === "mirror_jira" ? jiraBinding.boardColumns : null
                  }
                  projectId={selectedProject.id}
                  tickets={projectTickets}
                  epics={projectEpics}
                  groupMode={effectiveBoardGroupMode}
                  jiraIssueLinksByTicketId={jiraIssueLinksByTicketId}
                  activeJiraTicketIds={activeJiraTicketIds}
                  selectedTicketId={null}
                  repositoriesById={repositoriesById}
                  assignmentsByTicket={assignmentsByTicket}
                  assignments={snapshot?.assignments ?? []}
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
                    changeTicket(ticketForBoardAction(ticket), { status });
                  }}
                  onRegenerateSummary={(ticket) => {
                    void regenerateSummary(ticket);
                  }}
                  onOpenThread={(ticket, threadId) =>
                    requestTicketThread(ticketForBoardAction(ticket), threadId)
                  }
                  onCreateTicket={() => openTicketDialog()}
                />
              </div>
            </>
          )}
        </main>
      )}

      {createWorkspace ? (
        <WorkbenchWorkspaceDialog
          open={createWorkspace}
          projects={projects}
          pending={pending}
          error={error ?? query.error}
          onOpenChange={handleWorkspaceDialogOpenChange}
          onSave={submitProject}
        />
      ) : null}
      {editWorkspaceOpen && selectedProject ? (
        <WorkbenchWorkspaceDialog
          key={selectedProject.id}
          open
          projects={projects}
          initialWorkspace={selectedProject}
          pending={pending}
          error={error ?? query.error}
          onOpenChange={setEditWorkspaceOpen}
          onSave={saveWorkspace}
        />
      ) : null}
      {selectedProject && jiraDialogOpen ? (
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
      {startThreadRequest && environmentId ? (
        <WorkbenchStartThreadDialog
          open
          environmentId={environmentId}
          providers={providers}
          defaultModelSelection={
            repositoriesById.get(startThreadRequest.ticket.primaryT3ProjectId)
              ?.defaultModelSelection ?? null
          }
          pending={pending}
          additional={startThreadRequest.mode === "additional"}
          onOpenChange={(open) => {
            if (!open) setStartThreadRequest(null);
          }}
          onStart={startSelectedThread}
        />
      ) : null}
      {attachThreadTicket ? (
        <WorkbenchAttachThreadDialog
          threads={[...threadsById.values()].filter(
            (thread) =>
              thread.projectId === attachThreadTicket.primaryT3ProjectId &&
              !reservedThreadIds.has(thread.id) &&
              !(snapshot?.assignments ?? []).some(
                (assignment) => assignment.threadId === thread.id,
              ),
          )}
          pending={pending}
          error={error}
          onClose={() => setAttachThreadTicket(null)}
          onAttach={attachExistingThread}
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
