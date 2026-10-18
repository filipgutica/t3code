import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as Schema from "effect/Schema";

import { createModelSelection } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";

import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";

import * as ServerConfig from "../../config.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const DEFAULT_TEST_MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("codex"),
  "gpt-5.4-mini",
);

const layerCodexTextGenerationTest = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-codex-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

interface FakeCodexInput {
  output: string;
  exitCode?: number;
  stderr?: string;
  requireImage?: boolean;
  requireServiceTier?: string;
  requireReasoningEffort?: string;
  forbidReasoningEffort?: boolean;
  requireArg?: string;
  forbidArg?: string;
  stdinMustContain?: string;
  stdinMustNotContain?: string;
  mcpServers?: ReadonlyArray<{ name: string; enabled: boolean }> | number;
}

function makeFakeCodexBinary(dir: string, input: FakeCodexInput) {
  const check = JSON.stringify({
    requireImage: input.requireImage ?? false,
    requireServiceTier: input.requireServiceTier ?? null,
    requireReasoningEffort: input.requireReasoningEffort ?? null,
    forbidReasoningEffort: input.forbidReasoningEffort ?? false,
    requireArg: input.requireArg ?? null,
    forbidArg: input.forbidArg ?? null,
    stdinMustContain: input.stdinMustContain ?? null,
    stdinMustNotContain: input.stdinMustNotContain ?? null,
    mcpServers: input.mcpServers ?? [],
    stderr: input.stderr ?? null,
    output: input.output,
    exitCode: input.exitCode ?? 0,
  });
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    return writeFakeCli({
      directory: path.join(dir, "bin"),
      name: "codex",
      source: [
        'import * as NodeFS from "node:fs";',
        `const check = ${check};`,
        "const args = process.argv.slice(2);",
        'if (args.includes("mcp") && args.includes("list")) {',
        '  if (typeof check.mcpServers === "number") process.exit(check.mcpServers);',
        "  process.stdout.write(JSON.stringify(check.mcpServers));",
        "  process.exit(0);",
        "}",
        'const originalArgs = ` ${args.join(" ")} `;',
        "let outputPath = null;",
        "let seenImage = false;",
        'let seenServiceTier = "";',
        'let seenReasoningEffort = "";',
        "for (let index = 0; index < args.length; index += 1) {",
        '  if (args[index] === "--image") {',
        "    index += 1;",
        "    if (args[index]) seenImage = true;",
        '  } else if (args[index] === "--config") {',
        "    index += 1;",
        '    const value = args[index] ?? "";',
        '    if (value.startsWith("service_tier=")) seenServiceTier = value;',
        '    if (value.startsWith("model_reasoning_effort=")) seenReasoningEffort = value;',
        '  } else if (args[index] === "--output-last-message") {',
        "    index += 1;",
        "    outputPath = args[index] ?? null;",
        "  }",
        "}",
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        'const stdinContent = Buffer.concat(chunks).toString("utf8");',
        "function fail(message, code) {",
        '  process.stderr.write(message + "\\n");',
        "  process.exit(code);",
        "}",
        "if (check.requireArg !== null && !originalArgs.includes(` ${check.requireArg} `)) {",
        '  fail("missing arg: " + check.requireArg, 8);',
        "}",
        "if (check.forbidArg !== null && originalArgs.includes(` ${check.forbidArg} `)) {",
        '  fail("forbidden arg: " + check.forbidArg, 9);',
        "}",
        'if (check.requireImage && !seenImage) fail("missing --image input", 2);',
        "if (",
        "  check.requireServiceTier !== null &&",
        '  seenServiceTier !== `service_tier="${check.requireServiceTier}"`',
        ") {",
        '  fail("unexpected service tier config: " + seenServiceTier, 5);',
        "}",
        "if (",
        "  check.requireReasoningEffort !== null &&",
        '  seenReasoningEffort !== `model_reasoning_effort="${check.requireReasoningEffort}"`',
        ") {",
        '  fail("unexpected reasoning effort config: " + seenReasoningEffort, 6);',
        "}",
        "if (check.forbidReasoningEffort && seenReasoningEffort.length > 0) {",
        '  fail("reasoning effort config should be omitted: " + seenReasoningEffort, 7);',
        "}",
        "if (check.stdinMustContain !== null && !stdinContent.includes(check.stdinMustContain)) {",
        '  fail("stdin missing expected content", 3);',
        "}",
        "if (check.stdinMustNotContain !== null && stdinContent.includes(check.stdinMustNotContain)) {",
        '  fail("stdin contained forbidden content", 4);',
        "}",
        'if (check.stderr !== null) process.stderr.write(check.stderr + "\\n");',
        'if (outputPath !== null) NodeFS.writeFileSync(outputPath, check.output + "\\n");',
        "process.exitCode = check.exitCode;",
        "",
      ].join("\n"),
    });
  });
}

function withFakeCodexEnv<A, E, R>(
  input: FakeCodexInput & {
    launchArgs?: string;
    environment?: NodeJS.ProcessEnv;
    models?: ReadonlyArray<string>;
    managedRuntime?: boolean;
  },
  effectFn: (textGeneration: TextGeneration.TextGeneration["Service"]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-codex-text-" });
    const codexPath = yield* makeFakeCodexBinary(tempDir, input);
    const config = decodeCodexSettings({ binaryPath: codexPath, launchArgs: input.launchArgs });
    const textGeneration = yield* makeCodexTextGeneration(
      config,
      input.environment === undefined ? undefined : { ...process.env, ...input.environment },
      Effect.succeed(
        (input.models ?? []).map((slug) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: null,
        })),
      ),
      input.managedRuntime
        ? Effect.succeed({
            config,
            environment: input.environment ?? process.env,
            revision: "test",
          })
        : undefined,
    );
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

it.layer(layerCodexTextGenerationTest)("CodexTextGeneration", (it) => {
  it.effect("generates schema-validated JSON from a caller-owned prompt", () =>
    withFakeCodexEnv(
      {
        output: JSON.stringify({
          summary: `## Summary\n${"The ticket asks for a concise factual summary. ".repeat(20)}https://example.com/details`,
        }),
        stdinMustContain: "Summarize the supplied content.",
        forbidArg: "--ignore-user-config",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateStructured({
            operation: "generateExample",
            cwd: process.cwd(),
            prompt: "Summarize the supplied content.",
            outputSchema: Schema.Struct({ summary: Schema.String }),
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.summary).toContain("## Summary");
          expect(generated.summary).toContain("https://example.com/details");
        }),
    ),
  );

  it.effect("returns schema-valid whitespace for caller validation", () =>
    withFakeCodexEnv({ output: JSON.stringify({ summary: "   " }) }, (textGeneration) =>
      Effect.gen(function* () {
        const generated = yield* textGeneration.generateStructured({
          operation: "generateExample",
          cwd: process.cwd(),
          prompt: "Return a summary.",
          outputSchema: Schema.Struct({ summary: Schema.String }),
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        });
        expect(generated.summary).toBe("   ");
      }),
    ),
  );

  it.effect("decodes the type side of a structured output schema", () =>
    withFakeCodexEnv({ output: JSON.stringify({ count: 42 }) }, (textGeneration) =>
      Effect.gen(function* () {
        const generated = yield* textGeneration.generateStructured({
          operation: "generateExample",
          cwd: process.cwd(),
          prompt: "Return a count.",
          outputSchema: Schema.Struct({ count: Schema.NumberFromString }),
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        });
        expect(generated.count).toBe(42);
      }),
    ),
  );
});
