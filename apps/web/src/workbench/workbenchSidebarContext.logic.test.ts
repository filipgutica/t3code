import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchJiraBindingId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { getWorkbenchSidebarTicketDetails } from "./workbenchSidebarContext.logic";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("repo");
const ticketId = WorkbenchTicketId.make("ticket");
const threadId = ThreadId.make("thread");
const pr = {
  projectId,
  repository: "acme/repo",
  number: 12,
  url: "https://github.com/acme/repo/pull/12",
};
const ticket = {
  id: ticketId,
  kind: "bug" as const,
  status: "in_progress" as const,
  blocked: true,
  epicId: null,
  repositoryProjectIds: [projectId],
  primaryT3ProjectId: projectId,
};
const thread = {
  id: threadId,
  environmentId,
  projectId,
  title: "Fix bug",
  pullRequests: [],
  linkedPullRequest: pr,
  branchPullRequest: pr,
};

describe("Workbench sidebar ticket context", () => {
  it("uses Jira status and flagged state instead of stale local attention", () => {
    const issueLink = {
      bindingId: WorkbenchJiraBindingId.make("binding"),
      ticketId,
      active: false,
      linkedAt: "2026-09-22T00:00:00.000Z",
      lastSeenAt: "2026-09-22T00:00:00.000Z",
      issue: {
        issueId: "123",
        key: "WB-123",
        url: "https://example.atlassian.net/browse/WB-123",
        summary: "Fix bug",
        issueType: { id: "bug", name: "Bug" },
        status: { id: "review", name: "In Review" },
        epic: null,
        flagged: false,
        rank: 1,
        remoteUpdatedAt: null,
      },
    };
    const inputs = {
      environmentId,
      tickets: [ticket],
      assignments: [],
      threads: [],
      projects: [],
      epics: [],
      issueLinks: [issueLink],
    };
    const details = getWorkbenchSidebarTicketDetails(inputs).get(ticketId);
    expect(details?.statusLabel).toBe("In Review");
    expect(details?.attentionLabel).toBeNull();
    expect(details?.issueLink?.active).toBe(false);
    expect(
      getWorkbenchSidebarTicketDetails({
        ...inputs,
        issueLinks: [{ ...issueLink, issue: { ...issueLink.issue, flagged: true } }],
      }).get(ticketId)?.attentionLabel,
    ).toBe("Jira flagged");
  });

  it("keeps repository and PR context in the selected environment and deduplicates known PRs", () => {
    const details = getWorkbenchSidebarTicketDetails({
      environmentId,
      tickets: [ticket],
      assignments: [
        { ticketId, threadId },
        { ticketId, threadId },
      ],
      threads: [
        thread,
        {
          ...thread,
          environmentId: EnvironmentId.make("remote"),
          linkedPullRequest: { ...pr, number: 99 },
        },
      ],
      projects: [
        { id: projectId, environmentId, title: "Local repo" },
        { id: projectId, environmentId: EnvironmentId.make("remote"), title: "Remote repo" },
      ],
      epics: [],
      issueLinks: [],
    }).get(ticketId);
    expect(details?.repositories).toEqual(["Local repo"]);
    expect(details?.pullRequests.map(({ pullRequest }) => pullRequest.number)).toEqual([12]);
    expect(details?.threadCount).toBe(1);
    expect(details?.attentionLabel).toBe("Blocked");
    expect(details?.statusLabel).toBe("In Progress");
  });

  it("retains ticket context when thread and repository metadata is unavailable", () => {
    const details = getWorkbenchSidebarTicketDetails({
      environmentId,
      tickets: [ticket],
      assignments: [{ ticketId, threadId }],
      threads: [],
      projects: [],
      epics: [],
      issueLinks: [],
    }).get(ticketId);
    expect(details?.pullRequests).toEqual([]);
    expect(details?.repositories).toEqual([]);
    expect(details?.threadCount).toBe(0);
    expect(details?.kind).toBe("bug");
  });
});
