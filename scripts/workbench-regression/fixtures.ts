// @effect-diagnostics nodeBuiltinImport:off - Playwright host fixtures own disposable state.
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { setupHome } from "../workbench-demo/environment.mts";
import { withDemoAccess } from "../workbench-demo/access.mts";
import { runRpc, readShellSnapshot } from "../workbench-demo/local.mts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import { configureProvider } from "./provider-settings.mts";
import { resetToBaseline } from "../workbench-demo/reset-to-baseline.mts";
import { decodeJiraAuthBundle } from "../workbench-demo/jira-auth.mts";
import { resetJira, validateJiraBaseline } from "../workbench-demo/remotes.mts";
import { DEMO_REPOSITORIES } from "../workbench-demo/repositories.mts";

export type Demo = {
  home: string;
  origin: string;
  workbenchUrl: (path: string) => string;
  rpc: <A, E>(operation: Parameters<typeof runRpc<A, E>>[2]) => Promise<A>;
  shellSnapshot: () => ReturnType<typeof readShellSnapshot>;
};
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const workbenchUrlFor = (environmentId: string, path: string): string => {
  const url = new URL(path, "http://workbench.test");
  if (url.pathname !== "/workbench") throw new Error(`Expected a Workbench URL, received ${path}.`);
  url.searchParams.set("environmentId", environmentId);
  return `${url.pathname}${url.search}${url.hash}`;
};

const waitForWorkbenchStartup = async (page: Page, demo: Demo) => {
  await page.goto(demo.workbenchUrl("/workbench?workbenchProjectId=orbit"));
  await Promise.all([
    expect(page.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible({
      timeout: 60_000,
    }),
    expect(page.getByRole("list", { name: "Workbench Workspaces", exact: true })).toBeVisible({
      timeout: 60_000,
    }),
  ]);
};

export const test = base.extend<{}, { demo: Demo; pairedState: StorageState }>({
  // Playwright requires an explicit destructuring pattern for fixture dependencies.
  demo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const live = process.env.WORKBENCH_REGRESSION_LIVE === "1";
      const home = setupHome(
        live && process.env.DEMO_HOME
          ? process.env.DEMO_HOME
          : await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "workbench-regression-")),
      );
      const required = (key: string) => {
        const value = process.env[key];
        if (!value?.trim()) throw new Error(`Live regression requires ${key}.`);
        return value;
      };
      const baseline = live
        ? validateJiraBaseline(JSON.parse(required("DEMO_JIRA_BASELINE")))
        : undefined;
      if (baseline) {
        const entries = {
          DEMO_JIRA_SITE_URL: required("DEMO_JIRA_SITE_URL"),
          DEMO_JIRA_PROJECT_KEY: required("DEMO_JIRA_PROJECT_KEY"),
          DEMO_JIRA_BOARD_ID: required("DEMO_JIRA_BOARD_ID"),
          DEMO_JIRA_EMAIL: required("DEMO_JIRA_EMAIL"),
          DEMO_JIRA_API_TOKEN: required("DEMO_JIRA_API_TOKEN"),
          DEMO_JIRA_SPRINT_ID: String(baseline.sprintId),
          DEMO_GITHUB_REPOSITORIES: Object.values(DEMO_REPOSITORIES)
            .map((repo) => repo.repository)
            .join(","),
        };
        if (
          baseline.site !== entries.DEMO_JIRA_SITE_URL ||
          baseline.projectKey !== entries.DEMO_JIRA_PROJECT_KEY ||
          baseline.boardId !== Number(entries.DEMO_JIRA_BOARD_ID)
        )
          throw new Error("Jira baseline does not match the configured site/project/board.");
        await NodeFSP.writeFile(
          NodePath.join(home, "config.env"),
          Object.entries(entries)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join("\n"),
          { mode: 0o600 },
        );
        await NodeFSP.writeFile(
          NodePath.join(home, "remotes.json"),
          JSON.stringify({ jiraBaseline: baseline }),
          { mode: 0o600 },
        );
      }
      const server = live
        ? await resetToBaseline({
            home,
            remoteApply: true,
            oauthBundle: decodeJiraAuthBundle(required("DEMO_JIRA_OAUTH_BUNDLE")),
            configure: configureProvider,
          })
        : await resetToBaseline({ home, remoteApply: false, configure: configureProvider });
      try {
        const environmentId = (
          await NodeFSP.readFile(NodePath.join(home, "userdata", "environment-id"), "utf8")
        ).trim();
        if (!environmentId) throw new Error("The demo has no environment ID.");
        await NodeFSP.writeFile(NodePath.join(home, "pairing-url"), server.pairingUrl, {
          mode: 0o600,
        });
        // One short-lived session belongs to this worker's disposable server.
        // Snapshot assertions still read through real RPCs; revocation runs before shutdown.
        await withDemoAccess(
          home,
          ({ wsUrl, token }) =>
            use({
              home,
              origin: server.origin,
              workbenchUrl: (path) => workbenchUrlFor(environmentId, path),
              rpc: (operation) => runRpc(wsUrl, token, operation),
              shellSnapshot: () => readShellSnapshot(wsUrl, token),
            }),
          // Covers the 25-minute live-job ceiling, including slow Jira responses.
          { ttl: "30m" },
        );
      } finally {
        await server.stop();
        if (baseline)
          await resetJira({
            baseline,
            email: required("DEMO_JIRA_EMAIL"),
            token: required("DEMO_JIRA_API_TOKEN"),
            apply: true,
          });
      }
    },
    { scope: "worker", timeout: 180_000 },
  ],
  pairedState: [
    async ({ browser, demo }, use, workerInfo) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const startupErrors: string[] = [];
        const pendingScripts = new Set<string>();
        page.on("pageerror", (error) => startupErrors.push(error.message));
        page.on("request", (request) => {
          if (request.resourceType() === "script")
            pendingScripts.add(new URL(request.url()).pathname);
        });
        page.on("requestfinished", (request) =>
          pendingScripts.delete(new URL(request.url()).pathname),
        );
        page.on("requestfailed", (request) => {
          pendingScripts.delete(new URL(request.url()).pathname);
          if (request.resourceType() === "script")
            startupErrors.push(
              `${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
            );
        });
        await page.goto(await NodeFSP.readFile(NodePath.join(demo.home, "pairing-url"), "utf8"));
        await expect(page).not.toHaveURL(/\/pair/, { timeout: 30_000 });
        try {
          // The pairing redirect precedes the first app render. Navigating again here
          // can abort Vite's lazy module requests and strand bundled dev on its splash.
          await expect(
            page.getByRole("button", { name: "Toggle main sidebar", exact: true }),
          ).toBeVisible({
            timeout: 30_000,
          });
          // Publish storage only once the seeded application is ready for test navigation.
          await page.goto(
            `${demo.origin}${demo.workbenchUrl("/workbench?workbenchProjectId=orbit")}`,
          );
          await expect(page.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible({
            timeout: 30_000,
          });
        } catch (error) {
          await NodeFSP.mkdir(workerInfo.project.outputDir, { recursive: true });
          await page.screenshot({
            path: NodePath.join(workerInfo.project.outputDir, "startup-failure.png"),
          });
          await NodeFSP.writeFile(
            NodePath.join(workerInfo.project.outputDir, "startup-failure.json"),
            JSON.stringify({ errors: startupErrors, pendingScripts: [...pendingScripts] }, null, 2),
          );
          throw error;
        }
        // Registered environments live in IndexedDB, alongside the session cookie.
        await use(await context.storageState({ indexedDB: true }));
      } finally {
        await context.close();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  page: [
    async ({ page, demo }, use) => {
      await waitForWorkbenchStartup(page, demo);
      await use(page);
    },
    { scope: "test", timeout: 120_000 },
  ],
  storageState: async ({ pairedState }, use) => use(pairedState),
  baseURL: async ({ demo }, use) => use(demo.origin),
});

export { expect };
export const snapshot = (demo: Demo) =>
  demo.rpc((client) => client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}));

export const jiraSnapshot = (demo: Demo) =>
  demo.rpc((client) => client[WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]({}));
