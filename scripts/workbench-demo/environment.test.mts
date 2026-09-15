// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import { it as test } from "vite-plus/test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { setupHome, requireHome, resetHome, resolveHome, readConfig } from "./environment.mts";

test("claims only empty directories, reuses ownership, and preserves unknown files", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-home-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeAssert.equal(setupHome(home), home);
    const other = NodePath.join(root, "other");
    NodeFS.mkdirSync(other);
    NodeFS.writeFileSync(NodePath.join(other, "keep"), "data");
    NodeAssert.throws(() => setupHome(other), /not empty/);
    NodeAssert.throws(() => requireHome(other));
    NodeAssert.ok(NodeFS.existsSync(NodePath.join(other, "keep")));
  } finally {
    NodeFS.rmSync(root, { recursive: true });
  }
});
test("rejects shared home through filesystem aliases", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-home-test-"));
  try {
    NodeFS.symlinkSync(NodeOS.homedir(), NodePath.join(root, "alias"));
    NodeAssert.throws(() => resolveHome(NodePath.join(root, "alias", ".t3", "demo")), /shared/);
    NodeAssert.throws(() => resolveHome(NodeOS.homedir()), /shared/);
  } finally {
    NodeFS.rmSync(root, { recursive: true });
  }
});
test("reset previews, refuses running homes, archives data and retains configuration", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-home-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(
      NodePath.join(home, "config.env"),
      'DEMO_OWNER="literal$(not-executed)"\n',
    );
    NodeFS.writeFileSync(NodePath.join(home, "fixture"), "preserved in backup");
    NodeAssert.match(resetHome({ home, apply: false }), /Would archive/);
    NodeAssert.ok(NodeFS.existsSync(NodePath.join(home, "fixture")));
    NodeFS.writeFileSync(NodePath.join(home, "run.lock"), "lock");
    NodeAssert.throws(() => resetHome({ home, apply: true }), /Stop/);
    NodeFS.rmSync(NodePath.join(home, "run.lock"));
    NodeFS.mkdirSync(NodePath.join(home, "userdata", "secrets"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(home, "userdata", "secrets", "workbench-jira-credential-demo.bin"),
      "encrypted fixture",
    );
    NodeAssert.match(resetHome({ home, apply: true }), /Archived/);
    NodeAssert.equal(readConfig(home).DEMO_OWNER, "literal$(not-executed)");
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(home, "fixture")), false);
    NodeAssert.equal(
      NodeFS.readFileSync(
        NodePath.join(home, "userdata", "secrets", "workbench-jira-credential-demo.bin"),
        "utf8",
      ),
      "encrypted fixture",
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true });
  }
});
