import { act, render as renderUI, type Screen } from "../../test/render";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vite-plus/test";
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
  status: {
    readonly id: string;
    readonly name: string;
  },
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
function setup() {
  const resources = new AsyncDisposableStack();
  let result: HookResult | undefined;
  let renderer: Screen | undefined;
  function Probe(options: UseOptimisticWorkbenchStatusOptions) {
    const value = useOptimisticWorkbenchStatus(options);
    useLayoutEffect(() => {
      result = value;
    });
    return null;
  }
  const render = async (options: UseOptimisticWorkbenchStatusOptions) => {
    if (renderer) await renderer.rerender(<Probe {...options} />);
    else renderer = resources.use(await renderUI(<Probe {...options} />));
    if (!result) throw new Error("Hook did not render");
    return result;
  };
  const begin = async (input: Parameters<HookResult["begin"]>[0]) => {
    let token: ReturnType<HookResult["begin"]> = false;
    await act(() => {
      token = result!.begin(input);
    });
    if (typeof token !== "symbol") throw new Error("Expected a status token");
    return token;
  };
  result = undefined;
  return {
    get result() {
      return result;
    },
    get renderer() {
      return renderer;
    },
    render,
    begin,
    async [Symbol.asyncDispose]() {
      await resources.disposeAsync();
    },
  };
}
describe("useOptimisticWorkbenchStatus", () => {
  it("moves immediately, blocks only that ticket, and retains local status until its snapshot arrives", async () => {
    await using fixture = setup();
    const tickets = [makeTicket(ticketAId), makeTicket(ticketBId)];
    await fixture.render({ environmentId: environmentA, tickets, issueLinks: [] });
    const token = await fixture.begin({ ticketId: ticketAId, status: "in_progress" });
    expect(fixture.result?.tickets[0]?.status).toBe("in_progress");
    expect(fixture.result?.begin({ ticketId: ticketAId, status: "done" })).toBe(false);
    await fixture.begin({ ticketId: ticketBId, status: "done" });
    expect(fixture.result?.pendingTicketIds).toEqual(new Set([ticketAId, ticketBId]));
    await act(() => fixture.result?.succeed({ token, revision: 2 }));
    expect(fixture.result?.tickets.map((ticket) => ticket.status)).toEqual(["in_progress", "done"]);
    await fixture.render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "in_progress", 2), tickets[1]!],
      issueLinks: [],
    });
    expect(fixture.result?.pendingTicketIds).toEqual(new Set([ticketBId]));
  });
  it.each(["link first", "ticket first"])(
    "waits for both Jira projections with %s",
    async (order) => {
      await using fixture = setup();
      const ticket = makeTicket(ticketAId);
      const link = makeLink(ticketAId);
      const savedIssue = makeIssue({ id: "doing", name: "In Progress" }, secondRemoteUpdatedAt);
      const savedTicket = makeTicket(ticketAId, "in_progress", 3);
      const savedLink = makeLink(ticketAId, savedIssue);
      await fixture.render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
      const token = await fixture.begin({
        ticketId: ticketAId,
        status: "in_progress",
        jiraStatus: savedIssue.status,
      });
      expect(fixture.result?.issueLinks[0]?.issue.status).toEqual(savedIssue.status);
      await act(() =>
        fixture.result?.succeed({ token, jiraIssue: savedIssue, status: "in_progress" }),
      );
      await fixture.render({
        environmentId: environmentA,
        tickets: [
          order === "ticket first"
            ? savedTicket
            : { ...ticket, revision: 2, title: "Unrelated edit" },
        ],
        issueLinks: [order === "link first" ? savedLink : link],
      });
      expect(fixture.result?.tickets[0]?.status).toBe("in_progress");
      expect(fixture.result?.pendingTicketIds.has(ticketAId)).toBe(true);
      await fixture.render({
        environmentId: environmentA,
        tickets: [savedTicket],
        issueLinks: [savedLink],
      });
      expect(fixture.result?.pendingTicketIds.size).toBe(0);
      expect(fixture.result?.tickets).toEqual([savedTicket]);
    },
  );
  it("rolls back to the latest snapshot on failure", async () => {
    await using fixture = setup();
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await fixture.render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    const token = await fixture.begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    const latestTicket = { ...ticket, title: "Updated while saving", revision: 2 };
    const latestLink = { ...link, issue: { ...link.issue, rank: 4 } };
    await fixture.render({
      environmentId: environmentA,
      tickets: [latestTicket],
      issueLinks: [latestLink],
    });
    expect(fixture.result?.tickets[0]?.status).toBe("done");
    await act(() => fixture.result?.fail(token));
    expect(fixture.result?.tickets).toEqual([latestTicket]);
    expect(fixture.result?.issueLinks).toEqual([latestLink]);
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
  });
  it("isolates environments and ignores late completions", async () => {
    await using fixture = setup();
    const ticket = makeTicket(ticketAId);
    await fixture.render({ environmentId: environmentA, tickets: [ticket], issueLinks: [] });
    const oldToken = await fixture.begin({ ticketId: ticketAId, status: "in_progress" });
    await fixture.render({ environmentId: environmentB, tickets: [ticket], issueLinks: [] });
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
    await fixture.begin({ ticketId: ticketAId, status: "done" });
    await act(() => {
      fixture.result?.succeed({ token: oldToken, revision: 2 });
      fixture.result?.fail(oldToken);
    });
    expect(fixture.result?.tickets[0]?.status).toBe("done");
    expect(fixture.result?.pendingTicketIds.has(ticketAId)).toBe(true);
  });
  it("accepts parsed equal timestamps and a newer authoritative status", async () => {
    await using fixture = setup();
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await fixture.render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    const token = await fixture.begin({
      ticketId: ticketAId,
      status: "in_progress",
      jiraStatus: { id: "doing", name: "In Progress" },
    });
    await act(() =>
      fixture.result?.succeed({
        token,
        status: "in_progress",
        jiraIssue: makeIssue({ id: "doing", name: "In Progress" }, "2026-09-11T15:00:00.000Z"),
      }),
    );
    await fixture.render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "in_progress", 2)],
      issueLinks: [
        makeLink(
          ticketAId,
          makeIssue({ id: "doing", name: "In Progress" }, "2026-09-11T10:00:00-05:00"),
        ),
      ],
    });
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
    const next = await fixture.begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    await act(() =>
      fixture.result?.succeed({
        token: next,
        status: "done",
        jiraIssue: makeIssue({ id: "closed", name: "Closed" }, "2026-09-11T15:01:00Z"),
      }),
    );
    await fixture.render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "todo", 4)],
      issueLinks: [
        makeLink(ticketAId, makeIssue({ id: "todo", name: "To Do" }, "2026-09-11T15:02:00Z")),
      ],
    });
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
    expect(fixture.result?.tickets[0]?.status).toBe("todo");
  });
  it("does not resurrect an operation after an environment round trip", async () => {
    await using fixture = setup();
    const ticket = makeTicket(ticketAId);
    const options = { environmentId: environmentA, tickets: [ticket], issueLinks: [] };
    await fixture.render(options);
    const token = await fixture.begin({ ticketId: ticketAId, status: "done" });
    await fixture.render({ ...options, environmentId: environmentB });
    await fixture.render(options);
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
    expect(fixture.result?.tickets[0]?.status).toBe("todo");
    await act(() => fixture.result?.succeed({ token, revision: 2 }));
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
  });
  it("clears removed tickets and inactive Jira links", async () => {
    await using fixture = setup();
    const ticket = makeTicket(ticketAId);
    const link = makeLink(ticketAId);
    await fixture.render({ environmentId: environmentA, tickets: [ticket], issueLinks: [link] });
    await fixture.begin({
      ticketId: ticketAId,
      status: "done",
      jiraStatus: { id: "closed", name: "Closed" },
    });
    await fixture.render({
      environmentId: environmentA,
      tickets: [ticket],
      issueLinks: [{ ...link, active: false }],
    });
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
    await fixture.begin({ ticketId: ticketAId, status: "done" });
    await fixture.render({ environmentId: environmentA, tickets: [], issueLinks: [] });
    expect(fixture.result?.pendingTicketIds.size).toBe(0);
  });
});
