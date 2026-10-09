import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as GitHubApi from "../sourceControl/GitHubApi.ts";
import { rerunFailedGitHubWorkflowJobs } from "./githubWorkflowRerun.ts";

const head = { sha: "abc123", ref: "feature", repo: { id: 22, full_name: "fork/web" } };
const base = { ref: "main", sha: "base123", repo: { id: 11, full_name: "acme/web" } };
const pr = { number: 7, state: "open", merged: false, head, base };
const run = (id: number, overrides = {}) => ({
  id,
  workflow_id: 4,
  run_number: id,
  run_attempt: 1,
  event: "pull_request",
  head_sha: head.sha,
  head_branch: head.ref,
  head_repository: head.repo,
  repository: base.repo,
  status: "completed",
  conclusion: "failure",
  pull_requests: [
    {
      number: 7,
      head: {
        ...head,
        repo: { id: 22, name: "web", url: "https://api.github.com/repos/fork/web" },
      },
      base: {
        ...base,
        repo: { id: 11, name: "web", url: "https://api.github.com/repos/acme/web" },
      },
    },
  ],
  ...overrides,
});
const output = (value: unknown, truncated = false): GitHubApi.GitHubRestResponse => ({
  status: 200,
  headers: {},
  body: JSON.stringify(value),
  truncated,
  invalidUtf8: false,
});
const input = { host: "github.enterprise.test", repository: "acme/web", number: 7 };
const mock = (runs: ReturnType<typeof run>[]) =>
  vi.fn<GitHubApi.GitHubApi["Service"]["rest"]>((request) => {
    const path = request.path;
    return Effect.succeed(
      output(
        path.endsWith("/pulls/7")
          ? pr
          : request.method === "POST"
            ? {}
            : { total_count: runs.length, workflow_runs: runs },
      ),
    );
  });
const posts = (rest: ReturnType<typeof mock>) =>
  rest.mock.calls.filter(([request]) => request.method === "POST");

describe("GitHub failed workflow reruns", () => {
  it.effect(
    "requests only failed jobs on the latest matching workflow and qualifies every host",
    () =>
      Effect.gen(function* () {
        const rest = mock([
          run(1),
          run(2, { conclusion: "success" }),
          run(3, { workflow_id: 5 }),
          run(4, { head_sha: "old" }),
          run(5, { head_repository: { id: 33, full_name: "other/web" } }),
        ]);
        yield* rerunFailedGitHubWorkflowJobs({ ...input, rest });
        expect(posts(rest).map(([request]) => request.path)).toEqual([
          "repos/acme/web/actions/runs/3/rerun-failed-jobs",
        ]);
        expect(rest.mock.calls.every(([request]) => request.host === input.host)).toBe(true);
      }),
  );
  it.effect("a newer pending run suppresses an older failure", () =>
    Effect.gen(function* () {
      const rest = mock([run(1), run(2, { status: "in_progress", conclusion: null })]);
      const error = yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
      expect(error.message).toContain("No eligible failed workflow");
      expect(posts(rest)).toHaveLength(0);
    }),
  );
  it.effect("refuses a changed head before POST", () =>
    Effect.gen(function* () {
      const rest = mock([run(1)]);
      let reads = 0;
      rest.mockImplementation((request) => {
        const path = request.path;
        return Effect.succeed(
          output(
            path.endsWith("/pulls/7")
              ? ++reads === 1
                ? pr
                : { ...pr, head: { ...head, sha: "new" } }
              : { total_count: 1, workflow_runs: [run(1)] },
          ),
        );
      });
      const error = yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
      expect(error.message).toContain("head changed");
      expect(posts(rest)).toHaveLength(0);
    }),
  );
  it.effect("refuses incomplete, malformed and ambiguous discovery before mutation", () =>
    Effect.gen(function* () {
      for (const payload of [
        { total_count: 1001, workflow_runs: [] },
        { total_count: 1, workflow_runs: [{ id: 1 }] },
        { total_count: 2, workflow_runs: [run(1), run(2, { run_number: 1 })] },
      ]) {
        const rest = mock([]);
        rest.mockImplementation((request) =>
          Effect.succeed(output(request.path.endsWith("/pulls/7") ? pr : payload)),
        );
        yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
        expect(posts(rest)).toHaveLength(0);
      }
    }),
  );
  it.effect("refuses closed and merged PRs without mutation", () =>
    Effect.gen(function* () {
      for (const current of [
        { ...pr, state: "closed" },
        { ...pr, merged: true },
      ]) {
        const rest = mock([]);
        rest.mockImplementation(() => Effect.succeed(output(current)));
        yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
        expect(posts(rest)).toHaveLength(0);
      }
    }),
  );
  it.effect("reads all pages before selecting current failed runs", () =>
    Effect.gen(function* () {
      const firstPage = Array.from({ length: 100 }, (_, index) =>
        run(index + 1, { conclusion: "success" }),
      );
      const lastRun = run(101, { workflow_id: 5 });
      const rest = mock([]);
      rest.mockImplementation((request) => {
        const path = request.path;
        return Effect.succeed(
          output(
            path.endsWith("/pulls/7")
              ? pr
              : request.method === "POST"
                ? {}
                : {
                    total_count: 101,
                    workflow_runs: path.endsWith("page=2") ? [lastRun] : firstPage,
                  },
          ),
        );
      });
      yield* rerunFailedGitHubWorkflowJobs({ ...input, rest });
      expect(posts(rest).map(([request]) => request.path)).toEqual([
        "repos/acme/web/actions/runs/101/rerun-failed-jobs",
      ]);
    }),
  );
  it.effect("refuses a truncated response and an unrelated PR association", () =>
    Effect.gen(function* () {
      for (const truncated of [false, true]) {
        const rest = mock([]);
        rest.mockImplementation((request) => {
          const isHead = request.path.endsWith("/pulls/7");
          return Effect.succeed(
            output(
              isHead
                ? pr
                : {
                    total_count: 1,
                    workflow_runs: [run(1, { pull_requests: [{ number: 8, head, base }] })],
                  },
              !isHead && truncated,
            ),
          );
        });
        yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
        expect(posts(rest)).toHaveLength(0);
      }
    }),
  );
  it.effect("reports a truthful count when a later Actions write is denied", () =>
    Effect.gen(function* () {
      const rest = mock([run(1), run(2, { workflow_id: 5 })]);
      const success = rest.getMockImplementation()!;
      let requested = 0;
      rest.mockImplementation((request) =>
        request.method === "POST" && ++requested === 2
          ? Effect.fail(
              new GitHubApi.GitHubApiResponseError({
                host: input.host,
                operation: "rerunFailedWorkflowJobs",
                status: 403,
              }),
            )
          : success(request),
      );
      const error = yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
      expect(error.requestedCount).toBe(1);
      expect(error.message).toContain("Verify Actions write permission");
      expect(error.message).toContain("GitHub returned HTTP 403");
    }),
  );
});

it.effect("refuses a retargeted base branch even with the same head SHA", () =>
  Effect.gen(function* () {
    for (const changesDuringAction of [false, true]) {
      const rest = mock([run(1)]);
      let reads = 0;
      rest.mockImplementation((request) => {
        const path = request.path;
        return Effect.succeed(
          output(
            path.endsWith("/pulls/7")
              ? ++reads > 1 || !changesDuringAction
                ? { ...pr, base: { ...base, ref: "release" } }
                : pr
              : { total_count: 1, workflow_runs: [run(1)] },
          ),
        );
      });
      const error = yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
      expect(error.message).toContain(changesDuringAction ? "head changed" : "No eligible");
      expect(posts(rest)).toHaveLength(0);
    }
  }),
);

it.effect("refuses same-head runs changed or superseded before POST", () =>
  Effect.gen(function* () {
    for (const updated of [run(1, { run_attempt: 2 }), run(2, { conclusion: "success" })]) {
      const rest = mock([run(1)]);
      let discoveries = 0;
      rest.mockImplementation((request) => {
        const path = request.path;
        return Effect.succeed(
          output(
            path.endsWith("/pulls/7")
              ? pr
              : { total_count: 1, workflow_runs: [++discoveries === 1 ? run(1) : updated] },
          ),
        );
      });
      const error = yield* Effect.flip(rerunFailedGitHubWorkflowJobs({ ...input, rest }));
      expect(error.message).toContain("changed or was superseded");
      expect(posts(rest)).toHaveLength(0);
    }
  }),
);
