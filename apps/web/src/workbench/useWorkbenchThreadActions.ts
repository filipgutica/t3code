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
import { isWorkbenchThreadArchived } from "./workbench.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";

export function useWorkbenchThreadActions({
  environmentId,
  pageData,
  selectedTicket,
  pendingAction,
  setPendingAction,
  setError,
  ticketForBoardAction,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selectedTicket: WorkbenchTicket | null;
  readonly pendingAction: string | null;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
  readonly ticketForBoardAction: (ticket: WorkbenchTicket) => WorkbenchTicket;
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
  const [startThreadRequest, setStartThreadRequest] = useState<{
    ticket: WorkbenchTicket;
    assignment?: WorkbenchAssignment;
    mode?: "additional" | "replace";
    previousThreadId?: ThreadId;
  } | null>(null);
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
    deleteAssignedThread,
    attachExistingThread,
    startSelectedThread,
    unlinkThread,
  };
}
