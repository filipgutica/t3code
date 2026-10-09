// @effect-diagnostics nodeBuiltinImport:off - These tests exercise the disposable CLI protocol against native decoders.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import {
  decodePullRequestActivityJson,
  decodePullRequestCoreJson,
  decodePullRequestSummariesJson,
  decodeReviewThreadsJson,
  buildPullRequestSummariesGraphQlQuery,
  pullRequestCoreGraphQlQuery,
  PULL_REQUEST_ACTIVITY_GRAPHQL_QUERY,
  REVIEW_THREADS_GRAPHQL_QUERY,
} from "../../apps/server/src/pullRequest/gitHubPullRequestJson.ts";
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const adapter = NodePath.join(import.meta.dirname, "gh-attention.mjs");
const execute = async (args: string[], input?: unknown) => {
  const execution = execFile(process.execPath, [adapter, ...args]);
  if (input !== undefined) execution.child.stdin?.end(JSON.stringify(input));
  return (await execution).stdout;
};
const read = async (number: number, query: string) =>
  execute([
    "api",
    "graphql",
    "--hostname",
    "github.com",
    "-f",
    "owner=workbench-synthetic",
    "-f",
    "name=attention-fixtures",
    "-F",
    `number=${number}`,
    "-f",
    `query=${query}`,
  ]);

it("delivers failed checks, unresolved feedback, a separate API repository and incomplete coverage through the native GitHub decoding contract", async () => {
  const summariesDocument = buildPullRequestSummariesGraphQlQuery([
    ...[901, 902].map((number) => ({
      repository: "workbench-synthetic/attention-fixtures",
      number,
    })),
    { repository: "workbench-synthetic/attention-api", number: 906 },
  ]);
  const summaries = decodePullRequestSummariesJson(
    await execute(["api", "graphql", "--input", "-"], summariesDocument),
  );
  expect(Result.isSuccess(summaries)).toBe(true);
  if (!Result.isSuccess(summaries))
    throw new Error("Native summary decoder rejected the synthetic adapter");
  expect(summaries.success.get(0)?.checksState).toBe("failing");
  expect(summaries.success.get(1)?.reviewDecision).toBe("changes-requested");
  expect(summaries.success.get(2)).toEqual(
    expect.objectContaining({
      number: 906,
      url: "https://github.com/workbench-synthetic/attention-api/pull/906",
      checksState: "passing",
      reviewDecision: null,
    }),
  );
  const activity = decodePullRequestActivityJson(
    await read(902, PULL_REQUEST_ACTIVITY_GRAPHQL_QUERY),
  );
  expect(Result.isSuccess(activity)).toBe(true);
  if (!Result.isSuccess(activity))
    throw new Error("Native activity decoder rejected the synthetic review");
  expect(activity.success.remarks).toEqual([
    expect.objectContaining({
      kind: "review",
      author: expect.objectContaining({ login: "synthetic-reviewer" }),
      reviewState: "CHANGES_REQUESTED",
      body: expect.stringMatching(
        /\[Synthetic requested changes\].*empty-response regression test/,
      ),
    }),
  ]);
  const core = decodePullRequestCoreJson(
    await read(901, pullRequestCoreGraphQlQuery("github.com")),
  );
  expect(Result.isSuccess(core)).toBe(true);
  if (!Result.isSuccess(core))
    throw new Error("Native detail decoder rejected the synthetic adapter");
  expect(core.success.checks.map((check) => check.status)).toEqual(["failure", "failure"]);
  expect(new Set(core.success.checks.map((check) => check.name)).size).toBe(2);
  expect(core.success.title).toMatch(/^\[Synthetic attention\]/);
  const feedback = decodeReviewThreadsJson(await read(902, REVIEW_THREADS_GRAPHQL_QUERY));
  expect(Result.isSuccess(feedback)).toBe(true);
  if (!Result.isSuccess(feedback))
    throw new Error("Native activity decoder rejected the synthetic adapter");
  expect(feedback.success.threads).toHaveLength(2);
  expect(new Set(feedback.success.threads.map(({ thread }) => thread.id)).size).toBe(2);
  expect(feedback.success.threads.map(({ thread }) => thread.path)).toEqual([
    "synthetic.txt",
    "src/invitations.ts",
  ]);
  expect(feedback.success.threads.every(({ thread }) => !thread.isResolved)).toBe(true);
  expect(feedback.success.threads[0]?.thread.isResolved).toBe(false);
  expect(feedback.success.threads[0]?.thread.comments[0]?.body).toMatch(
    /\[Synthetic unresolved feedback\].*empty response/,
  );
  expect(feedback.success.threads[1]?.thread.comments[0]?.body).toMatch(
    /\[Synthetic unresolved feedback\].*expiry.*24 hours/,
  );
  expect(feedback.success.reviewers).toEqual([
    expect.objectContaining({ login: "synthetic-reviewer" }),
  ]);
  const incomplete = decodeReviewThreadsJson(await read(904, REVIEW_THREADS_GRAPHQL_QUERY));
  expect(Result.isSuccess(incomplete)).toBe(true);
  if (!Result.isSuccess(incomplete))
    throw new Error("Native activity decoder rejected the incomplete fixture");
  expect(incomplete.success.threads[0]?.nextCommentCursor).not.toBeNull();
});

it("refuses GitHub writes, unrelated identities and deliberately unavailable inspection without forwarding requests", async () => {
  for (const args of [
    ["api", "user", "--method", "PATCH", "-f", "name=changed"],
    ["api", "user", "--method=PATCH"],
    ["api", "user", "-X", "PATCH"],
    ["api", "user", "-XPATCH"],
    ["api", "user", "--field=name=changed"],
    ["api", "user", "-fname=changed"],
    ["api", "user", "-f", "name=changed"],
    ["api", "rate_limit", "--method", "POST"],
    ["auth", "status", "--json", "hosts"],
    [
      "api",
      "--method",
      "POST",
      "repos/workbench-synthetic/attention-fixtures/actions/runs/1/rerun-failed-jobs",
    ],
    ["api", "graphql", "-f", "query=mutation { closePullRequest }"],
    ["pr", "merge", "901", "--repo", "workbench-synthetic/attention-fixtures"],
    ["pr", "view", "75", "--repo", "filipgutica/t3code"],
    ["pr", "view", "906", "--repo", "workbench-synthetic/attention-fixtures"],
    ["pr", "view", "901", "--repo", "workbench-synthetic/attention-api"],
    ["pr", "view", "903", "--repo", "workbench-synthetic/attention-fixtures"],
  ])
    await expect(execute(args)).rejects.toThrow(/\[Synthetic demo\].*no GitHub request was sent/);
});
