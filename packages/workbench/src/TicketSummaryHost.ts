import type { WorkbenchOperationError, WorkbenchTicket } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** The application supplies its configured text writer without exposing it to ticket storage. */
export class TicketSummaryHost extends Context.Service<
  TicketSummaryHost,
  {
    readonly generate: (
      ticket: Pick<WorkbenchTicket, "title" | "markdown" | "primaryT3ProjectId">,
    ) => Effect.Effect<string, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/TicketSummaryHost") {}
