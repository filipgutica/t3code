import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type ThreadLinkedPullRequest } from "@t3tools/contracts";

import {
  getWorkbenchTicketPullRequests,
  mergeWorkbenchTicketPullRequests,
  type WorkbenchPullRequestThread,
} from "./workbenchPullRequests.logic";

describe("Jira search and Thread PR references", () => {
  it("retains checkout PRs without a Jira match and deduplicates them with search results", () => {
    const checkout = { ...pullRequest(1), title: "Local branch PR", state: "open" as const };
    expect(
      mergeWorkbenchTicketPullRequests({
        threadPullRequests: [],
        checkoutPullRequests: [checkout],
        matches: [],
      }),
    ).toEqual([{ pullRequest: checkout, threadTitle: null, matchesTicket: false }]);
    const match = { ...checkout, state: "merged" as const };
    expect(
      mergeWorkbenchTicketPullRequests({
        threadPullRequests: [],
        checkoutPullRequests: [checkout],
        matches: [match],
      }),
    ).toEqual([{ pullRequest: match, threadTitle: null, matchesTicket: true }]);
  });
  it("includes merged matches from other branches and enriches duplicate Thread references", () => {
    const reference = {
      threadId: ThreadId.make("thread"),
      threadTitle: "Ticket work",
      pullRequest: pullRequest(3800, "Kong/public-ui-components"),
    };
    const matched = {
      ...pullRequest(3800, "kong/public-ui-components"),
      title: "Fix headers [MA-5439]",
      state: "merged" as const,
    };
    expect(
      mergeWorkbenchTicketPullRequests({
        threadPullRequests: [reference],
        matches: [matched, { ...pullRequest(13803, "Kong/konnect-ui-apps"), state: "merged" }],
      }),
    ).toEqual([
      { pullRequest: matched, threadTitle: "Ticket work", matchesTicket: true },
      {
        pullRequest: { ...pullRequest(13803, "Kong/konnect-ui-apps"), state: "merged" },
        threadTitle: null,
        matchesTicket: true,
      },
    ]);
  });

  it("keeps Thread references when search has no matches and separates hosts", () => {
    const reference = {
      threadId: ThreadId.make("thread"),
      threadTitle: "Work",
      pullRequest: pullRequest(1),
    };
    const enterprise = { ...pullRequest(1), url: "https://git.example.com/acme/repo/pull/1" };
    expect(
      mergeWorkbenchTicketPullRequests({ threadPullRequests: [reference], matches: [] }),
    ).toEqual([{ pullRequest: reference.pullRequest, threadTitle: "Work", matchesTicket: false }]);
    expect(
      mergeWorkbenchTicketPullRequests({ threadPullRequests: [reference], matches: [enterprise] }),
    ).toHaveLength(2);
  });
});

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
