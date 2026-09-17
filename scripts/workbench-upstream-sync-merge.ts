// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

export interface VerifiedSyncPullRequest {
  readonly number: number;
  readonly state: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly base: {
    readonly ref: string;
    readonly sha: string;
    readonly repository: string;
  };
  readonly head: {
    readonly ref: string;
    readonly sha: string;
    readonly repository: string;
  };
}

export interface VerifiedSyncMergeInput {
  readonly pullRequest: VerifiedSyncPullRequest;
  readonly repository: string;
  readonly productBranch: string;
  readonly syncBranch: string;
  readonly productSha: string;
  readonly verifiedSha: string;
}

export function validateVerifiedSyncPullRequest({
  pullRequest,
  repository,
  productBranch,
  syncBranch,
  productSha,
  verifiedSha,
}: VerifiedSyncMergeInput): string | undefined {
  if (pullRequest.state !== "open") return `sync PR is not open: ${pullRequest.state}`;
  if (pullRequest.draft) return "sync PR is still a draft";
  if (pullRequest.merged) return "sync PR is already merged";
  if (pullRequest.base.repository !== repository) {
    return `sync PR base repository changed: ${pullRequest.base.repository}`;
  }
  if (pullRequest.head.repository !== repository) {
    return `sync PR head repository changed: ${pullRequest.head.repository}`;
  }
  if (pullRequest.base.ref !== productBranch) {
    return `sync PR base branch changed: ${pullRequest.base.ref}`;
  }
  if (pullRequest.head.ref !== syncBranch) {
    return `sync PR head branch changed: ${pullRequest.head.ref}`;
  }
  if (pullRequest.base.sha !== productSha) {
    return `product branch changed from ${productSha} to ${pullRequest.base.sha}`;
  }
  if (pullRequest.head.sha !== verifiedSha) {
    return `sync branch changed from ${verifiedSha} to ${pullRequest.head.sha}`;
  }
}

function parseOptions(argv: ReadonlyArray<string>): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument?.startsWith("--")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = value;
      index += 1;
    }
  }
  return options;
}

function requiredOption(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("GitHub pull request response must be an object");
  }
  return value;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Missing ${name}`);
  return value;
}

function optionalBooleanField(value: unknown, name: string): boolean {
  return value === undefined ? false : booleanField(value, name);
}

function numberField(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function parsePullRequest(value: unknown): VerifiedSyncPullRequest {
  const pullRequest = record(value);
  const base = record(pullRequest.base);
  const head = record(pullRequest.head);
  return {
    number: numberField(pullRequest.number, "pull request number"),
    state: stringField(pullRequest.state, "pull request state"),
    draft: booleanField(pullRequest.draft, "pull request draft state"),
    // The pull request endpoint does not include `merged` on every response;
    // an open pull request is sufficient evidence that it is not merged.
    merged: optionalBooleanField(pullRequest.merged, "pull request merged state"),
    base: {
      ref: stringField(base.ref, "pull request base ref"),
      sha: stringField(base.sha, "pull request base sha"),
      repository: stringField(record(base.repo).full_name, "pull request base repository"),
    },
    head: {
      ref: stringField(head.ref, "pull request head ref"),
      sha: stringField(head.sha, "pull request head sha"),
      repository: stringField(record(head.repo).full_name, "pull request head repository"),
    },
  };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const required = [
    "pr-json",
    "repository",
    "product-branch",
    "sync-branch",
    "product-sha",
    "verified-sha",
  ];
  for (const option of required) {
    requiredOption(options, option);
  }
  const prJsonPath = requiredOption(options, "pr-json");
  const repository = requiredOption(options, "repository");
  const productBranch = requiredOption(options, "product-branch");
  const syncBranch = requiredOption(options, "sync-branch");
  const productSha = requiredOption(options, "product-sha");
  const verifiedSha = requiredOption(options, "verified-sha");
  const pullRequest = parsePullRequest(JSON.parse(NodeFS.readFileSync(prJsonPath, "utf8")));
  const error = validateVerifiedSyncPullRequest({
    pullRequest,
    repository,
    productBranch,
    syncBranch,
    productSha,
    verifiedSha,
  });
  if (error) throw new Error(`Refusing to merge verified sync: ${error}`);
  process.stdout.write(`Verified sync PR #${pullRequest.number} matches ${verifiedSha}.\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
