// @effect-diagnostics nodeBuiltinImport:off - These tests exercise the disposable CLI protocol against native decoders.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  toPullRequestActivityPage,
  toPullRequestCore,
  toPullRequestSummary,
  toReviewThreadPage,
} from "../../packages/source-control-github/src/server/gitHubPullRequestJson.ts";
import { PullRequestSummary } from "../../packages/source-control-github/src/server/pullRequestBatches.graphql.ts";
import {
  PullRequestCore,
  PullRequestActivity,
} from "../../packages/source-control-github/src/server/pullRequestReads.graphql.ts";
import { ReviewThreads } from "../../packages/source-control-github/src/server/pullRequestReviews.graphql.ts";
import { attentionSummaryDocument } from "./attention-graphql.mts";
const decodeSummary = Schema.decodeUnknownSync(PullRequestSummary.result);
const decodeActivity = Schema.decodeUnknownSync(PullRequestActivity.result);
const decodeCore = Schema.decodeUnknownSync(PullRequestCore.result);
const decodeThreads = Schema.decodeUnknownSync(ReviewThreads.result);
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
  const summariesDocument = await attentionSummaryDocument([
    ...[901, 902].map((number) => ({
      repository: "workbench-synthetic/attention-fixtures",
      number,
    })),
    { repository: "workbench-synthetic/attention-api", number: 906 },
  ]);
  const summariesRaw = JSON.parse(
    await execute(["api", "graphql", "--input", "-"], summariesDocument),
  );
  const summaries = [0, 1, 2].map((index) => {
    const decoded = decodeSummary({
      repository: summariesRaw.data[`_${index}_repository`],
    });
    if (!decoded.repository?.pullRequest) throw new Error("Native summary is unavailable");
    return toPullRequestSummary(decoded.repository.pullRequest);
  });
  expect(summaries[0]?.checksState).toBe("failing");
  expect(summaries[1]?.reviewDecision).toBe("changes-requested");
  expect(summaries[2]).toEqual(
    expect.objectContaining({
      number: 906,
      url: "https://github.com/workbench-synthetic/attention-api/pull/906",
      checksState: "passing",
      reviewDecision: null,
    }),
  );
  const activity = toPullRequestActivityPage(
    decodeActivity(JSON.parse(await read(902, PullRequestActivity.document)).data),
  );
  if (!activity) throw new Error("Native activity is unavailable");
  expect(activity.remarks).toEqual([
    expect.objectContaining({
      kind: "review",
      author: expect.objectContaining({ login: "synthetic-reviewer" }),
      reviewState: "CHANGES_REQUESTED",
      body: expect.stringMatching(
        /\[Synthetic requested changes\].*empty-response regression test/,
      ),
    }),
  ]);
  const core = toPullRequestCore(
    decodeCore(JSON.parse(await read(901, PullRequestCore.document)).data),
  );
  if (!core) throw new Error("Native detail is unavailable");
  expect(core.checks.map((check) => check.status)).toEqual(["failure", "failure"]);
  expect(new Set(core.checks.map((check) => check.name)).size).toBe(2);
  expect(core.title).toMatch(/^\[Synthetic attention\]/);
  const feedback = toReviewThreadPage(
    decodeThreads(JSON.parse(await read(902, ReviewThreads.document)).data),
  );
  if (!feedback) throw new Error("Native review threads are unavailable");
  expect(feedback.threads).toHaveLength(2);
  expect(new Set(feedback.threads.map(({ thread }) => thread.id)).size).toBe(2);
  expect(feedback.threads.map(({ thread }) => thread.path)).toEqual([
    "synthetic.txt",
    "src/invitations.ts",
  ]);
  expect(feedback.threads.every(({ thread }) => !thread.isResolved)).toBe(true);
  expect(feedback.threads[0]?.thread.isResolved).toBe(false);
  expect(feedback.threads[0]?.thread.comments[0]?.body).toMatch(
    /\[Synthetic unresolved feedback\].*empty response/,
  );
  expect(feedback.threads[1]?.thread.comments[0]?.body).toMatch(
    /\[Synthetic unresolved feedback\].*expiry.*24 hours/,
  );
  expect(feedback.reviewers).toEqual([expect.objectContaining({ login: "synthetic-reviewer" })]);
  const incomplete = toReviewThreadPage(
    decodeThreads(JSON.parse(await read(904, ReviewThreads.document)).data),
  );
  if (!incomplete) throw new Error("Native incomplete fixture is unavailable");
  expect(incomplete.threads[0]?.nextCommentCursor).not.toBeNull();
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
