import { WS_METHODS, type EnvironmentId, type WorkbenchTicketId } from "@t3tools/contracts";
import { request } from "@t3tools/client-runtime/rpc";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { connectionAtomRuntime } from "../connection/runtime";

const snapshot = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:snapshot",
  execute: (_input: Record<string, never>) =>
    request(WS_METHODS.workbenchGetSnapshot, { compact: true }),
  staleTimeMs: 5_000,
});

const ticketPreparations = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:ticket-preparations",
  tag: WS_METHODS.workbenchGetTicketPreparations,
  staleTimeMs: 5_000,
});

const scheduler = createAtomCommandScheduler();
const serialPerEnvironment = {
  mode: "serial",
  key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
} as const;

const discardTicketDraftOptions = {
  label: "environment-data:workbench:discard-ticket-draft",
  tag: WS_METHODS.workbenchDiscardTicketDraft,
  scheduler,
  concurrency: serialPerEnvironment,
};

const refreshSnapshot = (
  { environmentId }: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.sync(() => {
    registry.refresh(
      snapshot({
        environmentId,
        input: {},
      }),
    );
    registry.refresh(ticketPreparations({ environmentId, input: {} }));
  });

export const workbenchEnvironment = {
  snapshot,
  ticket: createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:workbench:ticket",
    execute: ({ ticketId }: { ticketId: WorkbenchTicketId; revision: number }) =>
      request(WS_METHODS.workbenchGetTicket, { ticketId }),
    staleTimeMs: 5_000,
  }),
  ticketContext: createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:workbench:ticket-context",
    // `inputs` changes with anything else in the text, as References and Threads keep the revision.
    execute: ({ ticketId }: { ticketId: WorkbenchTicketId; revision: number; inputs: string }) =>
      request(WS_METHODS.workbenchGetTicketContext, { ticketId }),
    staleTimeMs: 0,
    idleTtlMs: 0,
  }),
  // Start work needs the saved ticket and prepared paths, rather than a stale query value.
  readSnapshot: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:read-snapshot",
    tag: WS_METHODS.workbenchGetSnapshot,
    scheduler,
    concurrency: serialPerEnvironment,
  }),
  ticketPreparations,
  // One read per host tells attention which review discussions you answered last.
  pullRequestViewer: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:workbench:pull-request-viewer",
    tag: WS_METHODS.pullRequestsRoutingIdentity,
    staleTimeMs: 10 * 60_000,
  }),
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
  archiveProject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:archive-project",
    tag: WS_METHODS.workbenchArchiveProject,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  deleteProject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:delete-project",
    tag: WS_METHODS.workbenchDeleteProject,
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
  archiveEpic: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:archive-epic",
    tag: WS_METHODS.workbenchArchiveEpic,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
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
  setJiraIssueLink: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:set-jira-issue-link",
    tag: WS_METHODS.workbenchSetJiraIssueLink,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  addReference: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:add-reference",
    tag: WS_METHODS.workbenchAddReference,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  removeReference: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:remove-reference",
    tag: WS_METHODS.workbenchRemoveReference,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  // The conversation draft lives in the Workbench snapshot, so every transition refreshes it.
  beginTicketDraft: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:begin-ticket-draft",
    tag: WS_METHODS.workbenchBeginTicketDraft,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  updateTicketDraft: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:update-ticket-draft",
    tag: WS_METHODS.workbenchUpdateTicketDraft,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  promoteTicketDraft: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:promote-ticket-draft",
    tag: WS_METHODS.workbenchPromoteTicketDraft,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  discardTicketDraft: createEnvironmentRpcCommand(connectionAtomRuntime, {
    ...discardTicketDraftOptions,
    onSuccess: refreshSnapshot,
  }),
  // The board refreshes both queries once after its sequential batch settles.
  discardTicketDraftInBatch: createEnvironmentRpcCommand(
    connectionAtomRuntime,
    discardTicketDraftOptions,
  ),
  startTicketDraftWork: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:start-ticket-draft-work",
    tag: WS_METHODS.workbenchStartTicketDraftWork,
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
  unlinkAssignment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:unlink-assignment",
    tag: WS_METHODS.workbenchUnlinkAssignment,
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
