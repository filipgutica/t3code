// @effect-diagnostics nodeBuiltinImport:off - Live regression reads the demo server's native shell.
import * as NodeCrypto from "node:crypto";
import { CommandId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import * as NodeFSP from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect, type Demo } from "./fixtures.ts";
import { dispatch } from "../workbench-demo/local.mts";

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
  await page.getByRole("button", { name: /^Linked pull requests/ }).click();
  await expect(page.getByText(/\d+ open · \d+ linked/, { exact: false })).toBeVisible();
};

const requireDemoLinks = async (demo: Demo) => {
  const shell = await demo.shellSnapshot();
  const thread = shell.threads.find((candidate) => candidate.id === "orbit-001-thread");
  const links = thread?.pullRequests ?? [];
  const second = shell.threads
    .filter((candidate) => ["orbit-001-thread", "orbit-005-thread"].includes(candidate.id))
    .flatMap((candidate) => candidate.pullRequests)
    .find((link) => link.url !== links[0]?.url);
  if (links.length === 0 || !second) {
    throw new Error("The live demo needs two distinct PRs across the seeded Orbit Threads.");
  }
  return { links, second };
};

const linkPullRequest = async (page: Page, url: string) => {
  await page.getByRole("button", { name: /^Link(?: pull request)?$/, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Link pull request", exact: true });
  await dialog.getByPlaceholder("Pull request URL or #42").fill(url);
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
};

const setLink = async ({
  demo,
  link,
  linked,
}: {
  demo: Demo;
  link: PullRequestLink;
  linked: boolean;
}) => {
  const shell = await demo.shellSnapshot();
  const exists =
    shell.threads
      .find((thread) => thread.id === "orbit-001-thread")
      ?.pullRequests.some((candidate) => candidate.url === link.url) ?? false;
  if (exists === linked) return;
  await demo.rpc((client) =>
    dispatch(client, {
      commandId: CommandId.make(NodeCrypto.randomUUID()),
      threadId: ThreadId.make("orbit-001-thread"),
      host: "github.com",
      repository: link.repository,
      number: link.number,
      ...(linked
        ? { type: "thread.pull-request.link" as const, url: link.url, source: "manual" as const }
        : { type: "thread.pull-request.unlink" as const }),
    }),
  );
};

test.describe("Pull request integration @live", () => {
  test.skip(!live, "Live pull request regression is opt-in (WORKBENCH_REGRESSION_LIVE=1).");

  test("P1: links and unlinks a real GitHub PR from a native Thread", async ({ page, demo }) => {
    const { links } = await requireDemoLinks(demo);
    const first = links[0]!;
    await openLinkedPullRequests(page, demo.home, "orbit-001-thread");

    const row = page.locator(`a[href=${JSON.stringify(first.url)}]:not([target])`);
    await expect(row).toBeVisible();
    await expect(page.getByText(/\d+ open · \d+ linked/, { exact: false })).toContainText(
      `${links.length} linked`,
    );

    const parent = row.locator("..");
    await parent.hover();
    await parent.getByRole("button", { name: `Actions for #${first.number}` }).click();
    try {
      await page.getByRole("menuitem", { name: "Unlink from thread", exact: true }).click();
      await expect(row).not.toBeVisible();
      await linkPullRequest(page, first.url);
      await expect(
        page.locator(`a[href=${JSON.stringify(first.url)}]:not([target])`),
      ).toBeVisible();
    } finally {
      await setLink({ demo, link: first, linked: true });
    }
  });

  test("P2: opens real PR detail, changes tabs, refreshes, and exposes the host link", async ({
    page,
    demo,
  }) => {
    const { links, second } = await requireDemoLinks(demo);
    await openLinkedPullRequests(page, demo.home, "orbit-001-thread");
    const first = links[0]!;
    const addedSecond = !links.some((link) => link.url === second.url);
    try {
      if (addedSecond) await linkPullRequest(page, second.url);

      await page.locator(`a[href=${JSON.stringify(first.url)}]:not([target])`).click();
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

      await page
        .getByRole("button", { name: `Open pull request #${first.number} on host` })
        .click();
      await page.getByRole("button", { name: "Back to this thread's pull requests" }).click();
      await page.locator(`a[href=${JSON.stringify(second.url)}]:not([target])`).click();
      await expect(
        page.getByRole("navigation", { name: "Pull request tabs", exact: true }),
      ).toBeVisible();
      if (second.snapshot?.title) {
        await expect(
          page.getByRole("heading", { name: second.snapshot.title, exact: true }),
        ).toBeVisible();
      }
      const panelToggle = page.getByRole("button", { name: "Toggle right panel", exact: true });
      await expect(panelToggle).toHaveAttribute("aria-pressed", "true");
      await panelToggle.click();
      await expect(
        page.getByRole("navigation", { name: "Pull request tabs", exact: true }),
      ).not.toBeVisible();
    } finally {
      if (addedSecond) await setLink({ demo, link: second, linked: false });
    }
  });
});
