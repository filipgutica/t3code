// @effect-diagnostics nodeBuiltinImport:off - Exercise setup's process boundary with isolated locked profiles.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { setupHome } from "./environment.mts";

const wizard = NodeURL.fileURLToPath(new URL("./setup.sh", import.meta.url));

it.each([".disposable-demo.lock", "run.lock"])(
  "refuses setup before changing a profile owned by %s",
  (lock) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-setup-lock-"));
    try {
      const home = setupHome(NodePath.join(root, "profile"));
      const config = NodePath.join(home, "config.env");
      const original = "DEMO_GITHUB_OWNER=existing-owner\n";
      NodeFS.writeFileSync(config, original);
      NodeFS.writeFileSync(NodePath.join(home, lock), "owned");
      const result = NodeChildProcess.spawnSync("bash", [wizard], {
        env: { ...process.env, DEMO_HOME: home },
        input: "edit\n",
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Stop or recover the active demo");
      expect(NodeFS.readFileSync(config, "utf8")).toBe(original);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
