// @effect-diagnostics nodeBuiltinImport:off - Lifecycle regression owns only disposable child processes and homes.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { it as test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), stopDemo: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));
vi.mock("./lifecycle.mts", () => ({ stopDemo: mocks.stopDemo }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  // The fixture writes runtime metadata before its ready line, so startup does
  // not need a filesystem watcher. Keep this process test independent of host FSEvents.
  watch: () => ({ close: () => {} }),
}));

import { setupHome } from "./environment.mts";
import { launchDemo } from "./launch.mts";

// The runner exits before its backend finishes handling the same group signal.
// The backend keeps the launcher's inherited output pipes until it is released.
const descendantSource = `
  process.on('SIGTERM', () => {});
  process.stdin.once('data', () => {
    process.stdout.write('backend shutdown complete\\n', () => process.exit(0));
  });
  process.send('ready');
`;
const launcherSource = `
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  process.on('SIGTERM', () => process.exit(0));
  const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], {
    stdio: [3, 'inherit', 'inherit', 'ipc']
  });
  descendant.once('message', () => {
    fs.writeFileSync(path.join(process.argv[1], 'userdata', 'server-runtime.json'), JSON.stringify({ pid: descendant.pid }));
    process.stdout.write('http://127.0.0.1:4173/pair#test-secret\\n');
  });
`;

test.skipIf(HostProcess.Platform.defaultValue() === "win32").each([false, true])(
  "waits for owned backend output to close (launcher already exited: %s)",
  async (alreadyExited) => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-shutdown-"));
    const home = setupHome(NodePath.join(directory, "home"));
    NodeFS.mkdirSync(NodePath.join(home, "userdata"));
    const actual = await vi.importActual<typeof NodeChildProcess>("node:child_process");
    const child = actual.spawn(process.execPath, ["-e", launcherSource, home], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      detached: true,
    });
    const closed = NodeEvents.EventEmitter.once(child, "close");
    const launcherExited = NodeEvents.EventEmitter.once(child, "exit");
    mocks.spawn.mockReturnValueOnce(child);
    mocks.stopDemo.mockImplementationOnce(async () => {
      NodeAssert.ok(child.pid);
      process.kill(-child.pid, "SIGTERM");
      return "Demo launcher stopped.";
    });
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      const pipe = child.stdio[3];
      NodeAssert.ok(pipe && "write" in pipe);
      pipe.end("finish shutdown\n");
    };
    try {
      const server = await launchDemo({ home });
      if (alreadyExited) {
        NodeAssert.ok(child.pid);
        process.kill(-child.pid, "SIGTERM");
        await launcherExited;
      }
      let stopCompleted = false;
      const stopped = server.stop().then(() => {
        stopCompleted = true;
      });
      await launcherExited;
      // A fresh I/O turn lets stop's exit continuation run before releasing the
      // backend. This is an event-loop boundary, not a shutdown delay.
      await new Promise<void>((resolve) => setImmediate(resolve));
      NodeAssert.equal(stopCompleted, false);
      await release();
      await stopped;
      NodeAssert.match(
        NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8"),
        /backend shutdown complete/,
      );
      NodeAssert.doesNotMatch(
        NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8"),
        /test-secret/,
      );
      await server.stop();
    } finally {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        process.kill(-child.pid, "SIGTERM");
      }
      await release();
      await closed;
      vi.resetAllMocks();
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("rejects a launcher that exits before ready and saves its final output", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-start-fail-"));
  const home = setupHome(NodePath.join(directory, "home"));
  NodeFS.mkdirSync(NodePath.join(home, "userdata"));
  const actual = await vi.importActual<typeof NodeChildProcess>("node:child_process");
  const child = actual.spawn(
    process.execPath,
    ["-e", "console.error('startup failed'); process.exit(7)"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = NodeEvents.EventEmitter.once(child, "close");
  mocks.spawn.mockReturnValueOnce(child);
  try {
    await NodeAssert.rejects(launchDemo({ home }), /Demo exited \(7\).*startup failed/s);
    NodeAssert.match(
      NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8"),
      /startup failed/,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
    vi.resetAllMocks();
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
