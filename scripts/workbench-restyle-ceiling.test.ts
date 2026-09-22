import { assert, describe, it } from "@effect/vitest";

import {
  classifyRestyleFindings,
  evaluateRestylePartitions,
  WORKBENCH_INTEGRATION_RESTYLE_CEILING,
  WORKBENCH_RESTYLE_CEILING,
} from "./workbench-restyle-ceiling.ts";

describe("workbench-restyle-ceiling", () => {
  it("keeps Workbench and route integration findings out of the upstream partition", () => {
    assert.deepStrictEqual(
      classifyRestyleFindings({
        diagnostics: [
          { code: "shadcn(no-restyle)", filename: "apps/web/src/components/Button.tsx" },
          { code: "shadcn(no-restyle)", filename: "apps/web/src/workbench/WorkbenchPage.tsx" },
          { code: "shadcn(no-restyle)", filename: "apps/web/src/routes/workbench.tsx" },
          { code: "react(refs)", filename: "apps/web/src/workbench/WorkbenchPage.tsx" },
        ],
      }),
      { upstream: 1, workbench: 1, workbenchIntegration: 1 },
    );
  });

  it("does not let one partition consume another partition's slack", () => {
    assert.isFalse(
      evaluateRestylePartitions({
        upstream: 1206,
        workbench: WORKBENCH_RESTYLE_CEILING + 1,
        workbenchIntegration: 0,
      }).ok,
    );
    assert.isFalse(
      evaluateRestylePartitions({
        upstream: 1208,
        workbench: WORKBENCH_RESTYLE_CEILING,
        workbenchIntegration: 0,
      }).ok,
    );
    assert.isFalse(
      evaluateRestylePartitions({
        upstream: 1207,
        workbench: WORKBENCH_RESTYLE_CEILING,
        workbenchIntegration: WORKBENCH_INTEGRATION_RESTYLE_CEILING + 1,
      }).ok,
    );
  });
});
