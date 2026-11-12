import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  WorkbenchAssignmentId,
  type EnvironmentId,
  type ServerProvider,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchProject,
  type WorkbenchTicket,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { useComposerDraftStore } from "../composerDraftStore";
import { newThreadId, randomUUID } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  coordinateWorkbenchTicketStart,
  type WorkbenchTicketStartStage,
  type StartWorkbenchTicketOptions,
} from "./startWorkbenchTicket";
import { workbenchEnvironment } from "./state";
import { getWorkbenchThreadLookupState, type WorkbenchThreadLookupState } from "./workbench.logic";
import { waitForWorkbenchThread } from "./waitForWorkbenchThread";
import { resolveWorkbenchDefaultModelSelection } from "./workbenchTicketDraft.logic";

const commandFailureMessage = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Workbench request failed.";
};

const remoteLaunchFailureMessage = (
  result: Extract<
    Awaited<ReturnType<typeof coordinateWorkbenchTicketStart>>,
    { state: "not-started" | "launch-rejected" }
  >,
) =>
  result.state === "launch-rejected"
    ? `That machine refused to start this Thread and will refuse every retry. Remove it from the Ticket and start a new Thread. ${commandFailureMessage(result.failure)}`
    : `The Thread is assigned but did not start on its machine. Retry, or remove it from the Ticket. ${commandFailureMessage(result.failure)}`;

const reportTicketStartResult = ({
  result,
  onError,
  onRefreshThreadLookup,
}: {
  result: Awaited<ReturnType<typeof coordinateWorkbenchTicketStart>>;
  onError: (message: string | null) => void;
  onRefreshThreadLookup: () => void;
}) => {
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
  if (result.state === "host-outdated") {
    onError(
      "Update T3 Code on the Workbench host before starting a Thread on another machine. This host would send that Thread instructions it cannot use.",
    );
    return;
  }
  if (result.state === "remote-read-only") {
    onError(
      "This connection can only view Threads on that machine. Start the Thread in another repository, or reconnect with access to change Threads there.",
    );
    return;
  }
  if (result.state === "ticket-unavailable") {
    onError("This Ticket is no longer available for a new Thread.");
    return;
  }
  if (result.state === "not-started" || result.state === "launch-rejected") {
    if (!isAtomCommandInterrupted(result.failure)) onError(remoteLaunchFailureMessage(result));
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
  if (result.state === "failed") reportTicketStartFailure(result, onError);
};

const reportTicketStartFailure = (
  result: Extract<Awaited<ReturnType<typeof coordinateWorkbenchTicketStart>>, { state: "failed" }>,
  onError: (message: string | null) => void,
) => {
  if (result.cleanupFailure && !isAtomCommandInterrupted(result.cleanupFailure)) {
    console.warn(
      "Failed to clean up a Workbench Thread after Assignment creation failed.",
      squashAtomCommandFailure(result.cleanupFailure),
    );
  }
  if (isAtomCommandInterrupted(result.failure)) return;
  if (result.stage === "repositories") {
    onError(
      `Repository choices could not be saved. Review the repositories and try again. ${commandFailureMessage(result.failure)}`,
    );
    return;
  }
  if (result.stage === "workspace") {
    onError(
      `The Ticket repositories could not be prepared. ${commandFailureMessage(result.failure)}`,
    );
    return;
  }
  onError(
    result.stage === "thread"
      ? `The workspace is prepared, but the Thread could not be created. Try Create thread again to reuse it. ${commandFailureMessage(result.failure)}`
      : commandFailureMessage(result.failure),
  );
};

export function useStartWorkbenchTicket({
  environmentId,
  projects,
  providers,
  assignmentsByTicket,
  existingThreadIds,
  threadLookupReady,
  remoteEnvironmentStates,
  boards,
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
  readonly remoteEnvironmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState>;
  readonly boards: ReadonlyArray<WorkbenchProject>;
  readonly onRefreshThreadLookup: () => void;
  readonly onOpenAssignedThread: (
    threadId: ThreadId,
    environmentId: EnvironmentId,
  ) => Promise<void>;
  readonly onPendingChange: (action: string | null) => void;
  readonly onError: (message: string | null) => void;
}) {
  const updateTicket = useAtomCommand(workbenchEnvironment.updateTicket, { reportFailure: false });
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
  const readTicketContext = useAtomCommand(workbenchEnvironment.readTicketContext, {
    reportFailure: false,
  });
  // The native send path's launch, checked against the Thread's own environment's grants.
  const launchThread = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  /** `openThread` replaces `onOpenAssignedThread` for this start, such as to stay on the page. */
  return async (
    ticket: WorkbenchTicket,
    options?: StartWorkbenchTicketOptions,
    openThread: (
      threadId: ThreadId,
      environmentId: EnvironmentId,
    ) => Promise<void> = onOpenAssignedThread,
  ) => {
    if (environmentId === null) return;
    onPendingChange(`start:${ticket.id}:checking-thread`);
    onError(null);
    const assignment = options?.assignment ?? assignmentsByTicket.get(ticket.id);
    const result = await (async () => {
      try {
        return await coordinateWorkbenchTicketStart(
          {
            environmentId,
            ticket,
            projects,
            assignment,
            existingThreadIds,
            threadLookupState:
              assignment === undefined
                ? "ready"
                : getWorkbenchThreadLookupState({
                    assignment,
                    threadLookupReady,
                    remoteEnvironmentStates,
                  }),
            board: boards.find((board) => board.id === ticket.projectId),
          },
          {
            updateTicket,
            prepareTicketWorkspace,
            createThread,
            createAssignment,
            replaceAssignment,
            deleteThread,
            readTicketContext,
            launchThread,
            canOperateEnvironment: (id) => readEnvironmentScope(id, AuthOrchestrationOperateScope),
            waitForThread: waitForWorkbenchThread,
            openThread,
            resolveRuntimeMode: (project) => {
              const settings =
                appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId)
                  ?.settings ?? DEFAULT_SERVER_SETTINGS;
              return resolveProjectSettings(settings, project.id).settings.defaultRuntimeMode;
            },
            resolveModelSelection: (project) => {
              const settings =
                appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
                DEFAULT_SERVER_SETTINGS;
              const { stickyActiveProvider, stickyModelSelectionByProvider } =
                useComposerDraftStore.getState();
              return resolveDefaultProviderModelSelection(
                providers,
                resolveWorkbenchDefaultModelSelection({
                  settings,
                  projectId: project.id,
                  project,
                }) ??
                  (stickyActiveProvider === null
                    ? null
                    : stickyModelSelectionByProvider[stickyActiveProvider]),
              );
            },
            makeThreadId: newThreadId,
            makeAssignmentId: () => WorkbenchAssignmentId.make(randomUUID()),
            now: () => new Date().toISOString(),
            onStage: (stage: WorkbenchTicketStartStage) =>
              onPendingChange(`start:${ticket.id}:${stage}`),
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
      }
    })().finally(() => {
      onPendingChange(null);
    });
    if (result === undefined) return;

    reportTicketStartResult({ result, onError, onRefreshThreadLookup });
    return result;
  };
}
