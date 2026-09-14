// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Short-lived local CLI authentication uses the existing auth command.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireHome } from "./environment.mts";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
export const withDemoAccess = async <T,>(
  homeInput: string,
  operation: (access: { wsUrl: string; token: string }) => Promise<T>,
): Promise<T> => {
  const home = requireHome(homeInput);
  const runtime: unknown = JSON.parse(
    await readFile(join(home, "userdata", "server-runtime.json"), "utf8"),
  );
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    !("port" in runtime) ||
    typeof runtime.port !== "number" ||
    !Number.isInteger(runtime.port) ||
    runtime.port < 1 ||
    runtime.port > 65535
  )
    throw new Error("Start the demo before seeding or verifying it.");
  const origin = `http://127.0.0.1:${runtime.port}`;
  const response = await fetch(`${origin}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("The demo server is not ready.");
  const issued = await exec(
    process.execPath,
    [
      "apps/server/src/bin.ts",
      "auth",
      "session",
      "issue",
      "--base-dir",
      home,
      "--ttl",
      "10m",
      "--label",
      "Workbench demo setup",
      "--json",
    ],
    { cwd: root },
  );
  const credential: unknown = JSON.parse(issued.stdout);
  if (
    typeof credential !== "object" ||
    credential === null ||
    !("token" in credential) ||
    typeof credential.token !== "string" ||
    !("sessionId" in credential) ||
    typeof credential.sessionId !== "string"
  )
    throw new Error("Could not issue local demo access.");
  try {
    return await operation({
      wsUrl: `${origin.replace("http:", "ws:")}/ws`,
      token: credential.token,
    });
  } finally {
    await exec(
      process.execPath,
      [
        "apps/server/src/bin.ts",
        "auth",
        "session",
        "revoke",
        "--base-dir",
        home,
        credential.sessionId,
      ],
      { cwd: root },
    );
  }
};
