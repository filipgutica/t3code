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
    await expect(projects.getByRole("link")).toHaveCount(6);
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
[390, 1280].forEach((width) => {
  test(`header, section nav, graph, and content share one frame at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    const edges = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const graphs = [...document.querySelectorAll(".commit-graph")].map((graph) =>
        graph.getBoundingClientRect(),
      );
      return {
        headerRule: box(".fg-site-header").width - innerWidth,
        navRule: box(".section-navigation").width - innerWidth,
        frameLeft: box("main").left,
        frameRight: box("main").right,
        brand: box(".fg-site-projects__trigger span").left,
        nav: box("nav.section-nav a").left,
        graphLeft: Math.min(...graphs.map((graph) => graph.left)),
        graphRight: Math.max(...graphs.map((graph) => graph.right)),
        headings: [...document.querySelectorAll("main :is(h1, h2)")].map(
          (heading) => heading.getBoundingClientRect().left,
        ),
        media: box(".hero-media"),
        themeSwitch: box(".fg-site-appearance").right,
      };
    });
    expect(edges.headerRule).toBe(0);
    expect(edges.navRule).toBe(0);
    for (const left of [edges.brand, edges.nav, edges.graphLeft])
      expect(left).toBeCloseTo(edges.frameLeft, 0);
    // Headings and the hero image start on the content column, right of the graph.
    for (const left of edges.headings) expect(left).toBeCloseTo(edges.media.left, 0);
    expect(edges.graphRight).toBeLessThanOrEqual(edges.media.left);
    expect(edges.media.right).toBeCloseTo(edges.frameRight, 0);
    expect(edges.themeSwitch).toBeCloseTo(edges.frameRight, 0);
  });
});
test("section anchors, active state, and history retain native scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const nav = page.getByRole("navigation", { name: "On this page" });
  await markScrollEnd(page);
  await nav.getByRole("link", { name: "Plan", exact: true }).click();
  await ended(page);
  await atReadingTop(page, "plan-heading");
  await expect(nav.getByRole("link", { name: "Plan", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await markScrollEnd(page);
  await nav.getByRole("link", { name: "Worktrees", exact: true }).click();
  await ended(page);
  await atReadingTop(page, "worktrees-heading");
  await markScrollEnd(page);
  await page.goBack();
  await ended(page);
  await atReadingTop(page, "plan-heading");
  await expect(page).toHaveURL(/#plan-heading$/);
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  await expect(nav.getByRole("link", { name: "Review", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(page).toHaveURL(/#plan-heading$/);
});
test("section and screenshot deep links land on their target", async ({ page }) => {
  await load(page, "#worktrees-heading");
  await atReadingTop(page, "worktrees-heading");
  await load(page, "#walkthrough-notifications");
  await atReadingTop(page, "walkthrough-notifications");
});
test("every screenshot links to its original PNG", async ({ page }) => {
  await load(page);
  const links = page.locator("[data-product-image]");
  await expect(links).toHaveCount(9);
  for (const link of await links.all())
    await expect(link).toHaveAttribute("href", /\/t3code\/_astro\/.*\.png$/);
});
test("image dialog uses original pixels, scales to DPR, and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 1440 });
  await load(page);
  const link = page.locator(".hero-media [data-product-image]");
  const original = await link.getAttribute("href");
  await link.click();
  const dialog = page.getByRole("dialog", { name: /Beacon Workbench Board/ });
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
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await load(page);
    await page.locator(".hero-media [data-product-image]").click();
    const image = page.getByRole("dialog", { name: /Beacon Workbench Board/ }).locator("img");
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
  // A background tab can report about:blank after its initial load event.
  await opened.waitForURL(/\.png$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await opened.close();
});
test("phone section navigation stays keyboard accessible across breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await load(page);
  const nav = page.getByRole("navigation", { name: "On this page" });
  const review = nav.getByRole("link", { name: "Review", exact: true });
  await review.focus();
  await expect(review).toBeFocused();
  await expect(review).toBeInViewport();
  await markScrollEnd(page);
  await page.keyboard.press("Enter");
  await ended(page);
  await atReadingTop(page, "review-heading");
  await expect(page).toHaveURL(/#review-heading$/);
  await review.focus();
  await expect(review).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(review).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeFocused();
  await noOverflow(page);
});
test("themes switch screenshot previews, originals, and an open lightbox", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const hero = page.locator(".hero-media img");
  const link = page.locator(".hero-media [data-product-image]");
  const currentSource = () =>
    hero.evaluate((image) => (image instanceof HTMLImageElement ? image.currentSrc : ""));
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect.poll(currentSource).toMatch(/board-light[.]/);
  const lightOriginal = await link.getAttribute("href");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(currentSource).toMatch(/board[.]/);
  const darkOriginal = await link.getAttribute("href");
  expect(darkOriginal).not.toBe(lightOriginal);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(currentSource).toMatch(/board[.]/);
  await expect(link).toHaveAttribute("href", darkOriginal!);
  await page.getByRole("button", { name: "System theme", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect.poll(currentSource).toMatch(/board-light[.]/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(currentSource).toMatch(/board[.]/);
  await link.click();
  const fullSize = page.getByRole("dialog").locator("img");
  await expect(fullSize).toHaveAttribute("src", darkOriginal!);
  const other = await context.newPage();
  await other.goto("/t3code/");
  await other.evaluate(() => localStorage.setItem("tool-site-theme", "light"));
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect.poll(currentSource).toMatch(/board-light[.]/);
  await expect(fullSize).toHaveAttribute("src", lightOriginal!);
  await page.keyboard.press("Escape");
  await expect(link).toBeFocused();
  await expect(page.getByRole("button", { name: "Light theme", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await other.close();
});
const graphState = (page: Page) =>
  page.evaluate(() => {
    const shown = (element: Element) =>
      getComputedStyle(element).display !== "none" && element.getClientRects().length > 0;
    const centre = innerHeight / 2;
    const nodes = [...document.querySelectorAll(".graph-node")].filter(shown).map((node) => {
      const box = node.getBoundingClientRect();
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        radius: box.height / 2,
        filled: Number(getComputedStyle(node.firstElementChild!).opacity),
        section: node.closest("section")!.getAttribute("aria-labelledby"),
      };
    });
    const lines = [...document.querySelectorAll(".graph-segment > i")].filter(shown).map((fill) => {
      const track = fill.parentElement!.getBoundingClientRect();
      return { top: track.top, bottom: track.bottom, drawnTo: fill.getBoundingClientRect().bottom };
    });
    return { centre, nodes, lines };
  });
// Lines are drawn down to the viewport's centre line, and nodes above it are filled.
const followsCentreLine = async (page: Page) => {
  const { centre, nodes, lines } = await graphState(page);
  const misdrawn = lines.filter(({ top, bottom, drawnTo }) => {
    const expected = Math.min(Math.max(centre, top), bottom);
    return Math.abs(drawnTo - expected) > 1.5;
  });
  const misfilled = nodes.filter(({ y, radius, filled }) =>
    y < centre - radius ? filled !== 1 : y > centre + radius ? filled !== 0 : false,
  );
  return misdrawn.length + misfilled.length;
};
const scrollToCentre = (page: Page, id: string, offset: number) =>
  page.evaluate(
    ({ id, offset }) => {
      const heading = document.getElementById(id)!.getBoundingClientRect();
      scrollTo({ top: scrollY + heading.top - innerHeight / 2 + offset, behavior: "instant" });
    },
    { id, offset },
  );

test("the commit graph draws to the viewport's centre line and is only scroll-linked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  await expect.poll(() => followsCentreLine(page)).toBe(0);
  // Centre line inside the fork's branch lanes, then just past the merge node.
  for (const [id, offset] of [
    ["threads-heading", 240],
    ["review-heading", 120],
  ] as const) {
    await scrollToCentre(page, id, offset);
    await expect.poll(() => followsCentreLine(page)).toBe(0);
  }
  const { centre, nodes } = await graphState(page);
  expect(nodes.filter((node) => node.y < centre).length).toBeGreaterThan(0);
  expect(nodes.filter((node) => node.y > centre).length).toBeGreaterThan(0);
  // Every animation follows scroll, so nothing runs while the page is idle.
  const animations = await page.evaluate(() =>
    document.getAnimations().map((animation) => animation.timeline instanceof ViewTimeline),
  );
  expect(animations.length).toBeGreaterThan(0);
  expect(animations.every(Boolean)).toBe(true);
});

test("the graph forks into a lane per repository and merges back at review", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const lanes = async () => {
    const { nodes } = await graphState(page);
    const main = nodes.find((node) => node.section === "hero-heading")!.x;
    const lanesOf = (section: string) =>
      nodes.filter((node) => node.section === section).map((node) => Math.round(node.x - main));
    return {
      worktrees: lanesOf("worktrees-heading"),
      threads: lanesOf("threads-heading"),
      review: lanesOf("review-heading"),
      install: lanesOf("install-heading"),
    };
  };
  const desktop = await lanes();
  expect(desktop.worktrees).toHaveLength(2);
  expect(desktop.worktrees.every((offset) => offset > 0)).toBe(true);
  expect(desktop.threads).toEqual(desktop.worktrees);
  expect(desktop.review).toEqual([0]);
  expect(desktop.install).toEqual([0]);
  await expect(page.locator(".graph-curve")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".graph-curve").first()).toBeHidden();
  const phone = await lanes();
  expect(phone.worktrees).toEqual([0]);
  expect(phone.threads).toEqual([0]);
  await noOverflow(page);
});

[390, 1280].forEach((width) => {
  test(`each commit node sits on its heading's first line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    const offsets = await page.evaluate(() =>
      [...document.querySelectorAll("main section")].flatMap((section) => {
        const heading = section.querySelector("h1, h2")!;
        const line =
          heading.getBoundingClientRect().top +
          parseFloat(getComputedStyle(heading).lineHeight) / 2;
        return [...section.querySelectorAll(".graph-node")]
          .filter((node) => getComputedStyle(node).display !== "none")
          .map((node) => {
            const box = node.getBoundingClientRect();
            return Math.abs(box.top + box.height / 2 - line);
          });
      }),
    );
    // Two worktree lanes on desktop; one lane on phones.
    expect(offsets).toHaveLength(width === 1280 ? 9 : 7);
    for (const offset of offsets) expect(offset).toBeLessThan(1);
  });
});

(
  [
    [320, 640],
    [1280, 900],
  ] as const
).forEach(([width, height]) => {
  test(`the merged node fills at the end of the page at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await load(page);
    await page.evaluate(() =>
      scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect(page.locator(".graph-node--merged > i")).toHaveCSS("opacity", "1");
  });
});

test("reduced motion shows the whole graph drawn and keeps navigation immediate", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const { nodes, lines } = await graphState(page);
  expect(nodes.every((node) => node.filled === 1)).toBe(true);
  expect(lines.every((line) => Math.abs(line.drawnTo - line.bottom) < 0.5)).toBe(true);
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Worktrees", exact: true })
    .click();
  await atReadingTop(page, "worktrees-heading");
  await noOverflow(page);
});
