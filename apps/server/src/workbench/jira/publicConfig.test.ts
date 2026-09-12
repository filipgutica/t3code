import { describe, expect, it } from "vite-plus/test";

import { resolveWorkbenchJiraBrokerUrl } from "./publicConfig.ts";

describe("Workbench Jira public configuration", () => {
  it("accepts an HTTPS broker URL and strips its trailing slash", () => {
    expect(
      resolveWorkbenchJiraBrokerUrl({
        T3_WORKBENCH_JIRA_BROKER_URL: "https://workbench-auth.example/",
      }),
    ).toBe("https://workbench-auth.example");
  });

  it("ignores unsafe broker URLs", () => {
    expect(
      resolveWorkbenchJiraBrokerUrl({ T3_WORKBENCH_JIRA_BROKER_URL: "http://localhost:8787" }),
    ).toBeNull();
    expect(
      resolveWorkbenchJiraBrokerUrl({
        T3_WORKBENCH_JIRA_BROKER_URL: "https://user:secret@workbench-auth.example",
      }),
    ).toBeNull();
  });
});
