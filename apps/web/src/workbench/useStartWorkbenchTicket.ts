import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  WorkbenchAssignmentId,
  type EnvironmentId,
  type ServerProvider,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { newThreadId, randomUUID } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  coordinateWorkbenchTicketStart,
  type StartWorkbenchTicketOptions,
} from "./startWorkbenchTicket";
import { workbenchEnvironment } from "./state";

const commandFailureMessage = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Workbench request failed.";
};

export function useStartWorkbenchTicket({
  environmentId,
  projects,
  providers,
  assignmentsByTicket,
  existingThreadIds,
  threadLookupReady,
  onRefreshThreadLookup,
  onOpenAssignedThread,
  onPendingChange,
  onError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly threadLookupReady: boolean;
  readonly onRefreshThreadLookup: () => void;
  readonly onOpenAssignedThread: (threadId: ThreadId) => Promise<void>;
  readonly onPendingChange: (action: string | null) => void;
  readonly onError: (message: string | null) => void;
}) {
  const createAssignment = useAtomCommand(workbenchEnvironment.createAssignment, {
    reportFailure: false,
  });
  const replaceAssignment = useAtomCommand(workbenchEnvironment.replaceAssignment, {
    reportFailure: false,
  });
  const prepareTicketWorkspace = useAtomCommand(workbenchEnvironment.prepareTicketWorkspace, {
    reportFailure: false,
  });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  return useCallback(
    (ticket: WorkbenchTicket, options?: StartWorkbenchTicketOptions) => {
      if (environmentId === null) return;
      void (async () => {
        onPendingChange(`start:${ticket.id}`);
        onError(null);
        let result: Awaited<ReturnType<typeof coordinateWorkbenchTicketStart>>;
        try {
          result = await coordinateWorkbenchTicketStart(
            {
              environmentId,
              ticket,
              projects,
              assignment: options?.assignment ?? assignmentsByTicket.get(ticket.id),
              existingThreadIds,
              threadLookupReady,
            },
            {
              prepareTicketWorkspace,
              createThread,
              createAssignment,
              replaceAssignment,
              deleteThread,
              addReviewComment: (threadRef, comment) =>
                useComposerDraftStore.getState().addReviewComment(threadRef, comment),
              openThread: onOpenAssignedThread,
              resolveModelSelection: (project) =>
                resolveDefaultProviderModelSelection(providers, project.defaultModelSelection),
              makeThreadId: newThreadId,
              makeAssignmentId: () => WorkbenchAssignmentId.make(randomUUID()),
              now: () => new Date().toISOString(),
            },
            options,
          );
        } catch (cause) {
          onError(
            cause instanceof Error && cause.message.trim().length > 0
              ? cause.message
              : "The Workbench request failed unexpectedly.",
          );
          return;
        } finally {
          onPendingChange(null);
        }

        if (result.state === "project-unavailable") {
          onError("The ticket's T3 Project is no longer available.");
          return;
        }
        if (result.state === "provider-unavailable") {
          onError("Configure an available Agent provider before starting this ticket.");
          return;
        }
        if (result.state === "thread-status-unavailable") {
          onError(null);
          onRefreshThreadLookup();
          return;
        }
        if (result.state === "navigation-failed") {
          onError(
            result.cause instanceof Error && result.cause.message.trim().length > 0
              ? result.cause.message
              : "The Thread is ready, but Workbench could not open it.",
          );
          return;
        }
        if (result.state !== "failed") return;

        if (result.cleanupFailure && !isAtomCommandInterrupted(result.cleanupFailure)) {
          console.warn(
            "Failed to clean up a Workbench Thread after Assignment creation failed.",
            squashAtomCommandFailure(result.cleanupFailure),
          );
        }
        if (isAtomCommandInterrupted(result.failure)) return;
        if (result.stage === "workspace") {
          onError(
            `The Ticket repositories could not be prepared. ${commandFailureMessage(result.failure)}`,
          );
          return;
        }
        onError(commandFailureMessage(result.failure));
      })();
    },
    [
      assignmentsByTicket,
      createAssignment,
      createThread,
      deleteThread,
      environmentId,
      existingThreadIds,
      onError,
      onOpenAssignedThread,
      onPendingChange,
      onRefreshThreadLookup,
      prepareTicketWorkspace,
      projects,
      providers,
      replaceAssignment,
      threadLookupReady,
    ],
  );
}
