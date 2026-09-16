// @effect-diagnostics nodeBuiltinImport:off - Writes a disposable demo configuration for the scripted provider.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export const REGRESSION_PROVIDER_INSTANCE_ID = "codex" as const;
export const REGRESSION_PROVIDER_MODEL = "gpt-5.4-mini" as const;
export const REGRESSION_PROVIDER_MESSAGE = "Workbench regression passed." as const;
export const REGRESSION_PROVIDER_SUMMARY = "Workbench regression summary." as const;

const providerBinaryPath = NodeURL.fileURLToPath(new URL("./provider.mjs", import.meta.url));

/**
 * Configure a demo home to use only the deterministic Codex executable.
 *
 * The app reads settings from `<baseDir>/userdata/settings.json`; the provider
 * home is kept outside that state directory so reset can archive server state
 * without losing the control file or persisted provider-thread fixtures.
 */
export const configureProvider = async (home: string): Promise<void> => {
  const providerHome = NodePath.join(home, "codex");
  const stateDir = NodePath.join(home, "userdata");
  NodeFS.mkdirSync(providerHome, { recursive: true, mode: 0o700 });
  NodeFS.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const settings = {
    providerInstances: {
      [REGRESSION_PROVIDER_INSTANCE_ID]: {
        driver: "codex",
        enabled: true,
        displayName: "Workbench Regression Provider",
        config: {
          binaryPath: providerBinaryPath,
          homePath: providerHome,
          shadowHomePath: "",
          launchArgs: "",
          customModels: [],
        },
      },
    },
    // Claude is enabled by default for normal installs. Explicitly disable
    // every legacy provider so the regression server cannot probe ambient
    // credentials or launch a real harness during startup.
    providers: {
      codex: { enabled: true },
      claudeAgent: { enabled: false },
      cursor: { enabled: false },
      grok: { enabled: false },
      opencode: { enabled: false },
      antigravity: { enabled: false },
    },
    textGenerationModelSelection: {
      instanceId: REGRESSION_PROVIDER_INSTANCE_ID,
      model: REGRESSION_PROVIDER_MODEL,
    },
  };
  NodeFS.writeFileSync(
    NodePath.join(stateDir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    { mode: 0o600 },
  );

  const controlPath = NodePath.join(providerHome, "workbench-regression.json");
  if (!NodeFS.existsSync(controlPath)) {
    NodeFS.writeFileSync(
      controlPath,
      `${JSON.stringify(
        {
          turn: { scenario: "success", message: REGRESSION_PROVIDER_MESSAGE },
          exec: { scenario: "success", summary: REGRESSION_PROVIDER_SUMMARY },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
};

export const providerControlPath = (home: string): string =>
  NodePath.join(home, "codex", "workbench-regression.json");

export const providerStatePath = (home: string): string =>
  NodePath.join(home, "codex", "workbench-regression-state.json");

export const providerCallsPath = (home: string): string =>
  NodePath.join(home, "codex", "workbench-regression-calls.ndjson");
