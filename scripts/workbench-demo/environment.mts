// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { parseEnv } from "node:util";

export const defaultHome = join(homedir(), ".t3-workbench-demos", "guide");
const marker = ".workbench-demo.json";
const canonical = (input: string): string =>
  existsSync(input)
    ? realpathSync(input)
    : join(
        canonical(dirname(input)),
        input.slice(dirname(input).length + (dirname(input).endsWith("/") ? 0 : 1)),
      );
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
export const resolveHome = (input: string) => {
  const home = canonical(resolve(input));
  const userHome = realpathSync(homedir());
  const live = canonical(join(userHome, ".t3"));
  if (home === dirname(home) || home === userHome || inside(live, home) || inside(home, live)) {
    throw new Error("Choose a dedicated demo directory outside the shared ~/.t3 home.");
  }
  return home;
};
export const requireHome = (input: string) => {
  const home = resolveHome(input);
  const value: unknown = JSON.parse(readFileSync(join(home, marker), "utf8"));
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
  if (existsSync(join(home, marker))) return requireHome(home);
  if (existsSync(home) && readdirSync(home).length > 0) {
    throw new Error("Directory is not empty and is not owned by the demo kit. Choose a new home.");
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, marker), JSON.stringify({ kind: "workbench-demo", version: 1 }) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return home;
};
export const readConfig = (home: string) =>
  existsSync(join(home, "config.env"))
    ? parseEnv(readFileSync(join(home, "config.env"), "utf8"))
    : {};

export const resetHome = ({ home: input, apply }: { home: string; apply: boolean }) => {
  const home = requireHome(input);
  if (existsSync(join(home, "run.lock"))) throw new Error("Stop the demo before resetting it.");
  const runtimeFile = join(home, "userdata", "server-runtime.json");
  if (existsSync(runtimeFile)) {
    const runtime: unknown = JSON.parse(readFileSync(runtimeFile, "utf8"));
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
  renameSync(home, backup);
  setupHome(home);
  for (const file of ["config.env", "remotes.json"]) {
    if (existsSync(join(backup, file))) copyFileSync(join(backup, file), join(home, file));
  }
  return `Archived previous environment at ${backup}. Configuration retained; run start, then seed.`;
};
