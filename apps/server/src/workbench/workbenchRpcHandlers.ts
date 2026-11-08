import { WORKBENCH_WS_METHODS, WorkbenchRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as RpcGroup from "effect/rpc/RpcGroup";

import * as AskForChangeService from "./AskForChangeService.ts";
import * as TicketContextService from "./TicketContextService.ts";
import * as TicketDraftService from "./TicketDraftService.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";

type WorkbenchRpcHandlers = RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WorkbenchRpcGroup>>;

export type WorkbenchRpcServices = {
  readonly askForChange: AskForChangeService.AskForChangeService["Service"];
  readonly ticketDrafts: TicketDraftService.TicketDraftService["Service"];
  readonly ticketContexts: TicketContextService.TicketContextService["Service"];
  readonly workbench: WorkbenchStore.WorkbenchStore["Service"];
  readonly ticketWorkspaces: TicketWorkspaceService.TicketWorkspaceService["Service"];
  readonly ticketSummaries: TicketSummaryService.TicketSummaryService["Service"];
  readonly workspaceLifecycle: WorkspaceLifecycleService.WorkspaceLifecycleService["Service"];
};

export const acquireWorkbenchRpcServices = Effect.gen(function* () {
  const askForChange = yield* AskForChangeService.AskForChangeService;
  const ticketDrafts = yield* TicketDraftService.TicketDraftService;
  const ticketContexts = yield* TicketContextService.TicketContextService;
  const workbench = yield* WorkbenchStore.WorkbenchStore;
  const ticketWorkspaces = yield* TicketWorkspaceService.TicketWorkspaceService;
  const ticketSummaries = yield* TicketSummaryService.TicketSummaryService;
  const workspaceLifecycle = yield* WorkspaceLifecycleService.WorkspaceLifecycleService;

  return {
    askForChange,
    ticketDrafts,
    ticketContexts,
    workbench,
    ticketWorkspaces,
    ticketSummaries,
    workspaceLifecycle,
  } satisfies WorkbenchRpcServices;
});

export const makeWorkbenchRpcHandlers = ({
  askForChange,
  ticketDrafts,
  ticketContexts,
  workbench,
  ticketWorkspaces,
  ticketSummaries,
  workspaceLifecycle,
}: WorkbenchRpcServices) =>
  ({
    [WORKBENCH_WS_METHODS.workbenchBeginTicketDraft]: (input) => ticketDrafts.begin(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateTicketDraft]: (input) => ticketDrafts.update(input),
    [WORKBENCH_WS_METHODS.workbenchPromoteTicketDraft]: (input) => ticketDrafts.promote(input),
    [WORKBENCH_WS_METHODS.workbenchDiscardTicketDraft]: (input) => ticketDrafts.discard(input),
    [WORKBENCH_WS_METHODS.workbenchStartTicketDraftWork]: (input) => ticketDrafts.startWork(input),
    [WORKBENCH_WS_METHODS.workbenchAcceptTicketDraftReview]: (input) =>
      workbench.resolveTicketDraftReview({ ...input, resolution: "accept" }),
    [WORKBENCH_WS_METHODS.workbenchUndoTicketDraftReview]: (input) =>
      workbench.resolveTicketDraftReview({ ...input, resolution: "undo" }),
    [WORKBENCH_WS_METHODS.workbenchAskForTicketDraftChange]: (input) =>
      askForChange.askForDraftChange(input),
    [WORKBENCH_WS_METHODS.workbenchGetTicketPreparations]: (_input) =>
      workbench.getTicketPreparations,
    [WORKBENCH_WS_METHODS.workbenchGetSnapshot]: (input) =>
      input.compact ? workbench.getCompactSnapshot : workbench.getSnapshot,
    [WORKBENCH_WS_METHODS.workbenchGetTicket]: (input) =>
      workbench.getTicket(input.ticketId).pipe(Effect.map(Option.getOrNull)),
    [WORKBENCH_WS_METHODS.workbenchGetTicketContext]: (input) =>
      ticketContexts.forTicket(input.ticketId),
    [WORKBENCH_WS_METHODS.workbenchCreateProject]: (input) => workbench.createProject(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateProject]: (input) => workbench.updateProject(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveProject]: (input) => workspaceLifecycle.archive(input),
    [WORKBENCH_WS_METHODS.workbenchDeleteProject]: (input) => workspaceLifecycle.delete(input),
    [WORKBENCH_WS_METHODS.workbenchCreateTicket]: (input) => workbench.createTicket(input),
    [WORKBENCH_WS_METHODS.workbenchUpdateTicket]: (input) =>
      workbench.updateTicket({ ...input, writer: { kind: "user" } }),
    [WORKBENCH_WS_METHODS.workbenchRegenerateTicketSummary]: (input) =>
      ticketSummaries.regenerate(input),
    [WORKBENCH_WS_METHODS.workbenchAcceptTicketReview]: (input) =>
      workbench.resolveTicketReview({ ...input, resolution: "accept" }),
    [WORKBENCH_WS_METHODS.workbenchUndoTicketReview]: (input) =>
      workbench.resolveTicketReview({ ...input, resolution: "undo" }),
    [WORKBENCH_WS_METHODS.workbenchAskForTicketChange]: (input) =>
      askForChange.askForTicketChange(input),
    [WORKBENCH_WS_METHODS.workbenchArchiveTicket]: (input) => workbench.archiveTicket(input),
    [WORKBENCH_WS_METHODS.workbenchDeleteTicket]: (input) => workbench.deleteTicket(input),
    [WORKBENCH_WS_METHODS.workbenchCreateAssignment]: (input) => workbench.createAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchUnlinkAssignment]: (input) => workbench.unlinkAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchReplaceAssignment]: (input) =>
      workbench.replaceAssignment(input),
    [WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace]: (input) =>
      ticketWorkspaces.prepare(input),
    [WORKBENCH_WS_METHODS.workbenchReleaseTicketWorkspace]: (input) =>
      ticketWorkspaces.release(input),
    [WORKBENCH_WS_METHODS.workbenchListTicketWorktrees]: (input) =>
      ticketWorkspaces.listWorktrees(input),
    [WORKBENCH_WS_METHODS.workbenchRemoveTicketWorktree]: (input) =>
      ticketWorkspaces.removeWorktree(input),
    [WORKBENCH_WS_METHODS.workbenchAddReference]: (input) =>
      workbench.addReference({ ...input, addedByThreadId: null }),
    [WORKBENCH_WS_METHODS.workbenchRemoveReference]: (input) => workbench.removeReference(input),
  }) satisfies WorkbenchRpcHandlers;
