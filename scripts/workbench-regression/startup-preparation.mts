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
const diagnosticHttpPaths = new Set([
  "/api/auth/session",
  "/api/auth/browser-session",
  "/.well-known/t3/environment",
]);
const diagnosticScriptPaths = new Set(["/@vite/client", "/src/bootstrap.ts", "/src/main.tsx"]);
const diagnosticRoutePaths = new Set([
  "/",
  "/pair",
  "/welcome",
  "/workbench",
  "/settings",
  "/connect",
  "/connect-agent",
]);
const diagnosticSourcePaths = new Set([
  "/src/AppRoot.tsx",
  "/src/main.tsx",
  "/src/bootstrap.ts",
  "/src/router.ts",
  "/src/routes/__root.tsx",
  "/src/routes/pair.tsx",
  "/src/components/auth/PairingRouteSurface.tsx",
  "/src/components/promptLinks/HostedPromptLinkLanding.tsx",
  "/src/components/ui/input.tsx",
  "/src/components/ui/button.tsx",
  "/src/components/ui/standalone-page.tsx",
  "/src/environments/primary/auth.ts",
  "/src/environments/primary/context.ts",
  "/src/environments/primary/httpClient.ts",
  "/src/environments/primary/httpLayer.ts",
  "/src/browser/BrowserProfileReporter.tsx",
  "/src/browser/ElectronBrowserHost.tsx",
  "/src/state/query.ts",
  "/src/lib/runtime.ts",
]);
const safeDiagnosticPath = (value: string, origin: string, allowlist: ReadonlySet<string>) => {
  try {
    const url = new URL(value);
    if (url.origin !== origin) return undefined;
    return allowlist.has(url.pathname) ? url.pathname : "OTHER";
  } catch {
    return undefined;
  }
};
const diagnosticSource = (stack: string, origin: string) => {
  for (const match of stack.matchAll(/https?:\/\/[^\s)]+/g)) {
    const path = safeDiagnosticPath(
      match[0].replace(/:\d+:\d+$/, ""),
      origin,
      diagnosticSourcePaths,
    );
    if (path !== undefined && path !== "OTHER") return path;
  }
  return undefined;
};
const classifyDiagnosticError = (error: Pick<Error, "name" | "message">) => {
  const name = ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(
    error.name,
  )
    ? error.name
    : "Error";
  const category = /does not provide an export named|has no exported member/i.test(error.message)
    ? "missing-module-export"
    : /failed to fetch dynamically imported module|importing a module script failed|loading chunk/i.test(
          error.message,
        )
      ? "dynamic-import"
      : /failed to fetch|failed to load module script|cannot find module/i.test(error.message)
        ? "fetch"
        : /PrimaryEnvironmentRequestError|Primary environment request failed/i.test(error.message)
          ? "environment-request"
          : /ParseError|SchemaError|schema.*decod|decod.*schema/i.test(error.message)
            ? "schema-decode"
            : /service not found|missing service|no service found/i.test(error.message)
              ? "missing-service"
              : /invalid hook call|rendered (?:more|fewer) hooks|useEffectEvent/i.test(
                    error.message,
                  )
                ? "react-hooks"
                : name === "ReferenceError" || /\bReferenceError\b/.test(error.message)
                  ? "reference"
                  : name === "TypeError" || /\bTypeError\b/.test(error.message)
                    ? "type"
                    : /error occurred in the|error boundary/i.test(error.message)
                      ? "react-render"
                      : "other";
  const operation = [
    "fetch-session-state",
    "exchange-bootstrap-credential",
    "fetch-environment-descriptor",
  ].find((value) => error.message.includes(value));
  const typeDetail = /cannot read properties of null|cannot read property .* of null/i.test(
    error.message,
  )
    ? "null-property"
    : /cannot read properties of undefined|cannot read property .* of undefined/i.test(
          error.message,
        )
      ? "undefined-property"
      : /is not a function|not callable/i.test(error.message)
        ? "not-callable"
        : /is not a constructor/i.test(error.message)
          ? "not-constructor"
          : /not iterable/i.test(error.message)
            ? "not-iterable"
            : /incompatible receiver|illegal invocation/i.test(error.message)
              ? "incompatible-receiver"
              : "other";
  return {
    name,
    category,
    ...(operation === undefined ? {} : { operation }),
    ...(category === "type" ? { typeDetail } : {}),
  };
};

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
  let reportBrowserFailure: (() => void) | undefined;
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
    try {
      reportBrowserFailure?.();
    } catch {
      // Diagnostic emission must not replace the original startup failure.
    }
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
      // Failure logs contain only fixed labels, allowlisted paths and numeric
      // statuses/counts. Never publish URLs, messages, stacks or browser content.
      const events: Array<Readonly<Record<string, string | number>>> = [];
      let droppedEvents = 0;
      let consoleErrors = 0;
      let reported = false;
      let snapshotPending = false;
      let domSnapshot:
        | {
            bootError: boolean;
            routeError: boolean;
            pairingInput: boolean;
            pairingInputDisabled?: boolean;
            pendingPairing: boolean;
          }
        | undefined;
      const record = (event: (typeof events)[number]) => {
        if (events.length === 32) {
          events.shift();
          droppedEvents = Math.min(droppedEvents + 1, 10_000);
        }
        events.push(event);
      };
      const safePath = (value: string, allowlist: ReadonlySet<string>) =>
        safeDiagnosticPath(value, runtime.devUrl, allowlist);
      const captureDomSnapshot = () => {
        if (reported || snapshotPending) return;
        snapshotPending = true;
        // Never await diagnostics during failure cleanup: browser closure cancels pending reads.
        void Promise.all([
          page.locator("#boot-error").count(),
          page.getByRole("heading", { name: "Something went wrong.", exact: true }).count(),
          page.locator("#pairing-token").evaluateAll((elements) => {
            const input = elements[0];
            return input instanceof HTMLInputElement
              ? { present: true, disabled: input.disabled }
              : { present: false };
          }),
          page.getByRole("heading", { name: "Pairing with this environment", exact: true }).count(),
        ])
          .then(([bootError, routeError, pairingInput, pendingPairing]) => {
            if (reported) return;
            domSnapshot = {
              bootError: bootError > 0,
              routeError: routeError > 0,
              pairingInput: pairingInput.present,
              ...(pairingInput.disabled === undefined
                ? {}
                : { pairingInputDisabled: pairingInput.disabled }),
              pendingPairing: pendingPairing > 0,
            };
          })
          .catch(() => {})
          .finally(() => {
            snapshotPending = false;
          });
      };
      page.on("pageerror", (error) => {
        record({ kind: "page-error", ...classifyDiagnosticError(error) });
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors = Math.min(consoleErrors + 1, 10_000);
          const text = message.text();
          const source =
            diagnosticSource(text.slice(0, 16_384), runtime.devUrl) ??
            safePath(message.location().url, diagnosticSourcePaths);
          record({
            kind: "console-error",
            ...classifyDiagnosticError({ name: "Error", message: text }),
            ...(source === undefined || source === "OTHER" ? {} : { source }),
          });
          if (consoleErrors <= 8) {
            captureDomSnapshot();
            for (const argument of message.args().slice(0, 3)) {
              void argument
                .evaluate((value: unknown) => {
                  if (!(value instanceof Error)) return undefined;
                  const message = Object.getOwnPropertyDescriptor(value, "message");
                  const stack = Object.getOwnPropertyDescriptor(value, "stack");
                  const name = Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(value),
                    "name",
                  );
                  // Skip accessors and coercion; raw fields remain transient and bounded.
                  return {
                    name: typeof name?.value === "string" ? name.value.slice(0, 64) : "Error",
                    message:
                      typeof message?.value === "string" ? message.value.slice(0, 8_192) : "",
                    ...(typeof stack?.value === "string"
                      ? { stack: stack.value.slice(0, 16_384) }
                      : {}),
                  };
                })
                .then((error) => {
                  if (reported || error === undefined) return;
                  const source = diagnosticSource(error.stack ?? "", runtime.devUrl);
                  record({
                    kind: "console-error-detail",
                    ...classifyDiagnosticError(error),
                    stackAvailable: error.stack === undefined ? 0 : 1,
                    ...(source === undefined ? {} : { source }),
                  });
                })
                .catch(() => {});
            }
          }
        }
      });
      page.on("response", (response) => {
        const path = safePath(response.url(), diagnosticHttpPaths);
        if (path !== undefined && path !== "OTHER") {
          record({ kind: "http-response", path, status: response.status() });
        } else if (response.status() >= 400 && response.request().resourceType() === "script") {
          const script = safePath(response.url(), diagnosticScriptPaths);
          if (script !== undefined)
            record({ kind: "script-response", path: script, status: response.status() });
        }
      });
      reportBrowserFailure = () => {
        if (reported) return;
        reported = true;
        Effect.runSync(
          Effect.logInfo(
            JSON.stringify({
              stage: "preparation-browser-failure",
              finalPath: safePath(page.url(), diagnosticRoutePaths) ?? "OTHER",
              consoleErrors,
              droppedEvents,
              domSnapshot:
                domSnapshot === undefined
                  ? { captured: false }
                  : { captured: true, observedAt: "console-error", ...domSnapshot },
              events,
            }),
          ),
        );
      };
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
        if (request.resourceType() === "script") {
          const path = safePath(request.url(), diagnosticScriptPaths);
          if (path !== undefined) record({ kind: "script-failed", path });
        }
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
