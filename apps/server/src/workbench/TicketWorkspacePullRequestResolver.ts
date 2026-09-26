import {
  WorkbenchOperationError,
  type ThreadId,
  type ProjectId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import {
  canonicalRepositoryKey,
  sourceControlRepositorySelector,
} from "@t3tools/shared/sourceControl";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import type { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import {
  type SourceControlProviderHandle,
  SourceControlProviderRegistry,
} from "../sourceControl/SourceControlProviderRegistry.ts";

export class TicketWorkspacePullRequestResolver extends Context.Service<
  TicketWorkspacePullRequestResolver,
  Pick<TicketWorkspaceHost["Service"], "resolveOpenPullRequestBranch">
>()("t3/workbench/TicketWorkspacePullRequestResolver") {}

const preparationError = (message: string) =>
  new WorkbenchOperationError({
    code: "ticket_workspace_preparation_failed",
    message,
  });

const threadCandidateUrls = (thread: OrchestrationThreadShell) => {
  if (thread.pullRequests.length > 0) {
    return visibleThreadPullRequests(thread.pullRequests).map((reference) => reference.url);
  }
  return [thread.linkedPullRequest, thread.branchPullRequest]
    .filter((reference) => reference !== null && reference !== undefined)
    .map((reference) => reference.url);
};

const validatePullRequestHead = ({
  request,
  identity,
  projectTitle,
}: {
  request: import("@t3tools/contracts").ChangeRequest;
  identity: NonNullable<
    import("@t3tools/contracts").OrchestrationProjectShell["repositoryIdentity"]
  >;
  projectTitle: string;
}) => {
  const headRepository = request.headRepositoryNameWithOwner?.toLowerCase();
  const sameRepository = headRepository
    ? headRepository === sourceControlRepositorySelector(identity)?.toLowerCase()
    : request.isCrossRepository === false;
  if (request.isCrossRepository === true || !sameRepository)
    return preparationError(
      `PR #${request.number} for ${projectTitle} has a fork or unknown head repository. Prepare that PR checkout separately; Workbench cannot safely reuse its branch automatically.`,
    );
  return null;
};

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const pullRequests = yield* PullRequestService;
  const providers = yield* SourceControlProviderRegistry;

  const collectThreadCandidates = Effect.fnUntraced(function* ({
    assignedThreadIds,
    addCandidate,
  }: {
    assignedThreadIds: ReadonlyArray<ThreadId>;
    addCandidate: (url: string) => void;
  }) {
    for (const threadId of assignedThreadIds) {
      const thread = yield* projections
        .getThreadShellById(threadId)
        .pipe(
          Effect.mapError(() =>
            preparationError("Could not load a linked Thread's pull requests."),
          ),
        );
      if (
        Option.isNone(thread) ||
        thread.value.archivedAt !== null ||
        thread.value.settledOverride === "settled"
      )
        continue;
      for (const url of threadCandidateUrls(thread.value)) addCandidate(url);
    }
  });

  const collectJiraCandidates = Effect.fnUntraced(function* ({
    projectId,
    projectTitle,
    jiraIssueKey,
    addCandidate,
  }: {
    projectId: ProjectId;
    projectTitle: string;
    jiraIssueKey: string;
    addCandidate: (url: string) => void;
  }) {
    yield* pullRequests.invalidate({});
    const result = yield* pullRequests
      .list({
        state: "open",
        involvement: "all",
        projectIds: [projectId],
        query: jiraIssueKey,
        limit: 50,
      })
      .pipe(
        Effect.mapError(() =>
          preparationError(
            `Could not search ${projectTitle} for Ticket pull requests. Check the hosting connection and retry.`,
          ),
        ),
      );
    if (
      result.errors.length > 0 ||
      result.providers.some((provider) => provider.searchesOnHost && !provider.configured)
    )
      return yield* preparationError(
        `Could not search all pull requests for ${projectTitle}. Check the hosting connection and retry.`,
      );
    if (result.truncated || Object.keys(result.nextCursors).length > 0)
      return yield* preparationError(
        `The PR search for ${projectTitle} is incomplete. Narrow the Ticket's linked PRs before preparing its workspace.`,
      );
    for (const entry of result.entries) {
      if (
        entry.projectId === projectId &&
        entry.state === "open" &&
        result.providers.some((provider) => provider.host === entry.host && provider.searchesOnHost)
      )
        addCandidate(entry.url);
    }
  });

  const inspectOpenCandidates = Effect.fnUntraced(function* ({
    handle,
    context,
    candidates,
    workspaceRoot,
    projectTitle,
    repositoryKey,
  }: {
    handle: SourceControlProviderHandle;
    context: NonNullable<SourceControlProviderHandle["context"]>;
    candidates: ReadonlyMap<string, string>;
    workspaceRoot: string;
    projectTitle: string;
    repositoryKey: string;
  }) {
    const openRequests = [];
    for (const url of candidates.values()) {
      const request = yield* handle.provider
        .getChangeRequest({ cwd: workspaceRoot, context, reference: url })
        .pipe(
          Effect.mapError(() =>
            preparationError(
              `Could not inspect a linked PR for ${projectTitle}. Check the hosting connection and retry.`,
            ),
          ),
        );
      if (request.state !== "open") continue;
      const parsed = parseChangeRequestUrl(request.url);
      if (
        !parsed ||
        canonicalRepositoryKey(`${parsed.host}/${parsed.repository}`) !== repositoryKey
      )
        return yield* preparationError(`A linked PR does not belong to ${projectTitle}.`);
      openRequests.push(request);
    }
    return openRequests;
  });

  const resolveOpenPullRequestBranch: TicketWorkspacePullRequestResolver["Service"]["resolveOpenPullRequestBranch"] =
    Effect.fn("TicketWorkspacePullRequestResolver.resolveOpenPullRequestBranch")(function* (input) {
      if (!input.jiraIssueKey && input.assignedThreadIds.length === 0) return Option.none();
      const projectOption = yield* projections
        .getProjectShellById(input.projectId)
        .pipe(
          Effect.mapError(() =>
            preparationError("Could not load the Ticket repository for PR discovery."),
          ),
        );
      if (Option.isNone(projectOption))
        return yield* preparationError("The Ticket repository is unavailable.");
      const project = projectOption.value;
      const identity = project.repositoryIdentity;
      // Local repositories without a hosting identity keep the existing origin/main path.
      if (!identity) return Option.none();
      const repositoryKey = canonicalRepositoryKey(identity.canonicalKey.toLowerCase());
      const candidates = new Map<string, string>();
      const addCandidate = (url: string) => {
        const parsed = parseChangeRequestUrl(url);
        if (
          parsed &&
          canonicalRepositoryKey(`${parsed.host}/${parsed.repository}`) === repositoryKey
        )
          candidates.set(`${repositoryKey}#${parsed.number}`, url);
      };
      yield* collectThreadCandidates({ assignedThreadIds: input.assignedThreadIds, addCandidate });
      if (input.jiraIssueKey) {
        yield* collectJiraCandidates({
          projectId: input.projectId,
          projectTitle: project.title,
          jiraIssueKey: input.jiraIssueKey,
          addCandidate,
        });
      }

      if (candidates.size === 0) return Option.none();
      const handle = yield* providers
        .resolveHandle({ cwd: project.workspaceRoot })
        .pipe(
          Effect.mapError(() =>
            preparationError(`Could not resolve the hosting provider for ${project.title}.`),
          ),
        );
      const context = handle.context;
      if (
        !context ||
        normalizeGitRemoteUrl(context.remoteUrl) !==
          normalizeGitRemoteUrl(identity.locator.remoteUrl)
      )
        return yield* preparationError(
          `The remote for ${project.title} changed or is unavailable. Refresh the Project before preparing its workspace.`,
        );
      const openRequests = yield* inspectOpenCandidates({
        handle,
        context,
        candidates,
        workspaceRoot: project.workspaceRoot,
        projectTitle: project.title,
        repositoryKey,
      });
      if (openRequests.length === 0) return Option.none();
      if (openRequests.length > 1)
        return yield* preparationError(
          `Multiple open PRs match ${project.title} (${openRequests.map((pr) => `#${pr.number}`).join(", ")}). Resolve the Ticket's PR associations before preparing its workspace.`,
        );
      const request = openRequests[0]!;
      const headError = validatePullRequestHead({ request, identity, projectTitle: project.title });
      if (headError !== null) return yield* headError;
      return Option.some({ remoteName: context.remoteName, remoteBranch: request.headRefName });
    });
  return TicketWorkspacePullRequestResolver.of({ resolveOpenPullRequestBranch });
});

export const TicketWorkspacePullRequestResolverLive = Layer.effect(
  TicketWorkspacePullRequestResolver,
  make,
);
