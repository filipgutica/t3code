// @effect-diagnostics nodeBuiltinImport:off - Playwright host fixtures own disposable state.
import { test as base, expect, type BrowserContext } from "@playwright/test";
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
  rpc: <A, E>(operation: Parameters<typeof runRpc<A, E>>[2]) => Promise<A>;
  shellSnapshot: () => ReturnType<typeof readShellSnapshot>;
};
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

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
        await NodeFSP.writeFile(NodePath.join(home, "pairing-url"), server.pairingUrl, {
          mode: 0o600,
        });
        // One short-lived session belongs to this worker's disposable server.
        // Snapshot assertions still read through real RPCs; revocation runs before shutdown.
        await withDemoAccess(home, ({ wsUrl, token }) =>
          use({
            home,
            origin: server.origin,
            rpc: (operation) => runRpc(wsUrl, token, operation),
            shellSnapshot: () => readShellSnapshot(wsUrl, token),
          }),
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
    async ({ browser, demo }, use) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(await NodeFSP.readFile(NodePath.join(demo.home, "pairing-url"), "utf8"));
        await expect(page).not.toHaveURL(/\/pair/, { timeout: 30_000 });
        await use(await context.storageState());
      } finally {
        await context.close();
      }
    },
    { scope: "worker" },
  ],
  storageState: async ({ pairedState }, use) => use(pairedState),
  baseURL: async ({ demo }, use) => use(demo.origin),
});

export { expect };
export const snapshot = (demo: Demo) =>
  demo.rpc((client) => client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}));

export const jiraSnapshot = (demo: Demo) =>
  demo.rpc((client) => client[WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot]({}));
