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
  inspectGitHub: vi.fn(),
}));

vi.mock("./launch.mts", () => ({ launchDemo: mocks.launchDemo }));
vi.mock("./access.mts", () => ({ withDemoAccess: mocks.withDemoAccess }));
vi.mock("./local.mts", () => ({
  setupLocal: mocks.setupLocal,
  verifyLocal: mocks.verifyLocal,
}));
vi.mock("./integrations.mts", () => ({
  linkDemoPullRequests: mocks.linkDemoPullRequests,
}));
vi.mock("./remotes.mts", () => ({ inspectGitHub: mocks.inspectGitHub }));

import { setupHome } from "./environment.mts";
import { prepareDemoProfile } from "./prepare.mts";

const writeConfig = (home: string): void => {
  NodeFS.writeFileSync(
    NodePath.join(home, "config.env"),
    [
      "DEMO_GITHUB_OWNER=demo-owner",
      "DEMO_GITHUB_RESOURCE_MODE=reuse",
      "DEMO_GITHUB_REPOSITORIES=orbit-api,orbit-web",
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
  mocks.verifyLocal.mockResolvedValue(undefined);
};

test("records the GitHub inspection and stops the setup server", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home);
    configureMocks(stop);

    await prepareDemoProfile({ home });

    NodeAssert.equal(stop.mock.calls.length, 1);
    NodeAssert.deepEqual(mocks.linkDemoPullRequests.mock.calls[0]?.[0]?.urls, [
      "https://github.com/demo-owner/orbit-api/pull/1",
    ]);
    const remotes = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "remotes.json"), "utf8"),
    ) as { github?: { missing: readonly string[] } };
    NodeAssert.deepEqual(remotes.github?.missing, []);
  } finally {
    vi.resetAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("stops the setup server when local setup fails", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-prepare-test-"));
  const stop = vi.fn(async () => undefined);
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    writeConfig(home);
    configureMocks(stop);
    mocks.setupLocal.mockRejectedValueOnce(new Error("Local setup failed"));

    await NodeAssert.rejects(prepareDemoProfile({ home }), /Local setup failed/);

    NodeAssert.equal(stop.mock.calls.length, 1);
    NodeAssert.equal(mocks.verifyLocal.mock.calls.length, 0);
  } finally {
    vi.resetAllMocks();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
