import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";
import { MuseSettings } from "../settings.ts";
import { makeMuseTextGeneration } from "./textGeneration.ts";

const settings = Schema.decodeSync(MuseSettings)({ enabled: true });

it.layer(NodeServices.layer)("Muse text generation", (it) => {
  it.effect("rejects caller-owned structured generation without opening a host", () =>
    Effect.gen(function* () {
      const createHost = vi.fn(async () => {
        throw new Error("No host expected");
      });
      const service = yield* makeMuseTextGeneration(settings, { createHost });
      const failure = yield* service
        .generateStructured({
          operation: "generateTicketSummary",
          cwd: "/project/should-not-be-used",
          prompt: "Summarize the supplied content.",
          outputSchema: Schema.Struct({ summary: Schema.String }),
          modelSelection: createModelSelection(
            ProviderInstanceId.make("muse"),
            "muse-spark-1.3-contributor",
            [{ id: "reasoningEffort", value: "high" }],
          ),
        })
        .pipe(Effect.flip);
      expect(failure).toMatchObject({
        _tag: "TextGenerationError",
        operation: "generateTicketSummary",
        detail: "Muse Code does not support caller-owned structured text generation.",
      });
      expect(createHost).not.toHaveBeenCalled();
    }),
  );
});
