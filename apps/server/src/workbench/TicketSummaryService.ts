import { WorkbenchOperationError } from "@t3tools/contracts";
import { TicketSummaryHost } from "@t3tools/workbench/TicketSummaryHost";
import { TicketSummaryServiceLive as serviceLayer } from "@t3tools/workbench/TicketSummaryService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration, layer as textGenerationLayer } from "../textGeneration/TextGeneration.ts";

export { TicketSummaryService } from "@t3tools/workbench/TicketSummaryService";

export const ticketSummaryHostLayer = Layer.effect(
  TicketSummaryHost,
  Effect.gen(function* () {
    const projections = yield* ProjectionSnapshotQuery;
    const settings = yield* ServerSettingsService;
    const textGeneration = yield* TextGeneration;
    return TicketSummaryHost.of({
      generate: Effect.fn("TicketSummaryHost.generate")(function* (ticket) {
        const project = yield* projections.getProjectShellById(ticket.primaryT3ProjectId).pipe(
          Effect.mapError(
            () =>
              new WorkbenchOperationError({
                code: "ticket_summary_generation_failed",
                message:
                  "The ticket's repository could not be loaded. Check its repository scope and try again.",
              }),
          ),
        );
        if (Option.isNone(project)) {
          return yield* new WorkbenchOperationError({
            code: "ticket_summary_generation_failed",
            message:
              "The ticket's repository is unavailable. Check its repository scope and try again.",
          });
        }
        const currentSettings = yield* settings.getSettings.pipe(
          Effect.mapError(
            () =>
              new WorkbenchOperationError({
                code: "ticket_summary_generation_failed",
                message:
                  "The text generation model settings could not be loaded. Try regenerating the summary.",
              }),
          ),
        );
        const result = yield* textGeneration
          .generateTicketSummary({
            cwd: project.value.workspaceRoot,
            title: ticket.title,
            description: ticket.markdown,
            modelSelection: currentSettings.textGenerationModelSelection,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new WorkbenchOperationError({
                  code: "ticket_summary_generation_failed",
                  message: `${error.detail} Check Settings → General → Text generation model, then regenerate the summary.`,
                }),
            ),
          );
        return result.summary;
      }),
    });
  }),
);

export const TicketSummaryServiceLive = serviceLayer.pipe(
  Layer.provide(ticketSummaryHostLayer.pipe(Layer.provide(textGenerationLayer))),
);
