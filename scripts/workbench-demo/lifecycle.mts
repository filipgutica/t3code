// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeFS from "node:fs";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import { requireHome, readConfig } from "./environment.mts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const socketPath = (home: string) =>
  HostProcessPlatform.defaultValue() === "win32"
    ? `\\\\.\\pipe\\workbench-demo-${NodeCrypto.createHash("sha256").update(home).digest("hex").slice(0, 24)}`
    : NodePath.join(home, "control.sock");

export const startDemo = async (input: string): Promise<number> => {
  const home = requireHome(input);
  const disposableLock = NodePath.join(home, ".disposable-demo.lock");
  if (NodeFS.existsSync(disposableLock))
    throw new Error(
      "A disposable demo run owns this profile's Jira grant. Stop or recover that run before starting the persistent profile.",
    );
  const runtimePath = NodePath.join(home, "userdata", "server-runtime.json");
  if (NodeFS.existsSync(runtimePath)) {
    const runtime: unknown = JSON.parse(NodeFS.readFileSync(runtimePath, "utf8"));
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
  const lock = NodePath.join(home, "run.lock");
  const fd = NodeFS.openSync(lock, "wx", 0o600);
  NodeFS.closeSync(fd);
  const server = NodeNet.createServer();
  const cleanup = () => {
    server.close();
    if (NodeFS.existsSync(lock)) NodeFS.unlinkSync(lock);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath(home), () => resolve());
    });
    if (HostProcessPlatform.defaultValue() !== "win32") NodeFS.chmodSync(socketPath(home), 0o600);
    const config = readConfig(home);
    const env = {
      ...process.env,
      PATH: `${NodePath.join(root, "node_modules", ".bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
    };
    for (const key of [
      "T3_WORKBENCH_JIRA_CLIENT_ID",
      "T3_WORKBENCH_JIRA_CLIENT_SECRET",
      "T3_WORKBENCH_JIRA_BROKER_URL",
      "T3_WORKBENCH_JIRA_VAULT",
      "T3CODE_PORT_OFFSET",
    ]) {
      if (config[key] !== undefined) Object.assign(env, { [key]: config[key] });
    }
    const child = NodeChildProcess.spawn(
      process.execPath,
      ["scripts/dev-runner.ts", "dev", "--home-dir", home],
      {
        cwd: root,
        env,
        stdio: "inherit",
        // Own one process group so a stopped launcher cannot leave Vite or the
        // backend watcher running with this demo's credentials.
        detached: HostProcessPlatform.defaultValue() !== "win32",
      },
    );
    let stopping = false;
    const stop = () => {
      stopping = true;
      if (HostProcessPlatform.defaultValue() === "win32" || child.pid === undefined) {
        child.kill("SIGINT");
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
      }
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
            stopping && (code === 130 || signal === "SIGINT" || signal === "SIGTERM")
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
    const socket = NodeNet.createConnection(socketPath(home));
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
