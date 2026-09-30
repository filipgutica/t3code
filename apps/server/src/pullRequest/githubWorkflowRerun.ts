import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import type * as GitHubCli from "../sourceControl/GitHubCli.ts";

export class GitHubWorkflowRerunError extends Schema.TaggedError<GitHubWorkflowRerunError>()(
  "GitHubWorkflowRerunError",
  {
    requestedCount: Schema.Int,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Requested ${this.requestedCount} workflow rerun${this.requestedCount === 1 ? "" : "s"}. ${this.detail}`;
  }
}

const Repository = Schema.Struct({ id: PositiveInt, full_name: TrimmedNonEmptyString });
const Revision = Schema.Struct({
  sha: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  repo: Repository,
});
const PullRequest = Schema.Struct({
  number: PositiveInt,
  state: Schema.Literals(["open", "closed"]),
  merged: Schema.Boolean,
  head: Revision,
  base: Revision,
});
const AssociationRevision = Schema.Struct({
  sha: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  repo: Schema.Struct({ id: PositiveInt }),
});
const Run = Schema.Struct({
  id: PositiveInt,
  workflow_id: PositiveInt,
  run_number: PositiveInt,
  run_attempt: PositiveInt,
  event: TrimmedNonEmptyString,
  head_sha: TrimmedNonEmptyString,
  head_branch: TrimmedNonEmptyString,
  head_repository: Repository,
  repository: Repository,
  status: Schema.Literals([
    "completed",
    "in_progress",
    "queued",
    "requested",
    "waiting",
    "pending",
  ]),
  conclusion: Schema.NullOr(
    Schema.Literals([
      "failure",
      "timed_out",
      "success",
      "cancelled",
      "skipped",
      "neutral",
      "action_required",
      "stale",
      "startup_failure",
    ]),
  ),
  pull_requests: Schema.Array(
    Schema.Struct({ number: PositiveInt, head: AssociationRevision, base: AssociationRevision }),
  ),
});
const RunPage = Schema.Struct({ total_count: NonNegativeInt, workflow_runs: Schema.Array(Run) });
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodePullRequest = Schema.decodeUnknownEffect(PullRequest);
const decodeRunPage = Schema.decodeUnknownEffect(RunPage);
const isRerunError = Schema.is(GitHubWorkflowRerunError);
type WorkflowRun = typeof Run.Type;
type PullRequestHead = typeof PullRequest.Type;

type Input = {
  readonly cwd: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly execute: GitHubCli.GitHubCli["Service"]["execute"];
};

export const rerunFailedGitHubWorkflowJobs = Effect.fn(
  "GitHubPullRequestCli.rerunFailedWorkflowJobs",
)(function* (input: Input) {
  let requestedCount = 0;
  const refuse = (detail: string) => new GitHubWorkflowRerunError({ requestedCount, detail });
  const endpoint = `repos/${input.repository}`;
  const readJson = Effect.fnUntraced(function* (path: string) {
    const result = yield* input.execute({
      cwd: input.cwd,
      args: ["api", "--hostname", input.host, "--method", "GET", path],
    });
    if (result.stdoutTruncated || result.stdoutInvalidUtf8)
      return yield* refuse(
        "GitHub returned a truncated or invalid response; no further reruns requested.",
      );
    return yield* decodeJson(result.stdout).pipe(
      Effect.mapError(() => refuse("GitHub returned malformed JSON; no further reruns requested.")),
    );
  });
  const readHead = Effect.fnUntraced(function* () {
    const head = yield* decodePullRequest(
      yield* readJson(`${endpoint}/pulls/${input.number}`),
    ).pipe(
      Effect.mapError(() => refuse("GitHub omitted the exact PR repository or revision identity.")),
    );
    if (
      head.number !== input.number ||
      head.base.repo.full_name.toLowerCase() !== input.repository.toLowerCase()
    )
      return yield* refuse("GitHub returned a different PR or base repository.");
    if (head.state !== "open" || head.merged)
      return yield* refuse("Only an open, unmerged PR can request workflow reruns.");
    return head;
  });
  const candidates = Effect.fnUntraced(function* (head: PullRequestHead) {
    const runs: WorkflowRun[] = [];
    let count: number | undefined;
    for (let page = 1; page <= 10; page++) {
      const result = yield* decodeRunPage(
        yield* readJson(
          `${endpoint}/actions/runs?head_sha=${encodeURIComponent(head.head.sha)}&per_page=100&page=${page}`,
        ),
      ).pipe(Effect.mapError(() => refuse("GitHub returned malformed workflow run identities.")));
      if (result.total_count > 1000 || (count !== undefined && count !== result.total_count))
        return yield* refuse("Workflow run discovery is incomplete or changed during pagination.");
      count = result.total_count;
      runs.push(...result.workflow_runs);
      if (runs.length >= count) break;
      if (result.workflow_runs.length < 100)
        return yield* refuse("Workflow run discovery ended before all runs were read.");
    }
    if (runs.length !== count || new Set(runs.map((run) => run.id)).size !== runs.length)
      return yield* refuse(
        "Workflow run discovery is incomplete or contains duplicate identities.",
      );
    const latest = new Map<string, WorkflowRun>();
    for (const run of runs) {
      if (
        run.head_sha !== head.head.sha ||
        run.head_branch !== head.head.ref ||
        run.head_repository.id !== head.head.repo.id ||
        run.repository.id !== head.base.repo.id
      )
        continue;
      const associations = run.pull_requests.filter(
        (pr) =>
          pr.number === head.number &&
          pr.head.sha === head.head.sha &&
          pr.head.ref === head.head.ref &&
          pr.head.repo.id === head.head.repo.id &&
          pr.base.repo.id === head.base.repo.id &&
          pr.base.ref === head.base.ref,
      );
      if (associations.length === 0) continue;
      if (associations.length !== 1 || run.pull_requests.length !== 1)
        return yield* refuse("A workflow run is associated with ambiguous PR identities.");
      const key = `${run.workflow_id}/${run.event}/${run.head_branch}/${run.head_repository.id}/${run.repository.id}`;
      const previous = latest.get(key);
      if (previous && previous.id !== run.id && previous.run_number === run.run_number)
        return yield* refuse("Workflow runs do not have a unique latest identity.");
      if (
        !previous ||
        run.run_number > previous.run_number ||
        (run.run_number === previous.run_number && run.run_attempt > previous.run_attempt)
      )
        latest.set(key, run);
    }
    // Choose latest across every state first. A newer success or queued run supersedes failure.
    return [...latest.values()].filter(
      (run) =>
        run.status === "completed" &&
        (run.conclusion === "failure" || run.conclusion === "timed_out"),
    );
  });
  return yield* Effect.gen(function* () {
    const expected = yield* readHead();
    const runs = yield* candidates(expected);
    if (runs.length === 0)
      return yield* refuse("No eligible failed workflow runs were found for the current PR head.");
    for (const run of runs) {
      const current = yield* readHead();
      if (
        current.head.sha !== expected.head.sha ||
        current.head.ref !== expected.head.ref ||
        current.head.repo.id !== expected.head.repo.id ||
        current.base.repo.id !== expected.base.repo.id ||
        current.base.ref !== expected.base.ref
      )
        return yield* refuse("The PR head changed before its workflows could be rerun.");
      const currentRuns = yield* candidates(current);
      if (
        !currentRuns.some(
          (candidate) => candidate.id === run.id && candidate.run_attempt === run.run_attempt,
        )
      )
        return yield* refuse("A workflow run changed or was superseded before rerun.");
      yield* input.execute({
        cwd: input.cwd,
        args: [
          "api",
          "--hostname",
          input.host,
          "--method",
          "POST",
          `${endpoint}/actions/runs/${run.id}/rerun-failed-jobs`,
        ],
      });
      requestedCount += 1;
    }
  }).pipe(
    Effect.mapError((error) =>
      isRerunError(error)
        ? error
        : refuse(
            `GitHub Actions request failed. Verify Actions write permission. ${error.message}`,
          ),
    ),
  );
});
