import { test, expect, snapshot } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { readConfig } from "../workbench-demo/environment.mts";
import { withDemoAccess } from "../workbench-demo/access.mts";
import { runRpc } from "../workbench-demo/local.mts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import type { WorkbenchJiraSnapshot } from "../../packages/contracts/src/workbenchJira.ts";

const live = process.env.WORKBENCH_REGRESSION_LIVE === "1";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const jiraSite = (home: string) => {
  const config = readConfig(home);
  const site = config.DEMO_JIRA_SITE_URL?.trim();
  if (!site) throw new Error("Live Jira regression requires DEMO_JIRA_SITE_URL.");
  return site;
};

const jiraSnapshot = (home: string): Promise<WorkbenchJiraSnapshot> =>
  withDemoAccess(home, ({ wsUrl, token }) =>
    runRpc(wsUrl, token, (client) => client[WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]({})),
  );

type JiraSyncRouteMode = "normal" | "hold" | "failure" | "empty";

/**
 * The live suite still uses the real Jira service. This route only controls
 * the browser's RPC response so the progress, retry, and empty-result states
 * can be observed without changing Jira data to manufacture an error.
 */
const routeJiraSync = async (page: import("@playwright/test").Page) => {
  let mode: JiraSyncRouteMode = "normal";
  let syncServer: { send: (message: string | Buffer) => void } | null = null;
  let heldRequest: string | Buffer | null = null;
  let targetRequestId: string | number | null = null;
  let resolveRequest: (() => void) | null = null;
  const requestSeen = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });

  const decode = (message: string | Buffer): Record<string, unknown> | null => {
    try {
      const text = typeof message === "string" ? message : message.toString("utf8");
      const value: unknown = JSON.parse(text);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  await page.routeWebSocket("**/ws**", (socket) => {
    const server = socket.connectToServer();
    syncServer = server;
    socket.onMessage((message) => {
      const payload = decode(message);
      if (
        heldRequest === null &&
        mode === "hold" &&
        payload?._tag === "Request" &&
        payload.tag === WORKBENCH_WS_METHODS.workbenchJiraSyncBinding &&
        (typeof payload.id === "string" || typeof payload.id === "number")
      ) {
        heldRequest = message;
        targetRequestId = payload.id;
        resolveRequest?.();
        return;
      }
      if (
        targetRequestId === null &&
        (mode === "failure" || mode === "empty") &&
        payload?._tag === "Request" &&
        payload.tag === WORKBENCH_WS_METHODS.workbenchJiraSyncBinding &&
        (typeof payload.id === "string" || typeof payload.id === "number")
      ) {
        targetRequestId = payload.id;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const payload = decode(message);
      if (
        payload?._tag === "Exit" &&
        payload.requestId === targetRequestId &&
        payload.exit &&
        typeof payload.exit === "object" &&
        mode === "failure"
      ) {
        mode = "normal";
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: payload.requestId,
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: {
                    _tag: "WorkbenchJiraOperationError",
                    code: "request_failed",
                    message: "Jira sync failed for regression.",
                  },
                },
              ],
            },
          }),
        );
        return;
      }
      if (
        payload?._tag === "Exit" &&
        payload.requestId === targetRequestId &&
        payload.exit &&
        typeof payload.exit === "object" &&
        mode === "empty"
      ) {
        const exit = payload.exit as { readonly _tag?: string; readonly value?: unknown };
        if (exit._tag === "Success" && exit.value && typeof exit.value === "object") {
          mode = "normal";
          socket.send(
            JSON.stringify({
              ...payload,
              exit: { ...exit, value: { ...(exit.value as object), links: [] } },
            }),
          );
          return;
        }
      }
      socket.send(message);
    });
  });

  return {
    setMode: (next: JiraSyncRouteMode) => {
      mode = next;
      heldRequest = null;
      targetRequestId = null;
    },
    requestSeen,
    release: () => {
      if (heldRequest === null || syncServer === null) {
        throw new Error("Expected Jira sync request was not held.");
      }
      syncServer.send(heldRequest);
      heldRequest = null;
      mode = "normal";
      targetRequestId = null;
    },
  };
};

const openSyncMenu = async (page: Page, projectId: string) => {
  await page.goto(`/workbench?workbenchProjectId=${encodeURIComponent(projectId)}`);
  await expect(page.getByRole("button", { name: "Workspace actions" })).toBeVisible();
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Sync Jira/ })).toBeVisible();
};

test.describe("Jira connection UX @live", () => {
  test.skip(!live, "Live Jira regression is opt-in (WORKBENCH_REGRESSION_LIVE=1).");

  test("J1: creating a Jira mirror automatically imports tickets and reports the result", async ({
    page,
    demo,
  }) => {
    const site = jiraSite(demo.home);
    const before = await snapshot(demo.home);
    const beforeJira = await jiraSnapshot(demo.home);
    const sourceBinding = beforeJira.bindings.find(
      (candidate) => candidate.projectId === "demo-jira",
    );
    const sourceConnection = beforeJira.connections.find((candidate) => candidate.siteUrl === site);
    if (!sourceBinding) throw new Error("The live demo has no preconnected Jira binding.");
    if (!sourceConnection) throw new Error(`The live demo is not connected to ${site}.`);
    expect(before.projects.some((project) => project.id === "orbit")).toBe(true);

    const syncRoute = await routeJiraSync(page);
    await page.goto("/workbench?workbenchProjectId=orbit");
    await expect(page.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Workspace", exact: true }).click();
    const workspaceDialog = page.getByRole("dialog", { name: /Workspace/ });
    await workspaceDialog.getByLabel("Workspace title").fill("Regression Jira Connection");
    await workspaceDialog.getByRole("checkbox", { name: /Orbit API/ }).check();
    await workspaceDialog.getByRole("checkbox", { name: /Orbit Web/ }).check();
    await workspaceDialog.getByRole("button", { name: "Create Workspace", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Regression Jira Connection", exact: true }),
    ).toBeVisible();
    const workspace = (await snapshot(demo.home)).projects.find(
      (project) => project.title === "Regression Jira Connection",
    );
    if (!workspace) throw new Error("The empty Jira regression workspace was not persisted.");
    expect(
      (await snapshot(demo.home)).tickets.filter((ticket) => ticket.projectId === workspace.id),
    ).toHaveLength(0);

    await page.getByRole("button", { name: "Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Connect Jira", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Connect Jira", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(sourceConnection.siteName, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Jira project" })).toBeVisible();
    await dialog.getByRole("combobox", { name: "Jira project" }).click();
    await page.getByRole("option", { name: /ORBIT/ }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Jira board" })).toBeVisible();
    await dialog.getByRole("combobox", { name: "Jira board" }).click();
    await page
      .getByRole("option", { name: new RegExp(escapeRegExp(sourceBinding.boardName)) })
      .click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Create mirror", exact: true })).toBeVisible();

    const followSprints = dialog.getByRole("checkbox", {
      name: "Follow selected sprints automatically",
    });
    if (await followSprints.isChecked()) await followSprints.uncheck();
    const sourceSprint = sourceBinding.selectedSprints.find(
      (sprint) => sprint.id === sourceBinding.sprintId,
    );
    if (!sourceSprint) throw new Error("The live demo has no selected Jira sprint.");
    const sprintCheckbox = dialog
      .locator("label")
      .filter({ hasText: new RegExp(`^${escapeRegExp(sourceSprint.name)}\\s`) })
      .getByRole("checkbox");
    await sprintCheckbox.check();

    syncRoute.setMode("hold");
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    await syncRoute.requestSeen;
    await expect(page.getByLabel("Jira sync status")).toContainText("Syncing with Jira…");
    syncRoute.release();
    await expect(dialog).not.toBeVisible();

    // The first sync is part of creating the connection. A successful result
    // stays visible after the request completes so the user can tell what
    // happened without opening the Jira configuration again.
    await expect(page.getByText(/Synced \d+ Jira tickets?/i).first()).toBeVisible({
      timeout: 30_000,
    });

    const after = await jiraSnapshot(demo.home);
    const binding = after.bindings.find((candidate) => candidate.projectId === workspace.id);
    expect(binding).toBeDefined();
    expect(binding?.lastSyncedAt).not.toBeNull();
    expect(binding?.lastSyncError).toBeNull();
    expect(
      after.issueLinks.filter((link) => link.bindingId === binding?.id && link.active).length,
    ).toBeGreaterThan(0);
    const firstImportedIssue = after.issueLinks.find(
      (link) => link.bindingId === binding?.id && link.active,
    )?.issue;
    if (!firstImportedIssue) throw new Error("The Jira sync did not create an active issue link.");
    await expect(page.getByText(firstImportedIssue.key, { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Jira sync status")).toContainText("Jira synced");
  });

  test("J1 error: a failed Jira sync is visible and retryable", async ({ page, demo }) => {
    const jira = await jiraSnapshot(demo.home);
    const binding = jira.bindings.find((candidate) => candidate.projectId === "demo-jira");
    if (!binding) throw new Error("The live demo has no preconnected Jira binding.");
    const syncRoute = await routeJiraSync(page);
    await openSyncMenu(page, binding.projectId);
    syncRoute.setMode("failure");
    await page.getByRole("menuitem", { name: "Sync Jira", exact: true }).click();
    const status = page.getByRole("status").filter({ hasText: "Jira sync failed for regression." });
    await expect(status).toBeVisible();
    await status.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
    ).toBeVisible();
  });

  test("J1 empty: an empty Jira import explains what was checked", async ({ page, demo }) => {
    const jira = await jiraSnapshot(demo.home);
    const binding = jira.bindings.find((candidate) => candidate.projectId === "demo-jira");
    if (!binding) throw new Error("The live demo has no preconnected Jira binding.");
    const syncRoute = await routeJiraSync(page);
    await openSyncMenu(page, binding.projectId);
    syncRoute.setMode("empty");
    await page.getByRole("menuitem", { name: "Sync Jira", exact: true }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "No Jira issues are assigned to you in this sprint.",
      }),
    ).toBeVisible();
  });
});
