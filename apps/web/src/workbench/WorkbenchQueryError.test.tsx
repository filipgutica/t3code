import { RegistryContext } from "@effect/atom-react";
import type { WorkbenchSnapshot } from "@t3tools/contracts";
import { act, type ButtonHTMLAttributes } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useEnvironmentQuery } from "../state/query";
import { WorkbenchQueryError } from "./WorkbenchQueryError";

vi.mock("../components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
const snapshot: WorkbenchSnapshot = {
  projects: [],
  tickets: [],
  epics: [],
  assignments: [],
  reservedThreadIds: [],
  ticketWorkspaces: [],
};
let renderer: ReactTestRenderer | undefined;
let registry: AtomRegistry.AtomRegistry;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

it("recognizes a real string RPC defect while keeping a transient error retryable", async () => {
  let response: Effect.Effect<WorkbenchSnapshot> = Effect.die(
    "Unknown request tag: workbench.getSnapshot",
  );
  const atom = Atom.make(Effect.suspend(() => response));
  function Harness() {
    const query = useEnvironmentQuery(atom);
    return query.error ? (
      <WorkbenchQueryError query={query} />
    ) : (
      <p>{query.data ? "Workbench ready" : "Connecting"}</p>
    );
  }
  await act(async () => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <Harness />
      </RegistryContext.Provider>,
    );
  });
  const text = () => JSON.stringify(renderer!.toJSON());
  expect(text()).toContain("Workbench is unavailable on this environment");
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);

  response = Effect.die(new Error("The connection timed out."));
  await act(async () => {
    registry.refresh(atom);
  });
  expect(text()).toContain("The connection timed out.");
  expect(text()).not.toContain("Workbench is unavailable on this environment");
  response = Effect.succeed(snapshot);
  await act(async () => {
    renderer!.root.findByType("button").props.onClick();
  });
  expect(text()).toContain("Workbench ready");
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
});
