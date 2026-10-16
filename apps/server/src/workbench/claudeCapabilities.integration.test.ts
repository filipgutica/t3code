import { assert, it } from "@effect/vitest";
import { ClaudeSettings } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { probeClaudeCapabilities } from "../provider/ClaudeProvider.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

it.effect("preserves API-key-only account metadata through real SDK initialization", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-claude-account-" });
    const binaryPath = yield* path.fromFileUrl(
      new URL("./testing/claudeApiKey.fixture.mjs", import.meta.url),
    );
    const capabilities = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath, homePath }),
      undefined,
      undefined,
      false,
    );

    assert.equal(capabilities?.apiKeySource, "ANTHROPIC_API_KEY");
    assert.equal(capabilities?.tokenSource, "none");
    assert.equal(capabilities?.apiProvider, "firstParty");
    assert.equal(capabilities?.email, undefined);
    assert.equal(capabilities?.subscriptionType, undefined);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
