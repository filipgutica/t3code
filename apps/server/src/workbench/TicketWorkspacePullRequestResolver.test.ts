import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  SourceControlProviderError,
  SourceControlProviderKind,
  type ChangeRequest,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  type PullRequestListEntry,
  type PullRequestListInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { nativeThreadShell } from "./testing/nativeThreads.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import { SourceControlProvider } from "@t3tools/source-control-core/server/SourceControlProvider";
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
    provider: SourceControlProviderKind.make("github"),
    locator: { source: "git-remote", remoteName: "origin", remoteUrl },
  },
};
const entry = (number: number, repository = "example/api"): PullRequestListEntry => ({
  projectId,
  projectTitle: "API",
  provider: SourceControlProviderKind.make("github"),
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
  provider: SourceControlProviderKind.make("github"),
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
  patch: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...nativeThreadShell({ threadId: `thread-${number}`, projectId, createdAt: timestamp }),
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
  ...patch,
});

const resolve = (
  options: {
    threads?: OrchestrationV2ThreadShell[];
    summaries?: ChangeRequest[];
    searches?: PullRequestListInput[];
    reads?: string[];
    remote?: string;
    failRead?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const provider = yield* SourceControlProvider;
    return yield* make.pipe(
      Effect.flatMap((resolver) =>
        resolver.resolveOpenPullRequestBranch({
          projectId,
          assignedThreadIds: (options.threads ?? []).map((value) => value.id),
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ProjectStoreV2)({ getShell: () => Effect.succeedSome(project) }),
          Layer.mock(ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.succeed((options.threads ?? []).find((value) => value.id === id) ?? null),
          }),
          // Records any host search; Ticket preparation must not run one.
          Layer.mock(PullRequestService)({
            list: (input) => {
              options.searches?.push(input);
              return Effect.die("Unexpected PR search");
            },
          }),
          Layer.mock(SourceControlProviderRegistry)({
            resolveLink: () => undefined,
            resolveHandle: () =>
              Effect.succeed({
                provider,
                context: {
                  provider: {
                    kind: SourceControlProviderKind.make("github"),
                    name: "GitHub",
                    baseUrl: "https://github.com",
                  },
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
        kind: SourceControlProviderKind.make("github"),
        getChangeRequest: ({ reference }) => {
          options.reads?.push(reference);
          if (options.failRead)
            return Effect.fail(
              new SourceControlProviderError({
                provider: SourceControlProviderKind.make("github"),
                operation: "getChangeRequest",
                cwd: project.workspaceRoot,
                detail: "offline",
              }),
            );
          const found = (
            options.summaries ??
            (options.threads ?? []).flatMap((value) =>
              (value.pullRequests ?? []).map((pullRequest) => summary(pullRequest.number)),
            )
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
  it.effect("uses the open PR linked through a Thread without searching hosts", () =>
    Effect.gen(function* () {
      const searches: PullRequestListInput[] = [];
      const reads: string[] = [];
      expect(yield* resolve({ threads: [thread(2)], searches, reads })).toEqual(
        Option.some({ remoteName: "origin", remoteBranch: "fix/pr-2" }),
      );
      expect(searches).toEqual([]);
      expect(reads).toEqual([entry(2).url]);
    }),
  );
  it.effect("ignores settled history, dismissed links, and other repositories", () =>
    Effect.gen(function* () {
      const dismissed = thread(3);
      const reads: string[] = [];
      expect(
        yield* resolve({
          threads: [
            thread(1, { settledOverride: "settled" }),
            thread(2, { archivedAt: DateTime.makeUnsafe(timestamp) }),
            {
              ...dismissed,
              pullRequests: (dismissed.pullRequests ?? []).map((value) => ({
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
  it.effect("fails when distinct open PRs are linked instead of choosing the first", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(resolve({ threads: [thread(1), thread(2)] }));
      expect(failureMessage(result)).toContain("Multiple open PRs");
    }),
  );
  it.effect("rechecks linked PR state and ignores closed or merged candidates", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve({ threads: [thread(1)], summaries: [summary(1, { state: "merged" })] }),
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
            yield* Effect.result(resolve({ threads: [thread(1)], summaries: [summary(1, patch)] })),
          ),
        ).toContain("fork or unknown head");
      }
    }),
  );
  it.effect("fails if PR metadata cannot be read or the repository remote changed", () =>
    Effect.gen(function* () {
      expect(
        failureMessage(yield* Effect.result(resolve({ threads: [thread(1)], failRead: true }))),
      ).toContain("Could not inspect");
      expect(
        failureMessage(
          yield* Effect.result(
            resolve({ threads: [thread(1)], remote: "https://github.com/example/other.git" }),
          ),
        ),
      ).toContain("remote");
    }),
  );
  it.effect("does no hosting reads when there is no Ticket PR association", () =>
    Effect.gen(function* () {
      const reads: string[] = [];
      expect(yield* resolve({ reads })).toEqual(Option.none());
      expect(reads).toEqual([]);
    }),
  );
});
