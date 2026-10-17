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
    cp "$RUNNER_TEMP/accepted-runs.json" "$RUNNER_TEMP/ci-runs.json"
    return 1
  fi
  [[ "$count" -gt "\${FAIL_DISPATCHES:-0}" ]]
}
git() { echo "\${REMOTE_SHA:-published-merge-sha} refs/heads/main"; }
date() { echo "2026-10-17T00:00:00Z"; }
sleep() { echo "$1" >> "$RUNNER_TEMP/backoffs"; }
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

it("retries each published-SHA dispatch with bounded backoff and propagates exhaustion", () => {
  for (const failures of [0, 2, 99])
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
      assert.equal(result.status, failures === 99 ? 1 : 0, result.stderr);
      const calls = dispatched(root);
      assert.equal(calls.length, failures === 99 ? 5 : failures + 2);
      assert.ok(
        calls.every((call) => call.endsWith("--ref main -f expected_sha=published-merge-sha")),
      );
      if (failures !== 99) assert.match(calls.at(-1)!, /workbench-quality.yml/);
      if (failures > 0)
        assert.equal(
          NodeFS.readFileSync(NodePath.join(root, "backoffs"), "utf8"),
          failures === 99 ? "2\n4\n6\n8\n" : "2\n4\n",
        );
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
  for (const status of ["queued", "in_progress", "completed"])
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
          FAIL_DISPATCHES: "1",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(dispatched(root).filter((call) => call.includes("workbench-ci.yml")).length, 2);
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
