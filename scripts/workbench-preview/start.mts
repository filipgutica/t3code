// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalConsole:off - Standalone container supervisor owns native process lifecycle and private bootstrap outside the application runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodeChildProcess from "node:child_process";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeUtil from "node:util";
import { setupLocal } from "../workbench-demo/local.mts";
import {
  installAttentionGitHubAdapter,
  seedAttentionRecords,
  seedAttentionOutcomes,
} from "../workbench-demo/attention.mts";
import { preparePreview, PREVIEW_MODEL_SELECTION, resetPreviewState } from "./config.mts";
import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "../../packages/contracts/src/auth.ts";

const stateDirectory = "/var/lib/workbench-preview";
await resetPreviewState(stateDirectory);
const preview = await preparePreview(process.env, stateDirectory);
preview.environment = await installAttentionGitHubAdapter(preview.home, preview.environment);
const repositoryRoot = NodePath.resolve(import.meta.dirname, "../..");
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const orbitWebRemote = "https://github.com/filipgutica/workbench-demo-orbit-web.git";
let shuttingDown = false;
let running: ReturnType<typeof launchNativeServer> | undefined;

function launchNativeServer(port: number, host: string, secret?: string) {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(repositoryRoot, "apps/server/dist/bin.mjs"),
      "serve",
      "--mode",
      "web",
      "--host",
      host,
      "--port",
      String(port),
      "--base-dir",
      preview.t3Home,
      ...(secret ? ["--bootstrap-fd", "3"] : []),
    ],
    {
      cwd: preview.home,
      env: preview.environment,
      stdio: ["ignore", "inherit", "inherit", "pipe"],
    },
  );
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve(code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1)),
    );
  });
  // Handle a spawn error immediately, including during readiness/seeding before anyone awaits it.
  void exited.catch(() => undefined);
  let bootstrapFailure: Error | undefined;
  const bootstrap = child.stdio[3];
  bootstrap?.once("error", () => {
    bootstrapFailure = new Error("Native preview server closed the private bootstrap pipe.");
    child.kill("SIGTERM");
  });
  if (secret && bootstrap && "end" in bootstrap)
    bootstrap.end(
      JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port,
        t3Home: preview.t3Home,
        host,
        desktopBootstrapToken: secret,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      }) + "\n",
    );
  else if (bootstrap && "end" in bootstrap) bootstrap.end();
  return {
    child,
    exited,
    get bootstrapFailure() {
      return bootstrapFailure;
    },
  };
}

const maintenancePort = async () => {
  const listener = NodeNet.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === "string")
    throw new Error("No maintenance port allocated.");
  return address.port;
};
const stop = () => {
  shuttingDown = true;
  running?.child.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

try {
  const port = await maintenancePort();
  const secret = NodeCrypto.randomBytes(32).toString("base64url");
  running = launchNativeServer(port, "127.0.0.1", secret);
  const deadline = Date.now() + 60_000;
  const origin = `http://127.0.0.1:${port}`;
  while (true) {
    if (running.bootstrapFailure) throw running.bootstrapFailure;
    if (
      shuttingDown ||
      running.child.pid === undefined ||
      running.child.exitCode !== null ||
      running.child.signalCode !== null
    )
      throw new Error("Preview server stopped before seeding.");
    try {
      const ready = await fetch(`${origin}/.well-known/t3/environment`, {
        signal: AbortSignal.timeout(1000),
      });
      if (ready.ok) break;
    } catch {
      /* The native listener is still starting. */
    }
    if (Date.now() >= deadline)
      throw new Error("Preview server did not become ready within 60 seconds.");
    await NodeTimersPromises.setTimeout(200);
  }
  const response = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: AuthTokenExchangeGrantType,
      subject_token: secret,
      subject_token_type: AuthEnvironmentBootstrapTokenType,
      requested_token_type: AuthAccessTokenType,
      client_label: "Private preview fixture seeder",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Private preview bootstrap refused (${response.status}).`);
  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("access_token" in result) ||
    typeof result.access_token !== "string"
  )
    throw new Error("Private preview bootstrap returned no access token.");
  const orbitWebPath = NodePath.join(preview.t3Home, "projects", "orbit-web");
  await NodeFSP.mkdir(NodePath.dirname(orbitWebPath), { recursive: true });
  await execFile("git", ["clone", "--depth", "1", orbitWebRemote, orbitWebPath], {
    cwd: preview.home,
    env: { ...preview.environment, GIT_TERMINAL_PROMPT: "0" },
    timeout: 30_000,
  });
  await setupLocal({
    home: preview.t3Home,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    token: result.access_token,
    localOriginDirectory: NodePath.join(preview.home, "git-remotes"),
    repositoryRemotes: { "orbit-web": orbitWebRemote },
    modelSelection: PREVIEW_MODEL_SELECTION,
  });
  await seedAttentionRecords({
    home: preview.t3Home,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    token: result.access_token,
    modelSelection: PREVIEW_MODEL_SELECTION,
  });
  running.child.kill("SIGTERM");
  await running.exited;
  await seedAttentionOutcomes(preview.t3Home);
  if (!shuttingDown) {
    // Public readiness cannot succeed until native fixture receipts have completed.
    running = launchNativeServer(preview.port, "0.0.0.0");
    console.log(
      "Workbench PR preview seeded; use native pairing to review this disposable environment.",
    );
    process.exitCode = await running.exited;
  }
} catch (error) {
  stop();
  await running?.exited.catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Preview startup failed.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
  await NodeFSP.rm(preview.home, { recursive: true, force: true });
}
