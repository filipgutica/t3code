// @effect-diagnostics nodeBuiltinImport:off - Provider discovery uses executable fixtures in private temporary homes.
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { it } from "vite-plus/test";

import { setupHome } from "./environment.mts";
import { seedInstalledDemoProviders } from "./providers.mts";

it("seeds installed providers without executing them or replacing saved configuration", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "demo-providers-"));
  try {
    const home = setupHome(NodePath.join(root, "home"));
    const bin = NodePath.join(root, "bin");
    const settingsPath = NodePath.join(home, "userdata", "settings.json");
    const executed = NodePath.join(root, "executed");
    const suffix = HostProcess.Platform.defaultValue() === "win32" ? ".cmd" : "";
    await NodeFSP.mkdir(bin);
    await NodeFSP.mkdir(NodePath.dirname(settingsPath));
    for (const name of ["codex", "claude", "opencode"]) {
      await NodeFSP.writeFile(
        NodePath.join(bin, name + suffix),
        suffix ? `@echo ran > "${executed}"\r\n` : `#!/bin/sh\ntouch '${executed}'\n`,
        { mode: 0o700 },
      );
    }
    await NodeFSP.mkdir(NodePath.join(bin, "grok" + suffix));
    const saved = {
      projectSettingsFolded: true,
      defaultModelSelection: { instanceId: "custom_codex", model: "my-model" },
      providerInstances: {
        codex: { driver: "codex", enabled: false, config: { binaryPath: "/custom/codex" } },
        custom_codex: { driver: "codex", config: { homePath: "/custom/account" } },
      },
    };
    await NodeFSP.writeFile(settingsPath, JSON.stringify(saved));

    NodeAssert.deepEqual(await seedInstalledDemoProviders({ home, env: { PATH: bin } }), [
      "claudeAgent",
      "opencode",
    ]);
    const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8"));
    NodeAssert.deepEqual(settings.providerInstances.claudeAgent, {
      driver: "claudeAgent",
      enabled: true,
      config: { binaryPath: NodePath.join(bin, "claude" + suffix) },
    });
    NodeAssert.equal(settings.providerInstances.opencode.enabled, true);
    NodeAssert.equal(settings.providerInstances.grok, undefined);
    NodeAssert.deepEqual(settings.providerInstances.codex, saved.providerInstances.codex);
    NodeAssert.deepEqual(
      settings.providerInstances.custom_codex,
      saved.providerInstances.custom_codex,
    );
    NodeAssert.deepEqual(settings.defaultModelSelection, saved.defaultModelSelection);
    NodeAssert.equal(settings.projectSettingsFolded, true);
    await NodeAssert.rejects(NodeFSP.access(executed), { code: "ENOENT" });
    const first = await NodeFSP.readFile(settingsPath, "utf8");
    NodeAssert.deepEqual(await seedInstalledDemoProviders({ home, env: { PATH: bin } }), []);
    NodeAssert.equal(await NodeFSP.readFile(settingsPath, "utf8"), first);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("leaves empty, running, and invalid demo settings untouched", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "demo-providers-"));
  try {
    const home = setupHome(NodePath.join(root, "home"));
    const settingsPath = NodePath.join(home, "userdata", "settings.json");
    NodeAssert.deepEqual(await seedInstalledDemoProviders({ home, env: { PATH: "" } }), []);
    await NodeAssert.rejects(NodeFSP.access(settingsPath), { code: "ENOENT" });

    await NodeFSP.writeFile(NodePath.join(home, "run.lock"), "running");
    await NodeAssert.rejects(seedInstalledDemoProviders({ home }), /Stop the demo/);
    await NodeAssert.rejects(NodeFSP.access(settingsPath), { code: "ENOENT" });
    await NodeFSP.rm(NodePath.join(home, "run.lock"));

    await NodeFSP.mkdir(NodePath.dirname(settingsPath));
    await NodeFSP.writeFile(settingsPath, '{"providerInstances":null,"providers":null}');
    NodeAssert.deepEqual(await seedInstalledDemoProviders({ home, env: { PATH: "" } }), []);
    const invalid = '{"providerInstances":[]}';
    await NodeFSP.writeFile(settingsPath, invalid);
    await NodeAssert.rejects(seedInstalledDemoProviders({ home }));
    NodeAssert.equal(await NodeFSP.readFile(settingsPath, "utf8"), invalid);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
