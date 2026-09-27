// @effect-diagnostics nodeBuiltinImport:off - Standalone preview provisioning owns process filesystem isolation outside the application runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { ProviderInstanceId } from "../../packages/contracts/src/providerInstance.ts";

export const PREVIEW_MODEL = "opencode/big-pickle";
export const PREVIEW_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: PREVIEW_MODEL,
};

export const resetPreviewState = async (stateDirectory: string) => {
  const directory = await NodeFSP.lstat(stateDirectory);
  const markerPath = NodePath.join(stateDirectory, ".workbench-preview-owned");
  const marker = await NodeFSP.lstat(markerPath);
  const uid = process.getuid?.();
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    !marker.isFile() ||
    marker.isSymbolicLink() ||
    uid === undefined ||
    directory.uid !== uid ||
    marker.uid !== uid ||
    (await NodeFSP.readFile(markerPath, "utf8")) !== "workbench-preview-v1\n"
  )
    throw new Error("Preview state directory is not owned by this runtime.");
  const entries = await NodeFSP.readdir(stateDirectory);
  if (
    entries.some((entry) => entry !== ".workbench-preview-owned" && !entry.startsWith("session-"))
  )
    throw new Error("Preview state directory contains unknown files.");
  // The container owns this marked root exclusively; never sweep arbitrary temporary homes.
  for (const entry of entries) {
    if (entry.startsWith("session-"))
      await NodeFSP.rm(NodePath.join(stateDirectory, entry), { recursive: true, force: true });
  }
};

export const preparePreview = async (ambient: NodeJS.ProcessEnv, stateDirectory: string) => {
  const portText = ambient.PORT ?? "8080";
  if (!/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535)
    throw new Error("PORT must be an integer from 1 to 65535.");
  const port = Number(portText);
  const home = await NodeFSP.mkdtemp(NodePath.join(stateDirectory, "session-"));
  await NodeFSP.chmod(home, 0o700);
  const t3Home = NodePath.join(home, "t3");
  const configHome = NodePath.join(home, "config");
  const opencodeConfig = NodePath.join(configHome, "opencode", "opencode.json");
  await NodeFSP.mkdir(NodePath.dirname(opencodeConfig), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(t3Home, "userdata"), { recursive: true });
  const openCodeContent = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: PREVIEW_MODEL,
    small_model: PREVIEW_MODEL,
    enabled_providers: ["opencode"],
    provider: { opencode: { whitelist: ["big-pickle"] } },
    server: { hostname: "127.0.0.1" },
    share: "disabled",
    autoupdate: false,
  });
  await NodeFSP.writeFile(opencodeConfig, openCodeContent, { mode: 0o600 });
  await NodeFSP.writeFile(
    NodePath.join(t3Home, "userdata", "settings.json"),
    JSON.stringify({
      defaultModelSelection: PREVIEW_MODEL_SELECTION,
      textGenerationModelSelection: PREVIEW_MODEL_SELECTION,
      providers: {
        codex: { enabled: false },
        claudeAgent: { enabled: false },
        cursor: { enabled: false },
        grok: { enabled: false },
        antigravity: { enabled: false },
        opencode: { enabled: true },
      },
      providerInstances: { opencode: { driver: "opencode", enabled: true } },
    }),
    { mode: 0o600 },
  );
  // Deliberate allowlist: no host credentials, provider keys, proxy auth or ambient T3 paths.
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: NodePath.join(home, "data"),
    XDG_CACHE_HOME: NodePath.join(home, "cache"),
    OPENCODE_CONFIG: opencodeConfig,
    OPENCODE_CONFIG_CONTENT: openCodeContent,
  };
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ"])
    if (ambient[key] !== undefined) environment[key] = ambient[key];
  return { home, t3Home, port, environment };
};
