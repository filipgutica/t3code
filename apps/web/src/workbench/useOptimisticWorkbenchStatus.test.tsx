import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchTicket,
} from "@t3tools/contracts";

import {
  useOptimisticWorkbenchStatus,
  type UseOptimisticWorkbenchStatusOptions,
} from "./useOptimisticWorkbenchStatus";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectId = WorkbenchProjectId.make("project-1");
const repositoryId = ProjectId.make("repository-1");
const ticketAId = WorkbenchTicketId.make("ticket-a");
const ticketBId = WorkbenchTicketId.make("ticket-b");
const initialUpdatedAt = "2026-09-11T12:00:00.000Z";
const firstRemoteUpdatedAt = "2026-09-11T12:01:00.000Z";
const secondRemoteUpdatedAt = "2026-09-11T12:02:00.000Z";

const makeTicket = (
  id: WorkbenchTicket["id"],
  status: WorkbenchTicket["status"] = "todo",
  revision = 1,
): WorkbenchTicket => ({
  id,
  projectId,
  epicId: null,
  title: id,
  kind: "story",
  markdown: "",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [],
  status,
  blocked: false,
  revision,
  createdAt: initialUpdatedAt,
  updatedAt: initialUpdatedAt,
});

const makeIssue = (
  status: { readonly id: string; readonly name: string },
  remoteUpdatedAt: string | null = firstRemoteUpdatedAt,
  rank = 1,
): WorkbenchJiraIssueSnapshot => ({
  issueId: "10001",
  key: "WB-1",
  url: "https://example.atlassian.net/browse/WB-1",
  summary: "Ticket A",
  issueType: { id: "story", name: "Story" },
  status,
  epic: null,
  flagged: false,
  rank,
  remoteUpdatedAt,
});

const makeLink = (
  ticketId: WorkbenchTicket["id"],
  issue: WorkbenchJiraIssueSnapshot = makeIssue({ id: "todo", name: "To Do" }),
  active = true,
): WorkbenchJiraIssueLink => ({
  bindingId: WorkbenchJiraBindingId.make("binding-1"),
  ticketId,
  issue,
  active,
  linkedAt: initialUpdatedAt,
  lastSeenAt: initialUpdatedAt,
});

type HookResult = ReturnType<typeof useOptimisticWorkbenchStatus>;

let result: HookResult | undefined;
let renderer: ReactTestRenderer | undefined;

function Probe(options: UseOptimisticWorkbenchStatusOptions) {
  const value = useOptimisticWorkbenchStatus(options);
  useLayoutEffect(() => {
    result = value;
  });
  return null;
}

const render = async (options: UseOptimisticWorkbenchStatusOptions) => {
  await act(() => {
    if (renderer) renderer.update(<Probe {...options} />);
    else renderer = create(<Probe {...options} />);
  });
  if (!result) throw new Error("Hook did not render");
  return result;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  result = undefined;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const begin = async (input: Parameters<HookResult["begin"]>[0]) => {
  let token: ReturnType<HookResult["begin"]> = false;
  await act(() => {
    token = result!.begin(input);
  });
  if (typeof token !== "symbol") throw new Error("Expected a status token");
  return token;
};

describe("useOptimisticWorkbenchStatus", () => {
  it("moves immediately, blocks only that ticket, and retains local status until its snapshot arrives", async () => {
    const tickets = [makeTicket(ticketAId), makeTicket(ticketBId)];
    await render({ environmentId: environmentA, tickets, issueLinks: [] });
    const token = await begin({ ticketId: ticketAId, status: "in_progress" });
    expect(result?.tickets[0]?.status).toBe("in_progress");
    expect(result?.begin({ ticketId: ticketAId, status: "done" })).toBe(false);
    await begin({ ticketId: ticketBId, status: "done" });
    expect(result?.pendingTicketIds).toEqual(new Set([ticketAId, ticketBId]));
    await act(() => result?.succeed({ token, revision: 2 }));
    expect(result?.tickets.map((ticket) => ticket.status)).toEqual(["in_progress", "done"]);
    await render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "in_progress", 2), tickets[1]!],
      issueLinks: [],
    });
    expect(result?.pendingTicketIds).toEqual(new Set([ticketBId]));
  });

  it.each(["link first", "ticket first"])(
    "waits for both Jira projections with %s",
    async (order) => {
      const ticket = makeTicket(ticketAId);
      const link = makeLink(ticketAId);
      const savedIssue = makeIssue({ id: "doing", name: "In Progress" }, secondRemoteUpdatedAt);
      const savedTicket = makeTicket(ticketAId, "in_progress", 3);
      const savedLink = makeLink(ticketAId, savedIssue);
      await render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
      const token = await begin({
        ticketId: ticketAId,
        status: "in_progress",
        jiraStatus: savedIssue.status,
      });
      expect(result?.issueLinks[0]?.issue.status).toEqual(savedIssue.status);
      await act(() => result?.succeed({ token, jiraIssue: savedIssue, status: "in_progress" }));
      await render({
        environmentId: environmentA,
        tickets: [
          order === "ticket first"
            ? savedTicket
            : { ...ticket, revision: 2, title: "Unrelated edit" },
        ],
        issueLinks: [order === "link first" ? savedLink : link],
      });
      expect(result?.tickets[0]?.status).toBe("in_progress");
      expect(result?.pendingTicketIds.has(ticketAId)).toBe(true);
      await render({
        environmentId: environmentA,
        tickets: [savedTicket],
        issueLinks: [savedLink],
      });
      expect(result?.pendingTicketIds.size).toBe(0);
      expect(result?.tickets).toEqual([savedTicket]);
    },
  );

  it("rolls back to the latest snapshot on failure", async () => {
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    const token = await begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    const latestTicket = { ...ticket, title: "Updated while saving", revision: 2 };
    const latestLink = { ...link, issue: { ...link.issue, rank: 4 } };
    await render({
      environmentId: environmentA,
      tickets: [latestTicket],
      issueLinks: [latestLink],
    });
    expect(result?.tickets[0]?.status).toBe("done");
    await act(() => result?.fail(token));
    expect(result?.tickets).toEqual([latestTicket]);
    expect(result?.issueLinks).toEqual([latestLink]);
    expect(result?.pendingTicketIds.size).toBe(0);
  });

  it("isolates environments and ignores late completions", async () => {
    const ticket = makeTicket(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket], issueLinks: [] });
    const oldToken = await begin({ ticketId: ticketAId, status: "in_progress" });
    await render({ environmentId: environmentB, tickets: [ticket], issueLinks: [] });
    expect(result?.pendingTicketIds.size).toBe(0);
    await begin({ ticketId: ticketAId, status: "done" });
    await act(() => {
      result?.succeed({ token: oldToken, revision: 2 });
      result?.fail(oldToken);
    });
    expect(result?.tickets[0]?.status).toBe("done");
    expect(result?.pendingTicketIds.has(ticketAId)).toBe(true);
  });

  it("accepts parsed equal timestamps and a newer authoritative status", async () => {
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    const token = await begin({
      ticketId: ticketAId,
      status: "in_progress",
      jiraStatus: { id: "doing", name: "In Progress" },
    });
    await act(() =>
      result?.succeed({
        token,
        status: "in_progress",
        jiraIssue: makeIssue({ id: "doing", name: "In Progress" }, "2026-09-11T15:00:00.000Z"),
      }),
    );
    await render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "in_progress", 2)],
      issueLinks: [
        makeLink(
          ticketAId,
          makeIssue({ id: "doing", name: "In Progress" }, "2026-09-11T10:00:00-05:00"),
        ),
      ],
    });
    expect(result?.pendingTicketIds.size).toBe(0);
    const next = await begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    await act(() =>
      result?.succeed({
        token: next,
        status: "done",
        jiraIssue: makeIssue({ id: "closed", name: "Closed" }, "2026-09-11T15:01:00Z"),
      }),
    );
    await render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "todo", 4)],
      issueLinks: [
        makeLink(ticketAId, makeIssue({ id: "todo", name: "To Do" }, "2026-09-11T15:02:00Z")),
      ],
    });
    expect(result?.pendingTicketIds.size).toBe(0);
    expect(result?.tickets[0]?.status).toBe("todo");
  });

  it("does not resurrect an operation after an environment round trip", async () => {
    const ticket = makeTicket(ticketAId);
    const options = { environmentId: environmentA, tickets: [ticket], issueLinks: [] };
    await render(options);
    const token = await begin({ ticketId: ticketAId, status: "done" });
    await render({ ...options, environmentId: environmentB });
    await render(options);
    expect(result?.pendingTicketIds.size).toBe(0);
    expect(result?.tickets[0]?.status).toBe("todo");
    await act(() => result?.succeed({ token, revision: 2 }));
    expect(result?.pendingTicketIds.size).toBe(0);
  });

  it("clears removed tickets and inactive Jira links", async () => {
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    await begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    await render({
      environmentId: environmentA,
      tickets: [ticket],
      issueLinks: [{ ...link, active: false }],
    });
    expect(result?.pendingTicketIds.size).toBe(0);
    await begin({ ticketId: ticketAId, status: "done" });
    await render({ environmentId: environmentA, tickets: [], issueLinks: [] });
    expect(result?.pendingTicketIds.size).toBe(0);
  });
});
