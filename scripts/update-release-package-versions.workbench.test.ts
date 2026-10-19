import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as Schema from "effect/Schema";

import * as TestConsole from "effect/testing/TestConsole";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import {
  releasePackageFiles,
  updateReleasePackageVersions,
} from "./update-release-package-versions.ts";

const ScriptTestLayer = Layer.mergeAll(NodeServices.layer, TestConsole.layer);

const PackageJsonSchema = Schema.Record(Schema.String, Schema.Unknown);
const PackageJsonPrettyJson = fromJsonStringPretty(PackageJsonSchema);
const decodePackageJson = Schema.decodeEffect(PackageJsonPrettyJson);
const encodePackageJson = Schema.encodeEffect(PackageJsonPrettyJson);

const writePackageJsonFixtures = Effect.fn("writePackageJsonFixtures")(function* (
  rootDir: string,
  version: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const relativePath of releasePackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(
      filePath,
      `${yield* encodePackageJson({
        name: relativePath,
        version,
        private: true,
        ...(relativePath === "apps/server/package.json"
          ? { workbench: { upstreamProviderCompatibilityVersion: "0.0.46" } }
          : {}),
      })}\n`,
    );
  }
});

it.layer(ScriptTestLayer)("update-release-package-versions", (it) => {
  it.effect("preserves upstream provider compatibility when updating fork release versions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-",
      });

      yield* writePackageJsonFixtures(baseDir, "0.0.1");

      yield* updateReleasePackageVersions("1.2.3", { rootDir: baseDir });
      const serverManifest = yield* fs
        .readFileString(`${baseDir}/apps/server/package.json`)
        .pipe(Effect.flatMap(decodePackageJson));
      assert.deepStrictEqual(serverManifest.workbench, {
        upstreamProviderCompatibilityVersion: "0.0.46",
      });
    }),
  );
});
