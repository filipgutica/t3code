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

function createFixture(
  conflicts: ReadonlyArray<ConflictPath>,
  upstreamFiles: Record<string, string> = {},
) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-sync-test-"));
  const repository = NodePath.join(root, "repository");
  NodeFS.mkdirSync(repository);
  runGit(repository, ["init", "--initial-branch=main"]);
  runGit(repository, ["config", "user.name", "Sync Test"]);
  runGit(repository, ["config", "user.email", "sync-test@example.invalid"]);
  NodeFS.writeFileSync(NodePath.join(repository, "pnpm-lock.yaml"), "base lockfile\n");
  NodeFS.writeFileSync(NodePath.join(repository, "source.txt"), "base source\n");
  NodeFS.mkdirSync(NodePath.join(repository, "scripts"));
  NodeFS.writeFileSync(
    NodePath.join(repository, "scripts/workbench-ci-scope.json"),
    JSON.stringify({ inertUpstreamCI: [".github/workflows/ci.yml", ".github/actions/ci-only/"] }),
  );
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
  for (const [path, content] of Object.entries(upstreamFiles)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(repository, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(repository, path), content);
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "upstream"]);
  const upstreamSha = runGit(repository, ["rev-parse", "HEAD"]);

  return { root, repository, productSha, upstreamSha };
}

function preview(conflicts: ReadonlyArray<ConflictPath>, upstreamFiles?: Record<string, string>) {
  const fixture = createFixture(conflicts, upstreamFiles);
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

  it("publishes upstream changes to inert CI but holds active CI for review", () => {
    const inert = preview([], {
      ".github/workflows/ci.yml": "name: CI\n",
      ".github/actions/ci-only/action.yml": "name: CI only\n",
    });
    assert.equal(inert.result.status, 0, inert.result.stderr);
    assert.deepEqual(inert.output.ciReviewPaths, []);

    const active = preview(["pnpm-lock.yaml"], {
      ".github/workflows/ci.yml": "name: CI\n",
      ".github/workflows/relay-preview.yml": "name: Relay preview\n",
      ".github/actions/setup-apt-mirrors/action.yml": "name: APT\n",
    });
    assert.equal(active.result.status, 2);
    assert.equal(active.output.mergePreview, "generated-lockfile");
    assert.deepEqual(active.output.ciReviewPaths, [
      ".github/actions/setup-apt-mirrors/action.yml",
      ".github/workflows/relay-preview.yml",
    ]);
    assert.include(active.result.stderr, "Upstream changes active CI");

    // Publication follows the product's policy, so upstream cannot exempt its own workflows.
    const claimed = preview([], {
      "scripts/workbench-ci-scope.json": JSON.stringify({ inertUpstreamCI: [".github/"] }),
      ".github/workflows/relay-preview.yml": "name: Relay preview\n",
    });
    assert.equal(claimed.result.status, 2);
    assert.deepEqual(claimed.output.ciReviewPaths, [".github/workflows/relay-preview.yml"]);
  });
});

const workflow = NodeFS.readFileSync(
  NodePath.resolve(import.meta.dirname, "../.github/workflows/workbench-upstream-sync.yml"),
  "utf8",
);
const stepScript = (name: string) => {
  const step = workflow.split(`name: ${name}\n`)[1]?.split(/\n      - /)[0];
  const script = step?.split("        run: |\n")[1]?.split(/\n(?= {0,8}\S)/)[0];
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
        GITHUB_ENV: NodePath.join(root, "environment"),
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

it.each([
  {
    advanceBase: false,
    name: "publishes a verified merge when the product base is unchanged",
  },
  {
    advanceBase: true,
    name: "rejects publishing a verified merge after the product base advances",
  },
])("$name", ({ advanceBase }) => {
  const fixture = createFixture([]);
  const { root, repository, productSha } = fixture;
  try {
    const remote = NodePath.join(root, "remote.git");
    runGit(root, ["init", "--bare", remote]);
    runGit(repository, ["remote", "add", "origin", remote]);
    runGit(repository, ["push", "origin", `${productSha}:refs/heads/main`]);
    runGit(repository, ["switch", "product"]);
    runGit(repository, ["merge", "--no-ff", "--no-edit", "main"]);
    const verifiedSha = runGit(repository, ["rev-parse", "HEAD"]);
    const verifiedTree = runGit(repository, ["rev-parse", "HEAD^{tree}"]);
    // GitHub's merge ref has the checked base and candidate as parents, and the candidate tree.
    const mergeSha = runGit(repository, [
      "commit-tree",
      verifiedTree,
      "-p",
      productSha,
      "-p",
      verifiedSha,
      "-m",
      "verified PR merge",
    ]);
    runGit(repository, ["fetch", "--no-tags", ".", mergeSha]);

    let remoteSha = productSha;
    if (advanceBase) {
      remoteSha = runGit(repository, [
        "commit-tree",
        `${productSha}^{tree}`,
        "-p",
        productSha,
        "-m",
        "product follow-up",
      ]);
      runGit(repository, ["push", "origin", `${remoteSha}:refs/heads/main`]);
    }

    const result = runStep(repository, "Publish the verified merge", "", {
      PRODUCT_SHA: productSha,
      VERIFIED_SHA: verifiedSha,
    });
    if (advanceBase) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /\[rejected\].*non-fast-forward/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(repository, "outputs"), "utf8"),
        `merge_sha=${mergeSha}\n`,
      );
    }
    assert.equal(
      runGit(repository, ["ls-remote", "origin", "refs/heads/main"]),
      `${advanceBase ? remoteSha : mergeSha}\trefs/heads/main`,
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "a source conflict",
    conflicts: ["source.txt"] as const,
    files: { ".github/workflows/relay-preview.yml": "name: Relay preview\n" },
    proceed: false,
    summary: /source\.txt[\s\S]*relay-preview\.yml/,
  },
  {
    name: "a clean merge that changes active CI",
    conflicts: [] as const,
    files: { ".github/workflows/relay-preview.yml": "name: Relay preview\n" },
    proceed: false,
    summary: /relay-preview\.yml/,
  },
  {
    name: "a clean merge that changes only inert CI",
    conflicts: [] as const,
    files: { ".github/workflows/ci.yml": "name: CI\n" },
    proceed: true,
    summary: null,
  },
])("previews $name successfully but preserves real failures", (testCase) => {
  const fixture = createFixture(testCase.conflicts, testCase.files);
  try {
    // The preview reads the committed policy, so the working tree can run the real scripts.
    NodeFS.rmSync(NodePath.join(fixture.repository, "scripts"), { recursive: true });
    NodeFS.symlinkSync(import.meta.dirname, NodePath.join(fixture.repository, "scripts"));
    // The workflow previews HEAD against upstream/main.
    runGit(fixture.repository, ["update-ref", "refs/remotes/upstream/main", fixture.upstreamSha]);
    runGit(fixture.repository, ["switch", "product"]);
    const result = runStep(fixture.repository, "Preview merge");
    assert.equal(result.status, 0, result.stderr);
    assert.include(
      NodeFS.readFileSync(NodePath.join(fixture.repository, "outputs"), "utf8"),
      `proceed=${testCase.proceed}\n`,
    );
    if (testCase.summary)
      assert.match(
        NodeFS.readFileSync(NodePath.join(fixture.repository, "summary"), "utf8"),
        testCase.summary,
      );

    const failed = runStep(fixture.repository, "Preview merge", "node() { return 1; }");
    assert.equal(failed.status, 1);
  } finally {
    NodeFS.rmSync(fixture.root, { recursive: true, force: true });
  }
});

it("publishes with a repository-scoped App token that the verify job never receives", () => {
  const verify = workflow.slice(
    workflow.indexOf("\n  verify:\n"),
    workflow.indexOf("\n  publish:\n"),
  );
  const publish = workflow.slice(
    workflow.indexOf("\n  publish:\n"),
    workflow.indexOf("\n  dispatch:\n"),
  );
  assert.notMatch(verify, /app-token|WORKBENCH_SYNC_APP/);
  assert.include(publish, "\n    environment: workbench-upstream-sync\n");
  for (const input of [
    "repositories: ${{ github.event.repository.name }}",
    "permission-contents: write",
    "permission-pull-requests: write",
    "permission-workflows: write",
  ])
    assert.include(publish, input);
  // GITHUB_TOKEN pushes cannot carry workflow changes, so every write must use the App token.
  assert.notMatch(publish, /github\.token|secrets\.GITHUB_TOKEN/);
  assert.deepEqual(
    [...publish.matchAll(/^\s+(?:token|GH_TOKEN): (.+)$/gm)].map((match) => match[1]),
    Array(3).fill("${{ steps.app-token.outputs.token }}"),
  );
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

const dispatchPreamble = `
gh() {
  if [[ "$1" == api ]]; then
    response="$RUNNER_TEMP/ci-runs.json"
    if [[ "$3" == *workbench-quality.yml* ]]; then response="$RUNNER_TEMP/quality-runs.json"; fi
    jq -r "$5" "$response"
    return
  fi
  echo "$*" >> "$RUNNER_TEMP/dispatches"
  count=$(wc -l < "$RUNNER_TEMP/dispatches")
  if [[ "\${ACCEPT_FAILED_DISPATCH:-}" == 1 && "$count" -eq 1 ]]; then
    if [[ "\${VISIBILITY_DELAY:-0}" == 0 ]]; then
      cp "$RUNNER_TEMP/accepted-runs.json" "$RUNNER_TEMP/ci-runs.json"
    fi
    return 1
  fi
  [[ "$count" -gt "\${FAIL_DISPATCHES:-0}" ]]
}
git() { echo "\${REMOTE_SHA:-published-merge-sha} refs/heads/main"; }
date() { echo "2026-10-17T00:00:00Z"; }
sleep() {
  echo "$1" >> "$RUNNER_TEMP/backoffs"
  elapsed=$(cat "$RUNNER_TEMP/elapsed" 2>/dev/null || echo 0)
  elapsed=$((elapsed + $1))
  echo "$elapsed" > "$RUNNER_TEMP/elapsed"
  if [[ "\${ACCEPT_FAILED_DISPATCH:-}" == 1 && "$elapsed" -ge "\${VISIBILITY_DELAY:-0}" ]]; then
    cp "$RUNNER_TEMP/accepted-runs.json" "$RUNNER_TEMP/ci-runs.json"
  fi
}
`;
const writeRuns = (root: string, ci: unknown[] = [], quality: unknown[] = []) => {
  for (const [name, runs] of [
    ["ci", ci],
    ["quality", quality],
  ] as const) {
    NodeFS.writeFileSync(
      NodePath.join(root, `${name}-runs.json`),
      JSON.stringify({ workflow_runs: runs }),
    );
  }
};
const dispatched = (root: string) =>
  NodeFS.readFileSync(NodePath.join(root, "dispatches"), "utf8").trim().split("\n");

it("fails without re-dispatching when acceptance remains unknown after bounded polling", () => {
  for (const failures of [0, 1])
    workflowFixture((root) => {
      writeRuns(root);
      const result = runStep(
        root,
        "Dispatch gates for the published main merge",
        dispatchPreamble,
        {
          PUBLISHED_SHA: "published-merge-sha",
          FAIL_DISPATCHES: String(failures),
        },
      );
      assert.equal(result.status, failures === 0 ? 0 : 1, result.stderr);
      const calls = dispatched(root);
      assert.equal(calls.length, failures === 0 ? 2 : 1);
      assert.ok(
        calls.every((call) => call.endsWith("--ref main -f expected_sha=published-merge-sha")),
      );
      if (failures === 0) assert.match(calls.at(-1)!, /workbench-quality.yml/);
      else {
        assert.match(
          result.stderr,
          /Dispatch acceptance unknown.*after 60 seconds.*Rerun this job/,
        );
        assert.equal(
          NodeFS.readFileSync(NodePath.join(root, "backoffs"), "utf8"),
          "5\n".repeat(12),
        );
      }
    });
});

it("retains active or successful exact-SHA dispatches but repairs failed or unrelated runs", () => {
  const run = {
    id: 1,
    head_sha: "published-merge-sha",
    head_branch: "main",
    event: "workflow_dispatch",
    path: ".github/workflows/workbench-ci.yml",
    run_number: 1,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
  };
  for (const [existing, expectedDispatches] of [
    [run, 1],
    [{ ...run, event: "push" }, 1],
    [{ ...run, status: "queued", conclusion: null }, 1],
    [{ ...run, status: "in_progress", conclusion: null }, 1],
    [{ ...run, conclusion: "failure" }, 2],
    [{ ...run, head_sha: "old-sha" }, 2],
    [{ ...run, event: "pull_request" }, 2],
    [{ ...run, head_branch: "other" }, 2],
    [{ ...run, path: ".github/workflows/unrelated.yml" }, 2],
  ] as const)
    workflowFixture((root) => {
      writeRuns(root, [existing]);
      const result = runStep(
        root,
        "Dispatch gates for the published main merge",
        dispatchPreamble,
        { PUBLISHED_SHA: "published-merge-sha" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(dispatched(root).length, expectedDispatches);
      assert.match(dispatched(root).at(-1)!, /workbench-quality.yml/);
    });
});

it("does not duplicate a dispatch accepted despite a client failure", () => {
  for (const [status, delay] of [
    ["queued", 0],
    ["in_progress", 3],
    ["completed", 3],
    ["queued", 99],
  ] as const)
    workflowFixture((root) => {
      writeRuns(root);
      NodeFS.writeFileSync(
        NodePath.join(root, "accepted-runs.json"),
        JSON.stringify({
          workflow_runs: [
            {
              id: 2,
              head_sha: "published-merge-sha",
              head_branch: "main",
              event: "workflow_dispatch",
              path: ".github/workflows/workbench-ci.yml",
              run_number: 2,
              run_attempt: 1,
              created_at: "2026-10-17T00:00:00Z",
              status,
              conclusion: status === "completed" ? "failure" : null,
            },
          ],
        }),
      );
      const result = runStep(
        root,
        "Dispatch gates for the published main merge",
        dispatchPreamble,
        {
          PUBLISHED_SHA: "published-merge-sha",
          ACCEPT_FAILED_DISPATCH: "1",
          VISIBILITY_DELAY: String(delay),
        },
      );
      assert.equal(result.status, delay === 99 ? 1 : 0, result.stderr);
      assert.equal(dispatched(root).filter((call) => call.includes("workbench-ci.yml")).length, 1);
      assert.equal(
        dispatched(root).filter((call) => call.includes("workbench-quality.yml")).length,
        delay === 99 ? 0 : 1,
      );
    });
});

it("repairs the latest failed run even when an older run succeeded", () => {
  for (const [runNumber, runAttempt] of [
    [2, 1],
    [1, 2],
  ])
    workflowFixture((root) => {
      const run = {
        id: 1,
        head_sha: "published-merge-sha",
        head_branch: "main",
        event: "workflow_dispatch",
        path: ".github/workflows/workbench-ci.yml",
        run_number: 1,
        run_attempt: 1,
        created_at: "2026-01-01T00:00:00Z",
        status: "completed",
        conclusion: "success",
      };
      // Deliberately place the older success first instead of relying on API order.
      writeRuns(root, [
        run,
        { ...run, id: 2, run_number: runNumber, run_attempt: runAttempt, conclusion: "failure" },
      ]);
      const result = runStep(
        root,
        "Dispatch gates for the published main merge",
        dispatchPreamble,
        {
          PUBLISHED_SHA: "published-merge-sha",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(dispatched(root).filter((call) => call.includes("workbench-ci.yml")).length, 1);
      assert.equal(
        dispatched(root).filter((call) => call.includes("workbench-quality.yml")).length,
        1,
      );
    });
});

it("refuses dispatch if main has moved", () =>
  workflowFixture((root) => {
    writeRuns(root);
    const result = runStep(root, "Dispatch gates for the published main merge", dispatchPreamble, {
      PUBLISHED_SHA: "published-merge-sha",
      REMOTE_SHA: "moved-main",
    });
    assert.equal(result.status, 1);
    assert.equal(NodeFS.existsSync(NodePath.join(root, "dispatches")), false);
  }));

it("a full rerun recognizes the exact published sync merge and repairs its missing gate", () => {
  const fixture = createFixture([]);
  try {
    const root = fixture.repository;
    runGit(root, ["switch", "product"]);
    runGit(root, ["merge", "--no-ff", "--no-edit", fixture.upstreamSha]);
    const verified = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, ["checkout", "--detach", fixture.productSha]);
    runGit(root, ["merge", "--no-ff", "--no-edit", verified]);
    const published = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, ["update-ref", "refs/remotes/upstream/main", fixture.upstreamSha]);
    const pending = runStep(root, "Check for upstream commits");
    assert.equal(pending.status, 0, pending.stderr);
    assert.include(
      NodeFS.readFileSync(NodePath.join(root, "outputs"), "utf8"),
      "needed=false\nintegrated=true\n",
    );
    const pr = {
      merged_at: "2026-10-17",
      merge_commit_sha: published,
      number: 42,
      base: { ref: "main", repo: { full_name: "filipgutica/t3code" } },
      head: {
        ref: "automation/workbench-upstream-sync",
        sha: verified,
        repo: { full_name: "filipgutica/t3code" },
      },
    };
    const preamble = 'gh() { jq -r "$5" "$RUNNER_TEMP/merged-prs.json"; }';
    for (const match of [false, true]) {
      NodeFS.writeFileSync(
        NodePath.join(root, "merged-prs.json"),
        JSON.stringify([{ ...pr, merge_commit_sha: match ? published : "different-merge" }]),
      );
      const identified = runStep(root, "Identify already-published sync merge", preamble, {
        PUBLISHED_SHA: published,
      });
      assert.equal(identified.status, 0, identified.stderr);
      assert.equal(NodeFS.existsSync(NodePath.join(root, "environment")), match);
    }
    writeRuns(root, [
      {
        id: 1,
        head_sha: published,
        head_branch: "main",
        event: "workflow_dispatch",
        path: ".github/workflows/workbench-ci.yml",
        run_number: 1,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
      },
    ]);
    const repair = runStep(root, "Dispatch gates for the published main merge", dispatchPreamble, {
      PUBLISHED_SHA: published,
      REMOTE_SHA: published,
    });
    assert.equal(repair.status, 0, repair.stderr);
    assert.deepEqual(dispatched(root), [
      `workflow run workbench-quality.yml --repo filipgutica/t3code --ref main -f expected_sha=${published}`,
    ]);
    assert.match(
      workflow,
      /needs: \[verify, publish\][\s\S]*always\(\)[\s\S]*needs\.verify\.outputs\.integrated == 'true'/,
    );
  } finally {
    NodeFS.rmSync(fixture.root, { recursive: true, force: true });
  }
});
