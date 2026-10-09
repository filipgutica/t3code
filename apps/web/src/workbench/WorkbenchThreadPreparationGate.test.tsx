import { EnvironmentId, ThreadId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  query: { isPending: false, isSuccess: true, data: [] as unknown[] },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
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
let renderer: ReactTestRenderer | undefined;
async function render(ref: typeof threadRef | null = threadRef) {
  await act(async () => {
    const view = (
      <WorkbenchThreadPreparationGate threadRef={ref}>
        <span>Native conversation</span>
      </WorkbenchThreadPreparationGate>
    );
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.query = { isPending: false, isSuccess: true, data: [] };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("returns an unsaved preparation link to its owning environment and workspace", async () => {
  state.query.data = [preparation];
  await render();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workbench",
    search: { environmentId: "remote", workbenchProjectId: "workbench", ticketId: "draft" },
    replace: true,
  });
  expect(renderer!.toJSON()).toBeNull();
});

it("returns a saved planning Thread link to the ticket", async () => {
  state.query.data = [
    { ...preparation, ticketId: WorkbenchTicketId.make("ticket"), phase: "planning" },
  ];
  await render();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workbench",
    search: { environmentId: "remote", workbenchProjectId: "workbench", ticketId: "ticket" },
    replace: true,
  });
});

it("keeps a partially promoted ticket in the retryable creation view", async () => {
  state.query.data = [
    { ...preparation, ticketId: WorkbenchTicketId.make("ticket"), phase: "promoting" },
  ];
  await render();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workbench",
    search: { environmentId: "remote", workbenchProjectId: "workbench", ticketId: "ticket" },
    replace: true,
  });
});

it("does not redirect using stale preparation data while Start work refreshes", async () => {
  state.query = { isPending: true, isSuccess: true, data: [preparation] };
  await render();
  expect(state.navigate).not.toHaveBeenCalled();
  expect(renderer!.root.findByType("span").children).toEqual(["Native conversation"]);
  state.query = { isPending: false, isSuccess: true, data: [] };
  await render();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("keeps ordinary native conversations mounted when a draft becomes a server Thread", async () => {
  await render(null);
  const conversation = renderer!.root.findByType("span");
  await render();
  expect(renderer!.root.findByType("span")).toBe(conversation);
  expect(state.navigate).not.toHaveBeenCalled();
});
