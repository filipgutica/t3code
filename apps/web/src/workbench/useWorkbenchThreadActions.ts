import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  WorkbenchAssignmentId,
  type EnvironmentId,
  type ProjectId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomCommand } from "../state/use-atom-command";
import { threadEnvironment } from "../state/threads";
import { useThreadActions } from "../hooks/useThreadActions";
import { randomUUID } from "../lib/utils";
import { workbenchEnvironment } from "./state";
import { failureMessage, reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import { openWorkbenchAssignedThread as openAssignedThreadWithRestore } from "./openWorkbenchAssignedThread";
import { useStartWorkbenchTicket } from "./useStartWorkbenchTicket";
import type { StartWorkbenchTicketOptions } from "./startWorkbenchTicket";
import { getWorkbenchThreadLookupState, isWorkbenchThreadArchived } from "./workbench.logic";
import type { WorkbenchAttachableThread } from "./WorkbenchAttachThreadDialog";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import { showWorkbenchPageChatThread } from "./workbenchFloatingChatState";
import {
  getWorkbenchRepositoryScope,
  isWorkbenchRepositoryScopeEqual,
  isWorkbenchTicketWorkspaceReady,
  type WorkbenchRepositoryScope,
  type WorkbenchRepositoryScopeDraft,
} from "./workbenchRepositoryScope";

type WorkbenchStartThreadRequest = {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
  repositoryScope?: WorkbenchRepositoryScope;
  reviewVersion?: number;
  assignment?: WorkbenchAssignment;
  mode?: "additional" | "replace";
  previousThreadId?: ThreadId;
};

const getWorkbenchThreadStartOptions = ({
  request,
  modelSelection,
  repositoryScope,
  repositoryProjectId,
  assignments,
  existingThreadIds,
}: {
  request: WorkbenchStartThreadRequest;
  modelSelection: ModelSelection;
  repositoryScope: WorkbenchRepositoryScope | undefined;
  repositoryProjectId: ProjectId | undefined;
  assignments: readonly WorkbenchAssignment[];
  existingThreadIds: ReadonlySet<ThreadId>;
}): StartWorkbenchTicketOptions => {
  const hasOtherThread = assignments.some(
    (assignment) =>
      assignment.ticketId === request.ticket.id &&
      assignment.supersededAt === null &&
      assignment.threadId !== request.previousThreadId &&
      existingThreadIds.has(assignment.threadId),
  );
  // A replacement is checked against the Assignment it replaces, not the Ticket's primary one.
  const assignment =
    request.assignment ??
    (request.mode === "replace"
      ? assignments.find(
          (candidate) =>
            candidate.ticketId === request.ticket.id &&
            candidate.threadId === request.previousThreadId &&
            candidate.supersededAt === null,
        )
      : undefined);
  return {
    ...(assignment ? { assignment } : {}),
    modelSelection,
    ...(repositoryScope ? { repositoryScope } : {}),
    ...(repositoryProjectId ? { repositoryProjectId } : {}),
    ...(request.mode === "replace"
      ? { mode: "replace" as const }
      : hasOtherThread
        ? { mode: "additional" as const }
        : {}),
    ...(request.previousThreadId ? { previousThreadId: request.previousThreadId } : {}),
  };
};

export function useWorkbenchThreadActions({
  environmentId,
  pageData,
  selectedTicket,
  pendingAction,
  setPendingAction,
  setError,
  ticketForBoardAction,
  repositoryScopeDraft,
  clearRepositoryScope,
  acceptSavedRepositoryScope,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selectedTicket: WorkbenchTicket | null;
  readonly pendingAction: string | null;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
  readonly ticketForBoardAction: (ticket: WorkbenchTicket) => WorkbenchTicket;
  readonly repositoryScopeDraft: WorkbenchRepositoryScopeDraft | null;
  readonly clearRepositoryScope: () => void;
  readonly acceptSavedRepositoryScope: (ticket: WorkbenchTicket) => void;
}) {
  const navigate = useNavigate({ from: "/workbench" });
  const {
    snapshot,
    canOperate,
    projects,
    providers,
    assignmentsByTicket,
    existingThreadIds,
    threadLookupReady,
    remoteEnvironmentStates,
    liveEnvironmentIds,
    refreshArchivedThreads,
    refreshThreadLookup,
    refreshWorkbenchSnapshot,
    threadsById,
    archivedThreadsById,
  } = pageData;
  const unarchiveThread = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const attachAssignment = useAtomCommand(workbenchEnvironment.createAssignment, {
    reportFailure: false,
  });
  const unlinkAssignment = useAtomCommand(workbenchEnvironment.unlinkAssignment, {
    reportFailure: false,
  });
  const { confirmAndDeleteThread } = useThreadActions();
  const [startThreadRequest, setStartThreadRequest] = useState<WorkbenchStartThreadRequest | null>(
    null,
  );
  const [attachThreadTicket, setAttachThreadTicket] = useState<WorkbenchTicket | null>(null);

  /** A Board's Thread ids are unique, and its maps hold each Thread from its own environment. */
  const getThreadEnvironmentId = (threadId: ThreadId, hostEnvironmentId: EnvironmentId) =>
    (threadsById.get(threadId) ?? archivedThreadsById.get(threadId))?.environmentId ??
    hostEnvironmentId;

  /** `knownEnvironmentId` names the Thread's machine before the lookup has its shell. */
  const openAssignedThread = async (threadId: ThreadId, knownEnvironmentId?: EnvironmentId) => {
    if (environmentId === null) return;
    const threadEnvironmentId =
      knownEnvironmentId ?? getThreadEnvironmentId(threadId, environmentId);
    const archived = isWorkbenchThreadArchived(threadId, threadsById, archivedThreadsById);
    if (archived && !canOperate) return;
    if (archived) {
      setPendingAction(`restore:${threadId}`);
      setError(null);
    }
    const result = await (async () => {
      try {
        return await openAssignedThreadWithRestore(
          { environmentId: threadEnvironmentId, threadId, archived },
          {
            unarchive: unarchiveThread,
            refreshArchived: refreshArchivedThreads,
            navigate: () =>
              navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId: threadEnvironmentId, threadId },
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
      }
    })().finally(() => {
      if (archived) setPendingAction(null);
    });
    if (result === undefined) return;
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
  };
  const openTicketThread = useStartWorkbenchTicket({
    environmentId,
    projects,
    providers,
    assignmentsByTicket,
    existingThreadIds,
    threadLookupReady,
    remoteEnvironmentStates,
    boards: snapshot?.projects ?? [],
    onRefreshThreadLookup: refreshThreadLookup,
    onOpenAssignedThread: openAssignedThread,
    onPendingChange: setPendingAction,
    onError: setError,
  });

  const repositoryReviewRequest = (ticket: WorkbenchTicket) => {
    if (
      !snapshot?.projects.some(
        (workspace) => workspace.id === ticket.projectId && workspace.archivedAt == null,
      )
    ) {
      setError("Restore this Board before creating a Thread.");
      return null;
    }
    const draft = repositoryScopeDraft?.ticket.id === ticket.id ? repositoryScopeDraft : null;
    const workspace = snapshot?.ticketWorkspaces.find(
      (candidate) => candidate.ticketId === ticket.id,
    );
    if (
      draft &&
      isWorkbenchTicketWorkspaceReady({
        ticket,
        workspace,
        board: snapshot?.projects.find((board) => board.id === ticket.projectId),
      }) &&
      !isWorkbenchRepositoryScopeEqual(ticket, draft.value)
    ) {
      setError("Save or cancel repository edits before creating another Thread.");
      return null;
    }
    return {
      ticket: draft?.ticket ?? ticket,
      repositoryScope: draft?.value ?? getWorkbenchRepositoryScope(ticket),
    };
  };

  const requestTicketThread = (ticket: WorkbenchTicket, threadId?: ThreadId) => {
    if (pendingAction !== null || environmentId === null) return;
    const assignment =
      threadId === undefined
        ? assignmentsByTicket.get(ticket.id)
        : snapshot?.assignments.find(
            (candidate) =>
              candidate.ticketId === ticket.id &&
              candidate.threadId === threadId &&
              candidate.supersededAt === null,
          );
    // Opening checks the Thread again; only a confirmed missing one leads to a replacement.
    if (
      assignment &&
      (getWorkbenchThreadLookupState({ assignment, threadLookupReady, remoteEnvironmentStates }) !==
        "ready" ||
        existingThreadIds.has(assignment.threadId))
    ) {
      void openTicketThread(ticket, { assignment });
      return;
    }
    const review = repositoryReviewRequest(ticket);
    if (!review) return;
    setError(null);
    setStartThreadRequest({ environmentId, ...review, ...(assignment ? { assignment } : {}) });
  };

  const requestNewThread = (ticket: WorkbenchTicket) => {
    if (pendingAction !== null || !threadLookupReady || environmentId === null) return;
    const review = repositoryReviewRequest(ticket);
    if (!review) return;
    const hasExistingThread = (snapshot?.assignments ?? []).some(
      (assignment) =>
        assignment.ticketId === ticket.id &&
        assignment.supersededAt === null &&
        existingThreadIds.has(assignment.threadId),
    );
    setError(null);
    setStartThreadRequest({
      environmentId,
      ...review,
      ...(hasExistingThread ? { mode: "additional" as const } : {}),
    });
  };

  const requestReplacementThread = ({
    ticket,
    previousThreadId,
  }: {
    ticket: WorkbenchTicket;
    previousThreadId: ThreadId;
  }) => {
    if (pendingAction !== null || environmentId === null) return;
    const review = repositoryReviewRequest(ticket);
    if (!review) return;
    setError(null);
    setStartThreadRequest({ environmentId, ...review, mode: "replace", previousThreadId });
  };

  const deleteAssignedThread = async (threadId: ThreadId) => {
    if (environmentId === null || pendingAction !== null) return;
    setPendingAction(`delete-thread:${threadId}`);
    setError(null);
    const threadEnvironmentId = getThreadEnvironmentId(threadId, environmentId);
    return (async () => {
      const result = await confirmAndDeleteThread(scopeThreadRef(threadEnvironmentId, threadId), {
        preserveWorktree: true,
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setError(failureMessage(result));
      }
    })().finally(() => {
      setPendingAction(null);
      refreshArchivedThreads();
      refreshWorkbenchSnapshot();
    });
  };

  const attachExistingThread = async (thread: WorkbenchAttachableThread) => {
    if (environmentId === null || attachThreadTicket === null || pendingAction !== null) return;
    const threadId = thread.id;
    const remote = thread.environmentId !== environmentId;
    // The dialog listed it while connected; the host stores remote refs without checking them.
    if (remote && !liveEnvironmentIds.has(thread.environmentId)) {
      setError("That Thread's machine is not connected. Reconnect it and try again.");
      return;
    }
    setPendingAction(`attach-thread:${attachThreadTicket.id}`);
    setError(null);
    const result = await attachAssignment({
      environmentId,
      input: {
        id: WorkbenchAssignmentId.make(randomUUID()),
        ticketId: attachThreadTicket.id,
        threadId,
        ...(remote ? { environmentId: thread.environmentId, projectId: thread.projectId } : {}),
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return;
    }
    setAttachThreadTicket(null);
    // The page's chat talks to the Board host, so a Thread on another machine opens on its page.
    if (
      remote ||
      !showWorkbenchPageChatThread({
        environmentId,
        ticketId: attachThreadTicket.id,
        projectId: attachThreadTicket.projectId,
        threadId,
      })
    ) {
      await openAssignedThread(threadId, thread.environmentId);
    }
  };

  /** The latest Ticket, or null when its repositories changed and the user must review them. */
  const getReviewedStartThreadTicket = (request: WorkbenchStartThreadRequest) => {
    const ticket = snapshot?.tickets.find((candidate) => candidate.id === request.ticket.id);
    if (
      !ticket ||
      ticket.archivedAt != null ||
      !snapshot?.projects.some(
        (workspace) => workspace.id === ticket.projectId && workspace.archivedAt == null,
      )
    ) {
      setError("This Ticket is no longer available for a new Thread.");
      setStartThreadRequest(null);
      return null;
    }
    // Brief and Progress writes by other Threads bump the revision; only repositories need review.
    if (!isWorkbenchRepositoryScopeEqual(ticket, request.ticket)) {
      setError(
        "This Ticket changed. Review its current repository choices before creating a Thread.",
      );
      setStartThreadRequest({
        ...request,
        ticket,
        repositoryScope: getWorkbenchRepositoryScope(ticket),
        reviewVersion: (request.reviewVersion ?? 0) + 1,
      });
      return null;
    }
    const workspace = snapshot?.ticketWorkspaces.find(
      (candidate) => candidate.ticketId === ticket.id,
    );
    if (workspace?.status === "preparing" || workspace?.status === "releasing") {
      setError("Wait for workspace preparation or release to finish before creating a Thread.");
      return null;
    }
    return ticket;
  };

  /** The repository of the Ticket's most active Thread, which a new Thread defaults to. */
  const getActiveThreadRepository = (ticketId: WorkbenchTicket["id"]): ProjectId | undefined => {
    const threadId = assignmentsByTicket.get(ticketId)?.threadId;
    if (threadId === undefined) return undefined;
    return (threadsById.get(threadId) ?? archivedThreadsById.get(threadId))?.projectId;
  };

  const startSelectedThread = async ({
    modelSelection,
    repositoryScope,
    repositoryProjectId,
  }: {
    modelSelection: ModelSelection;
    repositoryScope?: WorkbenchRepositoryScope;
    repositoryProjectId?: ProjectId;
  }) => {
    if (
      startThreadRequest === null ||
      pendingAction !== null ||
      startThreadRequest.environmentId !== environmentId
    )
      return;
    const latestTicket = getReviewedStartThreadTicket(startThreadRequest);
    if (latestTicket === null) return;
    const request = { ...startThreadRequest, ticket: latestTicket };
    const result = await openTicketThread(
      ticketForBoardAction(request.ticket),
      getWorkbenchThreadStartOptions({
        request,
        modelSelection,
        repositoryScope,
        repositoryProjectId,
        assignments: snapshot?.assignments ?? [],
        existingThreadIds,
      }),
      async (threadId) => {
        if (
          !showWorkbenchPageChatThread({
            environmentId: request.environmentId,
            ticketId: request.ticket.id,
            projectId: request.ticket.projectId,
            threadId,
          })
        ) {
          await openAssignedThread(threadId);
        }
      },
    );
    if (result?.state === "opened" || result?.state === "navigation-failed") {
      setStartThreadRequest(null);
      clearRepositoryScope();
    } else if (result && "ticket" in result && result.ticket) {
      acceptSavedRepositoryScope(result.ticket);
      setStartThreadRequest({
        ...request,
        ticket: result.ticket,
        repositoryScope: getWorkbenchRepositoryScope(result.ticket),
      });
    }
  };

  const unlinkThread = async (threadId: ThreadId) => {
    if (
      environmentId === null ||
      selectedTicket === undefined ||
      selectedTicket === null ||
      pendingAction !== null
    )
      return;
    setPendingAction(`unlink-thread:${threadId}`);
    setError(null);
    const result = await unlinkAssignment({
      environmentId,
      input: { ticketId: selectedTicket.id, threadId },
    });
    setPendingAction(null);
    reportWorkbenchCommandFailure(result, setError);
  };

  return {
    startThreadRequest,
    setStartThreadRequest,
    attachThreadTicket,
    setAttachThreadTicket,
    openAssignedThread,
    requestTicketThread,
    requestNewThread,
    requestReplacementThread,
    deleteAssignedThread,
    attachExistingThread,
    startSelectedThread,
    getActiveThreadRepository,
    unlinkThread,
  };
}
