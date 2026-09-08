import type {
  IsoDateTime,
  ThreadId,
  WorkbenchJiraOperationError,
  WorkbenchOperationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkbenchStore } from "./WorkbenchStore.ts";
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";

export class TicketExecutionService extends Context.Service<
  TicketExecutionService,
  {
    readonly start: (input: {
      readonly threadId: ThreadId;
      readonly startedAt: IsoDateTime;
    }) => Effect.Effect<void, WorkbenchOperationError | WorkbenchJiraOperationError>;
  }
>()("@t3tools/workbench/TicketExecutionService") {}

export const layer = Layer.effect(
  TicketExecutionService,
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    const jira = yield* WorkbenchJiraService;

    const start: TicketExecutionService["Service"]["start"] = Effect.fn(
      "TicketExecutionService.start",
    )(function* (input) {
      const snapshot = yield* store.getSnapshot;
      const assignment = snapshot.assignments.find(
        (candidate) => candidate.threadId === input.threadId && candidate.supersededAt === null,
      );
      if (assignment === undefined) return;
      const ticket = snapshot.tickets.find((candidate) => candidate.id === assignment.ticketId);
      if (ticket === undefined || ticket.archivedAt !== null || ticket.status !== "todo") return;

      // The store checks persisted Jira ownership under its write lock, including inactive links.
      yield* store.startTicketExecution({ ticketId: ticket.id, startedAt: input.startedAt }).pipe(
        Effect.asVoid,
        Effect.catchIf(
          (error) => error.code === "jira_managed_ticket",
          () => jira.startTicketExecution({ ticketId: ticket.id }).pipe(Effect.asVoid),
        ),
      );
    });
    return TicketExecutionService.of({ start });
  }),
);
