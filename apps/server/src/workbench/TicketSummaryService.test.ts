import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { TicketSummaryHost } from "@t3tools/workbench/TicketSummaryHost";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { ticketSummaryHostLayer } from "./TicketSummaryService.ts";
import { buildTicketSummaryPrompt } from "./ticketSummaryText.ts";

const projectId = ProjectId.make("summary-primary");
const ticket = {
  primaryT3ProjectId: projectId,
  title: "Validate dimensions",
  markdown: "The complete saved description.",
};

describe("TicketSummaryHost", () => {
  it.effect("explains the free OpenCode rejection without masking other generation errors", () =>
    Effect.gen(function* () {
      let detail: string | null =
        "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode";
      yield* Effect.gen(function* () {
        const host = yield* TicketSummaryHost;
        const rejected = yield* Effect.flip(host.generate(ticket));
        expect(rejected.message).toBe(
          "The free OpenCode model can't generate this summary. Your Ticket is saved and Thread chat still works. If you connect another provider, select it in Settings → General and retry.",
        );

        detail = "Provider timed out.";
        const unrelated = yield* Effect.flip(host.generate(ticket));
        expect(unrelated.message).toBe(
          "Provider timed out. Check Settings → General → Text generation model, then regenerate the summary.",
        );

        detail = null;
        const empty = yield* Effect.flip(host.generate(ticket));
        expect(empty.message).toBe(
          "The model returned an empty ticket summary. Check Settings → General → Text generation model, then regenerate the summary.",
        );
      }).pipe(
        Effect.provide(
          ticketSummaryHostLayer.pipe(
            Layer.provide(
              Layer.mock(ProjectionSnapshotQuery)({
                getProjectShellById: (id) =>
                  Effect.succeed(
                    Option.some({
                      id,
                      title: "Primary",
                      workspaceRoot: "/repos/primary",
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: "2026-09-07T10:00:00.000Z",
                      updatedAt: "2026-09-07T10:00:00.000Z",
                    }),
                  ),
              }),
            ),
            Layer.provide(
              Layer.mock(ServerSettingsService)({
                getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
              }),
            ),
            Layer.provide(
              Layer.mock(TextGeneration)({
                generateStructured: (input) =>
                  detail
                    ? Effect.fail(
                        new TextGenerationError({ operation: "generateTicketSummary", detail }),
                      )
                    : Schema.decodeUnknownEffect(input.outputSchema)({ summary: "  \n " }).pipe(
                        Effect.orDie,
                      ),
              }),
            ),
          ),
        ),
      );
    }),
  );

  it.effect(
    "uses the current text generation selection and the primary repository for each job",
    () =>
      Effect.gen(function* () {
        const first = createModelSelection(ProviderInstanceId.make("writer-one"), "model-one");
        const second = createModelSelection(ProviderInstanceId.make("writer-two"), "model-two");
        let selection: ModelSelection = first;
        const calls: Array<{
          operation: string;
          cwd: string;
          prompt: string;
          modelSelection: ModelSelection;
        }> = [];
        yield* Effect.gen(function* () {
          const host = yield* TicketSummaryHost;
          expect(yield* host.generate(ticket)).toBe("A generated summary.");
          selection = second;
          yield* host.generate(ticket);
          expect(calls).toEqual(
            [first, second].map((modelSelection) => ({
              cwd: "/repos/primary",
              operation: "generateTicketSummary",
              prompt: buildTicketSummaryPrompt({
                title: ticket.title,
                description: ticket.markdown,
              }).prompt,
              modelSelection,
            })),
          );
        }).pipe(
          Effect.provide(
            ticketSummaryHostLayer.pipe(
              Layer.provide(
                Layer.mock(ProjectionSnapshotQuery)({
                  getProjectShellById: (id) =>
                    Effect.succeed(
                      Option.some({
                        id,
                        title: "Primary",
                        workspaceRoot: "/repos/primary",
                        defaultModelSelection: null,
                        scripts: [],
                        createdAt: "2026-09-07T10:00:00.000Z",
                        updatedAt: "2026-09-07T10:00:00.000Z",
                      }),
                    ),
                }),
              ),
              Layer.provide(
                Layer.mock(ServerSettingsService)({
                  getSettings: Effect.sync(() => ({
                    ...DEFAULT_SERVER_SETTINGS,
                    textGenerationModelSelection: selection,
                  })),
                }),
              ),
              Layer.provide(
                Layer.mock(TextGeneration)({
                  generateStructured: (input) =>
                    Effect.sync(() => {
                      calls.push({
                        operation: input.operation,
                        cwd: input.cwd,
                        prompt: input.prompt,
                        modelSelection: input.modelSelection,
                      });
                    }).pipe(
                      Effect.andThen(
                        Schema.decodeUnknownEffect(input.outputSchema)({
                          summary: "## Summary\nA generated summary. https://example.com/details",
                        }).pipe(Effect.orDie),
                      ),
                    ),
                }),
              ),
            ),
          ),
        );
      }),
  );
});
