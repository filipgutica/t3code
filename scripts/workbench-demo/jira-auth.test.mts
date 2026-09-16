// @effect-diagnostics nodeBuiltinImport:off - The test uses the same native SQLite version as the demo runner.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it as test } from "vite-plus/test";

import { setupHome } from "./environment.mts";
import {
  decodeJiraAuthBundle,
  encodeJiraAuthBundle,
  exportJiraAuth,
  importJiraAuth,
  readJiraAuthBundleFile,
  type JiraAuthBundle,
  writeJiraAuthBundleFile,
} from "./jira-auth.mts";

const connection = {
  id: "connection-1",
  cloudId: "cloud-1",
  credentialId: "credential-1",
  siteName: "Orbit Jira",
  siteUrl: "https://example.atlassian.net",
  avatarUrl: null,
  scopes: ["read:jira-work", "write:jira-work"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const credential = {
  id: "credential-1",
  value: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    scope: "read:jira-work write:jira-work offline_access",
    expiresAtEpochMs: 1_900_000_000_000,
    authMode: "broker" as const,
  },
} as const;

const bundle: JiraAuthBundle = {
  version: 1,
  connections: [connection],
  credentials: [credential],
};

const makeDatabase = async (home: string, rows: readonly (typeof connection)[] = []) => {
  const stateDirectory = NodePath.join(home, "userdata");
  await NodeFSP.mkdir(stateDirectory, { recursive: true });
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
  const statement = database.prepare(
    `INSERT INTO workbench_jira_connections
      (connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
       scopes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of rows)
    statement.run(
      item.id,
      item.cloudId,
      item.credentialId,
      item.siteName,
      item.siteUrl,
      item.avatarUrl,
      JSON.stringify(item.scopes),
      item.createdAt,
      item.updatedAt,
    );
  database.close();
};

const secretPath = (home: string, id: string) =>
  NodePath.join(home, "userdata", "secrets", `workbench-jira-credential-${id}.bin`);

test("encodes and validates a Jira auth bundle for one-line CI secrets", () => {
  const encoded = encodeJiraAuthBundle(bundle);
  NodeAssert.equal(encoded.includes("\n"), false);
  NodeAssert.deepEqual(decodeJiraAuthBundle(encoded), bundle);
  NodeAssert.throws(
    () => decodeJiraAuthBundle(JSON.stringify({ ...bundle, version: 2 })),
    /Unsupported Jira auth bundle version/,
  );
});

test("round-trips the base64 bundle file used by CI setup", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jira-auth-file-"));
  try {
    const path = NodePath.join(root, "jira-auth.bundle");
    await writeJiraAuthBundleFile({ path, bundle });
    NodeAssert.deepEqual(await readJiraAuthBundleFile(path), bundle);
    NodeAssert.equal(NodeFS.statSync(path).mode & 0o777, 0o600);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("exports referenced credentials without exposing pending OAuth state", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jira-auth-export-"));
  try {
    const home = setupHome(NodePath.join(root, "source"));
    await makeDatabase(home, [connection]);
    await NodeFSP.mkdir(NodePath.dirname(secretPath(home, credential.id)), { mode: 0o700 });
    await NodeFSP.writeFile(secretPath(home, credential.id), JSON.stringify(credential.value), {
      mode: 0o600,
    });
    const exported = await exportJiraAuth({ home });
    NodeAssert.deepEqual(exported, bundle);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("imports a bundle idempotently and restores the secret file", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jira-auth-import-"));
  try {
    const home = setupHome(NodePath.join(root, "destination"));
    await makeDatabase(home);
    const encoded = encodeJiraAuthBundle(bundle);
    NodeAssert.deepEqual(await importJiraAuth({ home, bundle: encoded }), {
      connections: 1,
      credentials: 1,
    });
    NodeAssert.deepEqual(await importJiraAuth({ home, bundle: encoded }), {
      connections: 1,
      credentials: 1,
    });
    const database = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata", "state.sqlite"));
    const row = database
      .prepare(
        "SELECT connection_id, cloud_id, credential_id, scopes_json FROM workbench_jira_connections",
      )
      .get() as Record<string, unknown>;
    database.close();
    NodeAssert.deepEqual(
      { ...row },
      {
        connection_id: connection.id,
        cloud_id: connection.cloudId,
        credential_id: connection.credentialId,
        scopes_json: JSON.stringify(connection.scopes),
      },
    );
    NodeAssert.deepEqual(
      JSON.parse(await NodeFSP.readFile(secretPath(home, credential.id), "utf8")),
      credential.value,
    );
    NodeAssert.equal(NodeFS.statSync(secretPath(home, credential.id)).mode & 0o777, 0o600);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("refuses malformed bundles and a running demo before writing", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jira-auth-safety-"));
  try {
    const home = setupHome(NodePath.join(root, "destination"));
    await makeDatabase(home);
    NodeAssert.throws(
      () => decodeJiraAuthBundle(JSON.stringify({ version: 1 })),
      /Invalid Jira auth bundle/,
    );
    await NodeFSP.writeFile(NodePath.join(home, "run.lock"), "active");
    await NodeAssert.rejects(
      importJiraAuth({ home, bundle }),
      /Stop the demo before exporting or importing Jira credentials/,
    );
    NodeAssert.equal(NodeFS.existsSync(secretPath(home, credential.id)), false);
    await NodeFSP.unlink(NodePath.join(home, "run.lock"));
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata", "server-runtime.json"),
      JSON.stringify({ pid: process.pid }),
    );
    await NodeAssert.rejects(importJiraAuth({ home, bundle }), /Stop the demo server/);
    await NodeAssert.rejects(exportJiraAuth({ home }), /Stop the demo server/);
    NodeAssert.equal(NodeFS.existsSync(secretPath(home, credential.id)), false);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
