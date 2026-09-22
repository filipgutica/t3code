import {
  test,
  expect,
  jiraSnapshot,
  openWorkbench,
  snapshot,
  type Demo,
} from "./fixtures.ts";
import type { Page } from "@playwright/test";
import * as NodeCrypto from "node:crypto";
import { readConfig } from "../workbench-demo/environment.mts";
import { validateJiraBaseline } from "../workbench-demo/remotes.mts";
import { JiraHttpClient, JIRA_REGRESSION_CLEANUP_LABEL, type JiraIssue } from "./jira-http.mts";

const live = process.env.WORKBENCH_REGRESSION_LIVE === "1";

const jiraConfig = (home: string) => {
  const config = readConfig(home);
  const site = config.DEMO_JIRA_SITE_URL?.trim();
  const email = config.DEMO_JIRA_EMAIL?.trim();
  const token = config.DEMO_JIRA_API_TOKEN?.trim();
  if (!site || !email || !token) {
    throw new Error(
      "Live Jira regression requires DEMO_JIRA_SITE_URL, DEMO_JIRA_EMAIL, and DEMO_JIRA_API_TOKEN in the demo config.",
    );
  }
  return { site, email, token };
};

const liveJira = async (demo: Demo) => {
  const client = new JiraHttpClient(jiraConfig(demo.home));
  const jira = await jiraSnapshot(demo);
  const binding = jira.bindings.find((candidate) => candidate.projectId === "demo-jira");
  if (!binding) throw new Error("The live demo has no preconnected demo-jira binding.");
  const baseline = validateJiraBaseline(JSON.parse(process.env.DEMO_JIRA_BASELINE ?? "null"));
  const baselineKeys = new Set(baseline.issues.map((issue) => issue.key));
  const baselineLinks = jira.issueLinks.filter(
    (link) => link.bindingId === binding.id && link.active && baselineKeys.has(link.issue.key),
  );
  const todoKeys = new Set(
    baseline.issues.filter((issue) => issue.state === "todo").map((issue) => issue.key),
  );
  const todoLinks = baselineLinks.filter((link) => todoKeys.has(link.issue.key));
  return { client, jira, binding, baselineLinks, todoLinks };
};

const openJiraDialog = async (page: Page, demo: Demo) => {
  await openWorkbench(page, demo.workbenchUrl("/workbench?workbenchProjectId=demo-jira"));
  await expect(page.getByRole("heading", { name: "Orbit Jira", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "Configure Jira sprint mirror", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Jira sprint mirror", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const restoreIssue = async (client: JiraHttpClient, issue: JiraIssue): Promise<void> => {
  await client.updateIssue(issue.key, { description: issue.description });
  let current = await client.issue(issue.key);
  const visited = new Set<string>();
  for (let attempt = 0; current.status.id !== issue.status.id && attempt < 12; attempt += 1) {
    if (visited.has(current.status.id)) break;
    visited.add(current.status.id);
    const transition = (await client.transitions(issue.key)).find(
      (candidate) => candidate.to.id === issue.status.id,
    );
    if (!transition) break;
    await client.transitionIssue(issue.key, transition.id);
    current = await client.issue(issue.key);
  }
  if (current.status.id !== issue.status.id) {
    throw new Error(`Could not restore Jira issue ${issue.key} to ${issue.status.name}.`);
  }
};

test.describe("Jira Workbench integration @live", () => {
  test.skip(!live, "Live Jira regression is opt-in (WORKBENCH_REGRESSION_LIVE=1).");

  test("J2 imports selected sprint issues once and preserves repository scope", async ({
    page,
    demo,
  }) => {
    const { client, jira, binding } = await liveJira(demo);
    const links = jira.issueLinks.filter((link) => link.bindingId === binding.id && link.active);
    expect(binding.active).toBe(true);
    expect(binding.selectedSprints.length).toBeGreaterThan(0);
    expect(new Set(binding.selectedSprints.map((sprint) => sprint.id)).size).toBe(
      binding.selectedSprints.length,
    );
    expect(new Set(links.map((link) => link.issue.issueId)).size).toBe(links.length);
    const selectedSprintKeys = new Set(
      (
        await Promise.all(
          binding.selectedSprints.map((sprint) => client.sprintIssueKeys(sprint.id)),
        )
      ).flat(),
    );
    const accountId = await client.currentUserAccountId();
    for (const link of links) {
      expect(selectedSprintKeys.has(link.issue.key)).toBe(true);
      expect((await client.issue(link.issue.key)).assigneeAccountId).toBe(accountId);
    }

    const workbench = await snapshot(demo);
    const linkedTicketIds = new Set(links.map((link) => link.ticketId));
    expect(links.length).toBeGreaterThan(0);
    for (const ticketId of linkedTicketIds) {
      const ticket = workbench.tickets.find((candidate) => candidate.id === ticketId);
      expect(ticket).toBeDefined();
      expect(ticket?.primaryT3ProjectId).toBe(binding.defaultPrimaryT3ProjectId);
      expect(ticket?.repositoryProjectIds).toEqual(binding.defaultRepositoryProjectIds);
    }
    expect(
      workbench.ticketWorkspaces.filter((workspace) => linkedTicketIds.has(workspace.ticketId)),
    ).toHaveLength(0);

    await openWorkbench(page, demo.workbenchUrl("/workbench?workbenchProjectId=demo-jira"));
    await expect(page.getByRole("heading", { name: "Orbit Jira", exact: true })).toBeVisible();
    for (const link of links) {
      await expect(page.getByText(link.issue.key, { exact: true }).first()).toBeVisible();
    }

    const dialog = await openJiraDialog(page, demo);
    await dialog.getByRole("button", { name: "Edit sprints and mappings", exact: true }).click();
    const sprint = binding.selectedSprints[0]!;
    const sprintCheckbox = dialog
      .locator("label")
      .filter({ hasText: new RegExp(`^${escapeRegExp(sprint.name)}\\s`) })
      .getByRole("checkbox");
    await sprintCheckbox.uncheck();
    await expect(dialog.getByRole("button", { name: "Save mirror", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .filter({ hasText: /^Close$/ })
      .click();
  });

  test("J3 switches between mapped and mirrored Jira columns without changing ticket identity", async ({
    page,
    demo,
  }) => {
    const before = await liveJira(demo);
    const ticketIds = before.jira.issueLinks
      .filter((link) => link.bindingId === before.binding.id && link.active)
      .map((link) => link.ticketId);
    try {
      let dialog = await openJiraDialog(page, demo);
      await dialog.getByRole("button", { name: "Edit sprints and mappings", exact: true }).click();
      const mirror = dialog.getByRole("checkbox", { name: "Mirror Jira states" });
      await expect(mirror).toBeChecked();
      await mirror.uncheck();
      await expect(dialog.getByRole("combobox", { name: /Map Jira status/ }).first()).toBeVisible();
      await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
      await expect(dialog).not.toBeVisible();

      let after = await jiraSnapshot(demo);
      const mapped = after.bindings.find((binding) => binding.id === before.binding.id);
      expect(mapped?.boardMode).toBe("mapped");
      expect(
        after.issueLinks
          .filter((link) => link.bindingId === before.binding.id && link.active)
          .map((link) => link.ticketId),
      ).toEqual(ticketIds);

      dialog = await openJiraDialog(page, demo);
      await dialog.getByRole("button", { name: "Edit sprints and mappings", exact: true }).click();
      await dialog.getByRole("checkbox", { name: "Mirror Jira states" }).check();
      await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      after = await jiraSnapshot(demo);
      expect(after.bindings.find((binding) => binding.id === before.binding.id)?.boardMode).toBe(
        "mirror_jira",
      );
    } finally {
      const current = await jiraSnapshot(demo);
      const binding = current.bindings.find((candidate) => candidate.id === before.binding.id);
      if (binding?.boardMode !== before.binding.boardMode) {
        const dialog = await openJiraDialog(page, demo);
        await dialog
          .getByRole("button", { name: "Edit sprints and mappings", exact: true })
          .click();
        const mirror = dialog.getByRole("checkbox", { name: "Mirror Jira states" });
        await mirror.setChecked(before.binding.boardMode === "mirror_jira");
        await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
        await expect(dialog).not.toBeVisible();
      }
    }
  });

  test("J4 pauses and resumes mirror while retaining Tickets and repository scope", async ({
    page,
    demo,
  }) => {
    const before = await liveJira(demo);
    const beforeWorkbench = await snapshot(demo);
    try {
      let dialog = await openJiraDialog(page, demo);
      await dialog.getByRole("button", { name: "Pause mirror", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Resume mirror", exact: true }),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: "Close", exact: true })
        .filter({ hasText: /^Close$/ })
        .click();
      await expect(page.getByText("Jira paused", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "New Ticket", exact: true }).click();
      const createDialog = page.getByRole("dialog", { name: "Create Ticket", exact: true });
      await expect(
        createDialog.getByText("Resume the Jira connection before creating a Ticket."),
      ).toBeVisible();
      await expect(
        createDialog.getByRole("button", { name: "Create Ticket", exact: true }),
      ).toBeDisabled();
      await createDialog.getByRole("button", { name: "Cancel", exact: true }).click();

      dialog = await openJiraDialog(page, demo);
      await dialog.getByRole("button", { name: "Resume mirror", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Pause mirror", exact: true })).toBeVisible();
      await dialog
        .getByRole("button", { name: "Close", exact: true })
        .filter({ hasText: /^Close$/ })
        .click();
      await expect(page.getByText("Jira paused", { exact: true })).not.toBeVisible();
    } finally {
      const current = await jiraSnapshot(demo);
      const binding = current.bindings.find((candidate) => candidate.id === before.binding.id);
      if (binding && binding.active !== before.binding.active) {
        const dialog = await openJiraDialog(page, demo);
        await dialog
          .getByRole("button", {
            name: before.binding.active ? "Resume mirror" : "Pause mirror",
            exact: true,
          })
          .click();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .filter({ hasText: /^Close$/ })
          .click();
      }
    }
    const afterWorkbench = await snapshot(demo);
    expect(afterWorkbench.tickets.map((ticket) => ticket.id)).toEqual(
      beforeWorkbench.tickets.map((ticket) => ticket.id),
    );
    expect(afterWorkbench.tickets.map((ticket) => ticket.repositoryProjectIds)).toEqual(
      beforeWorkbench.tickets.map((ticket) => ticket.repositoryProjectIds),
    );
  });

  test("J5 creates a Jira issue from Workbench and verifies assignment, sprint, description, and scope", async ({
    page,
    demo,
  }) => {
    const { client, binding } = await liveJira(demo);
    const title = `[Workbench regression] Jira create ${NodeCrypto.randomUUID()}`;
    const description = "Created by the live Workbench Jira regression.";
    let key: string | undefined;
    try {
      await openWorkbench(page, demo.workbenchUrl("/workbench?workbenchProjectId=demo-jira"));
      await page.getByRole("button", { name: "New Ticket", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create Ticket", exact: true });
      await dialog.getByPlaceholder("What needs doing?").fill(title);
      // Creation uses the user's selected scope; mirror defaults apply to imports.
      await dialog.getByRole("checkbox", { name: /Orbit API/ }).check();
      await dialog.getByRole("checkbox", { name: /Orbit Web/ }).uncheck();
      await dialog
        .getByPlaceholder("Goal, constraints, and acceptance criteria…")
        .fill(description);
      await dialog.getByRole("button", { name: "Create Ticket", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

      const workbench = await snapshot(demo);
      const ticket = workbench.tickets.find((candidate) => candidate.title === title);
      expect(ticket).toBeDefined();
      const jira = await jiraSnapshot(demo);
      const link = jira.issueLinks.find(
        (candidate) => candidate.ticketId === ticket?.id && candidate.active,
      );
      expect(link).toBeDefined();
      key = link?.issue.key;
      if (!key) throw new Error("Workbench created a Ticket without a Jira issue link.");
      await client.updateIssue(key, { labels: [JIRA_REGRESSION_CLEANUP_LABEL] });
      expect(ticket?.primaryT3ProjectId).toBe("orbit-api");
      expect(ticket?.repositoryProjectIds).toEqual(["orbit-api"]);
      const issue = await client.issue(key);
      expect(issue.summary).toBe(title);
      expect(issue.description).toBe(description);
      expect(issue.labels).toContain("workbench-regression");
      expect(issue.assigneeAccountId).toBe(await client.currentUserAccountId());
      expect(await client.sprintIssueKeys(binding.sprintId)).toContain(key);
    } finally {
      const keys = key
        ? [key]
        : await client.issueKeysWithSummary({
            projectKey: readConfig(demo.home).DEMO_JIRA_PROJECT_KEY!,
            summary: title,
          });
      for (const createdKey of keys) await client.deleteIssue(createdKey);
    }
  });

  test("J6 syncs remote description and status changes, then writes Workbench edits back to Jira", async ({
    page,
    demo,
  }) => {
    const { client, binding, baselineLinks } = await liveJira(demo);
    const link = baselineLinks[0];
    if (!link) throw new Error("The live demo has no baseline Jira issue to exercise.");
    const original = await client.issue(link.issue.key);
    const remoteDescription = "Remote description written by the Jira regression.";
    const uiDescription = "Workbench description written by the Jira regression.";
    let remoteIssue = original;
    try {
      await client.updateIssue(original.key, { description: remoteDescription });
      await openWorkbench(
        page,
        demo.workbenchUrl(
          `/workbench?workbenchProjectId=demo-jira&ticketId=${encodeURIComponent(link.ticketId)}`,
        ),
      );
      await expect(
        page.getByRole("heading", { name: original.summary, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Refresh from Jira", exact: true }).click();
      await expect(page.getByText(remoteDescription, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Description", { exact: true }).fill(uiDescription);
      await page.getByRole("button", { name: "Save Ticket", exact: true }).click();
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      await expect(page.getByText(uiDescription, { exact: true })).toBeVisible();
      expect((await client.issue(original.key)).description).toBe(uiDescription);

      remoteIssue = await client.issue(original.key);
      const mappedStatusIds = new Set(
        binding.statusMappings.map((mapping) => mapping.jiraStatusId),
      );
      const transition = (await client.transitions(original.key)).find(
        (candidate) =>
          candidate.to.id !== remoteIssue.status.id && mappedStatusIds.has(candidate.to.id),
      );
      if (!transition) throw new Error(`Jira issue ${original.key} has no available transition.`);
      const statusButton = page.getByRole("button", {
        name: `Change status of ${original.summary}`,
        exact: true,
      });
      await statusButton.click();
      const transitionItem = page
        .getByRole("menuitem")
        .filter({ hasText: transition.to.name })
        .first();
      await expect(transitionItem).toBeVisible();
      await transitionItem.click();
      await expect(statusButton).toHaveText(transition.to.name);
      // The status label updates optimistically; the control stays disabled until
      // the Jira write and authoritative snapshots have completed.
      await expect(statusButton).toBeEnabled();
      await expect(statusButton).toHaveText(transition.to.name);
      remoteIssue = await client.issue(original.key);
      expect(remoteIssue.status.id).toBe(transition.to.id);
    } finally {
      await restoreIssue(client, original);
    }
  });

  test("J7 starts a deterministic turn on a Jira Todo Ticket and advances its remote state", async ({
    page,
    demo,
  }) => {
    const { client, binding, todoLinks } = await liveJira(demo);
    const link = todoLinks[0];
    if (!link) throw new Error("The live demo baseline has no Jira Todo issue to exercise.");
    const issue = await client.issue(link.issue.key);
    expect(
      binding.statusMappings.find((mapping) => mapping.jiraStatusId === issue.status.id)
        ?.workbenchStatus,
    ).toBe("todo");
    const inProgressStatusIds = new Set(
      binding.statusMappings
        .filter((mapping) => mapping.workbenchStatus === "in_progress")
        .map((mapping) => mapping.jiraStatusId),
    );
    const firstWorkingColumn = binding.boardColumns.find(
      (column) => !column.done && column.statusIds.some((id) => inProgressStatusIds.has(id)),
    );
    const expectedStartStatusIds = new Set(firstWorkingColumn?.statusIds ?? inProgressStatusIds);
    const transition = (await client.transitions(issue.key)).find(
      (candidate) =>
        candidate.to.id !== issue.status.id && expectedStartStatusIds.has(candidate.to.id),
    );
    if (!transition) throw new Error(`Jira issue ${issue.key} has no available transition.`);
    try {
      await openWorkbench(
        page,
        demo.workbenchUrl(
          `/workbench?workbenchProjectId=demo-jira&ticketId=${encodeURIComponent(link.ticketId)}`,
        ),
      );
      await expect(page.getByRole("heading", { name: issue.summary, exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: `Create Thread for ${issue.summary}`, exact: true })
        .filter({ hasText: /^Create Thread$/ })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create Thread", exact: true })
        .click();
      await expect(page).toHaveURL(
        (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === "true",
      );
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.click();
      await editor.press("End");
      await editor.pressSequentially(
        "Do not edit files or run commands. Reply exactly: Workbench regression passed.",
      );
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByText("Workbench regression passed.", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop generation", exact: true }),
      ).not.toBeVisible();
      // The provider can finish before the Ticket execution reactor finishes its
      // Jira write. The Ticket status reflects the reactor's confirmed readback.
      await page
        .getByRole("link", {
          name: `Back to Ticket ${issue.summary} in Workspace Orbit Jira`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", { name: `Change status of ${issue.summary}`, exact: true }),
      ).toHaveText(transition.to.name);
      const updated = await client.issue(issue.key);
      expect(updated.status.id).toBe(transition.to.id);
    } finally {
      await restoreIssue(client, issue);
    }
  });

  test("J8 automatically imports remote edits while preserving Ticket identity and scope", async ({
    page,
    demo,
  }) => {
    const { client, baselineLinks } = await liveJira(demo);
    const link = baselineLinks[0];
    if (!link) throw new Error("The live demo has no Jira issue to exercise.");
    const before = await snapshot(demo);
    const ticketBefore = before.tickets.find((ticket) => ticket.id === link.ticketId);
    if (!ticketBefore) throw new Error(`Missing local Ticket for Jira issue ${link.issue.key}.`);
    const issue = await client.issue(link.issue.key);
    const changedDescription = `${issue.description}\n\nJ8 transient remote edit.`;
    try {
      await client.updateIssue(issue.key, { description: changedDescription });
      await openWorkbench(
        page,
        demo.workbenchUrl(
          `/workbench?workbenchProjectId=demo-jira&ticketId=${encodeURIComponent(link.ticketId)}`,
        ),
      );
      await expect(page.getByText("J8 transient remote edit.", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const after = await snapshot(demo);
      const ticketAfter = after.tickets.find((ticket) => ticket.id === link.ticketId);
      expect(ticketAfter?.id).toBe(ticketBefore.id);
      expect(ticketAfter?.primaryT3ProjectId).toBe(ticketBefore.primaryT3ProjectId);
      expect(ticketAfter?.repositoryProjectIds).toEqual(ticketBefore.repositoryProjectIds);
    } finally {
      await client.updateIssue(issue.key, { description: issue.description });
    }
  });
});
