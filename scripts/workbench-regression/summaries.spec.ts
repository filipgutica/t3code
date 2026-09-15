// @effect-diagnostics nodeBuiltinImport:off - The test controls the external provider fixture through a private file.
import * as NodeFSP from "node:fs/promises";
import { test, expect } from "./fixtures.ts";
import { providerControlPath, REGRESSION_PROVIDER_SUMMARY } from "./provider-settings.mts";

test("T4: summary generation persists; failed regeneration preserves prior text and retry recovers", async ({
  page,
  demo,
}) => {
  const controlPath = providerControlPath(demo.home);
  const original = await NodeFSP.readFile(controlPath, "utf8");
  // The Board refreshes background summary results every 15 seconds. Allow
  // that refresh plus transport/render time, rather than racing its interval.
  const summaryRefreshTimeout = 20_000;
  try {
    await page.goto("/workbench?workbenchProjectId=orbit&ticketId=orbit-003");
    const summary = page.getByRole("region", { name: "Generated summary", exact: true });
    const generate = page.getByRole("button", {
      name: /^(Generate|Regenerate|Retry).*for Add helpful empty states$/,
    });
    await generate.click();
    await expect(summary.getByText(REGRESSION_PROVIDER_SUMMARY, { exact: true })).toBeVisible();
    await page.reload();
    await expect(summary.getByText(REGRESSION_PROVIDER_SUMMARY, { exact: true })).toBeVisible();
    await NodeFSP.writeFile(
      controlPath,
      JSON.stringify({ turn: { scenario: "success" }, exec: { scenario: "failure" } }),
    );
    await generate.click();
    await expect(
      summary.getByRole("status").filter({ hasText: /^Summary generation failed$/ }),
    ).toBeVisible({ timeout: summaryRefreshTimeout });
    await expect(summary.getByText(REGRESSION_PROVIDER_SUMMARY, { exact: true })).toBeVisible();
    await NodeFSP.writeFile(
      controlPath,
      JSON.stringify({
        turn: { scenario: "success" },
        exec: { scenario: "success", summary: "Updated regression summary." },
      }),
    );
    await generate.click();
    await expect(summary.getByText("Updated regression summary.", { exact: true })).toBeVisible({
      timeout: summaryRefreshTimeout,
    });
    await expect(summary.getByRole("status")).not.toBeVisible();
  } finally {
    await NodeFSP.writeFile(controlPath, original);
  }
});
