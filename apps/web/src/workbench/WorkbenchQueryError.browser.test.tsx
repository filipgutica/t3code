import { RegistryContext } from "@effect/atom-react";
import type { WorkbenchSnapshot } from "@t3tools/contracts";
import { type ButtonHTMLAttributes } from "react";
import { act, render } from "../../test/render";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
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
it("recognizes a real string RPC defect while keeping a transient error retryable", async () => {
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
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
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  const text = () => screen.container.textContent;
  expect(text()).toContain("Workbench is unavailable on this environment");
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);

  response = Effect.die(new Error("The connection timed out."));
  await act(async () => {
    registry.refresh(atom);
  });
  expect(text()).toContain("The connection timed out.");
  expect(text()).not.toContain("Workbench is unavailable on this environment");
  response = Effect.succeed(snapshot);
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("Workbench ready")).toBeVisible();
  expect(text()).toContain("Workbench ready");
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});
