import {
  CommandId,
  WorkbenchOperationError,
  type ThreadId,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { TicketDraftHost } from "@t3tools/workbench/TicketDraftHost";
import { layer as serviceLayer } from "@t3tools/workbench/TicketDraftService";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";

export { TicketDraftService } from "@t3tools/workbench/TicketDraftService";

const nativeFailure = () =>
  new WorkbenchOperationError({
    code: "ticket_draft_operation_failed",
    message: "The planning Thread could not be updated. Reload the draft and retry.",
  });
const makeHost = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const jira = yield* WorkbenchJiraService.WorkbenchJiraService;
  const ownsThread = (draft: WorkbenchTicketDraft) =>
    receipts.getByCommandId(CommandId.make(`ticket-draft:${draft.id}:create`)).pipe(
      Effect.map(
        (receipt) =>
          Option.isSome(receipt) &&
          receipt.value.status === "accepted" &&
          receipt.value.threadId === draft.threadId &&
          receipt.value.commandType === "thread.create",
      ),
      Effect.mapError(nativeFailure),
    );
  const checkIdle = Effect.fn("TicketDraftHost.requireIdle")(function* (
    threadId: ThreadId,
    allowArchived = false,
  ) {
    const projection = yield* threads
      .getThreadRecords(threadId, ["runs", "runtimeRequests"])
      .pipe(Effect.mapError(nativeFailure));
    if (
      projection.thread.deletedAt !== null ||
      (projection.thread.archivedAt !== null && !allowArchived)
    ) {
      return yield* new WorkbenchOperationError({
        code: "thread_not_found",
        message: "The planning Thread is no longer available.",
      });
    }
    if (
      projection.runs.some((run) =>
        ["preparing", "queued", "starting", "running", "waiting"].includes(run.status),
      ) ||
      projection.runtimeRequests.some((request) => request.status === "pending")
    ) {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_busy",
        message:
          "Wait for the planning turn to finish and resolve pending requests before continuing.",
      });
    }
  });
  return TicketDraftHost.of({
    validatePlanningModel: (model) =>
      providers.getInstance(model.instanceId).pipe(
        Effect.flatMap((instance) => {
          if (
            !instance ||
            !instance.enabled ||
            (instance.driverKind !== "codex" && instance.driverKind !== "claudeAgent")
          ) {
            return Effect.fail(
              new WorkbenchOperationError({
                code: "ticket_draft_invalid",
                message:
                  "Ticket planning currently requires a Codex or Claude provider with enforced read-only tools.",
              }),
            );
          }
          return Effect.void;
        }),
      ),
    createThread: Effect.fn("TicketDraftHost.createThread")(function* (draft) {
      yield* threads
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make(`ticket-draft:${draft.id}:create`),
          threadId: draft.threadId,
          projectId: draft.anchorProjectId,
          title: "Prepare ticket",
          createdBy: "user",
          creationSource: "web",
          modelSelection: draft.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "plan",
          branch: null,
          worktreePath: null,
        })
        .pipe(Effect.mapError(nativeFailure));
    }),
    requireIdle: (threadId) => checkIdle(threadId),
    requireDiscardable: Effect.fn("TicketDraftHost.requireDiscardable")(function* (draft) {
      if (!(yield* ownsThread(draft))) return;
      const existing = yield* threads
        .getThreadShell(draft.threadId)
        .pipe(Effect.mapError(nativeFailure));
      if (!existing || existing.deletedAt !== null) return;
      yield* checkIdle(draft.threadId, true);
    }),
    bindThread: Effect.fn("TicketDraftHost.bindThread")(function* ({
      draft,
      projectId,
      branch,
      worktreePath,
    }) {
      if (!(yield* ownsThread(draft))) return yield* nativeFailure();
      yield* checkIdle(draft.threadId);
      const current = yield* threads
        .getThreadShell(draft.threadId)
        .pipe(Effect.mapError(nativeFailure));
      if (!current) return yield* nativeFailure();
      yield* threads
        .dispatch({
          type: "thread.metadata.update",
          // Rejected native commands also have receipts. A fresh attempt can retry a busy/stale bind.
          commandId: CommandId.make(
            `ticket-draft:${draft.id}:bind:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
          ),
          threadId: draft.threadId,
          projectId,
          expectedProjectId: current.projectId,
          branch,
          worktreePath,
          expectedWorktreePath: current.worktreePath,
          ...(draft.phase === "promoting" ? { title: draft.fields.title } : {}),
        })
        .pipe(Effect.mapError(nativeFailure));
    }),
    startExecutionMode: Effect.fn("TicketDraftHost.startExecutionMode")(function* (draft) {
      yield* threads
        .dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make(
            `ticket-draft:${draft.id}:execution-mode:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
          ),
          threadId: draft.threadId,
          interactionMode: "default",
        })
        .pipe(Effect.mapError(nativeFailure));
    }),
    deleteThread: Effect.fn("TicketDraftHost.deleteThread")(function* (draft) {
      if (!(yield* ownsThread(draft))) return;
      const existing = yield* threads
        .getThreadShell(draft.threadId)
        .pipe(Effect.mapError(nativeFailure));
      if (!existing || existing.deletedAt !== null) return;
      yield* checkIdle(draft.threadId, true);
      yield* threads
        .dispatch({
          type: "thread.delete",
          commandId: CommandId.make(`ticket-draft:${draft.id}:delete`),
          threadId: draft.threadId,
        })
        .pipe(Effect.mapError(nativeFailure));
    }),
    createTicket: jira.createTicket,
  });
});

export const layer = serviceLayer.pipe(Layer.provide(Layer.effect(TicketDraftHost, makeHost)));
