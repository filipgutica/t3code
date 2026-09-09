import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type ThreadLinkedPullRequest } from "@t3tools/contracts";

import {
  getWorkbenchTicketPullRequests,
  type WorkbenchPullRequestThread,
} from "./workbenchPullRequests.logic";

const pullRequest = (number: number, repository = "acme/repo"): ThreadLinkedPullRequest => ({
  projectId: ProjectId.make("project-one"),
  repository,
  number,
  url: `https://github.com/${repository}/pull/${number}`,
});

const thread = ({
  id,
  linkedPullRequest,
  branchPullRequest,
}: {
  readonly id: string;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null;
  readonly branchPullRequest?: ThreadLinkedPullRequest | null;
}): WorkbenchPullRequestThread => ({
  id: ThreadId.make(id),
  title: id,
  linkedPullRequest: linkedPullRequest ?? null,
  branchPullRequest: branchPullRequest ?? null,
});

describe("Workbench Ticket pull request references", () => {
  it("deduplicates linked and branch references across live and archived Threads", () => {
    const firstPullRequest = pullRequest(1);
    const secondPullRequest = pullRequest(2);
    const archivedPullRequest = pullRequest(3);
    const liveThread = thread({
      id: "live-thread",
      linkedPullRequest: firstPullRequest,
      branchPullRequest: firstPullRequest,
    });
    const secondThread = thread({
      id: "second-thread",
      branchPullRequest: secondPullRequest,
    });
    const archivedThread = thread({
      id: "archived-thread",
      linkedPullRequest: archivedPullRequest,
    });

    const pullRequests = getWorkbenchTicketPullRequests({
      assignments: [
        { threadId: liveThread.id },
        { threadId: secondThread.id },
        { threadId: archivedThread.id },
        { threadId: ThreadId.make("missing-thread") },
      ],
      threadsById: new Map([
        [liveThread.id, liveThread],
        [secondThread.id, secondThread],
      ]),
      archivedThreadsById: new Map([[archivedThread.id, archivedThread]]),
    });

    expect(pullRequests).toEqual([
      { threadId: liveThread.id, threadTitle: "live-thread", pullRequest: firstPullRequest },
      { threadId: secondThread.id, threadTitle: "second-thread", pullRequest: secondPullRequest },
      {
        threadId: archivedThread.id,
        threadTitle: "archived-thread",
        pullRequest: archivedPullRequest,
      },
    ]);
  });

  it("prefers the live Thread when a stale archived map has the same id", () => {
    const livePullRequest = pullRequest(10);
    const archivedPullRequest = pullRequest(11);
    const liveThread = thread({ id: "same-thread", linkedPullRequest: livePullRequest });
    const archivedThread = thread({ id: "same-thread", linkedPullRequest: archivedPullRequest });

    const pullRequests = getWorkbenchTicketPullRequests({
      assignments: [{ threadId: liveThread.id }],
      threadsById: new Map([[liveThread.id, liveThread]]),
      archivedThreadsById: new Map([[archivedThread.id, archivedThread]]),
    });

    expect(pullRequests).toEqual([
      { threadId: liveThread.id, threadTitle: "same-thread", pullRequest: livePullRequest },
    ]);
  });

  it("keeps same-number pull requests from different repositories", () => {
    const upstreamPullRequest = pullRequest(12, "acme/upstream");
    const forkPullRequest = pullRequest(12, "acme/fork");
    const upstreamThread = thread({
      id: "upstream-thread",
      linkedPullRequest: upstreamPullRequest,
    });
    const forkThread = thread({ id: "fork-thread", linkedPullRequest: forkPullRequest });

    const pullRequests = getWorkbenchTicketPullRequests({
      assignments: [{ threadId: upstreamThread.id }, { threadId: forkThread.id }],
      threadsById: new Map([
        [upstreamThread.id, upstreamThread],
        [forkThread.id, forkThread],
      ]),
      archivedThreadsById: new Map(),
    });

    expect(pullRequests).toEqual([
      {
        threadId: upstreamThread.id,
        threadTitle: "upstream-thread",
        pullRequest: upstreamPullRequest,
      },
      { threadId: forkThread.id, threadTitle: "fork-thread", pullRequest: forkPullRequest },
    ]);
  });

  it("deduplicates repository names case-insensitively", () => {
    const lowerCasePullRequest = pullRequest(13, "acme/repo");
    const upperCasePullRequest = pullRequest(13, "ACME/REPO");
    const firstThread = thread({ id: "first-thread", linkedPullRequest: lowerCasePullRequest });
    const secondThread = thread({ id: "second-thread", linkedPullRequest: upperCasePullRequest });

    const pullRequests = getWorkbenchTicketPullRequests({
      assignments: [{ threadId: firstThread.id }, { threadId: secondThread.id }],
      threadsById: new Map([
        [firstThread.id, firstThread],
        [secondThread.id, secondThread],
      ]),
      archivedThreadsById: new Map(),
    });

    expect(pullRequests).toEqual([
      { threadId: firstThread.id, threadTitle: "first-thread", pullRequest: lowerCasePullRequest },
    ]);
  });
});
