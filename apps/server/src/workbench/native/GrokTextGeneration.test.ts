// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import { GrokSettings } from "@t3tools/provider-grok/settings";

import * as ServerConfig from "../../config.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { makeGrokTextGeneration } from "@t3tools/provider-grok/testing";
import { execScriptSource, writeFakeCli } from "@t3tools/provider-testing/fakeCli";
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(
  __dirname,
  "../../provider/testFixtures/grok-text-mock-agent.mjs",
);

const layerGrokTextGenerationTest = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-grok-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeAcpGrokWrapper(dir: string, env: Record<string, string>): string {
  return writeFakeCli({
    directory: NodePath.join(dir, "bin"),
    name: "grok",
    env,
    source: execScriptSource({
      scriptPath: mockAgentPath,
      expectedArgs: ["agent", "stdio"],
    }),
  });
}

function withFakeAcpGrok<A, E, R>(
  env: Record<string, string>,
  effectFn: (textGeneration: TextGeneration.TextGeneration["Service"]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-grok-text-acp-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    );
    const binaryPath = makeAcpGrokWrapper(tempDir, env);
    const config = decodeGrokSettings({ binaryPath });
    const textGeneration = yield* makeGrokTextGeneration(config);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

it.layer(layerGrokTextGenerationTest)("GrokTextGeneration", (it) => {
  it.effect("generates structured JSON through Grok ACP", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          summary:
            "Improve request validation for selected analytics fields. Return a clear error before querying the provider when unsupported combinations are supplied.",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateStructured({
            operation: "generateExample",
            cwd: process.cwd(),
            prompt: "Summarize the supplied content.",
            outputSchema: Schema.Struct({ summary: Schema.String }),
            modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-build"),
          });

          expect(generated.summary).toContain("Improve request validation");
        }),
    ),
  );
});
