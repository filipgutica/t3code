// @effect-diagnostics nodeBuiltinImport:off - This stopped-demo helper moves an OAuth credential between isolated test homes.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { requireHome } from "./environment.mts";

const BUNDLE_VERSION = 1 as const;
const authConnectionTable = "workbench_jira_connections";
const authStateDirectory = (home: string) => NodePath.join(home, "userdata");
const authDatabasePath = (home: string) => NodePath.join(authStateDirectory(home), "state.sqlite");
const authSecretsDirectory = (home: string) => NodePath.join(authStateDirectory(home), "secrets");
const credentialPath = (home: string, credentialId: string) =>
  NodePath.join(authSecretsDirectory(home), `workbench-jira-credential-${credentialId}.bin`);

type SqliteValue = string | number | null | Uint8Array;

export interface JiraAuthBundleCredential {
  readonly id: string;
  readonly value: {
    readonly accessToken: string;
    readonly refreshToken: string | null;
    readonly scope: string;
    readonly expiresAtEpochMs: number;
    readonly authMode?: "direct" | "broker";
  };
}

export interface JiraAuthBundleConnection {
  readonly id: string;
  readonly cloudId: string;
  readonly credentialId: string;
  readonly siteName: string;
  readonly siteUrl: string;
  readonly avatarUrl: string | null;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A portable, versioned snapshot of the credentials needed for a preconnected
 * demo. The bundle deliberately excludes the OAuth client secret and pending
 * authorization state. Keep encoded bundles in a secret store.
 */
export interface JiraAuthBundle {
  readonly version: typeof BUNDLE_VERSION;
  readonly connections: readonly JiraAuthBundleConnection[];
  readonly credentials: readonly JiraAuthBundleCredential[];
}

export type JiraAuthBundleInput = JiraAuthBundle | string | Uint8Array;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid Jira auth bundle.`);
  return value;
};

const identifierField = (value: unknown): string => {
  const identifier = stringField(value, "id");
  if (!/^[A-Za-z0-9._-]+$/.test(identifier)) throw new Error("Invalid Jira auth bundle.");
  return identifier;
};

const nullableStringField = (value: unknown): string | null => {
  if (value === null) return null;
  return stringField(value, "value");
};

const safeIntegerField = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("Invalid Jira auth bundle.");
  return value;
};

const scopesField = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== "string" || !scope))
    throw new Error("Invalid Jira auth bundle.");
  return [...value];
};

const parseCredential = (value: unknown): JiraAuthBundleCredential => {
  if (!isRecord(value) || !isRecord(value.value)) throw new Error("Invalid Jira auth bundle.");
  const authMode = value.value.authMode;
  if (authMode !== undefined && authMode !== "direct" && authMode !== "broker")
    throw new Error("Invalid Jira auth bundle.");
  return {
    id: identifierField(value.id),
    value: {
      accessToken: stringField(value.value.accessToken, "accessToken"),
      refreshToken: nullableStringField(value.value.refreshToken),
      scope: stringField(value.value.scope, "scope"),
      expiresAtEpochMs: safeIntegerField(value.value.expiresAtEpochMs),
      ...(authMode === undefined ? {} : { authMode }),
    },
  };
};

const parseConnection = (value: unknown): JiraAuthBundleConnection => {
  if (!isRecord(value)) throw new Error("Invalid Jira auth bundle.");
  const siteUrl = stringField(value.siteUrl, "siteUrl");
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    throw new Error("Invalid Jira auth bundle.");
  }
  return {
    id: identifierField(value.id),
    cloudId: stringField(value.cloudId, "cloudId"),
    credentialId: stringField(value.credentialId, "credentialId"),
    siteName: stringField(value.siteName, "siteName"),
    siteUrl,
    avatarUrl: nullableStringField(value.avatarUrl),
    scopes: scopesField(value.scopes),
    createdAt: stringField(value.createdAt, "createdAt"),
    updatedAt: stringField(value.updatedAt, "updatedAt"),
  };
};

const parseBundleObject = (value: unknown): JiraAuthBundle => {
  if (!isRecord(value) || value.version !== BUNDLE_VERSION)
    throw new Error("Unsupported Jira auth bundle version.");
  if (!Array.isArray(value.connections) || !Array.isArray(value.credentials))
    throw new Error("Invalid Jira auth bundle.");
  const connections = value.connections.map(parseConnection);
  const credentials = value.credentials.map(parseCredential);
  if (connections.length === 0 || credentials.length === 0) {
    throw new Error("Jira auth bundle does not contain a connection and credential.");
  }
  const connectionIds = new Set<string>();
  const cloudIds = new Set<string>();
  for (const connection of connections) {
    if (connectionIds.has(connection.id) || cloudIds.has(connection.cloudId))
      throw new Error("Invalid Jira auth bundle.");
    connectionIds.add(connection.id);
    cloudIds.add(connection.cloudId);
  }
  const credentialIds = new Set<string>();
  for (const credential of credentials) {
    if (credentialIds.has(credential.id)) throw new Error("Invalid Jira auth bundle.");
    credentialIds.add(credential.id);
  }
  if (connections.some((connection) => !credentialIds.has(connection.credentialId)))
    throw new Error("Invalid Jira auth bundle.");
  return { version: BUNDLE_VERSION, connections, credentials };
};

const decodeText = (input: string | Uint8Array): string => {
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    return Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new Error("Invalid Jira auth bundle encoding.");
  }
};

/** Validate and normalize a bundle supplied by a file or CI secret. */
export const decodeJiraAuthBundle = (input: JiraAuthBundleInput): JiraAuthBundle => {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) return parseBundleObject(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(input));
  } catch {
    throw new Error("Invalid Jira auth bundle encoding.");
  }
  return parseBundleObject(parsed);
};

/** Encode a bundle as one-line base64 suitable for a GitHub Actions secret. */
export const encodeJiraAuthBundle = (input: JiraAuthBundleInput): string =>
  Buffer.from(JSON.stringify(decodeJiraAuthBundle(input)), "utf8").toString("base64");

/** Read either raw JSON or the base64 form used by CI from a private file. */
export const readJiraAuthBundleFile = async (path: string): Promise<JiraAuthBundle> =>
  decodeJiraAuthBundle(await NodeFSP.readFile(path, "utf8"));

/** Write the one-line base64 form with the same permissions as a server secret. */
export const writeJiraAuthBundleFile = async (input: {
  readonly path: string;
  readonly bundle: JiraAuthBundleInput;
}): Promise<void> => {
  await NodeFSP.writeFile(input.path, encodeJiraAuthBundle(input.bundle), { mode: 0o600 });
  await NodeFSP.chmod(input.path, 0o600);
};

const jsonCredential = (value: Uint8Array): JiraAuthBundleCredential["value"] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(value));
  } catch {
    throw new Error("Stored Jira credentials are invalid.");
  }
  if (!isRecord(parsed)) throw new Error("Stored Jira credentials are invalid.");
  try {
    return parseCredential({ id: "credential", value: parsed }).value;
  } catch {
    throw new Error("Stored Jira credentials are invalid.");
  }
};

const openDatabase = (home: string): NodeSqlite.DatabaseSync => {
  const path = authDatabasePath(home);
  if (!NodeFS.existsSync(path)) throw new Error("The demo database does not exist; seed it first.");
  const database = new NodeSqlite.DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA busy_timeout = 5000;");
  return database;
};

const readConnectionRows = (database: NodeSqlite.DatabaseSync) => {
  try {
    return database
      .prepare(
        `SELECT connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
                scopes_json, created_at, updated_at
           FROM ${authConnectionTable}
          ORDER BY created_at ASC, connection_id ASC`,
      )
      .all() as Record<string, SqliteValue>[];
  } catch {
    throw new Error("The demo database has no Jira connection table; seed it first.");
  }
};

const requiredRowString = (row: Record<string, SqliteValue>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Invalid Jira connection row.");
  return value;
};

const rowConnection = (row: Record<string, SqliteValue>): JiraAuthBundleConnection => {
  let scopes: unknown;
  try {
    scopes = JSON.parse(requiredRowString(row, "scopes_json"));
  } catch {
    throw new Error("Invalid Jira connection row.");
  }
  return parseConnection({
    id: requiredRowString(row, "connection_id"),
    cloudId: requiredRowString(row, "cloud_id"),
    credentialId: requiredRowString(row, "credential_id"),
    siteName: requiredRowString(row, "site_name"),
    siteUrl: requiredRowString(row, "site_url"),
    avatarUrl: row.avatar_url,
    scopes,
    createdAt: requiredRowString(row, "created_at"),
    updatedAt: requiredRowString(row, "updated_at"),
  });
};

const ensureStopped = (home: string): void => {
  if (NodeFS.existsSync(NodePath.join(home, "run.lock")))
    throw new Error("Stop the demo before exporting or importing Jira credentials.");
  const runtimePath = NodePath.join(home, "userdata", "server-runtime.json");
  if (!NodeFS.existsSync(runtimePath)) return;
  const runtime: unknown = JSON.parse(NodeFS.readFileSync(runtimePath, "utf8"));
  if (
    !isRecord(runtime) ||
    typeof runtime.pid !== "number" ||
    !Number.isSafeInteger(runtime.pid) ||
    runtime.pid <= 0
  )
    throw new Error("Cannot verify that the demo server is stopped.");
  try {
    process.kill(runtime.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw new Error("Cannot verify that the demo server is stopped.");
  }
  throw new Error("Stop the demo server before exporting or importing Jira credentials.");
};

/** Export the connections and secret files referenced by a stopped demo home. */
export const exportJiraAuth = async (input: { readonly home: string }): Promise<JiraAuthBundle> => {
  const home = requireHome(input.home);
  ensureStopped(home);
  const database = openDatabase(home);
  try {
    const connections = readConnectionRows(database).map(rowConnection);
    if (connections.length === 0) throw new Error("The demo has no connected Jira site.");
    const credentialsById = new Map<string, JiraAuthBundleCredential>();
    for (const connection of connections) {
      if (credentialsById.has(connection.credentialId)) continue;
      const bytes = await NodeFSP.readFile(credentialPath(home, connection.credentialId));
      const value = jsonCredential(bytes);
      credentialsById.set(connection.credentialId, { id: connection.credentialId, value });
    }
    return decodeJiraAuthBundle({
      version: BUNDLE_VERSION,
      connections,
      credentials: [...credentialsById.values()],
    });
  } finally {
    database.close();
  }
};

const credentialBytes = (credential: JiraAuthBundleCredential): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(credential.value));

const writeCredentialFile = async (path: string, value: Uint8Array): Promise<void> => {
  const tempPath = `${path}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.writeFile(tempPath, value, { mode: 0o600 });
    await NodeFSP.chmod(tempPath, 0o600);
    await NodeFSP.rename(tempPath, path);
    await NodeFSP.chmod(path, 0o600);
  } finally {
    await NodeFSP.rm(tempPath, { force: true }).catch(() => undefined);
  }
};

/** Import a preconnected bundle into a stopped, already-seeded demo home. */
export const importJiraAuth = async (input: {
  readonly home: string;
  readonly bundle: JiraAuthBundleInput;
}): Promise<{ readonly connections: number; readonly credentials: number }> => {
  const home = requireHome(input.home);
  ensureStopped(home);
  const bundle = decodeJiraAuthBundle(input.bundle);
  const database = openDatabase(home);
  const secretDirectory = authSecretsDirectory(home);
  await NodeFSP.mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  await NodeFSP.chmod(secretDirectory, 0o700);

  const previousSecrets = new Map<string, Uint8Array | undefined>();
  for (const credential of bundle.credentials) {
    const path = credentialPath(home, credential.id);
    previousSecrets.set(path, await NodeFSP.readFile(path).catch(() => undefined));
  }
  const writtenPaths: string[] = [];
  try {
    for (const credential of bundle.credentials) {
      const path = credentialPath(home, credential.id);
      await writeCredentialFile(path, credentialBytes(credential));
      writtenPaths.push(path);
    }
    database.exec("BEGIN IMMEDIATE;");
    try {
      const statement = database.prepare(
        `INSERT INTO ${authConnectionTable} (
           connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
           scopes_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           cloud_id = excluded.cloud_id,
           credential_id = excluded.credential_id,
           site_name = excluded.site_name,
           site_url = excluded.site_url,
           avatar_url = excluded.avatar_url,
           scopes_json = excluded.scopes_json,
           updated_at = excluded.updated_at`,
      );
      for (const connection of bundle.connections) {
        statement.run(
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
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } catch (error) {
    for (const path of writtenPaths) {
      const previous = previousSecrets.get(path);
      if (previous === undefined) await NodeFSP.rm(path, { force: true });
      else await writeCredentialFile(path, previous);
    }
    if (error instanceof Error && error.message.startsWith("no such table"))
      throw new Error("The demo database has no Jira connection table; seed it first.");
    throw error;
  } finally {
    database.close();
  }
  return { connections: bundle.connections.length, credentials: bundle.credentials.length };
};
