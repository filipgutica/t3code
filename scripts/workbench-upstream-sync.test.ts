// @effect-diagnostics nodeBuiltinImport:off - Exercise merge-tree conflict classification in disposable repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(import.meta.dirname, "workbench-upstream-sync.ts");
const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

type ConflictPath = "pnpm-lock.yaml" | "source.txt";

function createFixture(conflicts: ReadonlyArray<ConflictPath>) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-sync-test-"));
  const repository = NodePath.join(root, "repository");
  NodeFS.mkdirSync(repository);
  runGit(repository, ["init", "--initial-branch=main"]);
  runGit(repository, ["config", "user.name", "Sync Test"]);
  runGit(repository, ["config", "user.email", "sync-test@example.invalid"]);
  NodeFS.writeFileSync(NodePath.join(repository, "pnpm-lock.yaml"), "base lockfile\n");
  NodeFS.writeFileSync(NodePath.join(repository, "source.txt"), "base source\n");
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "base"]);

  runGit(repository, ["switch", "-c", "product"]);
  for (const path of conflicts) {
    NodeFS.writeFileSync(NodePath.join(repository, path), `product ${path}\n`);
  }
  if (conflicts.length === 0) {
    NodeFS.writeFileSync(NodePath.join(repository, "product.txt"), "product\n");
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "product"]);
  const productSha = runGit(repository, ["rev-parse", "HEAD"]);

  runGit(repository, ["switch", "main"]);
  for (const path of conflicts) {
    NodeFS.writeFileSync(NodePath.join(repository, path), `upstream ${path}\n`);
  }
  if (conflicts.length === 0) {
    NodeFS.writeFileSync(NodePath.join(repository, "upstream.txt"), "upstream\n");
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "upstream"]);
  const upstreamSha = runGit(repository, ["rev-parse", "HEAD"]);

  return { root, repository, productSha, upstreamSha };
}

function preview(conflicts: ReadonlyArray<ConflictPath>) {
  const fixture = createFixture(conflicts);
  try {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [scriptPath, "--product", fixture.productSha, "--upstream", fixture.upstreamSha],
      { cwd: fixture.repository, encoding: "utf8" },
    );
    return {
      result,
      output: JSON.parse(result.stdout),
    };
  } finally {
    NodeFS.rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("workbench upstream sync merge preview", () => {
  it("accepts a clean merge", () => {
    const { result, output } = preview([]);

    assert.equal(result.status, 0);
    assert.equal(output.mergePreview, "clean");
    assert.deepEqual(output.conflictPaths, []);
  });

  it("accepts only a generated lockfile conflict", () => {
    const { result, output } = preview(["pnpm-lock.yaml"]);

    assert.equal(result.status, 0);
    assert.equal(output.mergePreview, "generated-lockfile");
    assert.deepEqual(output.conflictPaths, ["pnpm-lock.yaml"]);
  });

  it("rejects source and mixed conflicts", () => {
    const source = preview(["source.txt"]);
    assert.equal(source.result.status, 2);
    assert.equal(source.output.mergePreview, "conflict");
    assert.deepEqual(source.output.conflictPaths, ["source.txt"]);

    const mixed = preview(["pnpm-lock.yaml", "source.txt"]);
    assert.equal(mixed.result.status, 2);
    assert.equal(mixed.output.mergePreview, "conflict");
    assert.deepEqual(mixed.output.conflictPaths, ["pnpm-lock.yaml", "source.txt"]);
  });
});

const workflow = NodeFS.readFileSync(
  NodePath.resolve(import.meta.dirname, "../.github/workflows/workbench-upstream-sync.yml"),
  "utf8",
);
const stepScript = (name: string) => {
  const step = workflow.split(`name: ${name}\n`)[1]?.split(/\n      - /)[0];
  const script = step?.split("        run: |\n")[1];
  if (!script) throw new Error(`Missing workflow shell step: ${name}`);
  return script.replace(/^          /gm, "");
};
const workflowFixture = (body: (root: string) => void) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-sync-workflow-"));
  try {
    NodeFS.symlinkSync(import.meta.dirname, NodePath.join(root, "scripts"));
    body(root);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};
const runStep = (root: string, name: string, preamble = "", env = {}) =>
  NodeChildProcess.spawnSync(
    "bash",
    ["-e", "-o", "pipefail", "-c", `${preamble}\n${stepScript(name)}`],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        GITHUB_OUTPUT: NodePath.join(root, "outputs"),
        GITHUB_STEP_SUMMARY: NodePath.join(root, "summary"),
        GITHUB_REPOSITORY: "filipgutica/t3code",
        PRODUCT_BRANCH: "main",
        SYNC_BRANCH: "automation/workbench-upstream-sync",
        PRODUCT_SHA: "product-sha",
        VERIFIED_SHA: "candidate-sha",
        PR_NUMBER: "42",
        ...env,
      },
    },
  );

it("reports expected preview conflicts successfully but preserves real failures", () => {
  const fixture = createFixture(["source.txt"]);
  try {
    NodeFS.symlinkSync(import.meta.dirname, NodePath.join(fixture.repository, "scripts"));
    // The workflow previews HEAD against upstream/main.
    runGit(fixture.repository, ["update-ref", "refs/remotes/upstream/main", fixture.upstreamSha]);
    runGit(fixture.repository, ["switch", "product"]);
    const result = runStep(fixture.repository, "Preview merge");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      NodeFS.readFileSync(NodePath.join(fixture.repository, "outputs"), "utf8"),
      "proceed=false\n",
    );
    assert.match(
      NodeFS.readFileSync(NodePath.join(fixture.repository, "summary"), "utf8"),
      /source.txt/,
    );

    const failed = runStep(fixture.repository, "Preview merge", "node() { return 1; }");
    assert.equal(failed.status, 1);
  } finally {
    NodeFS.rmSync(fixture.root, { recursive: true, force: true });
  }
});

const waitPreamble = `
gh() {
  count=$(cat "$RUNNER_TEMP/api-count" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$RUNNER_TEMP/api-count"
  if [[ "\${API_FAIL:-}" == 1 ]]; then return 1; fi
  mergeable=null
  if [[ "$count" -gt "\${PENDING:-2}" ]]; then mergeable=true; fi
  if [[ "\${CONFLICT:-}" == 1 ]]; then mergeable=false; fi
  jq --argjson mergeable "$mergeable" '. + {mergeable: $mergeable}' "$RUNNER_TEMP/pr.json"
}
git() {
  count=$(cat "$RUNNER_TEMP/fetch-count" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$RUNNER_TEMP/fetch-count"
  [[ "$count" -gt "\${MISSING_REF:-1}" ]]
}
sleep() { :; }
`;
const writePullRequest = (root: string, headSha = "candidate-sha") => {
  NodeFS.writeFileSync(
    NodePath.join(root, "pr.json"),
    JSON.stringify({
      number: 42,
      state: "open",
      draft: false,
      merged: false,
      base: { ref: "main", sha: "product-sha", repo: { full_name: "filipgutica/t3code" } },
      head: {
        ref: "automation/workbench-upstream-sync",
        sha: headSha,
        repo: { full_name: "filipgutica/t3code" },
      },
    }),
  );
};

it("waits for asynchronous mergeability and merge-ref creation", () =>
  workflowFixture((root) => {
    writePullRequest(root);
    const result = runStep(root, "Wait for the verified sync merge ref", waitPreamble);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(NodeFS.readFileSync(NodePath.join(root, "api-count"), "utf8"), "4\n");
    assert.equal(NodeFS.readFileSync(NodePath.join(root, "fetch-count"), "utf8"), "2\n");
  }));

it("bounds merge-ref retries and fails on API errors, conflicts or a changed head", () => {
  for (const scenario of ["timeout", "api", "conflict", "head"])
    workflowFixture((root) => {
      writePullRequest(root, scenario === "head" ? "changed-sha" : "candidate-sha");
      const env = {
        PENDING: scenario === "timeout" ? "30" : "0",
        API_FAIL: scenario === "api" ? "1" : "0",
        CONFLICT: scenario === "conflict" ? "1" : "0",
      };
      const result = runStep(root, "Wait for the verified sync merge ref", waitPreamble, env);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(NodeFS.existsSync(NodePath.join(root, "fetch-count")), false);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(root, "api-count"), "utf8"),
        scenario === "timeout" ? "30\n" : "1\n",
      );
      if (scenario === "timeout") assert.match(result.stderr, /Timed out.*30 attempts/);
      if (scenario === "head") assert.match(result.stderr, /sync branch changed/);
    });
});

it("dispatches both gates with the published merge SHA and propagates dispatch errors", () =>
  workflowFixture((root) => {
    const preamble =
      'gh() { echo "$*" >> "$RUNNER_TEMP/dispatches"; return "${DISPATCH_STATUS:-0}"; }';
    const result = runStep(root, "Dispatch gates for the published main merge", preamble, {
      PUBLISHED_SHA: "published-merge-sha",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      NodeFS.readFileSync(NodePath.join(root, "dispatches"), "utf8").trim().split("\n"),
      [
        "workflow run workbench-ci.yml --repo filipgutica/t3code --ref main -f expected_sha=published-merge-sha",
        "workflow run workbench-quality.yml --repo filipgutica/t3code --ref main -f expected_sha=published-merge-sha",
      ],
    );
    assert.equal(
      runStep(root, "Dispatch gates for the published main merge", preamble, {
        PUBLISHED_SHA: "published-merge-sha",
        DISPATCH_STATUS: "1",
      }).status,
      1,
    );
  }));
