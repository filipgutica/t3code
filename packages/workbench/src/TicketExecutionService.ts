import type { WorkbenchJiraOperationError, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  WorkbenchStore,
  type WorkbenchConsumeTicketExecutionInput,
  type WorkbenchExecutionRun,
} from "./WorkbenchStore.ts";
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";

export class TicketExecutionService extends Context.Service<
  TicketExecutionService,
  {
    readonly initialize: Effect.Effect<number, WorkbenchOperationError>;
    readonly pending: Effect.Effect<ReadonlyArray<WorkbenchExecutionRun>, WorkbenchOperationError>;
    readonly consume: (
      input: WorkbenchConsumeTicketExecutionInput,
    ) => Effect.Effect<WorkbenchExecutionRun | null, WorkbenchOperationError>;
    readonly resume: (
      run: WorkbenchExecutionRun,
    ) => Effect.Effect<void, WorkbenchOperationError | WorkbenchJiraOperationError>;
  }
>()("@t3tools/workbench/TicketExecutionService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const jira = yield* WorkbenchJiraService;
  const resume: TicketExecutionService["Service"]["resume"] = Effect.fn(
    "TicketExecutionService.resume",
  )(function* (run) {
    const admission = yield* store.beginTicketExecutionJira(run.runId);
    if (admission === "skip") return;
    // The attempt is durably uncertain before I/O. After interruption we only reconcile a readback.
    yield* jira.startTicketExecution({
      ticketId: run.ticketId,
      execution: {
        runId: run.runId,
        assignmentId: run.assignmentId,
        sequence: run.sequence,
        readbackOnly: admission === "resume",
      },
    });
    yield* store.completeTicketExecutionJira(run.runId);
  });
  const consume = store.consumeTicketExecution;
  return TicketExecutionService.of({
    initialize: store.initializeTicketExecution,
    pending: store.pendingTicketExecutions,
    consume,
    resume,
  });
});
export const layer = Layer.effect(TicketExecutionService, make);
