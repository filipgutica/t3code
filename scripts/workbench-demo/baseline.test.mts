// @effect-diagnostics nodeBuiltinImport:off - Exercise the reset boundary in a disposable home.
import { expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { applyBaselineReset, planBaselineReset } from "./baseline.mts";
import { setupHome } from "./environment.mts";

const fixtureConfig = "DEMO_GITHUB_REPOSITORIES=filipgutica/orbit,filipgutica/beacon";

it("builds a deterministic plan from the saved profile", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);

    expect(planBaselineReset({ home })).toEqual({
      version: 1,
      home,
      githubRepositories: ["filipgutica/orbit", "filipgutica/beacon"],
      actions: [
        `Archive local demo state for ${home}.`,
        "Recreate local clones for filipgutica/orbit, filipgutica/beacon.",
      ],
    });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("applies a local reset and keeps the saved profile", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    NodeFS.writeFileSync(NodePath.join(home, "fixture"), "discarded\n");

    const result = applyBaselineReset({ home });

    expect(result.plan.githubRepositories).toEqual(["filipgutica/orbit", "filipgutica/beacon"]);
    expect(NodeFS.existsSync(NodePath.join(home, "fixture"))).toBe(false);
    expect(NodeFS.readFileSync(NodePath.join(home, "config.env"), "utf8")).toBe(fixtureConfig);
    expect(
      NodeFS.readdirSync(root).filter((entry) => entry.startsWith("demo.backup-")).length,
    ).toBe(1);
  } finally {
    // The reset backup has a timestamped name; remove all children of the test root.
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
