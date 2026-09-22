import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { legacyThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";

/**
 * Workbench rows only read the shell snapshot. Keep the legacy single-link projection visible
 * until a server has populated the richer pullRequests array, while respecting dismissed links.
 */
export function resolveWorkbenchSidebarThreadPullRequests(
  thread: Pick<
    EnvironmentThreadShell,
    "pullRequests" | "linkedPullRequest" | "branchPullRequest" | "updatedAt"
  >,
): ReadonlyArray<ThreadPullRequestLink> {
  const links = [...thread.pullRequests];
  // Once the server has emitted the link collection it is authoritative. The legacy fields may
  // be stale projections from before multi-PR links existed and must not be reintroduced here.
  if (links.length > 0) return links;
  const seenLegacyKeys = new Set<string>();

  for (const legacy of [thread.linkedPullRequest, thread.branchPullRequest]) {
    if (legacy === null || legacy === undefined) continue;
    const key = legacyThreadPullRequestKey(legacy);
    const linkKey = `${key.host}/${key.repository}#${key.number}`;
    if (seenLegacyKeys.has(linkKey)) continue;
    links.push({
      host: key.host,
      repository: legacy.repository,
      number: legacy.number,
      url: legacy.url,
      source: "manual",
      linkedAt: thread.updatedAt,
      snapshot: null,
      stack: null,
    });
    seenLegacyKeys.add(linkKey);
  }

  return links;
}

export function resolveWorkbenchSidebarRepositoryLabel(
  project: {
    readonly title: string;
    readonly repositoryIdentity: { readonly displayName?: string | null } | null | undefined;
  } | null,
): string | null {
  const identityLabel = project?.repositoryIdentity?.displayName?.trim();
  if (identityLabel) return identityLabel;
  const projectLabel = project?.title.trim();
  return projectLabel || null;
}
