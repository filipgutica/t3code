import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_RUNTIME_MODE,
  WorkbenchAssignmentId,
  type EnvironmentId,
  type ServerProvider,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { newThreadId, randomUUID } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { workbenchEnvironment } from "./state";
import { buildTicketThreadPrompt } from "./workbench.logic";

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
  onPendingChange,
  onError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly assignmentsByTicket: ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment>;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly onPendingChange: (action: string | null) => void;
  readonly onError: (message: string | null) => void;
}) {
  const navigate = useNavigate();
  const createAssignment = useAtomCommand(workbenchEnvironment.createAssignment, {
    reportFailure: false,
  });
  const replaceAssignment = useAtomCommand(workbenchEnvironment.replaceAssignment, {
    reportFailure: false,
  });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  return useCallback(
    (ticket: WorkbenchTicket) => {
      if (environmentId === null) return;
      void (async () => {
        onPendingChange(`start:${ticket.id}`);
        onError(null);
        const project = projects.find((candidate) => candidate.id === ticket.primaryT3ProjectId);
        if (!project) {
          onPendingChange(null);
          onError("The ticket's T3 Project is no longer available.");
          return;
        }
        const existing = assignmentsByTicket.get(ticket.id);
        if (existing && existingThreadIds.has(existing.threadId)) {
          onPendingChange(null);
          await navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId: existing.threadId },
          });
          return;
        }

        const threadId = newThreadId();
        const modelSelection = resolveDefaultProviderModelSelection(
          providers,
          project.defaultModelSelection,
        );
        if (modelSelection === null) {
          onPendingChange(null);
          onError("Configure an available Agent provider before starting this ticket.");
          return;
        }
        const createdAt = new Date().toISOString();
        const threadResult = await createThread({
          environmentId,
          input: {
            threadId,
            projectId: project.id,
            title: ticket.title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        });
        if (threadResult._tag === "Failure") {
          onPendingChange(null);
          if (!isAtomCommandInterrupted(threadResult)) {
            onError(commandFailureMessage(threadResult));
          }
          return;
        }
        const assignmentResult = existing
          ? await replaceAssignment({
              environmentId,
              input: {
                ticketId: ticket.id,
                previousThreadId: existing.threadId,
                threadId,
                replacedAt: createdAt,
              },
            })
          : await createAssignment({
              environmentId,
              input: {
                id: WorkbenchAssignmentId.make(randomUUID()),
                ticketId: ticket.id,
                threadId,
                createdAt,
              },
            });
        if (assignmentResult._tag === "Failure") {
          const cleanupResult = await deleteThread({
            environmentId,
            input: { threadId },
          });
          if (cleanupResult._tag === "Failure" && !isAtomCommandInterrupted(cleanupResult)) {
            console.warn(
              "Failed to clean up a Workbench Thread after Assignment creation failed.",
              squashAtomCommandFailure(cleanupResult),
            );
          }
          onPendingChange(null);
          if (!isAtomCommandInterrupted(assignmentResult)) {
            onError(commandFailureMessage(assignmentResult));
          }
          return;
        }

        useComposerDraftStore
          .getState()
          .setPrompt(scopeThreadRef(environmentId, threadId), buildTicketThreadPrompt(ticket));
        onPendingChange(null);
        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        });
      })();
    },
    [
      assignmentsByTicket,
      createAssignment,
      createThread,
      deleteThread,
      environmentId,
      existingThreadIds,
      navigate,
      onError,
      onPendingChange,
      projects,
      providers,
      replaceAssignment,
    ],
  );
}
