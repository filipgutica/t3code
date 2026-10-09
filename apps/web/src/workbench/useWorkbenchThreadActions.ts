import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  WorkbenchAssignmentId,
  type EnvironmentId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { useCallback, useState } from "react";
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
import { isWorkbenchThreadArchived } from "./workbench.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
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
  assignments,
  existingThreadIds,
}: {
  request: WorkbenchStartThreadRequest;
  modelSelection: ModelSelection;
  repositoryScope: WorkbenchRepositoryScope | undefined;
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
  return {
    ...(request.assignment ? { assignment: request.assignment } : {}),
    modelSelection,
    ...(repositoryScope ? { repositoryScope } : {}),
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
  onEditRepositories,
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
  readonly onEditRepositories: (ticket: WorkbenchTicket) => void;
}) {
  const navigate = useNavigate({ from: "/workbench" });
  const {
    snapshot,
    projects,
    providers,
    assignmentsByTicket,
    existingThreadIds,
    threadLookupReady,
    refreshArchivedThreads,
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
      setError,
      setPendingAction,
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

  const repositoryReviewRequest = (ticket: WorkbenchTicket) => {
    if (
      !snapshot?.projects.some(
        (workspace) => workspace.id === ticket.projectId && workspace.archivedAt == null,
      )
    ) {
      setError("Restore this Workspace before creating a Thread.");
      return null;
    }
    const draft = repositoryScopeDraft?.ticket.id === ticket.id ? repositoryScopeDraft : null;
    const workspace = snapshot?.ticketWorkspaces.find(
      (candidate) => candidate.ticketId === ticket.id,
    );
    if (
      draft &&
      isWorkbenchTicketWorkspaceReady({ ticket, workspace }) &&
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
    if (assignment && (!threadLookupReady || existingThreadIds.has(assignment.threadId))) {
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
    if (ticket.revision !== request.ticket.revision) {
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

  const startSelectedThread = async ({
    modelSelection,
    repositoryScope,
  }: {
    modelSelection: ModelSelection;
    repositoryScope?: WorkbenchRepositoryScope;
  }) => {
    if (
      startThreadRequest === null ||
      pendingAction !== null ||
      startThreadRequest.environmentId !== environmentId
    )
      return;
    const request = startThreadRequest;
    if (getReviewedStartThreadTicket(request) === null) return;
    const result = await openTicketThread(
      ticketForBoardAction(request.ticket),
      getWorkbenchThreadStartOptions({
        request,
        modelSelection,
        repositoryScope,
        assignments: snapshot?.assignments ?? [],
        existingThreadIds,
      }),
    );
    if (result?.state === "opened" || result?.state === "navigation-failed") {
      setStartThreadRequest(null);
      clearRepositoryScope();
    } else if (result?.state === "failed" && result.ticket) {
      acceptSavedRepositoryScope(result.ticket);
      setStartThreadRequest({
        ...request,
        ticket: result.ticket,
        repositoryScope: getWorkbenchRepositoryScope(result.ticket),
      });
    }
  };

  const editStartThreadRepositories = () => {
    if (!startThreadRequest || pendingAction !== null) return;
    const ticket = snapshot?.tickets.find(
      (candidate) => candidate.id === startThreadRequest.ticket.id,
    );
    if (!ticket) return;
    setStartThreadRequest(null);
    onEditRepositories(ticket);
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
    editStartThreadRepositories,
    unlinkThread,
  };
}
