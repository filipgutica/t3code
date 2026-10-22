import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  WorkbenchJiraBindingId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraIssueLink,
} from "@t3tools/contracts";
import { useWorkbenchSidebarTicketActionMenu } from "./useWorkbenchSidebarTicketActionMenu";
import {
  peekWorkbenchSidebarTicketAction,
  takeWorkbenchSidebarTicketAction,
} from "./workbenchSidebarTicketAction";

const mocks = vi.hoisted(() => ({
  grants: new Map<string, boolean>(),
  navigate: vi.fn(),
  showMenu: vi.fn(),
  query: vi.fn(),
  getCached: vi.fn(),
  transitionsQuery: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (environmentId: string | null) =>
    environmentId !== null && mocks.grants.get(environmentId) === true,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ buildLocation: () => ({ href: "/workbench" }) }),
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: (...args: unknown[]) => mocks.query(...args),
}));
vi.mock("../components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("../hooks/useCopyToClipboard", () => ({ writeTextToClipboard: vi.fn() }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: mocks.getCached } }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: mocks.showMenu } }),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (environmentId: string) => mocks.grants.get(environmentId) === true,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    updateTicket: { permissionAtom: (environmentId: string | null) => environmentId },
    jiraGetTicketTransitions: (target: unknown) => mocks.transitionsQuery(target),
  },
}));

const environmentId = EnvironmentId.make("destination");
const ticket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Fix the retry flow",
  status: "todo" as const,
  archivedAt: null,
  updatedAt: "2026-10-16T00:00:00.000Z",
};
const issueLink: WorkbenchJiraIssueLink = {
  bindingId: WorkbenchJiraBindingId.make("binding"),
  ticketId: ticket.id,
  issue: {
    issueId: "10001",
    key: "WB-1",
    url: "https://example.atlassian.net/browse/WB-1",
    summary: ticket.title,
    issueType: { id: "story", name: "Story" },
    status: { id: "todo", name: "To Do" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: ticket.updatedAt,
  },
  active: true,
  linkedAt: ticket.updatedAt,
  lastSeenAt: ticket.updatedAt,
};
const transition = {
  id: "review",
  name: "Request review",
  to: { id: "in-review", name: "In Review" },
  unavailableReason: null,
};
const input = {
  environmentId,
  ticket,
  issueLink: null,
  jiraOwnershipKnown: true,
  readOnly: false,
};
let actions: ReturnType<typeof useWorkbenchSidebarTicketActionMenu>;
let renderer: ReactTestRenderer | undefined;
function Harness({ value }: { value: Parameters<typeof useWorkbenchSidebarTicketActionMenu>[0] }) {
  const current = useWorkbenchSidebarTicketActionMenu(value);
  useEffect(() => {
    actions = current;
  }, [current]);
  return null;
}
async function render(value: Parameters<typeof useWorkbenchSidebarTicketActionMenu>[0] = input) {
  await act(async () => {
    renderer = create(<Harness value={value} />);
  });
}
const position = { x: 20, y: 40 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.clear();
  mocks.grants.set(environmentId, true);
  mocks.navigate.mockResolvedValue(undefined);
  mocks.showMenu.mockResolvedValue(null);
  mocks.getCached.mockReturnValue({ _tag: "Initial" });
  mocks.transitionsQuery.mockImplementation((target) => target);
  mocks.query.mockResolvedValue({
    _tag: "Success",
    value: { remoteUpdatedAt: "2026-10-16T01:00:00.000Z", transitions: [transition] },
  });
  takeWorkbenchSidebarTicketAction(environmentId, ticket.id);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  takeWorkbenchSidebarTicketAction(environmentId, ticket.id);
});

describe("Workbench sidebar Ticket actions", () => {
  it("opens the existing New Thread route with the destination Ticket queued", async () => {
    await render();
    await act(async () => actions.newThread(position));
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toEqual({
      environmentId,
      ticketId: ticket.id,
      kind: "new-thread",
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/workbench",
      search: { environmentId, workbenchProjectId: ticket.projectId, ticketId: ticket.id },
      replace: true,
    });
    expect(mocks.showMenu).not.toHaveBeenCalled();
  });

  it.each([
    { from: "todo", to: "done" },
    { from: "done", to: "todo" },
  ] as const)("moves a local Ticket from $from to $to", async ({ from, to }) => {
    await render({ ...input, ticket: { ...ticket, status: from } });
    mocks.showMenu.mockResolvedValueOnce(`status:${to}`);
    await act(async () => actions.openMenu(position));
    expect(mocks.showMenu.mock.calls[0]?.[0]).toContainEqual(
      expect.objectContaining({
        id: "change-status",
        children: expect.arrayContaining([expect.objectContaining({ id: `status:${to}` })]),
      }),
    );
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toMatchObject({
      kind: "status",
      status: to,
    });
  });

  it.each([
    { readOnly: true },
    { ticket: { ...ticket, archivedAt: ticket.updatedAt } },
    { environmentId: null },
  ])("keeps quick actions unavailable for an ineligible Ticket: %j", async (overrides) => {
    await render({ ...input, ...overrides });
    expect(actions.canCreateThread).toBe(false);
    await act(async () => {
      actions.newThread(position);
    });
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("rechecks destination permission when a previously visible quick action is used", async () => {
    await render();
    expect(actions.canCreateThread).toBe(true);
    mocks.grants.set(environmentId, false);
    mocks.grants.set("other-environment", true);
    await act(async () => {
      actions.newThread(position);
    });
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("prefetches Jira transitions through the shared revision query without forcing a refresh", async () => {
    await render({ ...input, issueLink });
    await act(async () => actions.prefetchTransitions());
    const target = {
      environmentId,
      input: { ticketId: ticket.id, remoteUpdatedAt: issueLink.issue.remoteUpdatedAt },
    };
    expect(mocks.transitionsQuery).toHaveBeenCalledWith(target);
    expect(mocks.query).toHaveBeenCalledWith(expect.anything(), target, {
      reportFailure: false,
      reportDefect: false,
    });
    expect(mocks.showMenu).not.toHaveBeenCalled();
  });

  it.each([
    { issueLink: null },
    { readOnly: true },
    { ticket: { ...ticket, archivedAt: ticket.updatedAt } },
    { environmentId: null },
  ])("does not prefetch transitions for an ineligible Ticket: %j", async (overrides) => {
    await render({ ...input, issueLink, ...overrides });
    await act(async () => actions.prefetchTransitions());
    expect(mocks.transitionsQuery).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rechecks permission before prefetching transitions", async () => {
    await render({ ...input, issueLink });
    mocks.grants.set(environmentId, false);
    await act(async () => actions.prefetchTransitions());
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("shows cached Jira transitions in the first menu and queues the chosen transition with its cached revision", async () => {
    const cachedRevision = "2026-10-16T02:00:00.000Z";
    const blocked = {
      id: "blocked",
      name: "Done",
      to: { id: "done", name: "Done" },
      unavailableReason: "A required field is missing",
    };
    mocks.getCached.mockReturnValue({
      _tag: "Success",
      value: { remoteUpdatedAt: cachedRevision, transitions: [transition, blocked] },
    });
    mocks.showMenu.mockResolvedValueOnce("jira-transition:review");
    await render({ ...input, issueLink });
    await act(async () => actions.openMenu(position));
    expect(mocks.transitionsQuery).toHaveBeenCalledWith({
      environmentId,
      input: { ticketId: ticket.id, remoteUpdatedAt: issueLink.issue.remoteUpdatedAt },
    });
    expect(mocks.showMenu).toHaveBeenCalledTimes(1);
    expect(mocks.showMenu.mock.calls[0]?.[0]).toContainEqual({
      id: "change-status",
      label: "Change status",
      disabled: false,
      children: [
        { id: "jira-transition:review", label: "In Review · Request review", disabled: false },
        { id: "jira-transition:blocked", label: "Done", disabled: true },
      ],
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toEqual({
      environmentId,
      ticketId: ticket.id,
      kind: "jira-transition",
      transitionId: "review",
      destination: transition.to,
      expectedRemoteUpdatedAt: cachedRevision,
    });
  });

  it.each([
    {
      result: { remoteUpdatedAt: null, transitions: [transition] },
      label: "Refresh Jira before changing status",
    },
    {
      result: { remoteUpdatedAt: ticket.updatedAt, transitions: [] },
      label: "No transitions available",
    },
    {
      result: {
        remoteUpdatedAt: ticket.updatedAt,
        transitions: [{ ...transition, unavailableReason: "Missing required field" }],
      },
      label: "No transitions available",
    },
  ])("shows a disabled child for a cached result: $label", async ({ result, label }) => {
    mocks.getCached.mockReturnValue({ _tag: "Success", value: result });
    await render({ ...input, issueLink });
    await act(async () => actions.openMenu(position));
    expect(mocks.showMenu.mock.calls[0]?.[0]).toContainEqual({
      id: "change-status",
      label: "Change status",
      disabled: false,
      children: [{ id: "jira-transition:unavailable", label, disabled: true }],
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["blocked", "missing"])(
    "does not queue an unavailable or unknown cached Jira transition: %s",
    async (transitionId) => {
      mocks.getCached.mockReturnValue({
        _tag: "Success",
        value: {
          remoteUpdatedAt: ticket.updatedAt,
          transitions: [
            transition,
            { ...transition, id: "blocked", unavailableReason: "Missing required field" },
          ],
        },
      });
      mocks.showMenu.mockResolvedValueOnce(`jira-transition:${transitionId}`);
      await render({ ...input, issueLink });
      await act(async () => actions.openMenu(position));
      expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      result: { remoteUpdatedAt: null, transitions: [transition] },
      label: "Refresh Jira before changing status",
    },
    {
      result: { remoteUpdatedAt: ticket.updatedAt, transitions: [] },
      label: "No transitions available",
    },
  ])("preserves the fallback message: $label", async ({ result, label }) => {
    mocks.query.mockResolvedValueOnce({ _tag: "Success", value: result });
    mocks.showMenu.mockResolvedValueOnce("change-status");
    await render({ ...input, issueLink });
    await act(async () => actions.openMenu(position));
    expect(mocks.showMenu).toHaveBeenNthCalledWith(
      2,
      [{ id: "unavailable", label, disabled: true }],
      position,
    );
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
  });

  it.each([
    { cached: { _tag: "Initial" }, remoteUpdatedAt: ticket.updatedAt },
    { cached: { _tag: "Failure" }, remoteUpdatedAt: ticket.updatedAt },
    {
      cached: {
        _tag: "Success",
        value: { remoteUpdatedAt: ticket.updatedAt, transitions: [transition] },
      },
      remoteUpdatedAt: null,
    },
  ])(
    "falls back to a second Jira menu when cached transitions cannot be used: %j",
    async ({ cached, remoteUpdatedAt }) => {
      mocks.getCached.mockReturnValue(cached);
      let choose: (id: string | null) => void = () => undefined;
      mocks.showMenu.mockResolvedValueOnce("change-status").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          }),
      );
      await render({
        ...input,
        issueLink: { ...issueLink, issue: { ...issueLink.issue, remoteUpdatedAt } },
      });
      await act(async () => actions.openMenu(position));
      expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
      expect(mocks.showMenu.mock.calls[0]?.[0]).toContainEqual({
        id: "change-status",
        label: "Change status",
        disabled: false,
      });
      expect(mocks.query).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        refresh: true,
        reportFailure: false,
        reportDefect: false,
      });
      expect(mocks.showMenu).toHaveBeenNthCalledWith(
        2,
        [{ id: "review", label: "In Review · Request review", disabled: false }],
        position,
      );
      await act(async () => choose("review"));
      expect(peekWorkbenchSidebarTicketAction(environmentId)).toEqual({
        environmentId,
        ticketId: ticket.id,
        kind: "jira-transition",
        transitionId: "review",
        destination: transition.to,
        expectedRemoteUpdatedAt: "2026-10-16T01:00:00.000Z",
      });
    },
  );

  it.each([false, true])(
    "does not queue a Jira transition when permission is revoked while its chooser is open (cached: %s)",
    async (cached) => {
      let choose: (id: string | null) => void = () => undefined;
      if (cached) {
        mocks.getCached.mockReturnValue({
          _tag: "Success",
          value: { remoteUpdatedAt: ticket.updatedAt, transitions: [transition] },
        });
      } else {
        mocks.showMenu.mockResolvedValueOnce("change-status");
      }
      mocks.showMenu.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          }),
      );
      await render({ ...input, issueLink });
      await act(async () => actions.openMenu(position));
      mocks.grants.set(environmentId, false);
      await act(async () => choose(cached ? "jira-transition:review" : "review"));
      expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );
});
