import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, WorkbenchProjectId } from "@t3tools/contracts";
import { WorkbenchAttentionProvider } from "./WorkbenchAttentionProvider";

const state = vi.hoisted(() => ({ ready: false, active: true }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/workbench" }),
  useSearch: () => ({}),
}));
vi.mock("./useWorkbenchSidebar", () => ({
  useWorkbenchSidebar: () => ({ isOnWorkbench: state.active }),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("local"),
}));
const shells: never[] = [];
vi.mock("../state/entities", () => ({ useThreadShells: () => shells }));
const snapshot = {
  projects: [{ id: WorkbenchProjectId.make("workspace") }],
  tickets: [],
  assignments: [],
};
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.ready ? snapshot : null }),
}));
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: () => null } }));
vi.mock("./WorkbenchAttentionQueries", () => ({ WorkbenchAttentionQueries: () => null }));

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
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
