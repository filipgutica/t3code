import { render } from "../../test/render";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type ScopedThreadRef,
  type WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
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
  projects: [{ id: WorkbenchProjectId.make("workspace"), archivedAt: null as string | null }],
  tickets: [] as {
    id: WorkbenchTicketId;
    projectId: WorkbenchProjectId;
    archivedAt: string | null;
  }[],
  assignments: [] as WorkbenchAssignment[],
};
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.ready ? snapshot : null }),
}));
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: () => null } }));
vi.mock("./WorkbenchAttentionQueries", () => ({ WorkbenchAttentionQueries: () => null }));
vi.mock("../state/threads", () => ({ environmentThreadDetails: {} }));
it("preserves an in-progress draft when attention inspection becomes ready or leaves Workbench", async () => {
  state.ready = false;
  state.active = true;
  state.route = null;
  shells.length = 0;
  snapshot.projects[0]!.archivedAt = null;
  snapshot.tickets.length = 0;
  snapshot.assignments.length = 0;
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
  // Navigation hooks are mocked; exercise provider remount behavior without a second router.
  await using screen = await render(page(), { router: false });
  await screen.getByRole("textbox", { name: "Draft" }).fill("Keep my description");
  state.ready = true;
  await screen.rerender(page());
  await expect
    .element(screen.getByRole("textbox", { name: "Draft" }))
    .toHaveValue("Keep my description");
  state.active = false;
  await screen.rerender(page());
  await expect
    .element(screen.getByRole("textbox", { name: "Draft" }))
    .toHaveValue("Keep my description");
});
