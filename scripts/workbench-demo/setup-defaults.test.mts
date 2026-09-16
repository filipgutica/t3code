// @effect-diagnostics nodeBuiltinImport:off - Exercise the bash prompt boundary with synthetic configuration.
import { it, expect } from "vite-plus/test";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const helper = NodeURL.fileURLToPath(new URL("./setup-defaults.sh", import.meta.url));
const run = (script: string, config = "", input = "\n") => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prompts-"));
  const file = NodePath.join(home, "config.env");
  NodeFS.writeFileSync(file, config);
  // A command that never reads stdin may exit before a pipe writer, causing EPIPE.
  const inputFile = NodePath.join(home, "stdin");
  NodeFS.writeFileSync(inputFile, input);
  const stdin = NodeFS.openSync(inputFile, "r");
  try {
    return NodeChildProcess.execFileSync(
      "bash",
      ["-c", 'set -eu; source "$1"; ENV_FILE="$2"; ' + script, "test", helper, file],
      { stdio: [stdin, "pipe", "pipe"], encoding: "utf8" },
    );
  } finally {
    NodeFS.closeSync(stdin);
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
};

it("Enter accepts detected GitHub login and explicit input overrides it", () => {
  const script =
    'demo_ask DEMO_GITHUB_OWNER "Owner" "detected-user"; printf "result=%s" "$DEMO_GITHUB_OWNER"';
  expect(run(script)).toContain("result=detected-user");
  expect(run(script, "", "my-org\n")).toContain("result=my-org");
});
it("saved values outrank environment and detection, without executing config", () => {
  const result = run(
    'DEMO_GITHUB_OWNER=ambient; demo_ask DEMO_GITHUB_OWNER "Owner" detected; printf "result=%s" "$DEMO_GITHUB_OWNER"',
    'DEMO_GITHUB_OWNER="saved$(printf unsafe)"\n',
  );
  expect(result).toContain("result=saved$(printf unsafe)");
  expect(
    run(
      'DEMO_GITHUB_OWNER=ambient; demo_ask DEMO_GITHUB_OWNER "Owner" detected; printf "result=%s" "$DEMO_GITHUB_OWNER"',
    ),
  ).toContain("result=ambient");
});
it("Enter retains secrets without printing them", () => {
  const result = run(
    'demo_ask DEMO_JIRA_API_TOKEN "Token" "" secret; [[ "$DEMO_JIRA_API_TOKEN" == sensitive ]]',
    "DEMO_JIRA_API_TOKEN=sensitive\n",
  );
  expect(result).not.toContain("sensitive");
  expect(result).toContain("Enter keeps");
});
it("detects only an existing complete demo repository pair", () => {
  const result = run(
    'gh() { [[ "$*" == *"repos/person/orbit-"* ]]; }; demo_detect_repositories person',
  );
  expect(result).toBe("orbit-api,orbit-web");
  expect(run("gh() { return 1; }; demo_detect_repositories person")).toBe("");
});
it("offers quick reuse only for a complete saved profile", () => {
  const config = [
    "DEMO_GITHUB_OWNER=person",
    "DEMO_GITHUB_RESOURCE_MODE=reuse",
    "DEMO_GITHUB_REPOSITORIES=orbit-api,orbit-web",
    "DEMO_JIRA_SITE_URL=https://example.atlassian.net",
    "DEMO_JIRA_RESOURCE_MODE=reuse",
    "DEMO_JIRA_PROJECT_KEY=DEMO",
    "DEMO_JIRA_BOARD_ID=1",
    "DEMO_JIRA_SPRINT_ID=2",
    "T3_WORKBENCH_JIRA_CLIENT_ID=client",
    "T3_WORKBENCH_JIRA_CLIENT_SECRET=secret",
    "DEMO_JIRA_CALLBACK_URL=http://localhost:5000/workbench",
  ].join("\n");
  expect(
    run("if demo_profile_complete; then printf ready; else printf incomplete; fi", config),
  ).toBe("ready");
  expect(
    run(
      "if demo_profile_complete; then printf ready; else printf incomplete; fi",
      config.replace("DEMO_JIRA_SPRINT_ID=2", ""),
    ),
  ).toBe("incomplete");
});

it("accepts a hosted broker profile without direct OAuth credentials", () => {
  const config = [
    "DEMO_GITHUB_OWNER=person",
    "DEMO_GITHUB_RESOURCE_MODE=reuse",
    "DEMO_GITHUB_REPOSITORIES=orbit-api,orbit-web",
    "DEMO_JIRA_SITE_URL=https://example.atlassian.net",
    "DEMO_JIRA_RESOURCE_MODE=reuse",
    "DEMO_JIRA_PROJECT_KEY=DEMO",
    "DEMO_JIRA_BOARD_ID=1",
    "DEMO_JIRA_SPRINT_ID=2",
    "T3_WORKBENCH_JIRA_BROKER_URL=https://workbench-auth.example",
  ].join("\n");

  expect(
    run("if demo_profile_complete; then printf ready; else printf incomplete; fi", config),
  ).toBe("ready");
  expect(
    run(
      "if demo_profile_complete; then printf ready; else printf incomplete; fi",
      config.replace("T3_WORKBENCH_JIRA_BROKER_URL=https://workbench-auth.example", ""),
    ),
  ).toBe("incomplete");
});

it("switching from reuse to provision clears saved remote identities", () => {
  expect(
    run(
      'demo_ask_reuse_resource DEMO_GITHUB_REPOSITORIES Repositories provision; demo_ask_reuse_resource DEMO_JIRA_SPRINT_ID Sprint provision; printf "repos=%s,sprint=%s" "$DEMO_GITHUB_REPOSITORIES" "$DEMO_JIRA_SPRINT_ID"',
      "DEMO_GITHUB_REPOSITORIES=old-api,old-web\nDEMO_JIRA_SPRINT_ID=123\n",
    ),
  ).toBe("repos=,sprint=");
});
