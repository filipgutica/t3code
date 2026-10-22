import { EnvironmentId, ThreadId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  query: { isPending: false, isSuccess: true, data: [] as unknown[] },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => state.query }));
vi.mock("./state", () => ({
  workbenchEnvironment: { ticketPreparations: vi.fn() },
}));
vi.mock("./WorkbenchTicketProposal", () => ({
  WorkbenchTicketProposalHistory: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { WorkbenchThreadPreparationGate } from "./WorkbenchThreadPreparationGate";

const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("planning"),
};
const preparation = {
  threadId: threadRef.threadId,
  draftId: WorkbenchTicketId.make("draft"),
  projectId: WorkbenchProjectId.make("workbench"),
  ticketId: null,
  phase: "draft",
};
function view(ref: typeof threadRef | null = threadRef) {
  return (
    <WorkbenchThreadPreparationGate threadRef={ref}>
      <span>Native conversation</span>
    </WorkbenchThreadPreparationGate>
  );
}
function setup() {
  vi.clearAllMocks();
  state.query = { isPending: false, isSuccess: true, data: [] };
}

it("returns an unsaved preparation link to its owning environment and workspace", async () => {
  setup();
  state.query.data = [preparation];
  await using screen = await render(view());
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workbench",
    search: { environmentId: "remote", workbenchProjectId: "workbench", ticketId: "draft" },
    replace: true,
  });
  await expect.element(screen.locator).toBeEmptyDOMElement();
});

it.each(["planning", "promoting"])(
  "returns a saved %s Thread link to its Ticket",
  async (phase) => {
    setup();
    state.query.data = [{ ...preparation, ticketId: WorkbenchTicketId.make("ticket"), phase }];
    await using _screen = await render(view());
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/workbench",
      search: { environmentId: "remote", workbenchProjectId: "workbench", ticketId: "ticket" },
      replace: true,
    });
  },
);

it("does not redirect using stale preparation data while Start work refreshes", async () => {
  setup();
  state.query = { isPending: true, isSuccess: true, data: [preparation] };
  await using screen = await render(view());
  expect(state.navigate).not.toHaveBeenCalled();
  await expect.element(screen.getByText("Native conversation")).toBeVisible();
  state.query = { isPending: false, isSuccess: true, data: [] };
  await screen.rerender(view());
  expect(state.navigate).not.toHaveBeenCalled();
});

it("keeps ordinary native conversations mounted when a draft becomes a server Thread", async () => {
  setup();
  await using screen = await render(view(null));
  const conversation = screen.getByText("Native conversation").element();
  await screen.rerender(view());
  expect(screen.getByText("Native conversation").element()).toBe(conversation);
  expect(state.navigate).not.toHaveBeenCalled();
});
