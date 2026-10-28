// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Host-side demo orchestration owns disposable files and processes.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import { withDemoAccess } from "./access.mts";
import { requireHome, setupHome } from "./environment.mts";
import { seedDemoReferences } from "./issue-links.mts";
import { launchDemo } from "./launch.mts";
import {
  installAttentionGitHubAdapter,
  seedAttentionOutcomes,
  seedAttentionRecords,
} from "./attention.mts";
import { readDemoModelSelection } from "./local.mts";
import { seedInstalledDemoProviders } from "./providers.mts";
import { stopDemo } from "./lifecycle.mts";
import { resetToBaseline } from "./reset-to-baseline.mts";

const RUNS_DIRECTORY = "runs";
const LOCK_FILE = ".disposable-demo.lock";

type DisposableRunLock = {
  readonly version: 1;
  readonly sourceHome: string;
  readonly runHome: string;
  readonly createdAt: string;
  readonly pid: number;
};

export type DisposableDemoSession = {
  readonly sourceHome: string;
  readonly runHome: string;
  readonly pairingUrl: string;
  readonly exited: Promise<void>;
  readonly stop: () => Promise<void>;
  readonly finish: () => Promise<void>;
};

const lockPath = (sourceHome: string): string => NodePath.join(sourceHome, LOCK_FILE);
const runsPath = (sourceHome: string): string => NodePath.join(sourceHome, RUNS_DIRECTORY);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRunPath = (sourceHome: string, runHome: string): boolean => {
  const relative = NodePath.relative(runsPath(sourceHome), runHome);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !NodePath.isAbsolute(relative) &&
    NodePath.basename(runHome).startsWith("run-")
  );
};

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await NodeFSP.readFile(path, "utf8"));

// Locks from older checkouts may also carry a `phase`, which recovery ignores.
const parseLock = (value: unknown, location: string): DisposableRunLock => {
  const record = isRecord(value) ? value : undefined;
  if (
    record === undefined ||
    record.version !== 1 ||
    typeof record.sourceHome !== "string" ||
    typeof record.runHome !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.pid !== "number"
  )
    throw new Error(`Invalid disposable demo lock in ${location}.`);
  return value as DisposableRunLock;
};
const readLock = async (path: string): Promise<DisposableRunLock> =>
  parseLock(await readJson(path), path);

const copyIfPresent = async (source: string, destination: string): Promise<void> => {
  if (!NodeFS.existsSync(source)) return;
  await NodeFSP.copyFile(source, destination);
  await NodeFSP.chmod(destination, 0o600);
};

const acquireLock = async (sourceHome: string, runHome: string): Promise<void> => {
  const path = lockPath(sourceHome);
  try {
    const handle = await NodeFSP.open(path, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({
          version: 1,
          sourceHome,
          runHome,
          createdAt: new Date().toISOString(),
          pid: process.pid,
        } satisfies DisposableRunLock)}\n`,
      );
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      let existing = "the saved lock";
      try {
        const value: unknown = await readJson(path);
        if (
          typeof value === "object" &&
          value !== null &&
          "runHome" in value &&
          typeof value.runHome === "string"
        )
          existing = value.runHome;
      } catch {
        // Keep the error actionable without attempting to remove an ambiguous lock.
      }
      throw new Error(
        `A disposable demo run is already active or needs recovery at ${existing}. Inspect that run before retrying, or run recover for it.`,
      );
    }
    throw error;
  }
};

const removeGeneratedRun = async (runHome: string): Promise<void> => {
  const parent = NodePath.dirname(runHome);
  const basename = NodePath.basename(runHome);
  await NodeFSP.rm(runHome, { recursive: true, force: true });
  const entries = await NodeFSP.readdir(parent);
  for (const entry of entries) {
    if (entry.startsWith(`${basename}.backup-`))
      await NodeFSP.rm(NodePath.join(parent, entry), { recursive: true, force: false });
  }
};

export const finishDisposableRun = async (sourceHome: string, runHome: string): Promise<void> => {
  await removeGeneratedRun(runHome);
  await NodeFSP.rm(lockPath(sourceHome), { force: false });
};

const stopRecordedRun = async (runHome: string): Promise<void> => {
  if (!NodeFS.existsSync(NodePath.join(runHome, "run.lock"))) return;
  try {
    await stopDemo(runHome);
  } catch (error) {
    if (error instanceof Error && /ENOENT|ECONNREFUSED/.test(String(error))) {
      await NodeFSP.rm(NodePath.join(runHome, "run.lock"), { force: false });
    } else throw error;
  }
};

export const startDisposableDemo = async (input: {
  readonly sourceHome: string;
}): Promise<DisposableDemoSession> => {
  const sourceHome = requireHome(input.sourceHome);
  const runHome = NodePath.join(
    runsPath(sourceHome),
    `run-${Date.now()}-${NodeCrypto.randomUUID().slice(0, 8)}`,
  );
  await NodeFSP.mkdir(runsPath(sourceHome), { recursive: true, mode: 0o700 });
  await acquireLock(sourceHome, runHome);
  let server: Awaited<ReturnType<typeof launchDemo>> | undefined;
  try {
    await setupHome(runHome);
    await copyIfPresent(
      NodePath.join(sourceHome, "config.env"),
      NodePath.join(runHome, "config.env"),
    );
    await copyIfPresent(
      NodePath.join(sourceHome, "remotes.json"),
      NodePath.join(runHome, "remotes.json"),
    );
    await NodeFSP.mkdir(NodePath.join(runHome, "userdata"), { recursive: true, mode: 0o700 });
    await copyIfPresent(
      NodePath.join(sourceHome, "userdata", "settings.json"),
      NodePath.join(runHome, "userdata", "settings.json"),
    );
    server = await resetToBaseline({ home: runHome, linkPullRequests: false });
    await server.stop();
    // The first boot migrates legacy provider settings before we preserve their choices.
    await seedInstalledDemoProviders({ home: runHome });
    const attentionEnv = await installAttentionGitHubAdapter(runHome, process.env);
    server = await launchDemo({ home: runHome, env: attentionEnv });
    const modelSelection = await readDemoModelSelection(runHome);
    await withDemoAccess(runHome, (access) =>
      seedAttentionRecords({ home: runHome, ...access, modelSelection }),
    );
    await server.stop();
    await seedAttentionOutcomes(runHome);
    seedDemoReferences(runHome);
    server = await launchDemo({ home: runHome, env: attentionEnv });
  } catch (error) {
    await server?.stop().catch(() => undefined);
    throw new Error(
      `${error instanceof Error ? error.message : "Disposable demo startup failed."} State retained at ${runHome} for diagnosis; run recover --home ${sourceHome} --run ${runHome} to remove it.`,
      { cause: error },
    );
  }

  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const stop = async () => {
    stopping = true;
    stopPromise ??= server?.stop() ?? Promise.resolve();
    await stopPromise;
  };
  const exited = server?.exited.then(() => {
    if (!stopping)
      throw new Error(
        `The disposable demo exited unexpectedly. Its state is retained at ${runHome}; inspect it before retrying.`,
      );
  });
  if (!exited) throw new Error("Disposable demo failed to start.");
  return {
    sourceHome,
    runHome,
    pairingUrl: server.pairingUrl,
    exited,
    stop,
    finish: async () => {
      await stop();
      await exited;
      await finishDisposableRun(sourceHome, runHome);
    },
  };
};

export const recoverDisposableDemo = async (input: {
  readonly sourceHome: string;
  readonly runHome: string;
}): Promise<void> => {
  const sourceHome = requireHome(input.sourceHome);
  const runHome = NodePath.resolve(input.runHome);
  if (!isRunPath(sourceHome, runHome))
    throw new Error(`Disposable run must be inside ${runsPath(sourceHome)}.`);
  if (!NodeFS.existsSync(lockPath(sourceHome)))
    throw new Error(`No disposable run lock exists for ${sourceHome}; refusing recovery.`);
  const lock = await readLock(lockPath(sourceHome));
  if (lock.sourceHome !== sourceHome || lock.runHome !== runHome)
    throw new Error("The source lock does not point to the requested disposable run.");
  await stopRecordedRun(runHome);
  await finishDisposableRun(sourceHome, runHome);
};
