import { test, expect } from "@playwright/test";
[320, 390, 768, 801, 1280].forEach((width) => {
  test(`static content and original screenshots at ${width}px without JavaScript`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/t3code/");
    await expect(page.getByRole("tablist")).toHaveCount(0);
    const frames = page.locator("[data-walkthrough-frame]");
    await expect(frames).toHaveCount(6);
    for (const frame of await frames.all()) await expect(frame).toBeVisible();
    await expect(page.locator(".hero-media img")).toHaveAttribute("srcset", /480w/);
    await expect(page.locator(".hero-media [data-product-image]")).toHaveAttribute(
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
test("static deep links reach content after all screenshot panels", async ({ page }) => {
  await page.goto("/t3code/#scope-heading");
  await expect(page.locator("#scope-heading")).toBeInViewport();
});
test("no-JavaScript system appearance uses the public page palette", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/t3code/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 245, 248)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(21, 22, 25)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 245, 248)");
});
