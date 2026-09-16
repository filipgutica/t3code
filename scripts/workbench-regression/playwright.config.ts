import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  ...(process.env.WORKBENCH_REGRESSION_LIVE === "1"
    ? { maxFailures: 1, grep: /@live/ }
    : { grepInvert: /@live/ }),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  outputDir: "../../.test-results/workbench",
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../.test-results/workbench-report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
