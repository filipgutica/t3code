// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface ScopePolicy {
  upstreamBase: string;
  groups: Array<{
    name: string;
    paths: Array<string>;
    tests: Array<string>;
    verification: Array<string>;
  }>;
  packages: Record<string, string>;
  packagingTests: Array<string>;
  packagingPaths: Array<string>;
}
const policyPath = "scripts/workbench-ci-scope.json";
const workflowPath = ".github/workflows/workbench-ci.yml";
const git = (args: ReadonlyArray<string>) => {
  const result = NodeChildProcess.spawnSync("git", [...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
};
const pathsFrom = (value: string) => value.split("\0").filter(Boolean);
const matches = (path: string, pattern: string) =>
  pattern.endsWith("/") || pattern.endsWith("-") || !NodePath.extname(pattern)
    ? path.startsWith(pattern)
    : path === pattern;
const isTest = (path: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
// Playwright owns these journeys in the separate Workbench regression workflow.
const isCentralTest = (path: string) =>
  isTest(path) && !(path.startsWith("scripts/workbench-regression/") && path.endsWith(".spec.ts"));
const isSource = (path: string) =>
  !isTest(path) &&
  (/\.(?:[cm]?[jt]sx?|css|sql|astro|rs|swift|kt|kts|patch|c|cc|cpp|h|hpp|sh|py|ps1|qml)$/.test(
    path,
  ) ||
    ["Dockerfile", "Cargo.toml", "Brewfile"].includes(NodePath.basename(path)) ||
    (path.includes("/src/") && path.endsWith(".json")));
const relevant = (path: string) =>
  /^(apps|packages|infra|scripts|native|patches)\//.test(path) || path === "vite.config.ts";

const loadPolicy = (): ScopePolicy => {
  const policy = JSON.parse(NodeFS.readFileSync(policyPath, "utf8")) as ScopePolicy;
  const strings = (value: unknown): value is Array<string> =>
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
  if (
    !/^[a-f0-9]{40}$/.test(policy.upstreamBase) ||
    !Array.isArray(policy.groups) ||
    policy.groups.length === 0 ||
    !policy.groups.every(
      (group) =>
        typeof group.name === "string" &&
        strings(group.paths) &&
        group.paths.length > 0 &&
        strings(group.tests) &&
        strings(group.verification) &&
        group.verification.length > 0,
    ) ||
    !policy.packages ||
    !Object.entries(policy.packages).every(([path, name]) => path && typeof name === "string") ||
    !strings(policy.packagingTests) ||
    !strings(policy.packagingPaths)
  ) {
    throw new Error("Invalid Workbench CI ownership policy");
  }
  return policy;
};
const forkPaths = (policy: ScopePolicy) => {
  try {
    git(["merge-base", "--is-ancestor", policy.upstreamBase, "HEAD"]);
  } catch (error) {
    // The sync workflow regenerates before committing its two-parent merge.
    if (git(["rev-parse", "--verify", "MERGE_HEAD"]).trim() !== policy.upstreamBase) throw error;
  }
  // Both sides of renames and deleted paths need ownership review.
  return pathsFrom(git(["diff", "--no-renames", "--name-only", "-z", policy.upstreamBase, "--"]));
};
const validateOwnership = (policy: ScopePolicy) => {
  const paths = forkPaths(policy);
  const unmapped = paths.filter(
    (path) =>
      relevant(path) &&
      isSource(path) &&
      !policy.groups.some((group) => group.paths.some((pattern) => matches(path, pattern))),
  );
  if (unmapped.length > 0)
    throw new Error(`Unmapped fork sources; add an owner and verification: ${unmapped.join(", ")}`);
  return paths;
};
const selectTests = (policy: ScopePolicy) => {
  const selected = new Set(
    validateOwnership(policy).filter(
      (path) =>
        isCentralTest(path) &&
        relevant(path) &&
        NodeFS.existsSync(path) &&
        !policy.groups.some(
          (group) =>
            group.paths.some((pattern) => matches(path, pattern)) &&
            group.verification.some(
              (lane) => lane === "workbench-preview-check" || lane === "workbench-pages",
            ),
        ),
    ),
  );
  for (const group of policy.groups)
    for (const pattern of group.tests) {
      const found = pathsFrom(git(["ls-files", "-z", "--", pattern])).filter(isCentralTest);
      if (found.length === 0) throw new Error(`Ownership test selector has no tests: ${pattern}`);
      for (const path of found) selected.add(path);
    }
  for (const path of policy.packagingTests) selected.delete(path);
  const packages = new Map<string, Array<string>>();
  for (const path of [...selected].sort()) {
    const entry = Object.entries(policy.packages).find(([directory]) =>
      path.startsWith(`${directory}/`),
    );
    if (!entry) throw new Error(`Fork test has no runner: ${path}`);
    const [directory, name] = entry;
    const files = packages.get(name) ?? [];
    files.push(path.slice(directory.length + 1));
    packages.set(name, files);
  }
  return packages;
};
const run = (command: string, args: ReadonlyArray<string>) => {
  const result = NodeChildProcess.spawnSync(command, [...args], { stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.error?.message})`);
};
const scope = (policy: ScopePolicy, base: string) => {
  validateOwnership(policy);
  const changed = pathsFrom(git(["diff", "--no-renames", "--name-only", "-z", base, "--"]));
  const product = changed.some(
    (path) =>
      /^(apps\/(server|web|desktop)|packages|infra\/workbench-auth)\//.test(path) ||
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|vite\.config\.ts)$/.test(
        path,
      ) ||
      path.startsWith("patches/"),
  );
  const tooling = changed.some(
    (path) => path.startsWith("scripts/") || path.startsWith(".github/workflows/workbench-ci"),
  );
  const ciPolicy = changed.some(
    (path) => path.startsWith("scripts/workbench-ci") || path === workflowPath,
  );
  return {
    verify: product || tooling,
    build: product || ciPolicy,
    packaging:
      ciPolicy ||
      changed.some((path) => policy.packagingTests.includes(path)) ||
      changed.some((path) => policy.packagingPaths.some((pattern) => matches(path, pattern))),
  };
};
const verifyResults = () => {
  const results = JSON.parse(process.env.RESULTS ?? "null") as Record<
    string,
    { result: string }
  > | null;
  const flags = {
    lint: process.env.SCOPE_VERIFY,
    typecheck: process.env.SCOPE_VERIFY,
    test: process.env.SCOPE_VERIFY,
    build: process.env.SCOPE_BUILD,
    packaging: process.env.SCOPE_PACKAGING,
  };
  if (!results || results.scope?.result !== "success")
    throw new Error("Scope detection did not succeed");
  if (Object.keys(results).sort().join() !== ["scope", ...Object.keys(flags)].sort().join())
    throw new Error("Unexpected aggregate jobs");
  for (const [job, flag] of Object.entries(flags)) {
    if (flag !== "true" && flag !== "false") throw new Error(`Missing scope decision for ${job}`);
    const expected = flag === "true" ? "success" : "skipped";
    if (results[job]?.result !== expected)
      throw new Error(`${job}: expected ${expected}, got ${results[job]?.result}`);
  }
};
const setup = `      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          sparse-checkout: |
            /*
            !/.repos/
          sparse-checkout-cone-mode: false
      - uses: voidzero-dev/setup-vp@v1
        with:
          node-version-file: package.json
          cache: true
          run-install: |
            args:
              - --filter=@t3tools/workbench...
              - --filter=@t3tools/monorepo
              - --filter=@t3tools/oxlint-plugin-t3code...
              - --filter=t3...
              - --filter=@t3tools/web...
              - --filter=@t3tools/desktop...
              - --filter=@t3tools/scripts...
              - --filter=t3code-workbench-auth...
`;
const verificationJob = (id: string, name: string, flag: string, steps: string) => `  ${id}:
    name: Workbench ${name}
    needs: scope
    if: \${{ needs.scope.outputs.${flag} == 'true' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
${setup}${steps}
`;
const generateCI =
  () => `# Generated by node scripts/workbench-ci.ts; edit the generator and ownership policy.
# Upstream CI sources remain unchanged; this workflow owns fork integration checks.
name: Workbench feature CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: workbench-ci-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  scope:
    name: Workbench Scope
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      verify: \${{ steps.scope.outputs.verify }}
      build: \${{ steps.scope.outputs.build }}
      packaging: \${{ steps.scope.outputs.packaging }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version-file: package.json
      - run: node scripts/workbench-ci.ts --check
      - id: scope
        env:
          CI_BASE: \${{ github.event.pull_request.base.sha || github.event.before }}
        run: node scripts/workbench-ci.ts --scope "$CI_BASE"

${verificationJob(
  "lint",
  "Lint",
  "verify",
  `      - name: Check fork sources and CI policy
        run: |
          node scripts/workbench-ci.ts --lint
          vp test run scripts/workbench-ci.test.ts
`,
)}
${verificationJob(
  "typecheck",
  "Typecheck",
  "verify",
  `      - run: vp run --filter @t3tools/desktop ensure:electron
      - name: Check Workbench and integrated application types
        run: node scripts/workbench-ci.ts --typecheck
`,
)}
${verificationJob(
  "test",
  "Integration",
  "verify",
  `      - run: vp run --filter @t3tools/desktop ensure:electron
      - name: Exercise fork-owned contracts and native integrations
        run: node scripts/workbench-ci.ts --run-tests
`,
)}
${verificationJob(
  "build",
  "Build",
  "build",
  `      - uses: ./.github/actions/setup-apt-mirrors
      - name: Install desktop build libraries
        run: |
          sudo apt-get update
          sudo apt-get install -y libsecret-1-dev pkg-config
      - run: vp run --filter @t3tools/desktop ensure:electron
      - name: Build Workbench desktop and server integration
        env:
          T3CODE_WORKBENCH_BUILD: "1"
        run: |
          vp run build:desktop
          node apps/desktop/scripts/verify-preload-bundle.mjs
`,
)}
${verificationJob(
  "packaging",
  "Packaging",
  "packaging",
  `      - name: Verify Workbench packaging, versions and updater manifests
        run: node scripts/workbench-ci.ts --packaging
`,
)}
  check:
    name: Workbench Check
    if: \${{ always() }}
    needs: [scope, lint, typecheck, test, build, packaging]
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version-file: package.json
      - name: Require applicable jobs and reject failures or cancellations
        env:
          RESULTS: \${{ toJSON(needs) }}
          SCOPE_VERIFY: \${{ needs.scope.outputs.verify }}
          SCOPE_BUILD: \${{ needs.scope.outputs.build }}
          SCOPE_PACKAGING: \${{ needs.scope.outputs.packaging }}
        run: node scripts/workbench-ci.ts --verify-results
`;

try {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (argument && command !== "--upstream" && command !== "--scope"))
    throw new Error("Unexpected Workbench CI arguments");
  if (command === "--verify-results") {
    verifyResults();
  } else {
    const policy = loadPolicy();
    if (command === "--upstream") {
      if (
        argument !== "upstream/main" ||
        git(["remote", "get-url", "upstream"]).trim() !== "https://github.com/pingdotgg/t3code.git"
      )
        throw new Error("--upstream requires the canonical upstream/main ref");
      const upstream = git(["rev-parse", "--verify", `${argument}^{commit}`]).trim();
      git(["merge-base", "--is-ancestor", policy.upstreamBase, upstream]);
      policy.upstreamBase = upstream;
    }
    validateOwnership(policy);
    const tests = selectTests(policy);
    for (const path of policy.packagingTests)
      if (!NodeFS.existsSync(path)) throw new Error(`Missing packaging test: ${path}`);
    if (command === "--scope") {
      if (!argument) throw new Error("--scope requires the exact change base");
      const decisions = scope(policy, argument);
      if (process.env.GITHUB_OUTPUT)
        NodeFS.appendFileSync(
          process.env.GITHUB_OUTPUT,
          Object.entries(decisions)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(""),
        );
      process.stdout.write(`${JSON.stringify(decisions)}\n`);
    } else if (command === "--list-tests") {
      process.stdout.write(`${JSON.stringify(Object.fromEntries(tests), null, 2)}\n`);
    } else if (command === "--run-tests") {
      for (const [name, files] of tests) {
        console.log(`${name}: ${files.length} owned/integration test files`);
        run("vp", ["run", "--filter", name, "test", ...files]);
      }
    } else if (command === "--typecheck") {
      for (const name of Object.values(policy.packages))
        run("vp", ["run", "--filter", name, "typecheck"]);
    } else if (command === "--packaging") {
      run("vp", ["test", "run", ...policy.packagingTests]);
    } else if (command === "--lint") {
      const files = validateOwnership(policy).filter((path) => NodeFS.existsSync(path));
      run("vp", [
        "lint",
        "--report-unused-disable-directives",
        ...files.filter((path) => relevant(path) && /\.[cm]?[jt]sx?$/.test(path)),
      ]);
      run("vp", [
        "fmt",
        "--check",
        "--no-error-on-unmatched-pattern",
        ...files.filter((path) => !path.startsWith(".repos/")),
      ]);
    } else if (!command || command === "--check" || command === "--upstream") {
      const generated = generateCI().replace(/\n{3,}/g, "\n\n");
      if (command === "--check") {
        if (NodeFS.readFileSync(workflowPath, "utf8") !== generated)
          throw new Error("Fork CI is stale; run node scripts/workbench-ci.ts");
      } else {
        NodeFS.writeFileSync(workflowPath, generated);
        if (command === "--upstream")
          NodeFS.writeFileSync(
            policyPath,
            NodeFS.readFileSync(policyPath, "utf8").replace(
              /("upstreamBase":\s*")[a-f0-9]{40}(")/,
              (_match, prefix: string, suffix: string) =>
                `${prefix}${policy.upstreamBase}${suffix}`,
            ),
          );
      }
    } else {
      throw new Error(`Unknown Workbench CI command: ${command}`);
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
