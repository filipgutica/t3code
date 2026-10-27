import { test, expect } from "@playwright/test";
[320, 390, 768, 801, 1280].forEach((width) => {
  test(`static content and original screenshots at ${width}px without JavaScript`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/t3code/");
    const shots = page.locator("figure.shot");
    await expect(shots).toHaveCount(9);
    for (const shot of await shots.all()) await expect(shot).toBeVisible();
    await expect(page.locator(".hero-media img")).toHaveAttribute("srcset", /480w/);
    await expect(page.locator(".hero-media [data-product-image]:visible")).toHaveAttribute(
      "href",
      /\.png$/,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Review", exact: true }).click();
    await expect(page).toHaveURL(/#review-heading$/);
    await expect(page.locator("#review-heading")).toBeInViewport();
    await expect(page.getByRole("group", { name: "Color theme" })).toHaveCount(0);
  });
});
test("static deep links reach content after all screenshots", async ({ page }) => {
  await page.goto("/t3code/#worktrees-heading");
  await expect(page.locator("#worktrees-heading")).toBeInViewport();
});
test("the commit graph still follows scroll without JavaScript", async ({ page }) => {
  await page.goto("/t3code/");
  const merged = page.locator(".graph-node--merged > i");
  await expect(merged).toHaveCSS("opacity", "0");
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  await expect(merged).toHaveCSS("opacity", "1");
});
test("no-JavaScript system appearance uses the public page palette", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/t3code/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(252, 252, 252)");
  await expect
    .poll(() =>
      page
        .locator(".hero-media img")
        .evaluate((image) => (image instanceof HTMLImageElement ? image.currentSrc : "")),
    )
    .toMatch(/board-light[.]/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect
    .poll(() =>
      page
        .locator(".hero-media img")
        .evaluate((image) => (image instanceof HTMLImageElement ? image.currentSrc : "")),
    )
    .toMatch(/board[.]/);
  const original = page.locator(".hero-media [data-product-image]:visible");
  await expect(original).toHaveAttribute("href", /board[.].*\.png$/);
  const darkOriginal = new URL((await original.getAttribute("href"))!, page.url()).href;
  await original.click();
  await expect(page).toHaveURL(darkOriginal);
  await page.goBack();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(252, 252, 252)");
});
