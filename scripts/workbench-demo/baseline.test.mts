// @effect-diagnostics nodeBuiltinImport:off - Exercise the reset boundary in a disposable home.
import { expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { applyBaselineReset, planBaselineReset } from "./baseline.mts";
import { setupHome } from "./environment.mts";

const fixtureConfig = [
  "DEMO_GITHUB_REPOSITORIES=filipgutica/orbit,filipgutica/beacon",
  "DEMO_JIRA_SITE_URL=https://example.atlassian.net",
  "DEMO_JIRA_PROJECT_KEY=ORBIT",
  "DEMO_JIRA_BOARD_ID=42",
  "DEMO_JIRA_EMAIL=demo@example.test",
  "DEMO_JIRA_API_TOKEN=secret",
].join("\n");

it("builds a deterministic plan from the saved remote baseline", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      JSON.stringify({
        jiraBaseline: {
          boardName: "Orbit board",
          sprintId: 7,
          sprintName: "Orbit sprint",
          issues: [
            {
              key: "ORBIT-1",
              summary: "Baseline issue 1",
              description: "Baseline description 1",
              labels: ["baseline"],
              assigneeAccountId: "account-1",
              epicKey: null,
              state: "todo",
            },
            {
              key: "ORBIT-2",
              summary: "Baseline issue 2",
              description: "Baseline description 2",
              labels: ["baseline"],
              assigneeAccountId: null,
              epicKey: "ORBIT-10",
              state: "done",
            },
          ],
        },
      }),
    );

    expect(planBaselineReset({ home })).toEqual({
      version: 1,
      home,
      githubRepositories: ["filipgutica/orbit", "filipgutica/beacon"],
      jira: {
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue 1",
            description: "Baseline description 1",
            labels: ["baseline"],
            assigneeAccountId: "account-1",
            epicKey: null,
            state: "todo",
          },
          {
            key: "ORBIT-2",
            summary: "Baseline issue 2",
            description: "Baseline description 2",
            labels: ["baseline"],
            assigneeAccountId: null,
            epicKey: "ORBIT-10",
            state: "done",
          },
        ],
      },
      actions: [
        `Archive local demo state for ${home}.`,
        "Recreate local clones for filipgutica/orbit, filipgutica/beacon.",
        "Re-add 2 explicitly owned Jira issue(s) to sprint 7.",
        "Restore recorded descriptions, labels, assignees, Epic relationships, and workflow states.",
        "Delete non-baseline issues marked workbench-regression in the configured Jira project.",
        "Move other non-baseline issues from the selected sprint to the backlog.",
      ],
    });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("applies a local reset without contacting Jira unless requested", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      JSON.stringify({
        jiraBaseline: {
          boardName: "Orbit board",
          sprintId: 7,
          sprintName: "Orbit sprint",
          issues: [
            {
              key: "ORBIT-1",
              summary: "Baseline issue",
              description: "Baseline description",
              labels: ["baseline"],
              assigneeAccountId: null,
              epicKey: null,
              state: "todo",
            },
          ],
        },
      }),
    );
    NodeFS.writeFileSync(NodePath.join(home, "fixture"), "discarded\n");
    const fetcher = async () => {
      throw new Error("Jira must not be contacted for a local reset");
    };

    const result = await applyBaselineReset({ home, fetcher });

    expect(result.plan.jira?.issues[0]?.key).toBe("ORBIT-1");
    expect(NodeFS.existsSync(NodePath.join(home, "fixture"))).toBe(false);
    expect(NodeFS.readFileSync(NodePath.join(home, "config.env"), "utf8")).toBe(fixtureConfig);
    expect(
      NodeFS.readdirSync(root).filter((entry) => entry.startsWith("demo.backup-")).length,
    ).toBe(1);
  } finally {
    // The reset backup has a timestamped name; remove all children of the test root.
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects a baseline containing issues from another Jira project", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      JSON.stringify({
        jiraBaseline: {
          boardName: "Orbit board",
          sprintId: 7,
          sprintName: "Orbit sprint",
          issues: [
            {
              key: "BEACON-1",
              summary: "Baseline issue",
              description: "Baseline description",
              labels: ["baseline"],
              assigneeAccountId: null,
              epicKey: null,
              state: "todo",
            },
          ],
        },
      }),
    );
    expect(() => planBaselineReset({ home })).toThrow("must belong to ORBIT");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects the legacy key-only Jira baseline before any reset", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    NodeFS.writeFileSync(
      NodePath.join(home, "remotes.json"),
      JSON.stringify({ jiraBaseline: { sprintId: 7, keys: ["ORBIT-1"] } }),
    );
    expect(() => planBaselineReset({ home })).toThrow("baseline is incomplete");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("requires a recorded Jira baseline before a remote reset", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-baseline-test-"));
  try {
    const home = setupHome(NodePath.join(root, "demo"));
    NodeFS.writeFileSync(NodePath.join(home, "config.env"), fixtureConfig);
    await expect(applyBaselineReset({ home, remoteApply: true })).rejects.toThrow(
      "Jira baseline is required",
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
