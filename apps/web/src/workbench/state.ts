import { WS_METHODS, type EnvironmentId, type WorkbenchTicketId } from "@t3tools/contracts";
import { request } from "@t3tools/client-runtime/rpc";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { connectionAtomRuntime } from "../connection/runtime";

const snapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:snapshot",
  tag: WS_METHODS.workbenchGetSnapshot,
  staleTimeMs: 5_000,
});

const jiraSnapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:jira:snapshot",
  tag: WS_METHODS.workbenchJiraGetSnapshot,
  staleTimeMs: 5_000,
});

const JIRA_TRANSITIONS_STALE_TIME_MS = 30_000;
const jiraTicketTransitionsCache = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:jira:get-ticket-transitions",
  staleTimeMs: JIRA_TRANSITIONS_STALE_TIME_MS,
  // Workflow actions belong to a Jira revision; a refreshed issue must not reuse old actions.
  execute: ({ ticketId }: { ticketId: WorkbenchTicketId; remoteUpdatedAt: string | null }) =>
    request(WS_METHODS.workbenchJiraGetTicketTransitions, { ticketId }),
});

// Retain the shared result, but recreate its observer on menu open so SWR checks its age.
// Keeping the observer alive for the cache's idle TTL would skip that check on reopen.
const jiraTicketTransitionsObserver = Atom.family(
  (cached: ReturnType<typeof jiraTicketTransitionsCache>) =>
    cached.pipe(
      Atom.swr({ staleTime: JIRA_TRANSITIONS_STALE_TIME_MS, revalidateOnMount: true }),
      Atom.setIdleTTL(0),
    ),
);

const scheduler = createAtomCommandScheduler();
const serialPerEnvironment = {
  mode: "serial",
  key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
} as const;

const refreshSnapshot = (
  { environmentId }: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.sync(() =>
    registry.refresh(
      snapshot({
        environmentId,
        input: {},
      }),
    ),
  );

const refreshJiraSnapshot = (
  { environmentId }: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.sync(() =>
    registry.refresh(
      jiraSnapshot({
        environmentId,
        input: {},
      }),
    ),
  );

const refreshWorkbenchAndJiraSnapshots = (
  input: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.all([refreshSnapshot(input, registry), refreshJiraSnapshot(input, registry)], {
    discard: true,
  });

export const workbenchEnvironment = {
  snapshot,
  jiraSnapshot,
  createProject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-project",
    tag: WS_METHODS.workbenchCreateProject,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  updateProject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:update-project",
    tag: WS_METHODS.workbenchUpdateProject,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  createEpic: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-epic",
    tag: WS_METHODS.workbenchCreateEpic,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  updateEpic: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:update-epic",
    tag: WS_METHODS.workbenchUpdateEpic,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  jiraBeginAuth: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:begin-auth",
    tag: WS_METHODS.workbenchJiraBeginAuth,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  jiraCompleteAuth: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:complete-auth",
    tag: WS_METHODS.workbenchJiraCompleteAuth,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshJiraSnapshot,
  }),
  jiraListProjects: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:list-projects",
    tag: WS_METHODS.workbenchJiraListProjects,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  jiraListBoards: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:list-boards",
    tag: WS_METHODS.workbenchJiraListBoards,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  jiraListSprints: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:list-sprints",
    tag: WS_METHODS.workbenchJiraListSprints,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  jiraGetBoardConfiguration: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:get-board-configuration",
    tag: WS_METHODS.workbenchJiraGetBoardConfiguration,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  jiraCreateBinding: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:create-binding",
    tag: WS_METHODS.workbenchJiraCreateBinding,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshJiraSnapshot,
  }),
  jiraUpdateBinding: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:update-binding",
    tag: WS_METHODS.workbenchJiraUpdateBinding,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshJiraSnapshot,
  }),
  jiraSyncBinding: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:sync-binding",
    tag: WS_METHODS.workbenchJiraSyncBinding,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshWorkbenchAndJiraSnapshots,
  }),
  jiraUpdateTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:jira:update-ticket",
    tag: WS_METHODS.workbenchJiraUpdateTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshWorkbenchAndJiraSnapshots,
  }),
  jiraGetTicketTransitions: (target: Parameters<typeof jiraTicketTransitionsCache>[0]) =>
    jiraTicketTransitionsObserver(jiraTicketTransitionsCache(target)),
  createTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-ticket",
    tag: WS_METHODS.workbenchCreateTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  updateTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:update-ticket",
    tag: WS_METHODS.workbenchUpdateTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  regenerateTicketSummary: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:regenerate-ticket-summary",
    tag: WS_METHODS.workbenchRegenerateTicketSummary,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  archiveTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:archive-ticket",
    tag: WS_METHODS.workbenchArchiveTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  deleteTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:delete-ticket",
    tag: WS_METHODS.workbenchDeleteTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  createAssignment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-assignment",
    tag: WS_METHODS.workbenchCreateAssignment,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  replaceAssignment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:replace-assignment",
    tag: WS_METHODS.workbenchReplaceAssignment,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  prepareTicketWorkspace: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:prepare-ticket-workspace",
    tag: WS_METHODS.workbenchPrepareTicketWorkspace,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  releaseTicketWorkspace: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:release-ticket-workspace",
    tag: WS_METHODS.workbenchReleaseTicketWorkspace,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
};
