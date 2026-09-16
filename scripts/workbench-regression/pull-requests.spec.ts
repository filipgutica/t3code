// @effect-diagnostics nodeBuiltinImport:off - Live regression reads the demo server's native shell.
import * as NodeFSP from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import { readShellSnapshot } from "../workbench-demo/local.mts";
import { withDemoAccess } from "../workbench-demo/access.mts";

type PullRequestLink = {
  readonly url: string;
  readonly number: number;
  readonly repository: string;
  readonly snapshot?: {
    readonly state: "open" | "closed" | "merged";
    readonly isDraft: boolean;
    readonly title: string;
  } | null;
};

const live = process.env.WORKBENCH_REGRESSION_LIVE === "1";

const nativeThreadRoute = async (home: string, threadId: string): Promise<string> => {
  const environmentId = (await NodeFSP.readFile(`${home}/userdata/environment-id`, "utf8")).trim();
  if (!environmentId) throw new Error("The live demo has no environment ID.");
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
};

/** Open the thread's linked-PR surface through the same launcher a user sees. */
const openLinkedPullRequests = async (page: Page, home: string, threadId: string) => {
  await page.goto(await nativeThreadRoute(home, threadId));
  await expect(page.getByRole("button", { name: "Toggle right panel" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle right panel" }).click();
  await page.getByRole("button", { name: "Add panel surface" }).click();
  await page.getByRole("menuitem", { name: "Linked pull requests", exact: true }).click();
  await expect(page.getByText(/\d+ open · \d+ linked/, { exact: false })).toBeVisible();
};

const requireThreadLinks = async (home: string): Promise<readonly PullRequestLink[]> => {
  const shell = await readShellSnapshotFromHome(home);
  const thread = shell.threads.find((candidate) => candidate.id === "orbit-001-thread");
  if (!thread || thread.pullRequests.length < 2) {
    throw new Error(
      "The live demo must seed at least two linked pull requests on orbit-001-thread.",
    );
  }
  return thread.pullRequests as readonly PullRequestLink[];
};

const readShellSnapshotFromHome = async (home: string) => {
  return withDemoAccess(home, ({ wsUrl, token }) => readShellSnapshot(wsUrl, token));
};

test.describe("Pull request integration @live", () => {
  test.skip(!live, "Live pull request regression is opt-in (WORKBENCH_REGRESSION_LIVE=1).");

  test("P1: links and unlinks a real GitHub PR from a native Thread", async ({ page, demo }) => {
    const links = await requireThreadLinks(demo.home);
    const first = links[0]!;
    await openLinkedPullRequests(page, demo.home, "orbit-001-thread");

    const row = page.locator(`a[href=${JSON.stringify(first.url)}]`);
    await expect(row).toBeVisible();
    await expect(page.getByText(/\d+ open · \d+ linked/, { exact: false })).toContainText(
      `${links.length} linked`,
    );

    const parent = row.locator("..");
    await parent.hover();
    await parent.getByRole("button", { name: `Actions for #${first.number}` }).click();
    await page.getByRole("menuitem", { name: "Unlink from thread", exact: true }).click();
    await expect(row).not.toBeVisible();

    await page.getByRole("button", { name: "Link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Link pull request", exact: true });
    await dialog.getByPlaceholder("Pull request URL or #42").fill(first.url);
    await dialog.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.locator(`a[href=${JSON.stringify(first.url)}]`)).toBeVisible();
  });

  test("P2: opens real PR detail, changes tabs, refreshes, and exposes the host link", async ({
    page,
    demo,
  }) => {
    const links = await requireThreadLinks(demo.home);
    await openLinkedPullRequests(page, demo.home, "orbit-001-thread");
    const first = links[0]!;
    const second = links[1]!;

    await page.locator(`a[href=${JSON.stringify(first.url)}]`).click();
    await expect(
      page.getByRole("navigation", { name: "Pull request tabs", exact: true }),
    ).toBeVisible();
    if (first.snapshot?.title) {
      await expect(
        page.getByRole("heading", { name: first.snapshot.title, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Summary", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByRole("button", { name: "Timeline", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "More pull request actions" }).click();
    await page.getByRole("menuitem", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("button", { name: "More pull request actions" })).toBeVisible();

    await page.getByRole("button", { name: `Open pull request #${first.number} on host` }).click();
    await page.getByRole("button", { name: "Back to this thread's pull requests" }).click();
    await page.locator(`a[href=${JSON.stringify(second.url)}]`).click();
    await expect(
      page.getByRole("navigation", { name: "Pull request tabs", exact: true }),
    ).toBeVisible();
    if (second.snapshot?.title) {
      await expect(
        page.getByRole("heading", { name: second.snapshot.title, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Collapse pull request panel" })).toBeVisible();
  });
});
