import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as SourceControlProviderRegistry from "../../sourceControl/SourceControlProviderRegistry.ts";
import * as Layer from "effect/Layer";
import { ServerSettingsService } from "../../serverSettings.ts";

const makeStubTextGeneration = (
  overrides: Partial<TextGeneration.TextGeneration["Service"]>,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () =>
      Effect.die("generateCommitMessage stub not configured for this test"),
    generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
    generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
    generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
    generateStructured: () => Effect.die("generateStructured stub not configured for this test"),
    generateReviewGuide: () => Effect.die("generateReviewGuide stub not configured for this test"),
    ...overrides,
  });

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGeneration.TextGeneration["Service"],
): ProviderInstance =>
  ({
    instanceId,
    driverKind: instanceId as unknown as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: instanceId as unknown as ProviderInstance["driverKind"],
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("TextGeneration.make", () => {
  it.effect("delegates structured generation to the selected provider instance", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_personal");
      const calls: Array<{ operation: string; prompt: string }> = [];
      const instance = makeStubInstance(
        instanceId,
        makeStubTextGeneration({
          generateStructured: (input) => {
            calls.push({ operation: input.operation, prompt: input.prompt });
            const decodeOutput = Schema.decodeEffect(input.outputSchema);
            return decodeOutput({ summary: "A concise result." }).pipe(Effect.orDie);
          },
        }),
      );
      const tg = yield* TextGeneration.make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([instance]),
        ),
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
              resolveLink: () => Effect.die("No link lookup expected"),
            }),
            Layer.mock(ServerSettingsService)({}),
          ),
        ),
      );

      const result = yield* tg.generateStructured({
        operation: "generateExample",
        cwd: process.cwd(),
        prompt: "Summarize the example.",
        outputSchema: Schema.Struct({ summary: Schema.String }),
        modelSelection: createModelSelection(instanceId, "gpt-5"),
      });

      expect(result).toEqual({ summary: "A concise result." });
      expect(calls).toEqual([
        {
          operation: "generateExample",
          prompt: "Summarize the example.",
        },
      ]);
    }),
  );
});
