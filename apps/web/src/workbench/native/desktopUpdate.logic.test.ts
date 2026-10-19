import { describe, expect, it } from "vite-plus/test";

import {
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
} from "../../components/desktopUpdate.logic";

describe("desktop update UI helpers", () => {
  it.each([
    ["0.0.30", "https://github.com/filipgutica/t3code/releases/tag/workbench-v0.0.30"],
    [
      "0.0.30-nightly.20260728.931",
      "https://github.com/filipgutica/t3code/releases/tag/workbench-daily-v0.0.30-nightly.20260728.931",
    ],
  ] as const)("links the downloaded release %s", (version, workbenchUrl) => {
    expect(
      getDesktopUpdateReleaseUrl(version, {
        releaseUrl: () => workbenchUrl,
        historyUrl: "https://product.example/releases",
      }),
    ).toBe(workbenchUrl);
  });

  it("links release history", () => {
    expect(
      getDesktopUpdateReleaseHistoryUrl({
        releaseUrl: () => "",
        historyUrl: "https://product.example/releases",
      }),
    ).toBe("https://product.example/releases");
  });
});
