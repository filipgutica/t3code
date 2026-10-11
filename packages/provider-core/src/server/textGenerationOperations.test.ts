import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeJsonReply,
  fromRunner,
  withoutInvestigation,
  type Runner,
} from "./textGenerationOperations.ts";

it.effect(
  "refuses investigation before running while allowing validated caller-owned generation",
  () =>
    Effect.gen(function* () {
      const operations: string[] = [];
      const run: Runner = (request) => {
        operations.push(request.operation);
        return decodeJsonReply(request, "Test", '{"summary":"A bounded result."}');
      };
      const generation = fromRunner("Test", withoutInvestigation("Test provider", run));
      const modelSelection = { instanceId: ProviderInstanceId.make("test"), model: "test" };
      const failure = yield* generation
        .generateReviewGuide({
          cwd: "/checkout",
          number: 42,
          title: "A change",
          description: "A bounded change",
          baseBranch: "main",
          baseCommit: "a".repeat(40),
          settledReview: "",
          modelSelection,
        })
        .pipe(Effect.flip);
      expect(failure).toMatchObject({
        _tag: "TextGenerationError",
        operation: "generateReviewGuide",
        detail: expect.stringContaining("cannot investigate a checkout read-only"),
      });
      expect(operations).toEqual([]);
      expect(
        yield* generation.generateStructured({
          operation: "generateCustomSummary",
          cwd: "/checkout",
          prompt: "Summarize the supplied content.",
          outputSchema: Schema.Struct({ summary: Schema.String }),
          modelSelection,
        }),
      ).toEqual({ summary: "A bounded result." });
      const invalid = yield* generation
        .generateStructured({
          operation: "generateCustomCount",
          cwd: "/checkout",
          prompt: "Count the supplied content.",
          outputSchema: Schema.Struct({ count: Schema.Int }),
          modelSelection,
        })
        .pipe(Effect.flip);
      expect(invalid.operation).toBe("generateCustomCount");
      expect(operations).toEqual(["generateCustomSummary", "generateCustomCount"]);
    }),
);
