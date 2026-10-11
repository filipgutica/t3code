// @effect-diagnostics nodeBuiltinImport:off - Tests model the Linux pre-ready paths without starting Electron.
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

afterEach(() => vi.unstubAllGlobals());

const cases = [
  {
    workbench: false,
    development: false,
    home: ".t3/userdata",
    scheme: "t3code",
    wmClass: "t3code",
    desktopEntry: "com.t3tools.T3Code.desktop",
  },
  {
    workbench: false,
    development: true,
    home: ".t3/dev",
    scheme: "t3code-dev",
    wmClass: "t3code-dev",
    desktopEntry: "com.t3tools.T3Code.Development.desktop",
  },
  {
    workbench: true,
    development: false,
    home: ".t3-workbench/userdata",
    scheme: "t3code-workbench",
    wmClass: "t3code-workbench",
    desktopEntry: "com.filipgutica.t3code.workbench.desktop",
  },
  {
    workbench: true,
    development: true,
    home: ".t3-workbench/dev",
    scheme: "t3code-workbench-dev",
    wmClass: "t3code-workbench",
    desktopEntry: "com.filipgutica.t3code.workbench.desktop",
  },
] as const;

describe("desktop product bootstrap", () => {
  it.each(cases)(
    "selects $scheme protocol, settings and Linux identity before Electron starts",
    async ({ workbench, development, home, scheme, wmClass, desktopEntry }) => {
      vi.resetModules();
      vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", workbench);
      const protocol = await import("../electron/ElectronProtocol.ts");
      const startup = await import("../app/DesktopEarlyElectronStartup.ts");

      assert.equal(protocol.getDesktopScheme(development), scheme);
      assert.equal(protocol.getDesktopUrl(development), `${scheme}://app/`);
      const options = startup.resolveEarlyLinuxElectronOptions({
        env: development ? { VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" } : {},
        homeDirectory: "/home/user",
        joinPath: NodePath.posix.join,
        readFileString: (path) => {
          assert.equal(path, `/home/user/${home}/desktop-settings.json`);
          return JSON.stringify({ linuxPasswordStore: "kwallet6" });
        },
      });
      assert.deepEqual(options, {
        isDevelopment: development,
        linuxWmClass: wmClass,
        linuxDesktopEntryName: desktopEntry,
        passwordStore: "kwallet6",
      });
    },
  );
});
