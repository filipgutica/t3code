// @effect-diagnostics nodeBuiltinImport:off - Demo startup owns its stopped, disposable settings file.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { requireHome } from "./environment.mts";

const object = Schema.Record(Schema.String, Schema.Unknown);
const decodeObject = Schema.decodeUnknownSync(object);
const candidates = [
  { driver: "codex", commands: ["codex"] },
  { driver: "claudeAgent", commands: ["claude"] },
  // Cursor uses its bundled SDK; the CLI only identifies a local installation.
  { driver: "cursor", commands: ["cursor-agent", "cursor"] },
  { driver: "grok", commands: ["grok"] },
  { driver: "opencode", commands: ["opencode"] },
  { driver: "pi", commands: ["pi"] },
  { driver: "muse", commands: ["muse"] },
  {
    driver: "antigravity",
    commands: [
      HostProcess.Platform.defaultValue() === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par",
    ],
  },
];

/** Add PATH-installed defaults to a stopped demo; native probes own auth and readiness. */
export const seedInstalledDemoProviders = async ({
  home: input,
  env = process.env,
}: {
  readonly home: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<readonly string[]> => {
  const home = requireHome(input);
  if (
    await NodeFSP.stat(NodePath.join(home, "run.lock")).then(
      () => true,
      (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      },
    )
  )
    throw new Error("Stop the demo before seeding installed providers.");
  const path = NodePath.join(home, "userdata", "settings.json");
  const text = await NodeFSP.readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });
  const settings = decodeObject(JSON.parse(text));
  const instances = { ...decodeObject(settings.providerInstances ?? {}) };
  const legacy = decodeObject(settings.providers ?? {});
  const added = await Effect.runPromise(
    Effect.gen(function* () {
      const added: string[] = [];
      for (const { driver, commands } of candidates) {
        // The saved profile's choices (including disabled instances) win.
        if (Object.hasOwn(instances, driver) || Object.hasOwn(legacy, driver)) continue;
        for (const command of commands) {
          const binaryPath = yield* resolveCommandPath(command, { env });
          if (binaryPath === null) continue;
          instances[driver] = {
            driver,
            enabled: true,
            ...(driver === "cursor" ? {} : { config: { binaryPath } }),
          };
          added.push(driver);
          break;
        }
      }
      return added;
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  if (added.length) {
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
    await NodeFSP.writeFile(
      path,
      `${JSON.stringify({ ...settings, providerInstances: instances }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  return added;
};
