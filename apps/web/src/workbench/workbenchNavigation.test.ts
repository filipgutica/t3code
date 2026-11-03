import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { shouldShowWorkbenchSidebar, withWorkbenchEnvironmentSearch } from "./workbenchNavigation";

describe("Workbench navigation context", () => {
  it("retains the selected environment when routing back to Workbench", () => {
    const environmentId = EnvironmentId.make("remote-environment");
    expect(withWorkbenchEnvironmentSearch(environmentId, { projectId: "workspace" })).toEqual({
      environmentId,
      projectId: "workspace",
    });
    expect(withWorkbenchEnvironmentSearch(null, { projectId: "workspace" })).toEqual({
      projectId: "workspace",
    });
  });

  it("keeps Thread pages on the native sidebar", () => {
    expect(shouldShowWorkbenchSidebar("/workbench")).toBe(true);
    expect(shouldShowWorkbenchSidebar("/env/thread")).toBe(false);
    expect(shouldShowWorkbenchSidebar("/")).toBe(false);
  });
});
