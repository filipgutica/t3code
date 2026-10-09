// @effect-diagnostics nodeBuiltinImport:off - This contract test verifies real isolated filesystem provisioning.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  ServerSettings,
  resolveProviderInstanceEnabled,
} from "../../packages/contracts/src/settings.ts";
import { ProviderInstanceId } from "../../packages/contracts/src/providerInstance.ts";
import { preparePreview, resetPreviewState } from "./config.mts";
const decodeSettings = Schema.decodeSync(Schema.fromJsonString(ServerSettings));

it("starts fresh without ambient credentials and configures only the fixed free OpenCode models", async () => {
  const ambient = {
    PORT: "8123",
    PATH: "/usr/bin",
    HOME: "/live-home",
    XDG_CONFIG_HOME: "/live-config",
    GITHUB_TOKEN: "private-source-value",
    OPENAI_API_KEY: "private-source-value",
    OPENCODE_API_KEY: "private-source-value",
    T3CODE_HOME: "/live-t3",
  };
  const stateDirectory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "preview-test-"));
  const first = await preparePreview(ambient, stateDirectory);
  const second = await preparePreview(ambient, stateDirectory);
  try {
    expect(first.home).not.toBe(second.home);
    expect(first.port).toBe(8123);
    expect(first.environment.HOME).toBe(first.home);
    expect(first.environment.PATH).toBe("/usr/bin");
    expect(Object.values(first.environment)).not.toContain("private-source-value");
    expect(Object.values(first.environment)).not.toContain("/live-home");
    expect(first.environment.T3CODE_HOME).toBeUndefined();
    const settingsText = await NodeFSP.readFile(
      NodePath.join(first.t3Home, "userdata", "settings.json"),
      "utf8",
    );
    const settings = decodeSettings(settingsText);
    expect(settings.defaultModelSelection?.model).toBe("opencode/big-pickle");
    expect(settings.textGenerationModelSelection.model).toBe("opencode/big-pickle");
    for (const driver of [
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "antigravity",
      "pi",
      "muse",
      "acpRegistry",
    ]) {
      const instance = settings.providerInstances[ProviderInstanceId.make(driver)];
      expect(instance?.driver).toBe(driver);
      expect(instance?.enabled).toBe(false);
    }
    expect(
      Object.entries(settings.providerInstances)
        .filter(([, instance]) => resolveProviderInstanceEnabled(instance))
        .map(([id]) => id),
    ).toEqual(["opencode"]);
    for (const instance of Object.values(settings.providerInstances)) {
      expect(instance.config ?? {}).toEqual({});
      expect(instance.environment ?? []).toEqual([]);
    }
    const openCode = JSON.parse(await NodeFSP.readFile(first.environment.OPENCODE_CONFIG!, "utf8"));
    expect(openCode.model).toBe("opencode/big-pickle");
    expect(openCode.small_model).toBe("opencode/big-pickle");
    expect(openCode.enabled_providers).toEqual(["opencode"]);
    expect(openCode.provider.opencode.whitelist).toEqual(["big-pickle"]);
    expect(first.environment.OPENCODE_CONFIG_CONTENT).toBe(
      await NodeFSP.readFile(first.environment.OPENCODE_CONFIG!, "utf8"),
    );
    expect((await NodeFSP.stat(first.home)).mode & 0o777).toBe(0o700);
    expect((await NodeFSP.stat(first.environment.OPENCODE_CONFIG!)).mode & 0o777).toBe(0o600);
  } finally {
    await NodeFSP.rm(first.home, { recursive: true, force: true });
    await NodeFSP.rm(stateDirectory, { recursive: true, force: true });
  }
});

it.each(["0", "65536", "8123junk", "NaN"])(
  "refuses invalid container PORT %s before preparation",
  async (PORT) => {
    await expect(preparePreview({ PORT }, "/unused-invalid-port")).rejects.toThrow(
      "PORT must be an integer",
    );
  },
);

it("removes abrupt-restart residue only from its marked root and refuses symlinks or unknown roots", async () => {
  const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "preview-reset-test-"));
  const stateDirectory = NodePath.join(parent, "state");
  const outside = NodePath.join(parent, "outside");
  await NodeFSP.mkdir(stateDirectory);
  await NodeFSP.mkdir(outside);
  await NodeFSP.writeFile(NodePath.join(outside, "keep"), "unrelated");
  try {
    await expect(resetPreviewState(stateDirectory)).rejects.toThrow();
    const markerPath = NodePath.join(stateDirectory, ".workbench-preview-owned");
    await NodeFSP.writeFile(markerPath, "other-owner\n");
    await expect(resetPreviewState(stateDirectory)).rejects.toThrow("not owned");
    await NodeFSP.unlink(markerPath);
    await NodeFSP.symlink(NodePath.join(outside, "keep"), markerPath);
    await expect(resetPreviewState(stateDirectory)).rejects.toThrow("not owned");
    await NodeFSP.unlink(markerPath);
    await NodeFSP.writeFile(markerPath, "workbench-preview-v1\n");
    const abandoned = await preparePreview({}, stateDirectory);
    await NodeFSP.writeFile(NodePath.join(abandoned.home, "grant"), "old-private-grant");
    await NodeFSP.symlink(outside, NodePath.join(stateDirectory, "session-external-link"));
    await NodeFSP.symlink(stateDirectory, NodePath.join(parent, "root-link"));
    await expect(resetPreviewState(NodePath.join(parent, "root-link"))).rejects.toThrow(
      "not owned",
    );
    await NodeFSP.writeFile(NodePath.join(stateDirectory, "unknown-file"), "retain");
    await expect(resetPreviewState(stateDirectory)).rejects.toThrow("unknown files");
    expect(await NodeFSP.readFile(NodePath.join(abandoned.home, "grant"), "utf8")).toBe(
      "old-private-grant",
    );
    await NodeFSP.unlink(NodePath.join(stateDirectory, "unknown-file"));
    await resetPreviewState(stateDirectory);
    expect(await NodeFSP.readdir(stateDirectory)).toEqual([".workbench-preview-owned"]);
    expect(await NodeFSP.readFile(NodePath.join(outside, "keep"), "utf8")).toBe("unrelated");
    const next = await preparePreview({}, stateDirectory);
    expect(next.home).not.toBe(abandoned.home);
  } finally {
    await NodeFSP.rm(parent, { recursive: true, force: true });
  }
});
