import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { TicketSummaryHost } from "@t3tools/workbench/TicketSummaryHost";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  type TicketSummaryGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import { ticketSummaryHostLayer } from "./TicketSummaryService.ts";

const projectId = ProjectId.make("summary-primary");
const ticket = {
  primaryT3ProjectId: projectId,
  title: "Validate dimensions",
  markdown: "The complete saved description.",
};

describe("TicketSummaryHost", () => {
  it.effect(
    "uses the current text generation selection and the primary repository for each job",
    () =>
      Effect.gen(function* () {
        const first = createModelSelection(ProviderInstanceId.make("writer-one"), "model-one");
        const second = createModelSelection(ProviderInstanceId.make("writer-two"), "model-two");
        let selection: ModelSelection = first;
        const calls: TicketSummaryGenerationInput[] = [];
        yield* Effect.gen(function* () {
          const host = yield* TicketSummaryHost;
          expect(yield* host.generate(ticket)).toBe("A generated summary.");
          selection = second;
          yield* host.generate(ticket);
          expect(calls).toEqual(
            [first, second].map((modelSelection) => ({
              cwd: "/repos/primary",
              title: ticket.title,
              description: ticket.markdown,
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
                  generateTicketSummary: (input) =>
                    Effect.sync(() => {
                      calls.push(input);
                      return { summary: "A generated summary." };
                    }),
                }),
              ),
            ),
          ),
        );
      }),
  );
});
