import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import packageJson from "../../package.json" with { type: "json" };
import { BUNDLED_MODEL_MANIFEST } from "../provider/ModelManifest.ts";

const loadCompatibility = async (manifest: object) => {
  vi.resetModules();
  vi.doMock("../../package.json", () => ({ default: manifest }));
  return import("../provider/providerCompatibility.ts");
};

afterEach(() => {
  vi.doUnmock("../../package.json");
  vi.resetModules();
});

describe("Workbench release provider compatibility", () => {
  it("selects V2 bundled policies after packaging assigns the independent release version", async () => {
    const { resolveProviderCompatibility } = await loadCompatibility({
      ...packageJson,
      version: "0.0.18",
    });
    for (const [driver, version, expected] of [
      ["codex", "0.159.0", "supported"],
      ["opencode", "2.0.18", "supported"],
      ["opencode", "1.14.19", "graceful"],
      ["pi", "1.0.0", "supported"],
    ] as const) {
      assert.strictEqual(
        resolveProviderCompatibility(
          BUNDLED_MODEL_MANIFEST.compatibility,
          ProviderDriverKind.make(driver),
          version,
        )?.status,
        expected,
        `${driver} ${version} in Workbench 0.0.18`,
      );
    }
    assert.strictEqual(
      resolveProviderCompatibility(
        BUNDLED_MODEL_MANIFEST.compatibility,
        ProviderDriverKind.make("opencode"),
        "2.0.18",
        "0.0.45",
      )?.status,
      "broken",
    );
  });

  it("uses the same V2 identity for remote overrides, fallback and update advice", async () => {
    const { applyProviderCompatibility } = await loadCompatibility({
      ...packageJson,
      version: "0.0.18",
    });
    const driver = ProviderDriverKind.make("opencode");
    const provider: ServerProvider = {
      driver,
      instanceId: ProviderInstanceId.make("opencode-release"),
      enabled: true,
      installed: true,
      version: "2.0.18",
      status: "ready",
      checkedAt: "2026-10-03T00:00:00Z",
      auth: { status: "authenticated" },
      models: [],
      skills: [],
      slashCommands: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "2.0.18",
        latestVersion: "2.1.0",
        canUpdate: true,
        updateCommand: "npm install -g opencode-ai@latest",
        checkedAt: "2026-10-03T00:00:00Z",
        message: null,
      },
    };
    const remote = {
      driver,
      t3CodeRange: ">=0.0.46",
      ranges: [
        { range: "=2.0.18", status: "unsupported" as const },
        { range: ">=2.1.0", status: "supported" as const },
      ],
    };
    const overridden = applyProviderCompatibility(
      provider,
      [remote],
      BUNDLED_MODEL_MANIFEST.compatibility,
    );
    assert.strictEqual(overridden.compatibilityAdvisory?.status, "unsupported");
    assert.strictEqual(overridden.compatibilityAdvisory?.latestVersionStatus, "supported");
    assert.strictEqual(overridden.status, "ready");
    for (const policies of [[], [{ ...remote, t3CodeRange: ">=9.0.0" }]]) {
      const fallback = applyProviderCompatibility(
        provider,
        policies,
        BUNDLED_MODEL_MANIFEST.compatibility,
      );
      assert.strictEqual(fallback.compatibilityAdvisory?.status, "supported");
      assert.strictEqual(fallback.compatibilityAdvisory?.latestVersionStatus, "supported");
    }
  });

  it("keeps ordinary package-version selection when Workbench metadata is absent", async () => {
    const { resolveProviderCompatibility } = await loadCompatibility({ version: "0.0.45" });
    assert.strictEqual(
      resolveProviderCompatibility(
        BUNDLED_MODEL_MANIFEST.compatibility,
        ProviderDriverKind.make("opencode"),
        "2.0.18",
      )?.status,
      "broken",
    );
    assert.strictEqual(
      resolveProviderCompatibility(
        BUNDLED_MODEL_MANIFEST.compatibility,
        ProviderDriverKind.make("opencode"),
        "1.14.19",
      )?.status,
      "supported",
    );
  });
});
