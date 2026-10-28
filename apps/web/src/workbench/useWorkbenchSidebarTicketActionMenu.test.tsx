import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { useWorkbenchSidebarTicketActionMenu } from "./useWorkbenchSidebarTicketActionMenu";
import {
  peekWorkbenchSidebarTicketAction,
  takeWorkbenchSidebarTicketAction,
} from "./workbenchSidebarTicketAction";

const mocks = vi.hoisted(() => ({
  grants: new Map<string, boolean>(),
  navigate: vi.fn(),
  showMenu: vi.fn(),
  openExternal: vi.fn(),
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
vi.mock("../components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("../hooks/useCopyToClipboard", () => ({ writeTextToClipboard: vi.fn() }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({
    contextMenu: { show: mocks.showMenu },
    shell: { openExternal: mocks.openExternal },
  }),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (environmentId: string) => mocks.grants.get(environmentId) === true,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    updateTicket: { permissionAtom: (environmentId: string | null) => environmentId },
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
const issue = {
  url: "https://example.atlassian.net/browse/WB-1",
  kind: "jira_issue" as const,
  label: "WB-1",
};
const input = {
  environmentId,
  ticket,
  issue: null,
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
  mocks.openExternal.mockResolvedValue(undefined);
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
    await act(async () => actions.newThread());
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
      actions.newThread();
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
      actions.newThread();
    });
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("treats a linked Ticket as local and opens its first issue Reference", async () => {
    await render({ ...input, issue });
    mocks.showMenu.mockResolvedValueOnce("open-issue");
    await act(async () => actions.openMenu(position));
    const items = mocks.showMenu.mock.calls[0]?.[0];
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "change-status",
        children: expect.arrayContaining([expect.objectContaining({ id: "status:done" })]),
      }),
    );
    expect(items).toContainEqual(expect.objectContaining({ id: "archive" }));
    expect(mocks.openExternal).toHaveBeenCalledWith(issue.url);
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
  });

  it("does not queue a status change when permission is revoked while the menu is open", async () => {
    let choose: (id: string | null) => void = () => undefined;
    mocks.showMenu.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    await render();
    await act(async () => actions.openMenu(position));
    mocks.grants.set(environmentId, false);
    await act(async () => choose("status:done"));
    expect(peekWorkbenchSidebarTicketAction(environmentId)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
