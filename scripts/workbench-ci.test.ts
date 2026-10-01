// @effect-diagnostics nodeBuiltinImport:off - Exercise the generator's CLI and filesystem contract.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(import.meta.dirname, "workbench-ci.ts");
const source = `name: CI
on: pull_request
permissions:
  contents: read
concurrency:
  group: ci-example
jobs:
  lint:
    name: Lint
    runs-on: blacksmith-2vcpu-ubuntu-2404
    timeout-minutes: 10
    steps:
      - name: Check unused code
        run: node lint.mjs
  test:
    name: Test
    runs-on: blacksmith-4vcpu-ubuntu-2404
    timeout-minutes: 10
    needs: [lint]
    strategy:
      matrix:
        shard: [1, 2]
    steps:
      - run: vp run --parallel --concurrency-limit 4 --filter app test
        timeout-minutes: 5
  native_gate:
    name: Native Gate
    runs-on: blacksmith-6vcpu-macos-26
    timeout-minutes: 5
    if: \${{ !cancelled() }}
    needs: [test]
    steps:
      - run: node native-gate.mjs
`;

const reportSource = `name: Thread Transfer Report
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
permissions:
  actions: read
  contents: read
  pull-requests: write
jobs:
  publish:
    name: Publish PR comment
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-24.04
    concurrency:
      group: thread-transfer-report-\${{ github.event.workflow_run.id }}
    steps:
      - uses: actions/checkout@v6
        with:
          ref: \${{ github.event.repository.default_branch }}
          sparse-checkout: .github/scripts
      - run: node --test .github/scripts/thread-transfer-report.test.cjs
`;

const withFixture = (
  run: (fixture: {
    root: string;
    input: string;
    output: string;
    reportInput: string;
    reportOutput: string;
  }) => void,
) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-ci-test-"));
  const directory = NodePath.join(root, ".github/workflows");
  NodeFS.mkdirSync(directory, { recursive: true });
  const input = NodePath.join(directory, "ci.yml");
  const output = NodePath.join(directory, "workbench-ci.yml");
  const reportInput = NodePath.join(directory, "thread-transfer-report.yml");
  const reportOutput = NodePath.join(directory, "workbench-thread-transfer-report.yml");
  NodeFS.writeFileSync(input, source);
  NodeFS.writeFileSync(reportInput, reportSource);
  try {
    run({ root, input, output, reportInput, reportOutput });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

const generate = (root: string, args: ReadonlyArray<string> = []) =>
  NodeChildProcess.spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });

it("keeps native gates and detects upstream changes before accepting fork CI", () => {
  withFixture(({ root, input, output }) => {
    assert.equal(generate(root, ["--check"]).status, 1);
    assert.equal(generate(root).status, 0);
    assert.equal(generate(root, ["--check"]).status, 0);
    const first = NodeFS.readFileSync(output, "utf8");
    assert.include(first, "name: Workbench CI\n");
    assert.include(first, "group: workbench-ci-example\n");
    assert.include(
      first,
      "name: Workbench Native Gate\n    runs-on: macos-26\n    timeout-minutes: 5",
    );
    assert.include(first, "runs-on: ubuntu-24.04\n    timeout-minutes: 30");
    assert.include(first, "needs: [lint]\n    strategy:\n      matrix:\n        shard: [1, 2]");
    assert.include(first, "if: ${{ !cancelled() }}\n    needs: [test]");
    assert.include(
      first,
      "run: vp run --parallel --concurrency-limit 1 --filter app test\n        timeout-minutes: 5",
    );
    assert.equal(NodeFS.readFileSync(input, "utf8"), source);

    const updated = `${source}  new_upstream_gate:
    name: New Upstream Gate
    runs-on: blacksmith-8vcpu-ubuntu-2404
    timeout-minutes: 10
    needs: [native_gate]
    permissions:
      pull-requests: read
    steps:
      - run: node new-upstream-gate.mjs
`;
    NodeFS.writeFileSync(input, updated);
    const stale = generate(root, ["--check"]);
    assert.equal(stale.status, 1);
    assert.include(stale.stderr, "Fork CI is stale");
    assert.equal(NodeFS.readFileSync(output, "utf8"), first);
    assert.equal(generate(root).status, 0);
    assert.equal(generate(root, ["--check"]).status, 0);
    const regenerated = NodeFS.readFileSync(output, "utf8");
    assert.include(
      regenerated,
      "  new_upstream_gate:\n    name: Workbench New Upstream Gate\n    runs-on: ubuntu-24.04\n    timeout-minutes: 30\n    needs: [native_gate]\n    permissions:\n      pull-requests: read\n    steps:\n      - run: node new-upstream-gate.mjs\n",
    );
    assert.equal(NodeFS.readFileSync(input, "utf8"), updated);
  });
});

it("follows the fork CI producer while preserving the trusted report publisher", () => {
  withFixture(({ root, reportInput, reportOutput }) => {
    assert.equal(generate(root).status, 0);
    const generated = NodeFS.readFileSync(reportOutput, "utf8");
    assert.include(generated, "name: Workbench Thread Transfer Report\n");
    assert.include(generated, "workflows: [Workbench CI]\n");
    assert.include(
      generated,
      "group: workbench-thread-transfer-report-${{ github.event.workflow_run.id }}",
    );
    assert.include(generated, reportSource.slice(reportSource.indexOf("    steps:\n")));
    assert.include(
      generated,
      "permissions:\n  actions: read\n  contents: read\n  pull-requests: write\n",
    );
    assert.equal(NodeFS.readFileSync(reportInput, "utf8"), reportSource);
    NodeFS.writeFileSync(
      reportInput,
      reportSource.replace("actions/checkout@v6", "actions/checkout@v7"),
    );
    assert.equal(generate(root, ["--check"]).status, 1);
    assert.equal(generate(root).status, 0);
    assert.include(NodeFS.readFileSync(reportOutput, "utf8"), "actions/checkout@v7");
    assert.equal(generate(root, ["--check"]).status, 0);
  });
});

it("rejects unsupported report infrastructure before replacing either verified workflow", () => {
  withFixture(({ root, input, output, reportInput, reportOutput }) => {
    assert.equal(generate(root).status, 0);
    const verifiedCI = NodeFS.readFileSync(output, "utf8");
    const verifiedReport = NodeFS.readFileSync(reportOutput, "utf8");
    NodeFS.writeFileSync(
      input,
      source.replace("run: node native-gate.mjs", "run: node new-gate.mjs"),
    );
    NodeFS.writeFileSync(
      reportInput,
      reportSource.replace("runs-on: ubuntu-24.04", "runs-on: blacksmith-2vcpu-ubuntu-2404"),
    );
    const rejected = generate(root);
    assert.equal(rejected.status, 1);
    assert.include(rejected.stderr, "Unsupported upstream thread transfer report infrastructure");
    assert.equal(NodeFS.readFileSync(output, "utf8"), verifiedCI);
    assert.equal(NodeFS.readFileSync(reportOutput, "utf8"), verifiedReport);
  });
});

it.each([
  ["runner", "blacksmith-6vcpu-macos-26", "blacksmith-12vcpu-macos-26"],
  ["timeout", "timeout-minutes: 10", "timeout-minutes: 15"],
  ["job mapping", "  native_gate:", '  "native_gate":'],
])("rejects unsupported upstream %s without replacing verified output", (_kind, from, to) => {
  withFixture(({ root, input, output }) => {
    assert.equal(generate(root).status, 0);
    const verified = NodeFS.readFileSync(output, "utf8");
    NodeFS.writeFileSync(input, source.replace(from, to));
    const rejected = generate(root);
    assert.equal(rejected.status, 1);
    assert.include(rejected.stderr, "Unsupported upstream CI");
    assert.equal(NodeFS.readFileSync(output, "utf8"), verified);
  });
});
