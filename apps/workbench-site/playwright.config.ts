import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testMatch: "site.spec.ts" },
    {
      name: "chromium-no-js",
      use: { browserName: "chromium", javaScriptEnabled: false },
      testMatch: "no-js.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm run preview --host 127.0.0.1 --port 4175 --ignore-lock",
    url: "http://127.0.0.1:4175/t3code/",
    reuseExistingServer: !process.env.CI,
  },
});
