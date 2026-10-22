import { describe, expect, it } from "vite-plus/test";

import { getDesktopUpdateReleaseUrl } from "../../components/desktopUpdate.logic";

describe("desktop update UI helpers", () => {
  it.each([
    ["0.0.30", "https://github.com/filipgutica/t3code/releases/tag/workbench-v0.0.30"],
  ] as const)("links the downloaded release %s", (version, workbenchUrl) => {
    expect(
      getDesktopUpdateReleaseUrl(version, {
        releaseUrl: () => workbenchUrl,
        historyUrl: "https://product.example/releases",
      }),
    ).toBe(workbenchUrl);
  });
});
