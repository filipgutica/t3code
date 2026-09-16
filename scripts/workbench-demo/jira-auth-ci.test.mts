// @effect-diagnostics nodeBuiltinImport:off - The test uses disposable SQLite state and an injected gh boundary.
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it as test } from "vite-plus/test";

import { setupHome } from "./environment.mts";
import {
  DEMO_CREDENTIALS_TOKEN,
  importJiraAuthBundleFromEnvironment,
  JIRA_OAUTH_BUNDLE_SECRET,
  publishJiraAuthBundle,
  preflightJiraAuthPersistence,
  type GhSecretSetInput,
} from "./jira-auth-ci.mts";
import { decodeJiraAuthBundle, encodeJiraAuthBundle } from "./jira-auth.mts";

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
  accessToken: "access-token",
  refreshToken: "refresh-token",
  scope: "read:jira-work write:jira-work offline_access",
  expiresAtEpochMs: 1_900_000_000_000,
  authMode: "broker" as const,
};

test("preflight proves write access with the unchanged bundle and hides credential errors", async () => {
  const bundle = {
    version: 1 as const,
    connections: [connection],
    credentials: [{ id: connection.credentialId, value: credential }],
  };
  const environment = {
    [DEMO_CREDENTIALS_TOKEN]: "writer-secret",
    [JIRA_OAUTH_BUNDLE_SECRET]: encodeJiraAuthBundle(bundle),
  };
  let writes = 0;
  await preflightJiraAuthPersistence({
    repository: "filipgutica/t3code",
    secretEnvironment: "workbench-demo",
    environment,
    commandRunner: async (input) => {
      writes += 1;
      NodeAssert.equal(input.secretEnvironment, "workbench-demo");
      NodeAssert.deepEqual(decodeJiraAuthBundle(input.secretValue), bundle);
      NodeAssert.equal(input.environment.GH_TOKEN, "writer-secret");
      NodeAssert.equal(input.environment[DEMO_CREDENTIALS_TOKEN], undefined);
    },
  });
  NodeAssert.equal(writes, 1);
  await NodeAssert.rejects(
    preflightJiraAuthPersistence({
      repository: "filipgutica/t3code",
      secretEnvironment: "workbench-demo",
      environment,
      commandRunner: async () => {
        throw new Error("writer-secret refresh-token");
      },
    }),
    { message: "GitHub secret update failed." },
  );
});

test("CI rejects direct and legacy OAuth bundles before updating secrets", async () => {
  for (const authMode of ["direct", undefined] as const) {
    const { authMode: _mode, ...tokens } = credential;
    let writes = 0;
    await NodeAssert.rejects(
      preflightJiraAuthPersistence({
        repository: "filipgutica/t3code",
        environment: {
          [DEMO_CREDENTIALS_TOKEN]: "writer-secret",
          [JIRA_OAUTH_BUNDLE_SECRET]: encodeJiraAuthBundle({
            version: 1,
            connections: [connection],
            credentials: [
              {
                id: connection.credentialId,
                value: { ...tokens, ...(authMode ? { authMode } : {}) },
              },
            ],
          }),
        },
        commandRunner: async () => {
          writes += 1;
        },
      }),
      /broker/,
    );
    NodeAssert.equal(writes, 0);
  }
});

const makeConnectedHome = async (): Promise<{ readonly root: string; readonly home: string }> => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jira-auth-ci-"));
  const home = setupHome(NodePath.join(root, "demo"));
  const stateDirectory = NodePath.join(home, "userdata");
  const secretsDirectory = NodePath.join(stateDirectory, "secrets");
  await NodeFSP.mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
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
    NodePath.join(secretsDirectory, `workbench-jira-credential-${connection.credentialId}.bin`),
    JSON.stringify(credential),
    { mode: 0o600 },
  );
  return { root, home };
};

test("publishes the exported bundle through stdin contract without putting credentials in argv", async () => {
  const { root, home } = await makeConnectedHome();
  try {
    const calls: GhSecretSetInput[] = [];
    await publishJiraAuthBundle({
      home,
      repository: "filipgutica/t3code",
      secretEnvironment: "workbench-demo",
      environment: {
        [DEMO_CREDENTIALS_TOKEN]: "github-secret-token",
        PATH: "/usr/bin",
      },
      commandRunner: async (input) => {
        calls.push(input);
      },
    });
    const call = calls[0];
    NodeAssert.ok(call);
    NodeAssert.equal(call.repository, "filipgutica/t3code");
    NodeAssert.equal(call.secretName, JIRA_OAUTH_BUNDLE_SECRET);
    NodeAssert.equal(call.environment.GH_TOKEN, "github-secret-token");
    NodeAssert.equal(call.environment[DEMO_CREDENTIALS_TOKEN], undefined);
    NodeAssert.equal(
      decodeJiraAuthBundle(call.secretValue).credentials[0]?.value.accessToken,
      "access-token",
    );
    NodeAssert.equal(
      decodeJiraAuthBundle(call.secretValue).credentials[0]?.value.refreshToken,
      "refresh-token",
    );
    NodeAssert.equal(call.repository.includes(call.secretValue), false);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("passes the bundle to gh on stdin and the credential only as GH_TOKEN", async () => {
  const { root, home } = await makeConnectedHome();
  try {
    const fakeBin = NodePath.join(root, "bin");
    const inputPath = NodePath.join(root, "stdin");
    const argsPath = NodePath.join(root, "args");
    const tokenPath = NodePath.join(root, "token");
    await NodeFSP.mkdir(fakeBin);
    await NodeFSP.writeFile(
      NodePath.join(fakeBin, "gh"),
      "#!/bin/sh\ncat > $TEST_INPUT_PATH\nprintf '%s\\n' \"$@\" > $TEST_ARGS_PATH\nprintf '%s' \"$GH_TOKEN\" > $TEST_TOKEN_PATH\n",
      { mode: 0o700 },
    );
    await publishJiraAuthBundle({
      home,
      repository: "filipgutica/t3code",
      secretEnvironment: "workbench-demo",
      environment: {
        [DEMO_CREDENTIALS_TOKEN]: "github-secret-token",
        PATH: `${fakeBin}${NodePath.delimiter}${process.env.PATH ?? ""}`,
        TEST_INPUT_PATH: inputPath,
        TEST_ARGS_PATH: argsPath,
        TEST_TOKEN_PATH: tokenPath,
      },
    });
    const input = (await NodeFSP.readFile(inputPath, "utf8")).trim();
    const args = await NodeFSP.readFile(argsPath, "utf8");
    NodeAssert.equal(decodeJiraAuthBundle(input).connections[0]?.cloudId, "cloud-1");
    NodeAssert.equal(
      args,
      "secret\nset\nDEMO_JIRA_OAUTH_BUNDLE\n--repo\nfilipgutica/t3code\n--env\nworkbench-demo\n",
    );
    NodeAssert.equal(args.includes("access-token"), false);
    NodeAssert.equal(args.includes("refresh-token"), false);
    NodeAssert.equal(await NodeFSP.readFile(tokenPath, "utf8"), "github-secret-token");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("requires the CI OAuth bundle for import without attempting a remote call", async () => {
  const { root, home } = await makeConnectedHome();
  try {
    await NodeAssert.rejects(
      importJiraAuthBundleFromEnvironment({ home, environment: {} }),
      new RegExp(`${JIRA_OAUTH_BUNDLE_SECRET} is required`),
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed GitHub repository names before exporting credentials", async () => {
  const { root, home } = await makeConnectedHome();
  try {
    await NodeAssert.rejects(
      publishJiraAuthBundle({
        home,
        repository: "--repo-malformed",
        environment: { [DEMO_CREDENTIALS_TOKEN]: "github-secret-token" },
        commandRunner: async () => {
          throw new Error("remote runner should not be called");
        },
      }),
      /OWNER\/REPOSITORY/,
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

test("sanitizes a GitHub secret update failure", async () => {
  const { root, home } = await makeConnectedHome();
  try {
    await NodeAssert.rejects(
      publishJiraAuthBundle({
        home,
        repository: "filipgutica/t3code",
        environment: { [DEMO_CREDENTIALS_TOKEN]: "github-secret-token" },
        commandRunner: async () => {
          throw new Error("provider leaked github-secret-token");
        },
      }),
      { message: "GitHub secret update failed." },
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
