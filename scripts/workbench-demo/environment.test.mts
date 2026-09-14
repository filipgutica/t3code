// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone host tooling owns filesystem and process lifecycle before the Effect app starts.
import { it as test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { setupHome, requireHome, resetHome, resolveHome, readConfig } from "./environment.mts";

test("claims only empty directories, reuses ownership, and preserves unknown files", () => {
  const root = mkdtempSync(join(tmpdir(), "demo-home-test-"));
  try {
    const home = setupHome(join(root, "demo"));
    assert.equal(setupHome(home), home);
    const other = join(root, "other");
    mkdirSync(other);
    writeFileSync(join(other, "keep"), "data");
    assert.throws(() => setupHome(other), /not empty/);
    assert.throws(() => requireHome(other));
    assert.ok(existsSync(join(other, "keep")));
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("rejects shared home through filesystem aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "demo-home-test-"));
  try {
    symlinkSync(homedir(), join(root, "alias"));
    assert.throws(() => resolveHome(join(root, "alias", ".t3", "demo")), /shared/);
    assert.throws(() => resolveHome(homedir()), /shared/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("reset previews, refuses running homes, archives data and retains configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "demo-home-test-"));
  try {
    const home = setupHome(join(root, "demo"));
    writeFileSync(join(home, "config.env"), 'DEMO_OWNER="literal$(not-executed)"\n');
    writeFileSync(join(home, "fixture"), "preserved in backup");
    assert.match(resetHome({ home, apply: false }), /Would archive/);
    assert.ok(existsSync(join(home, "fixture")));
    writeFileSync(join(home, "run.lock"), "lock");
    assert.throws(() => resetHome({ home, apply: true }), /Stop/);
    rmSync(join(home, "run.lock"));
    assert.match(resetHome({ home, apply: true }), /Archived/);
    assert.equal(readConfig(home).DEMO_OWNER, "literal$(not-executed)");
    assert.equal(existsSync(join(home, "fixture")), false);
  } finally {
    rmSync(root, { recursive: true });
  }
});
