// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import { spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { closeSync, openSync, unlinkSync, existsSync, chmodSync, readFileSync } from "node:fs";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { requireHome, readConfig } from "./environment.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const socketPath = (home: string) =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\workbench-demo-${createHash("sha256").update(home).digest("hex").slice(0, 24)}`
    : join(home, "control.sock");

export const startDemo = async (input: string): Promise<number> => {
  const home = requireHome(input);
  const runtimePath = join(home, "userdata", "server-runtime.json");
  if (existsSync(runtimePath)) {
    const runtime: unknown = JSON.parse(readFileSync(runtimePath, "utf8"));
    if (
      typeof runtime === "object" &&
      runtime !== null &&
      "pid" in runtime &&
      typeof runtime.pid === "number"
    ) {
      let alive = true;
      try {
        process.kill(runtime.pid, 0);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(
          "A server process is already recorded for this home. Reuse it or stop it first.",
        );
    }
  }
  const lock = join(home, "run.lock");
  const fd = openSync(lock, "wx", 0o600);
  closeSync(fd);
  const server = createServer();
  const cleanup = () => {
    server.close();
    if (existsSync(lock)) unlinkSync(lock);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath(home), () => resolve());
    });
    if (process.platform !== "win32") chmodSync(socketPath(home), 0o600);
    const config = readConfig(home);
    const env = {
      ...process.env,
      PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
    };
    for (const key of [
      "T3_WORKBENCH_JIRA_CLIENT_ID",
      "T3_WORKBENCH_JIRA_CLIENT_SECRET",
      "T3CODE_PORT_OFFSET",
    ]) {
      if (config[key]) Object.assign(env, { [key]: config[key] });
    }
    const child = spawn(process.execPath, ["scripts/dev-runner.ts", "dev", "--home-dir", home], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    let stopping = false;
    const stop = () => {
      stopping = true;
      child.kill("SIGINT");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    server.on("connection", (socket) => {
      socket.setTimeout(60_000, () => socket.destroy());
      socket.once("data", (data) => {
        if (data.toString().trim() === "stop") {
          child.once("exit", () => socket.end("Demo launcher stopped.\n"));
          stop();
        } else socket.end("Unknown command.\n");
      });
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          resolve(
            stopping && (code === 130 || signal === "SIGINT")
              ? 0
              : (code ?? (signal === "SIGINT" ? 0 : 1)),
          ),
        );
      });
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  } finally {
    cleanup();
  }
};

export const stopDemo = async (input: string) => {
  const home = requireHome(input);
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath(home));
    socket.setTimeout(60_000, () => socket.destroy(new Error("Demo controller did not respond.")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write("stop\n"));
    let response = "";
    socket.on("data", (data) => {
      response += data.toString();
    });
    socket.once("end", () => resolve(response.trim()));
  });
};
