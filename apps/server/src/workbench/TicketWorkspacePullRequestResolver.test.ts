import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  SourceControlProviderError,
  type ChangeRequest,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type PullRequestListEntry,
  type PullRequestListInput,
  type PullRequestListResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import { SourceControlProvider } from "../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../sourceControl/SourceControlProviderRegistry.ts";
import { make } from "./TicketWorkspacePullRequestResolver.ts";

const projectId = ProjectId.make("api");
const timestamp = "2026-09-17T00:00:00.000Z";
const remoteUrl = "https://github.com/example/api.git";
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "API",
  workspaceRoot: "/repos/api",
  scripts: [],
  defaultModelSelection: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  repositoryIdentity: {
    canonicalKey: "github.com/example/api",
    displayName: "example/api",
    provider: "github",
    locator: { source: "git-remote", remoteName: "origin", remoteUrl },
  },
};
const entry = (number: number, repository = "example/api"): PullRequestListEntry => ({
  projectId,
  projectTitle: "API",
  provider: "github",
  host: "github.com",
  repository,
  number,
  url: `https://github.com/${repository}/pull/${number}`,
  title: `Fix DEMO-1 #${number}`,
  author: null,
  headBranch: `fix/pr-${number}`,
  baseBranch: "main",
  state: "open",
  isDraft: false,
  mergeability: "unknown",
  additions: 0,
  deletions: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  viewerReviewRequested: false,
  labels: [],
});
const summary = (number: number, patch: Partial<ChangeRequest> = {}): ChangeRequest => ({
  provider: "github",
  number,
  title: `PR ${number}`,
  url: entry(number).url,
  baseRefName: "main",
  headRefName: `fix/pr-${number}`,
  state: "open",
  updatedAt: Option.none(),
  isCrossRepository: false,
  ...patch,
});
const thread = (
  number: number,
  patch: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: ThreadId.make(`thread-${number}`),
  projectId,
  title: "Ticket work",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [
    {
      host: "github.com",
      repository: "example/api",
      number,
      url: entry(number).url,
      source: "manual",
      linkedAt: timestamp,
      snapshot: null,
      stack: null,
    },
  ],
  latestTurn: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...patch,
});

const resolve = (
  options: {
    entries?: PullRequestListEntry[];
    threads?: OrchestrationThreadShell[];
    summaries?: ChangeRequest[];
    jiraIssueKey?: string | null;
    resultPatch?: Partial<PullRequestListResult>;
    searches?: PullRequestListInput[];
    reads?: string[];
    remote?: string;
    failRead?: boolean;
    cachedEntries?: PullRequestListEntry[];
  } = {},
) =>
  Effect.gen(function* () {
    const provider = yield* SourceControlProvider;
    let invalidated = false;
    return yield* make.pipe(
      Effect.flatMap((resolver) =>
        resolver.resolveOpenPullRequestBranch({
          projectId,
          assignedThreadIds: (options.threads ?? []).map((value) => value.id),
          jiraIssueKey: options.jiraIssueKey === undefined ? "DEMO-1" : options.jiraIssueKey,
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionSnapshotQuery)({
            getProjectShellById: () => Effect.succeedSome(project),
            getThreadShellById: (id) =>
              Effect.succeed(
                Option.fromNullishOr((options.threads ?? []).find((value) => value.id === id)),
              ),
          }),
          Layer.mock(PullRequestService)({
            invalidate: () =>
              Effect.sync(() => {
                invalidated = true;
              }),
            list: (input) => {
              options.searches?.push(input);
              return Effect.succeed({
                entries:
                  !invalidated && options.cachedEntries !== undefined
                    ? options.cachedEntries
                    : (options.entries ?? []),
                viewers: { "github.com": "demo" },
                providers: [
                  {
                    host: "github.com",
                    kind: "github",
                    searchesOnHost: true,
                    configured: true,
                    projectCount: 1,
                    detail: null,
                  },
                ],
                errors: [],
                truncated: false,
                nextCursors: {},
                ...options.resultPatch,
              });
            },
          }),
          Layer.mock(SourceControlProviderRegistry)({
            resolveLink: () => undefined,
            resolveHandle: () =>
              Effect.succeed({
                provider,
                context: {
                  provider: { kind: "github", name: "GitHub", baseUrl: "https://github.com" },
                  remoteName: "origin",
                  remoteUrl: options.remote ?? remoteUrl,
                },
              }),
          }),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      Layer.mock(SourceControlProvider)({
        kind: "github",
        getChangeRequest: ({ reference }) => {
          options.reads?.push(reference);
          if (options.failRead)
            return Effect.fail(
              new SourceControlProviderError({
                provider: "github",
                operation: "getChangeRequest",
                cwd: project.workspaceRoot,
                detail: "offline",
              }),
            );
          const found = (
            options.summaries ?? (options.entries ?? []).map((value) => summary(value.number))
          ).find((value) => value.url === reference);
          return found ? Effect.succeed(found) : Effect.die("Unexpected PR read");
        },
      }),
    ),
  );

const failureMessage = <A>(result: Result.Result<A, { message: string }>) => {
  expect(Result.isFailure(result)).toBe(true);
  return Result.isFailure(result) ? result.failure.message : "";
};

describe("Ticket workspace PR resolution", () => {
  it.effect("refreshes cached discovery before choosing a preparation branch", () =>
    Effect.gen(function* () {
      expect(yield* resolve({ cachedEntries: [], entries: [entry(1)] })).toEqual(
        Option.some({ remoteName: "origin", remoteBranch: "fix/pr-1" }),
      );
      const result = yield* resolve({
        cachedEntries: [entry(1)],
        entries: [entry(1), entry(2)],
      }).pipe(Effect.result);
      expect(failureMessage(result)).toContain("Multiple open PRs match API (#1, #2)");
    }),
  );
  it.effect("uses the open PR's branch and scopes the Jira search to the selected project", () =>
    Effect.gen(function* () {
      const searches: PullRequestListInput[] = [];
      expect(yield* resolve({ entries: [entry(1)], searches })).toEqual(
        Option.some({ remoteName: "origin", remoteBranch: "fix/pr-1" }),
      );
      expect(searches).toEqual([
        { state: "open", involvement: "all", projectIds: [projectId], query: "DEMO-1", limit: 50 },
      ]);
    }),
  );
  it.effect("deduplicates a PR linked through a Thread and matching the Jira issue", () =>
    Effect.gen(function* () {
      const reads: string[] = [];
      expect(yield* resolve({ entries: [entry(1)], threads: [thread(1)], reads })).toEqual(
        Option.some({ remoteName: "origin", remoteBranch: "fix/pr-1" }),
      );
      expect(reads).toEqual([entry(1).url]);
    }),
  );
  it.effect("uses an active linked PR without a Jira key and does not search all PRs", () =>
    Effect.gen(function* () {
      const searches: PullRequestListInput[] = [];
      expect(
        yield* resolve({
          jiraIssueKey: null,
          threads: [thread(2)],
          summaries: [summary(2)],
          searches,
        }),
      ).toEqual(Option.some({ remoteName: "origin", remoteBranch: "fix/pr-2" }));
      expect(searches).toEqual([]);
    }),
  );
  it.effect("ignores settled history, dismissed links, and other repositories", () =>
    Effect.gen(function* () {
      const dismissed = thread(3);
      const reads: string[] = [];
      expect(
        yield* resolve({
          entries: [entry(4, "example/other")],
          threads: [
            thread(1, { settledOverride: "settled" }),
            thread(2, { archivedAt: timestamp }),
            {
              ...dismissed,
              pullRequests: dismissed.pullRequests.map((value) => ({
                ...value,
                source: "stack-dismissed",
              })),
            },
          ],
          reads,
        }),
      ).toEqual(Option.none());
      expect(reads).toEqual([]);
    }),
  );
  it.effect("fails when distinct open PRs are linked or match instead of choosing the first", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        resolve({ entries: [entry(1)], threads: [thread(2)], summaries: [summary(1), summary(2)] }),
      );
      expect(failureMessage(result)).toContain("Multiple open PRs");
    }),
  );
  it.effect("rechecks linked PR state and ignores closed or merged candidates", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve({ entries: [entry(1)], summaries: [summary(1, { state: "merged" })] }),
      ).toEqual(Option.none());
    }),
  );
  it.effect("fails rather than selecting a fork or unverifiable head", () =>
    Effect.gen(function* () {
      for (const patch of [
        { isCrossRepository: true },
        { isCrossRepository: undefined },
        { headRepositoryNameWithOwner: "someone/fork" },
      ]) {
        expect(
          failureMessage(
            yield* Effect.result(resolve({ entries: [entry(1)], summaries: [summary(1, patch)] })),
          ),
        ).toContain("fork or unknown head");
      }
    }),
  );
  it.effect("does not treat failed or truncated discovery as no matching PR", () =>
    Effect.gen(function* () {
      for (const resultPatch of [
        { truncated: true },
        { errors: [{ projectId, projectTitle: "API", message: "offline" }] },
        {
          providers: [
            {
              host: "github.com",
              kind: "github" as const,
              searchesOnHost: true,
              configured: false,
              projectCount: 1,
              detail: "Sign in",
            },
          ],
        },
      ])
        expect(failureMessage(yield* Effect.result(resolve({ resultPatch })))).toMatch(
          /incomplete|Could not search/,
        );
    }),
  );
  it.effect("never associates an unfiltered listing from a host without text search", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve({
          entries: [entry(1)],
          resultPatch: {
            providers: [
              {
                host: "github.com",
                kind: "github",
                searchesOnHost: false,
                configured: true,
                projectCount: 1,
                detail: null,
              },
            ],
          },
        }),
      ).toEqual(Option.none());
    }),
  );
  it.effect("fails if PR metadata cannot be read or the repository remote changed", () =>
    Effect.gen(function* () {
      expect(
        failureMessage(yield* Effect.result(resolve({ entries: [entry(1)], failRead: true }))),
      ).toContain("Could not inspect");
      expect(
        failureMessage(
          yield* Effect.result(
            resolve({ entries: [entry(1)], remote: "https://github.com/example/other.git" }),
          ),
        ),
      ).toContain("remote");
    }),
  );
  it.effect("does no hosting reads when there is no Ticket PR association", () =>
    Effect.gen(function* () {
      const searches: PullRequestListInput[] = [];
      const reads: string[] = [];
      expect(yield* resolve({ jiraIssueKey: null, searches, reads })).toEqual(Option.none());
      expect(searches).toEqual([]);
      expect(reads).toEqual([]);
    }),
  );
});
