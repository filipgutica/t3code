import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { makeThreadFixture } from "../test-fixtures";
import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  WorkbenchProjectId,
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  RuntimeRequestId,
  WorkbenchTicketId,
  WorkbenchAssignmentId,
  type ScopedThreadRef,
  type WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import { useUiStateStore } from "../uiStateStore";
import { WorkbenchAttentionProvider } from "./WorkbenchAttentionProvider";

const state = vi.hoisted(() => ({
  ready: false,
  active: true,
  route: null as ScopedThreadRef | null,
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/workbench" }),
  useParams: () => state.route,
  useSearch: () => ({}),
}));
vi.mock("./useWorkbenchSidebar", () => ({
  useWorkbenchSidebar: () => ({ isOnWorkbench: state.active }),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("local"),
}));
const shells: EnvironmentThreadShell[] = [];
vi.mock("../state/entities", () => ({ useThreadShells: () => shells }));
const snapshot = {
  projects: [{ id: WorkbenchProjectId.make("workspace") }],
  tickets: [] as { id: WorkbenchTicketId; archivedAt: string | null }[],
  assignments: [] as WorkbenchAssignment[],
};
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.ready ? snapshot : null }),
}));
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: () => null } }));
vi.mock("./WorkbenchAttentionQueries", () => ({ WorkbenchAttentionQueries: () => null }));

const requestAt = "2026-09-29T00:01:00.000Z";
const requests = Atom.make<PendingThreadRequests>({
  approvals: [],
  userInputs: [
    {
      requestId: RuntimeRequestId.make("question"),
      createdAt: requestAt,
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Which option?",
          options: [{ label: "One", description: "First option" }],
          multiSelect: false,
        },
      ],
      responseCapability: "live",
      dismissible: false,
    },
  ],
});
vi.mock("../state/threads", () => ({
  environmentThreadDetails: { pendingRequestsAtom: () => requests },
}));
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.route = null;
  shells.length = 0;
  snapshot.tickets.length = 0;
  snapshot.assignments.length = 0;
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  registry = AtomRegistry.make();
});
afterEach(() => {
  act(() => renderer?.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});

it("preserves an in-progress draft when attention inspection becomes ready or leaves Workbench", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.ready = false;
  state.active = true;
  function Draft() {
    const [value, setValue] = useState("");
    return (
      <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    );
  }
  const page = () => (
    <WorkbenchAttentionProvider>
      <Draft />
    </WorkbenchAttentionProvider>
  );
  act(() => {
    renderer = create(page());
  });
  act(() =>
    renderer.root.findByType("input").props.onChange({ target: { value: "Keep my description" } }),
  );
  state.ready = true;
  act(() => renderer.update(page()));
  expect(renderer.root.findByType("input").props.value).toBe("Keep my description");
  state.active = false;
  act(() => renderer.update(page()));
  expect(renderer.root.findByType("input").props.value).toBe("Keep my description");
});

it("acknowledges a plain native route only after its visible active Ticket assignment is known", async () => {
  const environmentId = EnvironmentId.make("remote");
  const id = ThreadId.make("native-question");
  state.route = scopeThreadRef(environmentId, id);
  state.active = false;
  state.ready = false;
  shells.push(
    makeThreadFixture({
      environmentId,
      id,
      projectId: ProjectId.make("repo"),
      title: "Question",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: requestAt,
      updatedAt: requestAt,
      latestRun: null,
      runtime: null,
      pullRequests: [],
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: true,
      hasActionableProposedPlan: false,
    }),
  );
  const key = scopedThreadKey(state.route);
  const page = () => (
    <RegistryContext.Provider value={registry}>
      <WorkbenchAttentionProvider>
        <span>Native Thread</span>
      </WorkbenchAttentionProvider>
    </RegistryContext.Provider>
  );
  await act(async () => {
    renderer = create(page());
  });
  expect(useUiStateStore.getState().threadLastVisitedAtById[key]).toBeUndefined();
  state.ready = true;
  await act(async () => renderer.update(page()));
  expect(useUiStateStore.getState().threadLastVisitedAtById[key]).toBeUndefined();
  const ticketId = WorkbenchTicketId.make("ticket");
  snapshot.tickets = [{ id: ticketId, archivedAt: null }];
  snapshot.assignments = [
    {
      id: WorkbenchAssignmentId.make("assignment"),
      ticketId,
      threadId: id,
      createdAt: requestAt,
      supersededAt: requestAt,
    },
  ];
  await act(async () => renderer.update(page()));
  expect(useUiStateStore.getState().threadLastVisitedAtById[key]).toBeUndefined();
  snapshot.assignments = snapshot.assignments.map((row) => ({ ...row, supersededAt: null }));
  snapshot.tickets = [{ id: ticketId, archivedAt: requestAt }];
  await act(async () => renderer.update(page()));
  expect(useUiStateStore.getState().threadLastVisitedAtById[key]).toBeUndefined();
  snapshot.tickets = [{ id: ticketId, archivedAt: null }];
  await act(async () => renderer.update(page()));
  expect(useUiStateStore.getState().threadLastVisitedAtById[key]).toBe(requestAt);
});
