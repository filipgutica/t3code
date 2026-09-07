// @effect-diagnostics nodeBuiltinImport:off - Tests exercise bootstrap files with a mocked 1Password process.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";
import { prepareWorkbenchJiraDevEnv } from "./workbench-jira-dev-env.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const idKey = "T3_WORKBENCH_JIRA_CLIENT_ID";
const secretKey = "T3_WORKBENCH_JIRA_CLIENT_SECRET";
const resolvedTemplate = `${idKey}="test-client"\n${secretKey}="test-secret"\n`;
const directories: string[] = [];
let injectedTemplate = "";
let templatePath = "";

const makeFixture = () => {
  const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-jira-env-"));
  directories.push(repoRoot);
  NodeFS.writeFileSync(
    NodePath.join(repoRoot, ".env.example"),
    `${idKey}="op://test/jira/${idKey}"\n${secretKey}="op://test/jira/${secretKey}"\nT3CODE_RELAY_URL=https://example.test\n`,
  );
  return {
    repoRoot,
    mode: "dev",
    dryRun: false,
    baseEnv: { T3_WORKBENCH_JIRA_VAULT: "test", OP_ACCOUNT: "test-account" },
  };
};

beforeEach(() => {
  injectedTemplate = "";
  templatePath = "";
  vi.mocked(NodeChildProcess.spawnSync)
    .mockReset()
    .mockImplementation((_command, args) => {
      if (!Array.isArray(args) || args[1] !== "--in-file") {
        throw new Error("1Password requires a template file.");
      }
      templatePath = args[2];
      injectedTemplate = NodeFS.readFileSync(templatePath, "utf8");
      return {
        pid: 1,
        output: [null, resolvedTemplate, ""],
        stdout: resolvedTemplate,
        stderr: "",
        status: 0,
        signal: null,
      };
    });
});

afterEach(() => {
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("prepareWorkbenchJiraDevEnv", () => {
  it("starts an unconfigured clone without querying 1Password or creating files", () => {
    const fixture = makeFixture();
    const result = prepareWorkbenchJiraDevEnv({ ...fixture, baseEnv: {} });
    expect(result.warning).toBeUndefined();
    expect(result.env[secretKey]).toBeUndefined();
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
  });
  it("keeps copied template references disabled when child processes reload env files", () => {
    const fixture = makeFixture();
    NodeFS.copyFileSync(
      NodePath.join(fixture.repoRoot, ".env.example"),
      NodePath.join(fixture.repoRoot, ".env"),
    );
    const result = prepareWorkbenchJiraDevEnv({ ...fixture, baseEnv: {} });
    const reloaded = loadRepoEnv({ repoRoot: fixture.repoRoot, baseEnv: result.env });
    expect(reloaded[idKey]).toBe("");
    expect(reloaded[secretKey]).toBe("");
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
  });

  it.each([0, 2])("does not inject when %i accounts match the configured vault", (matches) => {
    const fixture = makeFixture();
    vi.mocked(NodeChildProcess.spawnSync).mockImplementation((_command, args) => {
      if (!Array.isArray(args)) throw new Error("Expected command arguments.");
      if (args[0] === "inject")
        throw new Error("Must not inject with an ambiguous or inaccessible vault.");
      const stdout =
        args[0] === "account" ? JSON.stringify([{ account_uuid: "a" }, { account_uuid: "b" }]) : "";
      return {
        pid: 1,
        output: [null, stdout, ""],
        stdout,
        stderr: "",
        status: args[0] === "account" || matches === 2 ? 0 : 1,
        signal: null,
      };
    });
    const result = prepareWorkbenchJiraDevEnv({
      ...fixture,
      baseEnv: { T3_WORKBENCH_JIRA_VAULT: "test" },
    });
    expect(result.warning).toContain(matches === 2 ? "Multiple" : "No configured");
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
  });

  it("finds the vault account on a fresh worktree using only the global vault selector", () => {
    const fixture = makeFixture();
    vi.mocked(NodeChildProcess.spawnSync).mockImplementation((_command, args, options) => {
      if (!Array.isArray(args)) throw new Error("Expected command arguments.");
      let status = 0;
      let stdout = "";
      if (args[0] === "account") {
        stdout = JSON.stringify([{ user_uuid: "work" }, { user_uuid: "personal" }]);
      } else if (args[0] === "vault") {
        status = args[4] === "personal" ? 0 : 1;
      } else {
        status = options?.env?.OP_ACCOUNT === "personal" ? 0 : 1;
        stdout = resolvedTemplate;
      }
      return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status, signal: null };
    });
    const result = prepareWorkbenchJiraDevEnv({
      ...fixture,
      baseEnv: { T3_WORKBENCH_JIRA_VAULT: "personal-vault-id" },
    });
    expect(result.warning).toBeUndefined();
    expect(result.env[secretKey]).toBe("test-secret");
    expect(result.env.OP_ACCOUNT).toBeUndefined();
    expect(NodeFS.readFileSync(NodePath.join(fixture.repoRoot, ".env.local"), "utf8")).toBe(
      resolvedTemplate,
    );
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env"))).toBe(false);
  });

  it.effect.each(["dev", "dev:server", "dev:desktop"])(
    "bootstraps %s without enabling unrelated public defaults",
    (mode) =>
      Effect.gen(function* () {
        const platform = yield* HostProcessPlatform;
        const fixture = makeFixture();
        const result = prepareWorkbenchJiraDevEnv({ ...fixture, mode });
        const localPath = NodePath.join(fixture.repoRoot, ".env.local");
        expect(NodeFS.readFileSync(localPath, "utf8")).toBe(resolvedTemplate);
        if (platform !== "win32") {
          expect(NodeFS.statSync(localPath).mode & 0o777).toBe(0o600);
        }
        expect(result.env[idKey]).toBe("test-client");
        expect(result.env[secretKey]).toBe("test-secret");
        expect(result.env.T3CODE_RELAY_URL).toBeUndefined();
        expect(result.env.VITE_T3_WORKBENCH_JIRA_CLIENT_SECRET).toBeUndefined();
        expect(result.warning).toBeUndefined();
        expect(injectedTemplate).toContain(`op://test/jira/${secretKey}`);
        expect(injectedTemplate).not.toContain("T3CODE_RELAY_URL");
        expect(NodeFS.existsSync(templatePath)).toBe(false);
      }),
  );

  it("keeps an existing local file byte-for-byte and does not query 1Password", () => {
    const fixture = makeFixture();
    const localPath = NodePath.join(fixture.repoRoot, ".env.local");
    const content = `${resolvedTemplate}CUSTOM_SETTING=keep-me\n`;
    NodeFS.writeFileSync(localPath, content);
    const result = prepareWorkbenchJiraDevEnv(fixture);
    expect(result.env[secretKey]).toBe("test-secret");
    expect(NodeFS.readFileSync(localPath, "utf8")).toBe(content);
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
  });

  it("preserves explicit credentials and does not create a file when both are supplied", () => {
    const fixture = makeFixture();
    const baseEnv = { [idKey]: "shell-client", [secretKey]: "shell-secret" };
    const result = prepareWorkbenchJiraDevEnv({ ...fixture, baseEnv });
    expect(result.env).toMatchObject(baseEnv);
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
  });

  it("keeps an explicit credential while resolving the missing credential", () => {
    const fixture = makeFixture();
    const result = prepareWorkbenchJiraDevEnv({
      ...fixture,
      baseEnv: { ...fixture.baseEnv, [idKey]: "shell-client" },
    });
    expect(result.env[idKey]).toBe("shell-client");
    expect(result.env[secretKey]).toBe("test-secret");
  });

  it.each([
    { mode: "dev:web", dryRun: false },
    { mode: "dev", dryRun: true },
  ])("does not bootstrap $mode with dryRun=$dryRun", (options) => {
    const fixture = makeFixture();
    prepareWorkbenchJiraDevEnv({ ...fixture, ...options });
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
  });

  it("does not retain a partial injection or expose command diagnostics on failure", () => {
    const fixture = makeFixture();
    vi.mocked(NodeChildProcess.spawnSync).mockReturnValue({
      pid: 1,
      status: 1,
      signal: null,
      stdout: resolvedTemplate,
      stderr: "sensitive-diagnostic",
      output: [null, resolvedTemplate, "sensitive-diagnostic"],
    });
    const result = prepareWorkbenchJiraDevEnv({
      ...fixture,
      baseEnv: { ...fixture.baseEnv, [idKey]: "op://test/jira/id" },
    });
    expect(result.env[idKey]).toBe("");
    expect(result.warning).toContain("1Password");
    expect(result.warning).not.toContain("sensitive-diagnostic");
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
  });

  it("rejects unresolved credential output", () => {
    const fixture = makeFixture();
    vi.mocked(NodeChildProcess.spawnSync).mockReturnValue({
      pid: 1,
      status: 0,
      signal: null,
      stdout: `${idKey}=op://test/jira/id\n`,
      stderr: "",
      output: [null, "", ""],
    });
    expect(prepareWorkbenchJiraDevEnv(fixture).warning).toContain("did not resolve");
    expect(NodeFS.existsSync(NodePath.join(fixture.repoRoot, ".env.local"))).toBe(false);
  });

  it("preserves an incomplete local file and explains the missing setup", () => {
    const fixture = makeFixture();
    const localPath = NodePath.join(fixture.repoRoot, ".env.local");
    NodeFS.writeFileSync(localPath, "CUSTOM_SETTING=keep-me\n");
    expect(prepareWorkbenchJiraDevEnv(fixture).warning).toContain(
      "Existing .env.local was preserved",
    );
    expect(NodeFS.readFileSync(localPath, "utf8")).toBe("CUSTOM_SETTING=keep-me\n");
    expect(NodeChildProcess.spawnSync).not.toHaveBeenCalled();
  });
});
