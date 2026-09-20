// @effect-diagnostics nodeBuiltinImport:off - Disposable runner tests use private temporary homes.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it as test } from "vite-plus/test";

import { setupHome } from "./environment.mts";
import { finishDisposableRun, recoverDisposableDemo, startDisposableDemo } from "./disposable.mts";

const config = [
  "DEMO_JIRA_SITE_URL=https://example.atlassian.net",
  "DEMO_JIRA_PROJECT_KEY=ORBIT",
  "DEMO_JIRA_BOARD_ID=42",
].join("\n");
const manifest = {
  jiraBaseline: {
    boardName: "Orbit board",
    sprintId: 7,
    sprintName: "Orbit sprint",
    issues: [
      {
        key: "ORBIT-1",
        summary: "Baseline issue",
        description: "Baseline description",
        labels: [],
        assigneeAccountId: null,
        epicKey: null,
        state: "todo",
      },
    ],
  },
};

const connection = {
  id: "connection-1",
  cloudId: "cloud-1",
  credentialId: "credential-1",
  siteName: "Orbit Jira",
  siteUrl: "https://example.atlassian.net",
  avatarUrl: null,
  scopes: ["read:jira-work"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const seedAuth = async (home: string, accessToken: string): Promise<void> => {
  const stateDirectory = NodePath.join(home, "userdata");
  await NodeFSP.mkdir(NodePath.join(stateDirectory, "secrets"), { recursive: true, mode: 0o700 });
  const database = new NodeSqlite.DatabaseSync(NodePath.join(stateDirectory, "state.sqlite"));
  database.exec(`
    CREATE TABLE workbench_jira_connections (
      connection_id TEXT PRIMARY KEY,
      cloud_id TEXT NOT NULL UNIQUE,
      credential_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      site_url TEXT NOT NULL,
      avatar_url TEXT,
      scopes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  database
    .prepare(
      `INSERT INTO workbench_jira_connections
        (connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
         scopes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      connection.id,
      connection.cloudId,
      connection.credentialId,
      connection.siteName,
      connection.siteUrl,
      connection.avatarUrl,
      JSON.stringify(connection.scopes),
      connection.createdAt,
      connection.updatedAt,
    );
  database.close();
  await NodeFSP.writeFile(
    NodePath.join(
      stateDirectory,
      "secrets",
      `workbench-jira-credential-${connection.credentialId}.bin`,
    ),
    JSON.stringify({
      accessToken,
      refreshToken: "refresh-token",
      scope: "read:jira-work",
      expiresAtEpochMs: 1_900_000_000_000,
      authMode: "broker",
    }),
    { mode: 0o600 },
  );
};

const writeLock = async (
  sourceHome: string,
  runHome: string,
  phase: "pending-auth" | "running" | "auth-saved" = "running",
) => {
  await NodeFSP.writeFile(
    NodePath.join(sourceHome, ".disposable-demo.lock"),
    `${JSON.stringify({
      version: 1,
      phase,
      sourceHome,
      runHome,
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: process.pid,
    })}\n`,
    { mode: 0o600 },
  );
};

test("fails before creating a disposable run when the saved Jira grant is missing", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    NodeFS.writeFileSync(NodePath.join(source, "config.env"), `${config}\n`);
    NodeFS.writeFileSync(NodePath.join(source, "remotes.json"), JSON.stringify(manifest));

    await NodeAssert.rejects(
      startDisposableDemo({ sourceHome: source }),
      /demo database does not exist|no connected Jira site/i,
    );
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
    NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.join(source, "runs")), []);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("finishes a stopped run before deleting its rotated grant and reset archive", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-success"));
    await seedAuth(source, "source-token");
    await seedAuth(run, "rotated-token");
    await NodeFSP.mkdir(NodePath.join(source, "runs"), { recursive: true });
    await NodeFSP.mkdir(`${run}.backup-123`);
    await writeLock(source, run);

    await finishDisposableRun(source, run);

    NodeAssert.equal(NodeFS.existsSync(run), false);
    NodeAssert.equal(NodeFS.existsSync(`${run}.backup-123`), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
    const credential = JSON.parse(
      await NodeFSP.readFile(
        NodePath.join(source, "userdata", "secrets", "workbench-jira-credential-credential-1.bin"),
        "utf8",
      ),
    ) as { accessToken: string };
    NodeAssert.equal(credential.accessToken, "rotated-token");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("retains the run and lock when the refreshed grant cannot be saved", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-failed-save"));
    await seedAuth(source, "source-token");
    await seedAuth(run, "rotated-token");
    await NodeFSP.mkdir(NodePath.join(source, "runs"), { recursive: true });
    await writeLock(source, run);
    await NodeFSP.writeFile(NodePath.join(source, "run.lock"), "active");

    await NodeAssert.rejects(
      finishDisposableRun(source, run),
      /Stop the demo before exporting or importing Jira credentials/,
    );
    NodeAssert.equal(NodeFS.existsSync(run), true);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("recovers an auth-saved run even if its throwaway directory is already gone", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = NodePath.join(source, "runs", "run-recovered");
    await NodeFSP.mkdir(NodePath.dirname(run), { recursive: true });
    await writeLock(source, run, "auth-saved");

    await recoverDisposableDemo({ sourceHome: source, runHome: run });

    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("recovers a running-phase run through the public recovery path", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-running"));
    await seedAuth(source, "source-token");
    await seedAuth(run, "rotated-token");
    await NodeFSP.writeFile(
      NodePath.join(run, "disposable-run.json"),
      `${JSON.stringify({
        version: 1,
        phase: "running",
        sourceHome: source,
        runHome: run,
        createdAt: "2026-01-01T00:00:00.000Z",
        pid: process.pid,
      })}\n`,
    );
    await writeLock(source, run, "running");

    await recoverDisposableDemo({ sourceHome: source, runHome: run });

    NodeAssert.equal(NodeFS.existsSync(run), false);
    const credential = JSON.parse(
      await NodeFSP.readFile(
        NodePath.join(source, "userdata", "secrets", "workbench-jira-credential-credential-1.bin"),
        "utf8",
      ),
    ) as { accessToken: string };
    NodeAssert.equal(credential.accessToken, "rotated-token");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("cleans a run interrupted before the OAuth bundle was imported", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-pending-auth"));
    await writeLock(source, run, "pending-auth");

    await recoverDisposableDemo({ sourceHome: source, runHome: run });

    NodeAssert.equal(NodeFS.existsSync(run), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects recovery for a run that does not match the source lock", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const lockedRun = NodePath.join(source, "runs", "run-locked");
    const requestedRun = NodePath.join(source, "runs", "run-other");
    await NodeFSP.mkdir(requestedRun, { recursive: true });
    await writeLock(source, lockedRun);

    await NodeAssert.rejects(
      recoverDisposableDemo({ sourceHome: source, runHome: requestedRun }),
      /source lock does not point/,
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
