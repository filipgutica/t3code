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
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: mocks.showMenu } }),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (environmentId: string) => mocks.grants.get(environmentId) === true,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    updateTicket: { permissionAtom: (environmentId: string | null) => environmentId },
    jiraGetTicketTransitions: vi.fn(),
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

describe("Workbench sidebar Ticket quick actions", () => {
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
    await act(async () => actions.changeStatus(position));
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
    expect(actions.canChangeStatus).toBe(false);
    await act(async () => {
      actions.newThread(position);
      actions.changeStatus(position);
    });
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("does not treat unknown Jira ownership as a local status change", async () => {
    await render({ ...input, jiraOwnershipKnown: false });
    expect(actions.canChangeStatus).toBe(false);
    await act(async () => actions.changeStatus(position));
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
  });

  it("rechecks destination permission when a previously visible quick action is used", async () => {
    await render();
    expect(actions.canCreateThread).toBe(true);
    mocks.grants.set(environmentId, false);
    mocks.grants.set("other-environment", true);
    await act(async () => {
      actions.newThread(position);
      actions.changeStatus(position);
    });
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("waits for the selected Jira transition and uses its refreshed revision", async () => {
    let choose: (id: string | null) => void = () => undefined;
    mocks.showMenu.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    await render({ ...input, issueLink });
    await act(async () => actions.changeStatus(position));
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.showMenu).toHaveBeenCalledWith(
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
  });

  it("does not queue a Jira transition when permission is revoked while its chooser is open", async () => {
    let choose: (id: string | null) => void = () => undefined;
    mocks.showMenu.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    await render({ ...input, issueLink });
    await act(async () => actions.changeStatus(position));
    mocks.grants.set(environmentId, false);
    await act(async () => choose("review"));
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
