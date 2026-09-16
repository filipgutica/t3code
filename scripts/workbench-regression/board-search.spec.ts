import { test, expect, snapshot } from "./fixtures.ts";

test("local board search filters titles, clears, and resets between Workspaces", async ({
  page,
  demo,
}) => {
  await page.goto("/workbench?workbenchProjectId=orbit");
  const board = page.getByRole("region", { name: "Ticket board", exact: true });
  const search = board.getByRole("textbox", { name: "Search tickets" });
  await expect(board.locator("article").first()).toBeVisible();
  const count = await board.locator("article").count();
  expect(count).toBeGreaterThan(1);
  const before = await snapshot(demo);

  await search.fill("  WELCOME CHECKLIST  ");
  await expect(board.locator("article")).toHaveCount(1);
  await expect(
    board.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await search.fill("no-such-ticket-search");
  await expect(board.getByRole("status").filter({ hasText: "No matching tickets." })).toBeVisible();
  await expect(board.locator("article")).toHaveCount(0);
  await board.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(board.locator("article")).toHaveCount(count);

  await search.fill("welcome");
  await expect(board.locator("article")).toHaveCount(1);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(board.locator("article")).toHaveCount(count);
  expect((await snapshot(demo)).tickets.map(({ id, status }) => ({ id, status }))).toEqual(
    before.tickets.map(({ id, status }) => ({ id, status })),
  );

  await search.fill("welcome");
  await expect(board.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Beacon 7", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(board.locator("article").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
