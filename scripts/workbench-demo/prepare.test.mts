// @effect-diagnostics nodeBuiltinImport:off - First-run setup tests use private temporary homes.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it as test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  launchDemo: vi.fn(),
  withDemoAccess: vi.fn(),
  setupLocal: vi.fn(),
  verifyLocal: vi.fn(),
  linkDemoPullRequests: vi.fn(),
  syncDemoJira: vi.fn(),
  verifyDemoJira: vi.fn(),
  inspectGitHub: vi.fn(),
  snapshotJiraBaseline: vi.fn(),
}));

vi.mock("./launch.mts", () => ({ launchDemo: mocks.launchDemo }));
vi.mock("./access.mts", () => ({ withDemoAccess: mocks.withDemoAccess }));
vi.mock("./local.mts", () => ({
  setupLocal: mocks.setupLocal,
  verifyLocal: mocks.verifyLocal,
}));
vi.mock("./integrations.mts", () => ({
  linkDemoPullRequests: mocks.linkDemoPullRequests,
  syncDemoJira: mocks.syncDemoJira,
  verifyDemoJira: mocks.verifyDemoJira,
}));
vi.mock("./remotes.mts", () => ({
  inspectGitHub: mocks.inspectGitHub,
  snapshotJiraBaseline: mocks.snapshotJiraBaseline,
}));

import { setupHome } from "./environment.mts";
import { prepareDemoProfile } from "./prepare.mts";

const writeConfig = (
  home: string,
  options: { readonly provisionedSprint?: boolean } = {},
): void => {
  NodeFS.writeFileSync(
    NodePath.join(home, "config.env"),
    [
      "DEMO_GITHUB_OWNER=demo-owner",
      "DEMO_GITHUB_RESOURCE_MODE=reuse",
      "DEMO_GITHUB_REPOSITORIES=orbit-api,orbit-web",
      "DEMO_JIRA_RESOURCE_MODE=reuse",
      "DEMO_JIRA_SITE_URL=https://example.atlassian.net",
      "DEMO_JIRA_PROJECT_KEY=ORBIT",
      "DEMO_JIRA_BOARD_ID=42",
      ...(options.provisionedSprint ? [] : ["DEMO_JIRA_SPRINT_ID=7"]),
      "DEMO_JIRA_EMAIL=user@example.test",
      "DEMO_JIRA_API_TOKEN=api-token",
    ].join("\n"),
  );
};

const configureMocks = (stop: ReturnType<typeof vi.fn>) => {
  mocks.launchDemo.mockResolvedValueOnce({
    pairingUrl: "http://127.0.0.1:4173/pair#secret",
    stop,
    exited: Promise.resolve(),
  });
  mocks.inspectGitHub.mockResolvedValueOnce({
    missing: [],
    repositories: [{ pullRequests: [{ url: "https://github.com/demo-owner/orbit-api/pull/1" }] }],
  });
  mocks.withDemoAccess.mockImplementation(
    async (_home: string, operation: (access: unknown) => unknown) =>
      operation({ wsUrl: "ws://demo", token: "token" }),
  );
  mocks.setupLocal.mockResolvedValue(undefined);
  mocks.linkDemoPullRequests.mockResolvedValue(undefined);
  mocks.verifyDemoJira.mockResolvedValue(undefined);
  mocks.verifyLocal.mockResolvedValue(undefined);
};

test("stops the setup server and leaves no baseline when authorization is canceled", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home);
    configureMocks(stop);

    await NodeAssert.rejects(
      prepareDemoProfile({
        home,
        authorize: async () => {
          throw new Error("Jira authorization was canceled");
        },
      }),
      /Jira authorization was canceled/,
    );
    NodeAssert.equal(stop.mock.calls.length, 1);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(home, "userdata")), true);
    const remotes = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "remotes.json"), "utf8"),
    ) as Record<string, unknown>;
    NodeAssert.equal("jiraBaseline" in remotes, false);
    NodeAssert.equal(mocks.syncDemoJira.mock.calls.length, 0);
  } finally {
    vi.clearAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("captures a new baseline using the sprint selected by provisioning", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home, { provisionedSprint: true });
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      `${JSON.stringify({ jira: { sprintId: 7 } })}\n`,
    );
    configureMocks(stop);
    mocks.syncDemoJira.mockResolvedValueOnce({
      links: [{ active: true, issue: { key: "ORBIT-1" } }],
    });
    mocks.snapshotJiraBaseline.mockResolvedValueOnce({ issues: [{ key: "ORBIT-1" }] });

    await prepareDemoProfile({ home, authorize: async () => undefined });

    NodeAssert.equal(stop.mock.calls.length, 1);
    NodeAssert.equal(mocks.syncDemoJira.mock.calls[0]?.[0]?.sprintId, 7);
    const remotes = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "remotes.json"), "utf8"),
    ) as { jiraBaseline?: { issues: readonly { key: string }[] } };
    NodeAssert.deepEqual(remotes.jiraBaseline?.issues, [{ key: "ORBIT-1" }]);
  } finally {
    vi.resetAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("stops the setup server and leaves no baseline when Jira sync fails", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home);
    configureMocks(stop);
    mocks.syncDemoJira.mockRejectedValueOnce(new Error("Jira sync failed"));

    await NodeAssert.rejects(
      prepareDemoProfile({ home, authorize: async () => undefined }),
      /Jira sync failed/,
    );

    NodeAssert.equal(stop.mock.calls.length, 1);
    const remotes = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "remotes.json"), "utf8"),
    ) as Record<string, unknown>;
    NodeAssert.equal("jiraBaseline" in remotes, false);
  } finally {
    vi.resetAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("does not replace the prior baseline when interrupted during capture", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home);
    const priorBaseline = { issues: [{ key: "ORBIT-0" }] };
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      `${JSON.stringify({ jiraBaseline: priorBaseline })}\n`,
    );
    configureMocks(stop);
    mocks.syncDemoJira.mockResolvedValueOnce({
      links: [{ active: true, issue: { key: "ORBIT-1" } }],
    });
    let captureStarted!: () => void;
    const captureReady = new Promise<void>((resolve) => {
      captureStarted = resolve;
    });
    let resolveCapture!: (value: { issues: readonly { key: string }[] }) => void;
    const capture = new Promise<{ issues: readonly { key: string }[] }>((resolve) => {
      resolveCapture = resolve;
    });
    mocks.snapshotJiraBaseline.mockImplementationOnce(async () => {
      captureStarted();
      return await capture;
    });

    const preparing = prepareDemoProfile({ home, authorize: async () => undefined });
    await captureReady;
    process.emit("SIGINT");
    resolveCapture({ issues: [{ key: "ORBIT-1" }] });

    await NodeAssert.rejects(preparing, /Setup was canceled/);
    NodeAssert.equal(stop.mock.calls.length, 1);
    const remotes = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "remotes.json"), "utf8"),
    ) as { jiraBaseline?: typeof priorBaseline };
    NodeAssert.deepEqual(remotes.jiraBaseline, priorBaseline);
  } finally {
    vi.resetAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
