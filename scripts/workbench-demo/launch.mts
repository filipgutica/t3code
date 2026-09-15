// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Host-side demo lifecycle watches explicit startup signals and owns the spawned process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { stopDemo } from "./lifecycle.mts";
import { requireHome } from "./environment.mts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
export const launchDemo = async (input: { home: string; env?: NodeJS.ProcessEnv }) => {
  const home = requireHome(input.home);
  const child = NodeChildProcess.spawn(
    process.execPath,
    ["scripts/workbench-demo/cli.mts", "start", "--home", home],
    {
      cwd: root,
      env: {
        ...process.env,
        ...input.env,
        PATH: `${NodePath.join(root, "node_modules/.bin")}${path.delimiter}${input.env?.PATH ?? process.env.PATH}`,
        T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        await stopDemo(home);
      } catch {
        child.kill("SIGINT");
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Demo launcher did not exit after stop; credentials were not exported.",
                  ),
                ),
              15_000,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    await NodeFSP.writeFile(NodePath.join(home, "server.log"), output, { mode: 0o600 });
  };
  try {
    const pairingUrl = await new Promise<string>((resolve, reject) => {
      let candidate: string | undefined;
      let pending = "";
      const directory = NodePath.join(home, "userdata");
      const runtime = NodePath.join(directory, "server-runtime.json");
      // setup/configureProvider creates userdata before the launcher starts.
      const watcher = NodeFS.watch(directory, () => check());
      const timeout = setTimeout(() => {
        watcher.close();
        reject(new Error(`Demo startup timed out. ${output.slice(-4000)}`));
      }, 120_000);
      const check = () => {
        if (!candidate || !NodeFS.existsSync(runtime)) return;
        clearTimeout(timeout);
        watcher.close();
        resolve(candidate);
      };
      const collect = (chunk: Buffer) => {
        pending += chunk.toString();
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const clean = line.replace(/\u001b\[[0-9;]*m/g, "");
          candidate ??= clean.match(/https?:\/\/[^\s]+\/pair#[^\s]+/)?.[0];
          output = (output + clean.replace(/\/pair#[^\s]+/g, "/pair#[redacted]") + "\n").slice(
            -40_000,
          );
        }
        check();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", (error) => {
        clearTimeout(timeout);
        watcher.close();
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        watcher.close();
        reject(new Error(`Demo exited (${code}). ${output.slice(-4000)}`));
      });
    });
    return { pairingUrl, origin: new URL(pairingUrl).origin, stop, exited };
  } catch (error) {
    await stop();
    throw error;
  }
};
