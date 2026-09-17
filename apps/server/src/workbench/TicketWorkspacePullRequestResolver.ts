import { WorkbenchOperationError } from "@t3tools/contracts";
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
import { SourceControlProviderRegistry } from "../sourceControl/SourceControlProviderRegistry.ts";

export class TicketWorkspacePullRequestResolver extends Context.Service<
  TicketWorkspacePullRequestResolver,
  Pick<TicketWorkspaceHost["Service"], "resolveOpenPullRequestBranch">
>()("t3/workbench/TicketWorkspacePullRequestResolver") {}

const preparationError = (message: string) =>
  new WorkbenchOperationError({
    code: "ticket_workspace_preparation_failed",
    message,
  });

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const pullRequests = yield* PullRequestService;
  const providers = yield* SourceControlProviderRegistry;

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
      for (const threadId of input.assignedThreadIds) {
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
        if (thread.value.pullRequests.length > 0) {
          for (const reference of visibleThreadPullRequests(thread.value.pullRequests))
            addCandidate(reference.url);
        } else {
          for (const reference of [thread.value.linkedPullRequest, thread.value.branchPullRequest])
            if (reference) addCandidate(reference.url);
        }
      }
      if (input.jiraIssueKey) {
        yield* pullRequests.invalidate({});
        const result = yield* pullRequests
          .list({
            state: "open",
            involvement: "all",
            projectIds: [input.projectId],
            query: input.jiraIssueKey,
            limit: 50,
          })
          .pipe(
            Effect.mapError(() =>
              preparationError(
                `Could not search ${project.title} for Ticket pull requests. Check the hosting connection and retry.`,
              ),
            ),
          );
        if (
          result.errors.length > 0 ||
          result.providers.some((provider) => provider.searchesOnHost && !provider.configured)
        )
          return yield* preparationError(
            `Could not search all pull requests for ${project.title}. Check the hosting connection and retry.`,
          );
        if (result.truncated || Object.keys(result.nextCursors).length > 0)
          return yield* preparationError(
            `The PR search for ${project.title} is incomplete. Narrow the Ticket's linked PRs before preparing its workspace.`,
          );
        for (const entry of result.entries) {
          if (
            entry.projectId === input.projectId &&
            entry.state === "open" &&
            result.providers.some(
              (provider) => provider.host === entry.host && provider.searchesOnHost,
            )
          )
            addCandidate(entry.url);
        }
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
      const openRequests = [];
      for (const url of candidates.values()) {
        const request = yield* handle.provider
          .getChangeRequest({ cwd: project.workspaceRoot, context, reference: url })
          .pipe(
            Effect.mapError(() =>
              preparationError(
                `Could not inspect a linked PR for ${project.title}. Check the hosting connection and retry.`,
              ),
            ),
          );
        if (request.state !== "open") continue;
        const parsed = parseChangeRequestUrl(request.url);
        if (
          !parsed ||
          canonicalRepositoryKey(`${parsed.host}/${parsed.repository}`) !== repositoryKey
        )
          return yield* preparationError(`A linked PR does not belong to ${project.title}.`);
        openRequests.push(request);
      }
      if (openRequests.length === 0) return Option.none();
      if (openRequests.length > 1)
        return yield* preparationError(
          `Multiple open PRs match ${project.title} (${openRequests.map((pr) => `#${pr.number}`).join(", ")}). Resolve the Ticket's PR associations before preparing its workspace.`,
        );
      const request = openRequests[0]!;
      const headRepository = request.headRepositoryNameWithOwner?.toLowerCase();
      const sameRepository = headRepository
        ? headRepository === sourceControlRepositorySelector(identity)?.toLowerCase()
        : request.isCrossRepository === false;
      if (request.isCrossRepository === true || !sameRepository)
        return yield* preparationError(
          `PR #${request.number} for ${project.title} has a fork or unknown head repository. Prepare that PR checkout separately; Workbench cannot safely reuse its branch automatically.`,
        );
      return Option.some({ remoteName: context.remoteName, remoteBranch: request.headRefName });
    });
  return TicketWorkspacePullRequestResolver.of({ resolveOpenPullRequestBranch });
});

export const TicketWorkspacePullRequestResolverLive = Layer.effect(
  TicketWorkspacePullRequestResolver,
  make,
);
