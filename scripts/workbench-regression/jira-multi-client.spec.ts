import { test, expect, snapshot, jiraSnapshot, type Demo } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import * as NodeCrypto from "node:crypto";
import { readConfig } from "../workbench-demo/environment.mts";
import { validateJiraBaseline } from "../workbench-demo/remotes.mts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import { JiraHttpClient, type JiraSprint } from "./jira-http.mts";

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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const openJiraDialog = async (page: Page) => {
  await page.goto("/workbench?workbenchProjectId=demo-jira");
  await expect(page.getByRole("heading", { name: "Orbit Jira", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "Configure Jira sprint mirror", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Jira sprint mirror", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
};

const sprintCheckbox = (dialog: Awaited<ReturnType<typeof openJiraDialog>>, name: string) =>
  dialog
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegExp(name)}\\s`) })
    .getByRole("checkbox");

const saveBindingSprints = async ({
  page,
  targetFollow,
  selectedSprintNames,
  createdFutureName,
}: {
  readonly page: Page;
  readonly targetFollow: boolean;
  readonly selectedSprintNames: readonly string[];
  readonly createdFutureName?: string;
}) => {
  const dialog = await openJiraDialog(page);
  await dialog.getByRole("button", { name: "Edit sprints and mappings", exact: true }).click();
  const follow = dialog.getByRole("checkbox", {
    name: "Follow selected sprints automatically",
  });
  await expect(follow).toBeVisible();
  await follow.setChecked(targetFollow);
  for (const name of selectedSprintNames) {
    const checkbox = sprintCheckbox(dialog, name);
    if (await checkbox.isVisible()) await checkbox.setChecked(true);
  }
  if (createdFutureName !== undefined) {
    const createdFuture = sprintCheckbox(dialog, createdFutureName);
    if (await createdFuture.isVisible()) await createdFuture.setChecked(false);
  }
  await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
  await expect(dialog).not.toBeVisible();
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
  return { client, jira, binding, baselineLinks };
};

test.describe("Jira multi-sprint selection and client conflicts @live", () => {
  test.skip(!live, "Live Jira regression is opt-in (WORKBENCH_REGRESSION_LIVE=1).");

  test("J9 maps a future sprint with the original sprint and restores Ticket identity", async ({
    page,
    demo,
  }) => {
    const { client, binding, baselineLinks } = await liveJira(demo);
    const beforeWorkbench = await snapshot(demo);
    const beforeBinding = binding;
    const originalSprintId = binding.sprintId;
    const originalSprintNames = binding.selectedSprints.map((sprint) => sprint.name);
    const originalIssueKeys = await client.sprintIssueKeys(originalSprintId);
    const link = baselineLinks.find((candidate) => originalIssueKeys.includes(candidate.issue.key));
    if (!link)
      throw new Error("The live demo has no assigned baseline issue in its selected sprint.");
    const originalIssue = await client.issue(link.issue.key);
    let futureSprintId: number | undefined;
    let futureSprintName: string | undefined;
    let testFailure: unknown;
    try {
      futureSprintName = `WB-reg-${NodeCrypto.randomBytes(10).toString("hex")}`;
      let futureSprint: JiraSprint;
      try {
        futureSprint = await client.createFutureSprint(binding.boardId, futureSprintName);
      } catch (error) {
        // A successful Jira create can still lose its response. Recover only the
        // uniquely named future sprint on this board before surfacing the failure.
        const matches = await client.futureSprintsForBoard(binding.boardId).catch(() => []);
        const recovered = matches.filter(
          (candidate) => candidate.name === futureSprintName && candidate.state === "future",
        );
        if (recovered.length !== 1) throw error;
        futureSprint = recovered[0]!;
      }
      futureSprintId = futureSprint.id;
      if (
        futureSprint.originBoardId !== undefined &&
        futureSprint.originBoardId !== binding.boardId
      ) {
        throw new Error(`Jira created future sprint ${futureSprint.id} on an unexpected board.`);
      }
      await client.moveIssuesToSprint(futureSprint.id, [originalIssue.key]);

      const dialog = await openJiraDialog(page);
      await dialog.getByRole("button", { name: "Edit sprints and mappings", exact: true }).click();
      const follow = dialog.getByRole("checkbox", {
        name: "Follow selected sprints automatically",
      });
      await expect(follow).toBeChecked({ checked: beforeBinding.followActiveSprint });
      await follow.uncheck();
      const futureCheckbox = sprintCheckbox(dialog, futureSprintName);
      await expect(futureCheckbox).toBeVisible();
      await futureCheckbox.check();
      await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
      await expect(dialog).not.toBeVisible();

      await expect
        .poll(async () => {
          const after = await jiraSnapshot(demo);
          const current = after.bindings.find((candidate) => candidate.id === binding.id);
          return current?.selectedSprints.map((sprint) => sprint.id) ?? [];
        })
        .toEqual(expect.arrayContaining([originalSprintId, futureSprint.id]));

      const after = await jiraSnapshot(demo);
      const afterBinding = after.bindings.find((candidate) => candidate.id === binding.id);
      const selectedIds = new Set(afterBinding?.selectedSprints.map((sprint) => sprint.id));
      expect(afterBinding?.followActiveSprint).toBe(false);
      expect(selectedIds).toEqual(new Set([originalSprintId, futureSprint.id]));
      const activeLinks = after.issueLinks.filter(
        (candidate) => candidate.bindingId === binding.id && candidate.active,
      );
      expect(baselineLinks.length).toBeGreaterThan(1);
      expect(new Set(activeLinks.map((candidate) => candidate.issue.key))).toEqual(
        new Set(baselineLinks.map((candidate) => candidate.issue.key)),
      );
      await expect(page.getByText(originalIssue.key, { exact: true }).first()).toBeVisible();

      const afterWorkbench = await snapshot(demo);
      const ticketAfterImport = afterWorkbench.tickets.find(
        (ticket) => ticket.id === link.ticketId,
      );
      const ticketBeforeImport = beforeWorkbench.tickets.find(
        (ticket) => ticket.id === link.ticketId,
      );
      expect(ticketBeforeImport).toBeDefined();
      expect(ticketAfterImport).toBeDefined();
      expect(ticketAfterImport?.id).toBe(ticketBeforeImport?.id);
      expect(ticketAfterImport?.repositoryProjectIds).toEqual(
        ticketBeforeImport?.repositoryProjectIds,
      );
      expect(ticketAfterImport?.primaryT3ProjectId).toBe(ticketBeforeImport?.primaryT3ProjectId);

      await saveBindingSprints({
        page,
        targetFollow: false,
        selectedSprintNames: originalSprintNames,
        createdFutureName: futureSprintName,
      });
      await expect
        .poll(async () => {
          const current = await jiraSnapshot(demo);
          return current.issueLinks.find(
            (candidate) =>
              candidate.bindingId === binding.id && candidate.issue.key === originalIssue.key,
          )?.active;
        })
        .toBe(false);
      const retained = (await jiraSnapshot(demo)).issueLinks.find(
        (candidate) =>
          candidate.bindingId === binding.id && candidate.issue.key === originalIssue.key,
      );
      expect(retained?.ticketId).toBe(link.ticketId);

      const dialogAfterDeselect = await openJiraDialog(page);
      await dialogAfterDeselect
        .getByRole("button", { name: "Edit sprints and mappings", exact: true })
        .click();
      await dialogAfterDeselect
        .getByRole("checkbox", {
          name: "Follow selected sprints automatically",
        })
        .uncheck();
      await sprintCheckbox(dialogAfterDeselect, futureSprintName).check();
      await dialogAfterDeselect.getByRole("button", { name: "Save mirror", exact: true }).click();
      await expect(dialogAfterDeselect).not.toBeVisible();
      await expect
        .poll(async () => {
          const current = await jiraSnapshot(demo);
          return current.issueLinks.find(
            (candidate) =>
              candidate.bindingId === binding.id && candidate.issue.key === originalIssue.key,
          );
        })
        .toMatchObject({ ticketId: link.ticketId, active: true });
    } catch (error) {
      testFailure = error;
    }

    const cleanupErrors: unknown[] = [];
    let issueRestored = false;
    if (futureSprintId !== undefined) {
      try {
        await client.moveIssuesToSprint(originalSprintId, [originalIssue.key]);
        issueRestored = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await saveBindingSprints({
        page,
        targetFollow: beforeBinding.followActiveSprint,
        selectedSprintNames: originalSprintNames,
        ...(futureSprintName === undefined ? {} : { createdFutureName: futureSprintName }),
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (issueRestored && futureSprintId !== undefined && futureSprintName !== undefined) {
      try {
        const ownedSprint = await client.sprint(futureSprintId);
        if (
          ownedSprint.id !== futureSprintId ||
          ownedSprint.name !== futureSprintName ||
          ownedSprint.state !== "future" ||
          ownedSprint.originBoardId !== binding.boardId
        ) {
          throw new Error(`Refusing to delete an unexpected Jira sprint ${futureSprintId}.`);
        }
        await client.deleteSprint(futureSprintId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [...(testFailure === undefined ? [] : [testFailure]), ...cleanupErrors],
        "Multi-sprint regression cleanup failed.",
      );
    }
    if (testFailure !== undefined) throw testFailure;
  });

  test("J10 rejects a stale edit from a second browser and preserves the Jira winner", async ({
    page,
    browser,
    pairedState,
    demo,
  }) => {
    const { client, baselineLinks } = await liveJira(demo);
    const link = baselineLinks[0];
    if (!link) throw new Error("The live demo has no baseline Jira issue to exercise.");
    const original = await client.issue(link.issue.key);
    const winner = `${original.description}\n\nJ10 winner from client one.`;
    const stale = `${original.description}\n\nJ10 stale edit from client two.`;
    const secondContext = await browser.newContext({
      baseURL: demo.origin,
      storageState: pairedState,
    });
    try {
      const secondPage = await secondContext.newPage();
      const ticketUrl = `/workbench?workbenchProjectId=demo-jira&ticketId=${encodeURIComponent(link.ticketId)}`;
      await Promise.all([page.goto(ticketUrl), secondPage.goto(ticketUrl)]);
      await Promise.all([
        expect(page.getByRole("heading", { name: original.summary, exact: true })).toBeVisible(),
        expect(
          secondPage.getByRole("heading", { name: original.summary, exact: true }),
        ).toBeVisible(),
      ]);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await secondPage.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Description", { exact: true }).fill(winner);
      await secondPage.getByLabel("Description", { exact: true }).fill(stale);

      // Manual refreshes bypass the background cooldown and exercise the shared
      // server lock while the first browser submits its edit.
      const refreshes = Promise.all(
        [0, 1].map(() =>
          demo.rpc((rpc) =>
            rpc[WORKBENCH_WS_METHODS.workbenchJiraSyncBinding]({
              bindingId: link.bindingId,
            }),
          ),
        ),
      );
      const [, syncResults] = await Promise.all([
        page.getByRole("button", { name: "Save Ticket", exact: true }).click(),
        refreshes,
      ]);
      for (const result of syncResults) {
        expect(result.bindingId).toBe(link.bindingId);
        expect(result.links.some((candidate) => candidate.ticketId === link.ticketId)).toBe(true);
      }
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      await expect(page.getByText("J10 winner from client one.", { exact: true })).toBeVisible();
      await expect.poll(async () => (await client.issue(original.key)).description).toBe(winner);

      await secondPage.getByRole("button", { name: "Save Ticket", exact: true }).click();
      await expect(secondPage.getByRole("alert")).toContainText(
        /changed remotely|Refresh the Ticket/i,
      );
      await expect.poll(async () => (await client.issue(original.key)).description).toBe(winner);
      const finalWorkbench = await snapshot(demo);
      const finalTicket = finalWorkbench.tickets.find((ticket) => ticket.id === link.ticketId);
      expect(finalTicket).toBeDefined();
      expect(finalTicket?.markdown).toBe(winner);
    } finally {
      try {
        await client.updateIssue(original.key, { description: original.description });
      } finally {
        await secondContext.close();
      }
    }
  });
});
