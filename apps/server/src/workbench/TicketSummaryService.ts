import { TextGenerationError, WorkbenchOperationError } from "@t3tools/contracts";
import { TicketSummaryHost } from "@t3tools/workbench/TicketSummaryHost";
import { TicketSummaryServiceLive as serviceLayer } from "@t3tools/workbench/TicketSummaryService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration, layer as textGenerationLayer } from "../textGeneration/TextGeneration.ts";
import { buildTicketSummaryPrompt, sanitizeTicketSummary } from "./ticketSummaryText.ts";

export { TicketSummaryService } from "@t3tools/workbench/TicketSummaryService";

const OPEN_CODE_FREE_TIER_REJECTION =
  "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode";

export const ticketSummaryHostLayer = Layer.effect(
  TicketSummaryHost,
  Effect.gen(function* () {
    const projections = yield* ProjectStoreV2;
    const settings = yield* ServerSettingsService;
    const textGeneration = yield* TextGeneration;
    return TicketSummaryHost.of({
      generate: Effect.fn("TicketSummaryHost.generate")(function* (ticket) {
        const project = yield* projections.getShell(ticket.primaryT3ProjectId).pipe(
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
        const { prompt, outputSchema } = buildTicketSummaryPrompt({
          title: ticket.title,
          description: ticket.markdown,
        });
        const summary = yield* textGeneration
          .generateStructured({
            operation: "generateTicketSummary",
            cwd: project.value.workspaceRoot,
            prompt,
            outputSchema,
            modelSelection: currentSettings.textGenerationModelSelection,
          })
          .pipe(
            Effect.map((result) => sanitizeTicketSummary(result.summary)),
            Effect.filterOrFail(
              (result) => result.length > 0,
              () =>
                new TextGenerationError({
                  operation: "generateTicketSummary",
                  detail: "The model returned an empty ticket summary.",
                }),
            ),
            Effect.mapError(
              (error) =>
                new WorkbenchOperationError({
                  code: "ticket_summary_generation_failed",
                  message:
                    error.detail === OPEN_CODE_FREE_TIER_REJECTION
                      ? "The free OpenCode model can't generate this summary. Your Ticket is saved and Thread chat still works. If you connect another provider, select it in Settings → General and retry."
                      : `${error.detail} Check Settings → General → Text generation model, then regenerate the summary.`,
                }),
            ),
          );
        return summary;
      }),
    });
  }),
);

export const TicketSummaryServiceLive = serviceLayer.pipe(
  Layer.provide(ticketSummaryHostLayer.pipe(Layer.provide(textGenerationLayer))),
);
