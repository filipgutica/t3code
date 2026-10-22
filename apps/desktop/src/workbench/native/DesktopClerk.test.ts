// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Hosted handoff test uses a real localhost listener without an OpenAI account.
import * as NodeHttp from "node:http";
import * as NodePath from "@effect/platform-node/NodePath";
import { codexAuthHandoffUrl, readCodexAuthDelivery } from "@t3tools/shared/codexAuthHandoff";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, vi } from "vite-plus/test";

const { createClerkBridgeMock, storageAdapter, storageMock } = vi.hoisted(() => ({
  createClerkBridgeMock: vi.fn(),
  storageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  storageMock: vi.fn(),
}));

vi.mock("@clerk/electron", () => ({
  createClerkBridge: createClerkBridgeMock,
}));

vi.mock("@clerk/electron/storage", () => ({
  storage: storageMock,
}));

import * as FileSystem from "effect/FileSystem";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopClerk from "../../app/DesktopClerk.ts";
import * as DesktopWebLinks from "../../app/DesktopWebLinks.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";

const layerDesktopClerk = (
  isDevelopment = true,
  events: string[] = [],
  platform: NodeJS.Platform = "darwin",
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = FileSystem.layerNoop({
    exists: () => Effect.succeed(false),
  }),
  shell: ElectronShell.ElectronShell["Service"] = {
    openExternal: () => Effect.succeed(true),
    openSystemSettings: () => Effect.succeed(false),
    copyText: () => Effect.void,
  },
) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    stateDir: "/tmp/t3-state",
    isDevelopment,
    appDataDirectory: "/tmp/app-data",
    platform,
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  const electronApp = {
    requestSingleInstanceLock: Effect.succeed(true),
    on: () => Effect.void,
    setPath: (name: string, value: string) =>
      Effect.sync(() => {
        events.push(`setPath:${name}:${value}`);
      }),
  } as unknown as ElectronApp.ElectronApp["Service"];

  return DesktopClerk.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodePath.layerPosix,
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        Layer.succeed(ElectronShell.ElectronShell, shell),
        fileSystemLayer,
      ),
    ),
  );
};

it.effect.each([
  ["t3code", "startup"],
  ["t3code", "open-url"],
  ["t3code-workbench", "startup"],
  ["t3code-workbench", "open-url"],
] as const)("receives hosted web sign-in through the %s %s handler", ([desktopScheme, entry]) =>
  Effect.gen(function* () {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", desktopScheme === "t3code-workbench");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const port = yield* Effect.promise(async () => {
      const server = NodeHttp.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return address.port;
    });
    const authorize = new URL("https://auth.openai.com/api/accounts/authorize");
    authorize.search = new URLSearchParams({
      client_id: "dynamic_agent_client",
      response_type: "code",
      redirect_uri: `http://127.0.0.1:${port}/auth/callback`,
      state: "a".repeat(43),
      code_challenge_method: "S256",
      code_challenge: "b".repeat(43),
    }).toString();
    const request = {
      authorizationUrl: authorize.toString(),
      returnUrl: "https://app.t3.codes/welcome#agents:remote-one",
      environmentId: EnvironmentId.make("remote-one"),
      instanceId: ProviderInstanceId.make("work"),
      flowId: "flow-one",
    };
    const link = codexAuthHandoffUrl(request, true, desktopScheme);
    const delivered = Promise.withResolvers<string>();
    const receivedWebLinks: string[] = [];
    const shell = ElectronShell.ElectronShell.of({
      openExternal: (value) =>
        Effect.promise(async () => {
          const url = new URL(String(value));
          const callback = new URL(url.searchParams.get("redirect_uri")!);
          callback.search = new URLSearchParams({
            state: url.searchParams.get("state")!,
            code: "test-code",
            client_id: "oaiapp_test",
          }).toString();
          const response = await fetch(callback, { redirect: "manual" });
          delivered.resolve(response.headers.get("location")!);
          return true;
        }),
      openSystemSettings: () => Effect.succeed(false),
      copyText: () => Effect.void,
    });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const electronApp = {
      requestSingleInstanceLock: Effect.succeed(true),
      whenReady: Effect.void,
      on: (name: string, listener: (...args: unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(name, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    yield* Effect.gen(function* () {
      const clerk = yield* DesktopClerk.DesktopClerk;
      yield* clerk.configure;
      if (entry === "open-url") {
        const event = { preventDefault: vi.fn() };
        listeners.get("open-url")!(event, link);
        assert.strictEqual(event.preventDefault.mock.calls.length, 1);
      }
      const delivery = readCodexAuthDelivery(yield* Effect.promise(() => delivered.promise));
      assert.strictEqual(delivery?.environmentId, request.environmentId);
      assert.strictEqual(delivery?.instanceId, request.instanceId);
      assert.strictEqual(delivery?.flowId, request.flowId);
      assert.strictEqual(delivery?.returnUrl, request.returnUrl);
      assert.deepStrictEqual(receivedWebLinks, []);
    }).pipe(
      Effect.provide(layerDesktopClerk(true, [], "darwin", undefined, shell)),
      Effect.provideService(HostProcess.Arguments, entry === "startup" ? ["t3", link] : ["t3"]),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(
        ElectronWindow.ElectronWindow,
        {} as ElectronWindow.ElectronWindow["Service"],
      ),
      Effect.provideService(
        DesktopWebLinks.DesktopWebLinks,
        DesktopWebLinks.DesktopWebLinks.of({
          receive: (url) => Effect.sync(() => void receivedWebLinks.push(url)),
          setRendererReady: () => Effect.void,
        }),
      ),
    );
  }).pipe(Effect.scoped),
);

afterEach(() => vi.unstubAllGlobals());
it.effect.each([true])(
  "hands web and app links and HTML files to the renderer and leaves other links alone (Workbench: %s)",
  (workbench) =>
    Effect.gen(function* () {
      vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", workbench);
      storageMock.mockReturnValue(storageAdapter);
      createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const electronApp = {
        requestSingleInstanceLock: Effect.succeed(true),
        whenReady: Effect.void,
        on: (name: string, listener: (...args: unknown[]) => void) =>
          Effect.sync(() => {
            listeners.set(name, listener);
          }),
      } as unknown as ElectronApp.ElectronApp["Service"];
      const received: Array<string> = [];
      yield* Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;
        const open = (url: string) => {
          const event = { preventDefault: vi.fn() };
          listeners.get("open-url")!(event, url);
          return event.preventDefault.mock.calls.length;
        };
        // macOS hands the default browser every web link.
        assert.strictEqual(open("https://example.com/page"), 1);
        assert.strictEqual(open("http://localhost:3000/"), 1);
        const scheme = workbench ? "t3code-workbench" : "t3code";
        assert.strictEqual(open(`${scheme}://new?prompt=hi`), 1);
        assert.strictEqual(open(`${scheme}://threads/env-1/thread-1`), 1);
        assert.strictEqual(open(`${scheme}://somewhere-else`), 0);
        // Anything else is not a web page; Electron keeps its own handling.
        assert.strictEqual(open("mailto:hello@example.com"), 0);
        const fileEvent = { preventDefault: vi.fn() };
        listeners.get("open-file")!(fileEvent, "/tmp/browser-page.html");
        listeners.get("open-file")!(fileEvent, "/tmp/not-a-web-page.txt");
        assert.strictEqual(fileEvent.preventDefault.mock.calls.length, 1);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(received, [
          "https://example.com/page",
          "http://localhost:3000/",
          `${scheme}://new?prompt=hi`,
          `${scheme}://threads/env-1/thread-1`,
          "file:///tmp/browser-page.html",
        ]);
      }).pipe(
        Effect.provide(layerDesktopClerk(true, [], "darwin")),
        Effect.provideService(HostProcess.Arguments, ["t3"]),
        Effect.provideService(ElectronApp.ElectronApp, electronApp),
        Effect.provideService(
          ElectronWindow.ElectronWindow,
          {} as ElectronWindow.ElectronWindow["Service"],
        ),
        Effect.provideService(
          DesktopWebLinks.DesktopWebLinks,
          DesktopWebLinks.DesktopWebLinks.of({
            receive: (url) => Effect.sync(() => void received.push(url)),
            setRendererReady: () => Effect.void,
          }),
        ),
      );
    }).pipe(Effect.scoped),
);
