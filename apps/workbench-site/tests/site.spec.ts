import { test as base, expect, type Page } from "@playwright/test";
const test = base.extend<{ cleanPage: void }>({
  cleanPage: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || /hydration/i.test(message.text()))
          errors.push(message.text());
      });
      page.on("response", (response) => {
        if (
          baseURL &&
          new URL(response.url()).origin === new URL(baseURL).origin &&
          response.status() >= 400
        )
          errors.push(`${response.status()} ${response.url()}`);
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
const load = async (page: Page, hash = "") => {
  await page.goto(`/t3code/${hash}`);
  await expect(page.locator("[data-enhanced]")).toHaveAttribute("data-enhanced", "true");
  await expect(page.getByRole("tablist", { name: "Ticket workflow screenshots" })).toBeVisible();
};
const noOverflow = async (page: Page) => {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
};
const markScrollEnd = async (page: Page) =>
  page.evaluate(() => {
    delete document.documentElement.dataset.scrollEnded;
    window.addEventListener(
      "scrollend",
      () => {
        document.documentElement.dataset.scrollEnded = "true";
      },
      { once: true },
    );
  });
const ended = async (page: Page) =>
  expect(page.locator("html")).toHaveAttribute("data-scroll-ended", "true");
const atReadingTop = async (page: Page, id: string) =>
  expect
    .poll(() =>
      page
        .locator(`#${id}`)
        .evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
          ),
        ),
    )
    .toBeLessThan(2);
[320, 390, 768, 801, 1280].forEach((width) => {
  test(`responsive content and optimized screenshots at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    await noOverflow(page);
    await expect(
      page.getByRole("heading", { name: "Your work, across repositories." }),
    ).toBeVisible();
    const hero = page.locator(".hero-media img");
    await expect(hero).toBeVisible();
    await expect
      .poll(() =>
        hero.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(hero).toHaveAttribute("srcset", /480w/);
    await expect(hero).toHaveAttribute("loading", "eager");
    await expect(hero).toHaveAttribute("fetchpriority", "high");
    const bounds = await hero.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeLessThan(900);
    const download = page
      .locator(".hero")
      .getByRole("link", { name: "Download Workbench", exact: true });
    await expect(download).toBeInViewport();
    expect((await download.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator(".fg-site-projects > summary").click();
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("link")).toHaveCount(5);
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("link", { name: "Workbench", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "UI", exact: true })).toHaveAttribute(
      "href",
      "https://filipgutica.github.io/ui/",
    );
  });
});
test("section anchors, active state, and history retain native scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const nav = page.getByRole("navigation", { name: "On this page" });
  await markScrollEnd(page);
  await nav.getByRole("link", { name: "Walkthrough", exact: true }).click();
  await ended(page);
  await atReadingTop(page, "walkthrough-heading");
  await expect(nav.getByRole("link", { name: "Walkthrough", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await markScrollEnd(page);
  await nav.getByRole("link", { name: "Workspaces", exact: true }).click();
  await ended(page);
  await atReadingTop(page, "scope-heading");
  await markScrollEnd(page);
  await page.goBack();
  await ended(page);
  await atReadingTop(page, "walkthrough-heading");
  await expect(page).toHaveURL(/#walkthrough-heading$/);
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  await expect(nav.getByRole("link", { name: "Jira", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(page).toHaveURL(/#walkthrough-heading$/);
});
test("initial section hash realigns after screenshot enhancement", async ({ page }) => {
  await load(page, "#scope-heading");
  await atReadingTop(page, "scope-heading");
});
test("inactive screenshot deep links and history select the matching tab", async ({ page }) => {
  await load(page, "#walkthrough-notifications");
  await expect(page.getByRole("tab", { name: "Notifications", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#walkthrough-notifications")).toBeVisible();
  await atReadingTop(page, "walkthrough-notifications");
  await page.evaluate(() => {
    location.hash = "walkthrough-workspace";
  });
  await expect(page.getByRole("tab", { name: "Workspace", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await atReadingTop(page, "walkthrough-workspace");
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Notifications", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await atReadingTop(page, "walkthrough-notifications");
});
test("tabs support keyboard controls and retained original screenshot links", async ({ page }) => {
  await load(page);
  const first = page.getByRole("tab", { name: "Ticket", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Workspace", exact: true })).toBeFocused();
  await expect(page.locator("#walkthrough-workspace")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Jira (optional)", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  expect(await page.locator("[data-walkthrough-frame]").count()).toBe(6);
  for (const link of await page.locator("[data-product-image]").all())
    await expect(link).toHaveAttribute("href", /\/t3code\/_astro\/.*\.png$/);
});
test("image dialog uses original pixels, scales to DPR, and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await load(page);
  const link = page.locator(".hero-media [data-product-image]");
  const original = await link.getAttribute("href");
  await link.click();
  const dialog = page.getByRole("dialog", { name: /Orbit Workbench Board/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveAttribute("src", original!);
  const measured = await dialog.locator("img").evaluate((image) => ({
    original: image.getAttribute("width"),
    dpr: devicePixelRatio,
  }));
  await expect
    .poll(() => dialog.locator("img").evaluate((image) => image.getBoundingClientRect().width))
    .toBe(Number(measured.original) / measured.dpr);
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(link).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await link.click();
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeCloseTo(0, 0);
  expect(rect!.width).toBeCloseTo(390, 0);
  await dialog.getByRole("button", { name: "Close screenshot", exact: true }).click();
  await expect(link).toBeFocused();
});
test("full-size screenshots keep one source pixel per screen pixel on Retina", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    await load(page);
    await page.locator(".hero-media [data-product-image]").click();
    const image = page.getByRole("dialog", { name: /Orbit Workbench Board/ }).locator("img");
    const pixels = await image.evaluate((element) => ({
      original: Number(element.getAttribute("width")),
      dpr: devicePixelRatio,
    }));
    expect(pixels.dpr).toBe(2);
    await expect
      .poll(() => image.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(pixels.original / 2);
  } finally {
    await context.close();
  }
});

test("modifier click preserves the original PNG navigation", async ({ page, context }) => {
  await load(page);
  const link = page.locator(".hero-media [data-product-image]");
  const popup = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/\.png$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await opened.close();
});
test("phone section navigation stays keyboard accessible across breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await load(page);
  const nav = page.getByRole("navigation", { name: "On this page" });
  const jira = nav.getByRole("link", { name: "Jira", exact: true });
  await jira.focus();
  await expect(jira).toBeFocused();
  await expect(jira).toBeInViewport();
  await markScrollEnd(page);
  await page.keyboard.press("Enter");
  await ended(page);
  await atReadingTop(page, "jira-heading");
  await expect(page).toHaveURL(/#jira-heading$/);
  await jira.focus();
  await expect(jira).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(jira).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(jira).toBeFocused();
  await noOverflow(page);
});
test("themes support saved choice, system changes, and cross-tab updates", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "System theme", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  const other = await context.newPage();
  await other.goto("/t3code/");
  await other.evaluate(() => localStorage.setItem("tool-site-theme", "light"));
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Light theme", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await other.close();
});
test("reduced motion keeps section navigation and screenshot changes immediate", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("#walkthrough-workspace [data-product-image]")
        .evaluate((element) => element.getAnimations().length),
    )
    .toBe(0);
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Workspaces", exact: true })
    .click();
  await atReadingTop(page, "scope-heading");
  await noOverflow(page);
});
