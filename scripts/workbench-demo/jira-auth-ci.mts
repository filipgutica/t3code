// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This helper is a short-lived CI credential bridge.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import {
  decodeJiraAuthBundle,
  encodeJiraAuthBundle,
  exportJiraAuth,
  importJiraAuth,
} from "./jira-auth.mts";

export const JIRA_OAUTH_BUNDLE_SECRET = "DEMO_JIRA_OAUTH_BUNDLE" as const;
export const DEMO_CREDENTIALS_TOKEN = "DEMO_CREDENTIALS_TOKEN" as const;

type Environment = Readonly<Record<string, string | undefined>>;

export interface GhSecretSetInput {
  readonly repository: string;
  readonly secretName: string;
  readonly secretEnvironment?: string;
  readonly secretValue: string;
  readonly environment: Environment;
}

export type GhSecretSetRunner = (input: GhSecretSetInput) => Promise<void>;

const commandError = () => new Error("GitHub secret update failed.");

const defaultGhSecretSetRunner: GhSecretSetRunner = async ({
  repository,
  secretName,
  secretEnvironment,
  secretValue,
  environment,
}) => {
  const token = environment.GH_TOKEN?.trim();
  if (!token) throw commandError();
  const childEnvironment = { ...environment, GH_TOKEN: token };
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error === undefined) resolve();
      else reject(error);
    };
    const child = NodeChildProcess.spawn(
      "gh",
      [
        "secret",
        "set",
        secretName,
        "--repo",
        repository,
        ...(secretEnvironment ? ["--env", secretEnvironment] : []),
      ],
      {
        env: childEnvironment,
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.once("error", () => finish(commandError()));
    child.once("close", (code) => (code === 0 ? finish() : finish(commandError())));
    child.stdin.once("error", () => finish(commandError()));
    child.stdin.end(`${secretValue}\n`);
  });
};

const validRepository = (repository: string): boolean =>
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);

const requireRepository = (repository: string): string => {
  const value = repository.trim();
  if (!validRepository(value)) throw new Error("A GitHub repository must be OWNER/REPOSITORY.");
  return value;
};

/** Prove secret-write access before any OAuth refresh can rotate the saved token. */
export const preflightJiraAuthPersistence = async (input: {
  readonly repository: string;
  readonly secretEnvironment?: string;
  readonly environment?: Environment;
  readonly commandRunner?: GhSecretSetRunner;
}): Promise<void> => {
  const repository = requireRepository(input.repository);
  const environment = input.environment ?? process.env;
  const token = environment[DEMO_CREDENTIALS_TOKEN]?.trim();
  if (!token) throw new Error(`${DEMO_CREDENTIALS_TOKEN} is required to update the GitHub secret.`);
  const value = environment[JIRA_OAUTH_BUNDLE_SECRET]?.trim();
  if (!value) throw new Error(`${JIRA_OAUTH_BUNDLE_SECRET} is required.`);
  const bundle = decodeJiraAuthBundle(value);
  if (bundle.credentials.some((credential) => credential.value.authMode !== "broker")) {
    throw new Error(
      "CI requires broker OAuth credentials. Reconnect Jira through the deployed broker, then export a new bundle.",
    );
  }
  const secretValue = encodeJiraAuthBundle(bundle);
  const { [DEMO_CREDENTIALS_TOKEN]: _token, ...inheritedEnvironment } = environment;
  try {
    await (input.commandRunner ?? defaultGhSecretSetRunner)({
      repository,
      secretName: JIRA_OAUTH_BUNDLE_SECRET,
      secretValue,
      ...(input.secretEnvironment ? { secretEnvironment: input.secretEnvironment } : {}),
      environment: { ...inheritedEnvironment, GH_TOKEN: token },
    });
  } catch {
    throw commandError();
  }
};

/**
 * Export a stopped demo's OAuth connection and publish it as a GitHub secret.
 * The token is read from DEMO_CREDENTIALS_TOKEN and is passed to gh only as
 * GH_TOKEN. The bundle itself is supplied to gh over stdin.
 */
export const publishJiraAuthBundle = async (input: {
  readonly home: string;
  readonly repository: string;
  readonly secretEnvironment?: string;
  readonly environment?: Environment;
  readonly commandRunner?: GhSecretSetRunner;
}): Promise<void> => {
  const repository = requireRepository(input.repository);
  const environment = input.environment ?? process.env;
  const token = environment[DEMO_CREDENTIALS_TOKEN]?.trim();
  if (!token) throw new Error(`${DEMO_CREDENTIALS_TOKEN} is required to update the GitHub secret.`);
  const bundle = await exportJiraAuth({ home: input.home });
  const secretValue = encodeJiraAuthBundle(bundle);
  const { [DEMO_CREDENTIALS_TOKEN]: _credentialsToken, ...inheritedEnvironment } = environment;
  try {
    await (input.commandRunner ?? defaultGhSecretSetRunner)({
      repository,
      secretName: JIRA_OAUTH_BUNDLE_SECRET,
      ...(input.secretEnvironment ? { secretEnvironment: input.secretEnvironment } : {}),
      secretValue,
      environment: {
        ...inheritedEnvironment,
        GH_TOKEN: token,
      },
    });
  } catch {
    throw commandError();
  }
};

/** Import the preconnected OAuth bundle from the CI secret into a stopped demo. */
export const importJiraAuthBundleFromEnvironment = async (input: {
  readonly home: string;
  readonly environment?: Environment;
}): Promise<{ readonly connections: number; readonly credentials: number }> => {
  const environment = input.environment ?? process.env;
  const value = environment[JIRA_OAUTH_BUNDLE_SECRET]?.trim();
  if (!value)
    throw new Error(`${JIRA_OAUTH_BUNDLE_SECRET} is required to import Jira credentials.`);
  return importJiraAuth({ home: input.home, bundle: decodeJiraAuthBundle(value) });
};

const usage = `Usage:
  node scripts/workbench-demo/jira-auth-ci.mts --export --home PATH --repository OWNER/REPOSITORY [--secret-environment NAME]
  node scripts/workbench-demo/jira-auth-ci.mts --preflight --repository OWNER/REPOSITORY [--secret-environment NAME]
  node scripts/workbench-demo/jira-auth-ci.mts --import --home PATH

Export reads DEMO_CREDENTIALS_TOKEN and updates DEMO_JIRA_OAUTH_BUNDLE through gh.
Import reads DEMO_JIRA_OAUTH_BUNDLE from the environment.
`;

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const runAsCommand = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  const secretEnvironment = optionValue(args, "--secret-environment");
  if (["--export", "--import", "--preflight"].filter((flag) => args.includes(flag)).length !== 1)
    throw new Error("Choose exactly one operation.");
  const exporting = args.includes("--export");
  const importing = args.includes("--import");
  if (args.includes("--preflight")) {
    const repository = optionValue(args, "--repository");
    if (!repository) throw new Error("--repository is required for --preflight.");
    await preflightJiraAuthPersistence({
      repository,
      ...(secretEnvironment ? { secretEnvironment } : {}),
    });
    console.log("Verified Jira credential persistence.");
    return;
  }
  if (exporting === importing) throw new Error("Choose exactly one of --export or --import.");
  const home = optionValue(args, "--home");
  if (home === undefined || home.length === 0) throw new Error("--home is required.");
  if (exporting) {
    const repository = optionValue(args, "--repository");
    if (repository === undefined) throw new Error("--repository is required for --export.");
    await publishJiraAuthBundle({
      home,
      repository,
      ...(secretEnvironment ? { secretEnvironment } : {}),
    });
    console.log(`Updated ${JIRA_OAUTH_BUNDLE_SECRET}.`);
    return;
  }
  const result = await importJiraAuthBundleFromEnvironment({ home });
  console.log(
    `Imported ${result.connections} Jira connection(s) and ${result.credentials} credential(s).`,
  );
};

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  runAsCommand().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Jira auth CI operation failed.");
    process.exitCode = 1;
  });
}
