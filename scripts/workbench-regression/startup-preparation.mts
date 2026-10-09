// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off - Owned browser fixture startup uses public native auth and runtime receipts.
import type { Browser, BrowserContext } from "@playwright/test";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { PersistedServerRuntimeState } from "../../apps/server/src/serverRuntimeState.ts";
import { requireHome } from "../workbench-demo/environment.mts";
import { configureProvider } from "./provider-settings.mts";
const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const decodeRuntime = Schema.decodeUnknownSync(PersistedServerRuntimeState);

type Runtime = { pid: number; startedAt: string; devUrl: string };
const readRuntime = async (home: string): Promise<Runtime | undefined> => {
  const directory = NodePath.join(home, "userdata");
  const file = NodePath.join(directory, "server-runtime.json");
  try {
    if ((await NodeFSP.lstat(directory)).isSymbolicLink())
      throw new Error("Demo state directory is a symlink.");
    if ((await NodeFSP.lstat(file)).isSymbolicLink())
      throw new Error("Demo runtime receipt is a symlink.");
    const value = decodeRuntime(JSON.parse(await NodeFSP.readFile(file, "utf8")));
    if (!value.devUrl) throw new Error("The demo runtime has no public dev origin.");
    const url = new URL(value.devUrl);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Browser preparation requires the owned local demo origin.");
    }
    process.kill(value.pid, 0);
    return { pid: value.pid, startedAt: value.startedAt, devUrl: url.origin };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    )
      return undefined;
    throw error;
  }
};
const sameRuntime = (a: Runtime, b: Runtime | undefined) =>
  b !== undefined && a.pid === b.pid && a.startedAt === b.startedAt && a.devUrl === b.devUrl;

/** Keep this browser alive through worker use; its pairing credential is separate from the launcher's. */
export const prepareStartup = (input: {
  browser: Browser;
  home: string;
  live: boolean;
  deadline: number;
}) => {
  const home = requireHome(input.home);
  let eligibleAfter = input.live ? Infinity : -Infinity;
  let watcher: NodeFS.FSWatcher | undefined;
  let context: BrowserContext | undefined;
  let settled = false;
  const {
    promise: receipt,
    resolve: resolveRuntime,
    reject: rejectRuntime,
  } = Promise.withResolvers<Runtime>();
  const remaining = () => {
    const timeout = input.deadline - Effect.runSync(Clock.currentTimeMillis);
    if (timeout <= 0)
      throw new Error("Browser preparation exhausted the existing demo worker budget.");
    return timeout;
  };
  let pairChild: NodeChildProcess.ChildProcess | undefined;
  let pairClosed: Promise<void> = Promise.resolve();
  const stopPairChild = async () => {
    const child = pairChild;
    if (!child || child.exitCode !== null || child.signalCode !== null) return pairClosed;
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 1_000);
    try {
      await pairClosed;
    } finally {
      clearTimeout(force);
    }
  };
  const fail = async (error: unknown) => {
    rejectRuntime(error);
    watcher?.close();
    // This Browser belongs to the failed fixture's worker, before fresh tests run.
    // Closing it also rejects pending newContext/newPage operations.
    await Promise.allSettled([stopPairChild(), input.browser.close()]);
  };
  const timeout = setTimeout(
    () => void fail(new Error("Browser preparation exhausted the existing demo worker budget.")),
    remaining(),
  );
  const check = async () => {
    try {
      const runtime = await readRuntime(home);
      if (!settled && runtime && Date.parse(runtime.startedAt) >= eligibleAfter) {
        settled = true;
        watcher?.close();
        resolveRuntime(runtime);
      }
    } catch (error) {
      rejectRuntime(error);
    }
  };
  const configure = async (directory: string) => {
    await configureProvider(directory);
    watcher = NodeFS.watch(NodePath.join(home, "userdata"), () => void check());
    watcher.on("error", rejectRuntime);
    await check();
  };
  const onAuthImported = async () => {
    // resetToBaseline invokes this while the migration boot is stopped.
    // Only the subsequently persisted server receipt is eligible for browser auth.
    eligibleAfter = Effect.runSync(Clock.currentTimeMillis);
    await check();
  };
  const ready = (async () => {
    const runtime = await receipt;
    remaining();
    context = await input.browser.newContext();
    remaining();
    const page = await context.newPage();
    remaining();
    {
      if (!sameRuntime(runtime, await readRuntime(home)))
        throw new Error("Demo runtime changed before browser preparation.");
      const pairingUrl = await new Promise<string>((resolve, reject) => {
        remaining();
        const child = NodeChildProcess.spawn(
          process.execPath,
          [
            "apps/server/src/bin.ts",
            "pair",
            "--base-dir",
            home,
            "--ttl",
            "5m",
            "--label",
            "Workbench regression browser preparation",
          ],
          { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
        );
        pairChild = child;
        Effect.runSync(
          Effect.logInfo(JSON.stringify({ stage: "preparation-pair-child-start", pid: child.pid })),
        );
        pairClosed = new Promise<void>((closed) => child.once("close", () => closed()));
        let output = "";
        child.stdout?.on("data", (chunk) => {
          output += chunk.toString();
          if (output.length > 64_000) {
            reject(new Error("Owned preparation pairing output exceeded its expected bound."));
            void stopPairChild();
          }
        });
        child.stderr?.on("data", () => {}); // Never forward credential-bearing output/errors.
        child.once("error", () => reject(new Error("Owned preparation pairing command failed.")));
        child.once("close", (code) => {
          Effect.runSync(
            Effect.logInfo(
              JSON.stringify({ stage: "preparation-pair-child-closed", pid: child.pid, code }),
            ),
          );
          if (code !== 0)
            return reject(new Error("Owned preparation pairing command did not complete."));
          const match = NodeUtil.stripVTControlCharacters(output).match(
            /Pairing URL:\s*(https?:\/\/[^\s]+)/,
          );
          if (!match?.[1])
            return reject(new Error("Owned preparation pairing command returned no URL."));
          resolve(match[1]);
        });
      });
      remaining();
      const pairing = new URL(pairingUrl);
      if (pairing.origin !== runtime.devUrl || pairing.pathname !== "/pair") {
        throw new Error("Owned preparation pairing URL does not match its runtime.");
      }
      const pending = new Set<object>();
      const idleWaiters = new Set<() => void>();
      page.on("request", (request) => {
        if (request.resourceType() === "script") pending.add(request);
      });
      const scriptIdle = () =>
        new Promise<void>((resolve, reject) => {
          if (pending.size === 0) return resolve();
          const timer = setTimeout(() => {
            idleWaiters.delete(done);
            reject(new Error("Startup scripts did not settle within the existing demo budget."));
          }, remaining());
          const done = () => {
            if (pending.size === 0) {
              clearTimeout(timer);
              idleWaiters.delete(done);
              resolve();
            }
          };
          idleWaiters.add(done);
        });
      page.on("requestfinished", (request) => {
        pending.delete(request);
        for (const done of idleWaiters) done();
      });
      page.on("requestfailed", (request) => {
        pending.delete(request);
        for (const done of idleWaiters) done();
      });
      try {
        await page.goto(pairing.href, { timeout: remaining() });
      } catch {
        throw new Error("Owned browser preparation could not load the pairing document.");
      }
      await page
        .getByRole("button", { name: "Toggle main sidebar", exact: true })
        .waitFor({ state: "visible", timeout: remaining() });
      await scriptIdle();
      const environmentId = (
        await NodeFSP.readFile(NodePath.join(home, "userdata", "environment-id"), "utf8")
      ).trim();
      const workbench = new URL("/workbench", runtime.devUrl);
      workbench.searchParams.set("environmentId", environmentId);
      workbench.searchParams.set("workbenchProjectId", "orbit");
      await page.goto(workbench.href, { timeout: remaining() });
      await page
        .getByRole("heading", { name: "Orbit", exact: true })
        .waitFor({ state: "visible", timeout: remaining() });
      await page
        .getByRole("list", { name: "Workbench Workspaces", exact: true })
        .waitFor({ state: "visible", timeout: remaining() });
      await scriptIdle();
      if (!sameRuntime(runtime, await readRuntime(home)))
        throw new Error("Demo runtime changed during browser preparation.");
    }
    remaining();
    return runtime;
  })()
    .catch(async (error) => {
      await fail(error);
      throw error;
    })
    .finally(() => clearTimeout(timeout));
  return {
    configure,
    onAuthImported,
    ready,
    cancel: async (error: unknown) => {
      await fail(error);
      await ready.catch(() => {});
    },
    verify: async (runtime: Runtime) => {
      if (!sameRuntime(runtime, await readRuntime(home)))
        throw new Error("The reset completed on a different demo runtime.");
    },
    close: async () => {
      clearTimeout(timeout);
      watcher?.close();
      rejectRuntime(new Error("Owned browser preparation closed."));
      try {
        await context?.close();
      } finally {
        await stopPairChild();
      }
    },
  };
};
