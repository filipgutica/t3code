// @effect-diagnostics nodeBuiltinImport:off - Dev bootstrap runs before the child process environment is created.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";

import { loadRepoEnv } from "./public-config.ts";

const repoDirectory = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const credentialKeys = ["T3_WORKBENCH_JIRA_CLIENT_ID", "T3_WORKBENCH_JIRA_CLIENT_SECRET"] as const;
const isCredential = (value: string | undefined) =>
  Boolean(value?.trim()) && !value?.includes("op://");

const decodeAccounts = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        account_uuid: Schema.optional(Schema.String),
        user_uuid: Schema.optional(Schema.String),
      }),
    ),
  ),
);

const resolveVaultAccount = (
  env: NodeJS.ProcessEnv,
): {
  readonly env: NodeJS.ProcessEnv;
  readonly warning?: string;
} => {
  const vault = env.T3_WORKBENCH_JIRA_VAULT?.trim();
  if (env.OP_ACCOUNT?.trim() || !vault) return { env };
  const options = { env, encoding: "utf8", timeout: 20_000 } as const;
  const listed = NodeChildProcess.spawnSync("op", ["account", "list", "--format", "json"], options);
  if (listed.error || listed.status !== 0) {
    return {
      env,
      warning:
        "Could not list 1Password accounts. Unlock 1Password and allow CLI access, then restart dev.",
    };
  }
  let accounts;
  try {
    accounts = decodeAccounts(listed.stdout);
  } catch {
    return {
      env,
      warning: "Could not read the 1Password account list. Check your 1Password CLI installation.",
    };
  }
  const ids = new Set(
    accounts.flatMap((account) => {
      const id = account.account_uuid ?? account.user_uuid;
      return id ? [id] : [];
    }),
  );
  const matches: string[] = [];
  for (const id of ids) {
    const access = NodeChildProcess.spawnSync(
      "op",
      ["vault", "get", vault, "--account", id, "--format", "json"],
      options,
    );
    if (!access.error && access.status === 0) matches.push(id);
  }
  if (matches.length !== 1) {
    return {
      env,
      warning:
        matches.length > 1
          ? "Multiple 1Password accounts contain that vault name. Set T3_WORKBENCH_JIRA_VAULT to its unique vault ID."
          : "No configured 1Password account could access the Jira vault. Check T3_WORKBENCH_JIRA_VAULT and allow CLI access, then restart dev.",
    };
  }
  // Scope account selection to injection; do not change the developer's CLI default.
  return { env: { ...env, OP_ACCOUNT: matches[0] } };
};

const injectTemplate = ({
  template,
  env,
}: {
  readonly template: string;
  readonly env: NodeJS.ProcessEnv;
}) => {
  // op requires a file here: its stdin detection rejects Node's spawnSync pipe on macOS.
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-jira-template-"));
  const path = NodePath.join(directory, "jira.env.tpl");
  try {
    NodeFS.writeFileSync(path, template, { mode: 0o600 });
    return NodeChildProcess.spawnSync("op", ["inject", "--in-file", path], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
};

export const prepareWorkbenchJiraDevEnv = ({
  mode,
  dryRun,
  baseEnv,
  repoRoot = repoDirectory,
}: {
  readonly mode: string;
  readonly dryRun: boolean;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly repoRoot?: string;
}): { readonly env: NodeJS.ProcessEnv; readonly warning?: string } => {
  if (dryRun || !["dev", "dev:server", "dev:desktop"].includes(mode)) {
    return { env: baseEnv };
  }
  const localPath = NodePath.join(repoRoot, ".env.local");
  const env = loadRepoEnv({ repoRoot, baseEnv });
  if (credentialKeys.every((key) => isCredential(env[key]))) {
    return { env };
  }

  // Do not pass unresolved references to Jira if 1Password is unavailable.
  const overrides = { ...baseEnv };
  for (const key of credentialKeys) {
    if (!isCredential(overrides[key])) delete overrides[key];
    if (env[key] !== undefined && !isCredential(env[key])) env[key] = "";
  }
  if (!env.T3_WORKBENCH_JIRA_VAULT?.trim()) return { env };
  if (NodeFS.existsSync(localPath)) {
    return {
      env,
      warning:
        "Existing .env.local was preserved. Set both T3_WORKBENCH_JIRA_CLIENT_ID and T3_WORKBENCH_JIRA_CLIENT_SECRET there to enable Jira dev.",
    };
  }
  const example = NodeUtil.parseEnv(
    NodeFS.readFileSync(NodePath.join(repoRoot, ".env.example"), "utf8"),
  );
  const template =
    credentialKeys.map((key) => `${key}=${JSON.stringify(example[key] ?? "")}`).join("\n") + "\n";
  const selected = resolveVaultAccount(env);
  if (selected.warning) return { env, warning: selected.warning };
  const injected = injectTemplate({ template, env: selected.env });
  if (injected.error || injected.status !== 0) {
    return {
      env,
      warning:
        "Jira dev credentials were not loaded. Install the 1Password CLI, unlock 1Password, and allow CLI access, then restart dev. Existing credentials remain available.",
    };
  }
  const resolved = NodeUtil.parseEnv(injected.stdout);
  if (!credentialKeys.every((key) => isCredential(resolved[key]))) {
    return { env, warning: "The 1Password template did not resolve both Jira dev credentials." };
  }
  try {
    NodeFS.writeFileSync(localPath, injected.stdout, { flag: "wx", mode: 0o600 });
  } catch {
    return {
      env,
      warning: "Could not create .env.local for Jira dev. No existing file was overwritten.",
    };
  }
  return { env: loadRepoEnv({ repoRoot, baseEnv: overrides }) };
};
