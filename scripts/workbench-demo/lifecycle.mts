// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeFS from "node:fs";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import { requireHome, readConfig } from "./environment.mts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const socketPath = (home: string) =>
  HostProcess.Platform.defaultValue() === "win32"
    ? `\\\\.\\pipe\\workbench-demo-${NodeCrypto.createHash("sha256").update(home).digest("hex").slice(0, 24)}`
    : NodePath.join(home, "control.sock");

/** `built` runs the production server and its bundled client instead of the Vite dev stack. */
const serverArgs = (home: string, built: boolean) => {
  if (!built) return ["scripts/dev-runner.ts", "dev", "--home-dir", home];
  const dist = NodePath.join(root, "apps", "server", "dist");
  for (const file of ["bin.mjs", "client/index.html", "client/.vite/manifest.json"])
    if (!NodeFS.existsSync(NodePath.join(dist, file)))
      throw new Error(
        `The built server is missing ${file}. Run \`T3CODE_WORKBENCH_BUILD=1 vp run --filter t3 build\` first.`,
      );
  // The pairing URL and runtime origin must stay on loopback for the browser checks.
  return [
    NodePath.join(dist, "bin.mjs"),
    "start",
    "--mode",
    "web",
    "--host",
    "127.0.0.1",
    "--base-dir",
    home,
    "--no-browser",
  ];
};

export const startDemo = async (
  input: string,
  options: { built?: boolean } = {},
): Promise<number> => {
  const home = requireHome(input);
  const built = options.built ?? false;
  const args = serverArgs(home, built);
  const disposableLock = NodePath.join(home, ".disposable-demo.lock");
  if (NodeFS.existsSync(disposableLock))
    throw new Error(
      "A disposable demo run is using this profile. Stop or recover that run before starting the persistent profile.",
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
    if (HostProcess.Platform.defaultValue() !== "win32") NodeFS.chmodSync(socketPath(home), 0o600);
    const config = readConfig(home);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${NodePath.join(root, "node_modules", ".bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
    };
    if (config.T3CODE_PORT_OFFSET !== undefined) env.T3CODE_PORT_OFFSET = config.T3CODE_PORT_OFFSET;
    if (built) {
      // Flags set mode, host, home and browser; these ambient keys would still
      // switch the server to dev mode, pin its port, or make it read bootstrap input.
      delete env.VITE_DEV_SERVER_URL;
      delete env.T3CODE_PORT;
      delete env.T3CODE_BOOTSTRAP_FD;
    }
    const child = NodeChildProcess.spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
      // Own one process group so a stopped launcher cannot leave Vite or a
      // server running with this demo's credentials.
      detached: HostProcess.Platform.defaultValue() !== "win32",
    });
    let stopping = false;
    const stop = () => {
      stopping = true;
      if (HostProcess.Platform.defaultValue() === "win32" || child.pid === undefined) {
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
