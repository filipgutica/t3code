import { describe, expect, it } from "@effect/vitest";
import { ProjectId, type ThreadPullRequestLink } from "@t3tools/contracts";

import {
  resolveWorkbenchSidebarRepositoryLabel,
  resolveWorkbenchSidebarThreadPullRequests,
} from "./workbenchSidebarThread.logic";

const projectId = ProjectId.make("project");
const link = (
  number: number,
  source: ThreadPullRequestLink["source"] = "manual",
): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "owner/repository",
  number,
  url: `https://github.com/owner/repository/pull/${number}`,
  source,
  linkedAt: "2026-09-22T00:00:00.000Z",
  snapshot: null,
  stack: null,
});

describe("Workbench sidebar thread presentation", () => {
  it("keeps the native link collection authoritative over legacy projections", () => {
    const native = link(12);
    const links = resolveWorkbenchSidebarThreadPullRequests({
      pullRequests: [native],
      linkedPullRequest: {
        projectId,
        repository: "owner/repository",
        number: 12,
        url: native.url,
      },
      branchPullRequest: {
        projectId,
        repository: "owner/repository",
        number: 13,
        url: "https://github.com/owner/repository/pull/13",
      },
      updatedAt: "2026-09-22T00:01:00.000Z",
    });

    expect(links).toHaveLength(1);
    expect(links[0]).toBe(native);
  });

  it("recovers legacy links from cached shell metadata when native links are absent", () => {
    const links = resolveWorkbenchSidebarThreadPullRequests({
      pullRequests: [],
      linkedPullRequest: {
        projectId,
        repository: "owner/repository",
        number: 12,
        url: "https://github.com/owner/repository/pull/12",
      },
      branchPullRequest: {
        projectId,
        repository: "owner/repository",
        number: 13,
        url: "https://github.com/owner/repository/pull/13",
      },
      updatedAt: "2026-09-22T00:01:00.000Z",
    });

    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ number: 12, snapshot: null, source: "manual" });
    expect(links[1]).toMatchObject({ number: 13, snapshot: null, source: "manual" });
  });

  it("does not resurrect a dismissed legacy link", () => {
    const dismissed = link(12, "stack-dismissed");
    const links = resolveWorkbenchSidebarThreadPullRequests({
      pullRequests: [dismissed],
      linkedPullRequest: {
        projectId,
        repository: "owner/repository",
        number: 12,
        url: dismissed.url,
      },
      branchPullRequest: null,
      updatedAt: "2026-09-22T00:01:00.000Z",
    });

    expect(links).toEqual([dismissed]);
  });

  it("prefers the saved repository identity over the workspace title", () => {
    expect(
      resolveWorkbenchSidebarRepositoryLabel({
        title: "Workspace",
        repositoryIdentity: { displayName: "owner/repository" },
      }),
    ).toBe("owner/repository");
    expect(
      resolveWorkbenchSidebarRepositoryLabel({
        title: "Workspace",
        repositoryIdentity: null,
      }),
    ).toBe("Workspace");
    expect(resolveWorkbenchSidebarRepositoryLabel(null)).toBeNull();
  });
});
