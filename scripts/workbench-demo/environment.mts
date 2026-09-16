// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

export const defaultHome = NodePath.join(NodeOS.homedir(), ".t3-workbench-demos", "guide");
const marker = ".workbench-demo.json";
const canonical = (input: string): string =>
  NodeFS.existsSync(input)
    ? NodeFS.realpathSync(input)
    : NodePath.join(
        canonical(NodePath.dirname(input)),
        input.slice(
          NodePath.dirname(input).length + (NodePath.dirname(input).endsWith("/") ? 0 : 1),
        ),
      );
const inside = (parent: string, child: string) => {
  const path = NodePath.relative(parent, child);
  return path === "" || (!path.startsWith("..") && !NodePath.isAbsolute(path));
};
export const resolveHome = (input: string) => {
  const home = canonical(NodePath.resolve(input));
  const userHome = NodeFS.realpathSync(NodeOS.homedir());
  const live = canonical(NodePath.join(userHome, ".t3"));
  if (
    home === NodePath.dirname(home) ||
    home === userHome ||
    inside(live, home) ||
    inside(home, live)
  ) {
    throw new Error("Choose a dedicated demo directory outside the shared ~/.t3 home.");
  }
  return home;
};
export const requireHome = (input: string) => {
  const home = resolveHome(input);
  const value: unknown = JSON.parse(NodeFS.readFileSync(NodePath.join(home, marker), "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "workbench-demo" ||
    !("version" in value) ||
    value.version !== 1
  ) {
    throw new Error("Unsupported demo ownership marker.");
  }
  return home;
};
export const setupHome = (input: string) => {
  const home = resolveHome(input);
  if (NodeFS.existsSync(NodePath.join(home, marker))) return requireHome(home);
  if (NodeFS.existsSync(home) && NodeFS.readdirSync(home).length > 0) {
    throw new Error("Directory is not empty and is not owned by the demo kit. Choose a new home.");
  }
  NodeFS.mkdirSync(home, { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(home, marker),
    JSON.stringify({ kind: "workbench-demo", version: 1 }) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return home;
};
export const readConfig = (home: string) =>
  NodeFS.existsSync(NodePath.join(home, "config.env"))
    ? NodeUtil.parseEnv(NodeFS.readFileSync(NodePath.join(home, "config.env"), "utf8"))
    : {};

export const resetHome = ({ home: input, apply }: { home: string; apply: boolean }) => {
  const home = requireHome(input);
  if (NodeFS.existsSync(NodePath.join(home, "run.lock")))
    throw new Error("Stop the demo before resetting it.");
  const runtimeFile = NodePath.join(home, "userdata", "server-runtime.json");
  if (NodeFS.existsSync(runtimeFile)) {
    const runtime: unknown = JSON.parse(NodeFS.readFileSync(runtimeFile, "utf8"));
    if (
      typeof runtime === "object" &&
      runtime !== null &&
      "pid" in runtime &&
      typeof runtime.pid === "number"
    ) {
      let active = true;
      try {
        process.kill(runtime.pid, 0);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") active = false;
      }
      if (active)
        throw new Error("The recorded server process still exists. Stop it before reset.");
    }
  }
  if (!apply)
    return `Would archive ${home} and recreate local state. Remote resources are retained. Pass --apply.`;
  const backup = `${home}.backup-${Date.now()}`;
  NodeFS.renameSync(home, backup);
  setupHome(home);
  for (const file of ["config.env", "remotes.json"]) {
    if (NodeFS.existsSync(NodePath.join(backup, file)))
      NodeFS.copyFileSync(NodePath.join(backup, file), NodePath.join(home, file));
  }
  return `Archived previous environment at ${backup}. Configuration retained; Jira must be reconnected after start and seed. Use reset-baseline to preserve the Jira connection.`;
};
