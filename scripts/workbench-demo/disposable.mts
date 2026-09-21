// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Host-side demo orchestration owns disposable files and processes.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import { planBaselineReset } from "./baseline.mts";
import { withDemoAccess } from "./access.mts";
import { requireHome, setupHome } from "./environment.mts";
import { exportJiraAuth, importJiraAuth } from "./jira-auth.mts";
import { launchDemo } from "./launch.mts";
import { stopDemo } from "./lifecycle.mts";
import { resetToBaseline } from "./reset-to-baseline.mts";
import { verifyDemoJira } from "./integrations.mts";

const RUNS_DIRECTORY = "runs";
const LOCK_FILE = ".disposable-demo.lock";
const RUN_MANIFEST = "disposable-run.json";

type DisposableRunManifest = {
  readonly version: 1;
  readonly phase: "pending-auth" | "running" | "auth-saved";
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

const parseManifest = (value: unknown, location: string): DisposableRunManifest => {
  const record = isRecord(value) ? value : undefined;
  if (
    record === undefined ||
    record.version !== 1 ||
    (record.phase !== "pending-auth" &&
      record.phase !== "running" &&
      record.phase !== "auth-saved") ||
    typeof record.sourceHome !== "string" ||
    typeof record.runHome !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.pid !== "number"
  )
    throw new Error(`Invalid disposable demo manifest in ${location}.`);
  return value as DisposableRunManifest;
};
const readManifestFile = async (path: string): Promise<DisposableRunManifest> =>
  parseManifest(await readJson(path), path);
const readManifest = async (runHome: string): Promise<DisposableRunManifest> =>
  readManifestFile(NodePath.join(runHome, RUN_MANIFEST));

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
          phase: "pending-auth",
          sourceHome,
          runHome,
          createdAt: new Date().toISOString(),
          pid: process.pid,
        } satisfies DisposableRunManifest)}\n`,
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
        `A disposable demo run is already active or needs recovery at ${existing}. Inspect that run before retrying; stale Jira tokens will not be replayed.`,
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

const writeRunManifest = async (
  runHome: string,
  sourceHome: string,
  phase: DisposableRunManifest["phase"],
): Promise<void> => {
  await NodeFSP.writeFile(
    NodePath.join(runHome, RUN_MANIFEST),
    `${JSON.stringify({
      version: 1,
      phase,
      sourceHome,
      runHome,
      createdAt: new Date().toISOString(),
      pid: process.pid,
    } satisfies DisposableRunManifest)}\n`,
    { mode: 0o600 },
  );
};

const writeLockPhase = async (
  sourceHome: string,
  runHome: string,
  phase: DisposableRunManifest["phase"],
): Promise<void> => {
  const lock = await readManifestFile(lockPath(sourceHome));
  await NodeFSP.writeFile(
    lockPath(sourceHome),
    `${JSON.stringify({ ...lock, runHome, phase } satisfies DisposableRunManifest)}\n`,
    { mode: 0o600 },
  );
};

export const finishDisposableRun = async (sourceHome: string, runHome: string): Promise<void> => {
  const bundle = await exportJiraAuth({ home: runHome });
  await importJiraAuth({ home: sourceHome, bundle });
  const lock = await readManifestFile(lockPath(sourceHome));
  await NodeFSP.writeFile(
    lockPath(sourceHome),
    `${JSON.stringify({ ...lock, phase: "auth-saved" } satisfies DisposableRunManifest)}\n`,
    { mode: 0o600 },
  );
  await removeGeneratedRun(runHome);
  await NodeFSP.rm(lockPath(sourceHome), { force: false });
};

const requireJiraBaseline = (home: string) => {
  const jira = planBaselineReset({ home }).jira;
  if (jira === undefined)
    throw new Error(
      `The saved demo has no complete Jira baseline. Run bash scripts/workbench-demo/setup.sh with DEMO_HOME=${home} before using the disposable runner.`,
    );
  return jira;
};

const verifyJira = async (home: string): Promise<void> => {
  const jira = requireJiraBaseline(home);
  await withDemoAccess(home, (access) =>
    verifyDemoJira({
      ...access,
      site: jira.site,
      boardId: jira.boardId,
      projectKey: jira.projectKey,
      sprintId: jira.sprintId,
      expectedKeys: jira.issues.map((issue) => issue.key),
      requireEpic: false,
    }),
  );
};

export const startDisposableDemo = async (input: {
  readonly sourceHome: string;
}): Promise<DisposableDemoSession> => {
  const sourceHome = requireHome(input.sourceHome);
  const sourceJira = requireJiraBaseline(sourceHome);
  const runHome = NodePath.join(
    runsPath(sourceHome),
    `run-${Date.now()}-${NodeCrypto.randomUUID().slice(0, 8)}`,
  );
  await NodeFSP.mkdir(runsPath(sourceHome), { recursive: true, mode: 0o700 });
  await acquireLock(sourceHome, runHome);
  let server: Awaited<ReturnType<typeof launchDemo>> | undefined;
  let runInitialized = false;
  try {
    // Exporting first proves that the durable source is stopped and still has a usable grant.
    const oauthBundle = await exportJiraAuth({ home: sourceHome });
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
    server = await resetToBaseline({
      home: runHome,
      remoteApply: false,
      oauthBundle,
      configure: async () => {
        // resetToBaseline archives the run home, so persist the recovery marker
        // after that archive and before the new server starts.
        await writeRunManifest(runHome, sourceHome, "pending-auth");
        runInitialized = true;
      },
      onAuthImported: async () => {
        await writeRunManifest(runHome, sourceHome, "running");
        await writeLockPhase(sourceHome, runHome, "running");
      },
    });
    // resetToBaseline syncs Jira when the complete baseline is present; verify the live grant too.
    if (sourceJira.issues.length === 0) throw new Error("The saved Jira baseline has no issues.");
    await verifyJira(runHome);
  } catch (error) {
    if (server) {
      await server.stop().catch(() => undefined);
    } else if (!runInitialized) {
      // No live run exists yet, so this failure cannot have rotated its grant.
      await NodeFSP.rm(runHome, { recursive: true, force: true });
      await NodeFSP.rm(lockPath(sourceHome), { force: true });
    } else {
      throw new Error(
        `${error instanceof Error ? error.message : "Disposable demo startup failed."} State retained at ${runHome}; run recover --home ${sourceHome} --run ${runHome} after confirming the server is stopped.`,
      );
    }
    throw error;
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
  const lock = await readManifestFile(lockPath(sourceHome));
  if (lock.sourceHome !== sourceHome || lock.runHome !== runHome)
    throw new Error("The source lock does not point to the requested disposable run.");
  if (lock.phase === "auth-saved") {
    await removeGeneratedRun(runHome);
    await NodeFSP.rm(lockPath(sourceHome), { force: false });
    return;
  }
  if (lock.phase === "pending-auth") {
    if (NodeFS.existsSync(NodePath.join(runHome, "run.lock"))) {
      try {
        await stopDemo(runHome);
      } catch (error) {
        if (error instanceof Error && /ENOENT|ECONNREFUSED/.test(String(error))) {
          await NodeFSP.rm(NodePath.join(runHome, "run.lock"), { force: false });
        } else throw error;
      }
    }
    await removeGeneratedRun(runHome);
    await NodeFSP.rm(lockPath(sourceHome), { force: false });
    return;
  }
  const manifest = await readManifest(runHome);
  if (manifest.sourceHome !== sourceHome || manifest.runHome !== runHome)
    throw new Error("The disposable run does not belong to the selected source home.");
  if (NodeFS.existsSync(NodePath.join(runHome, "run.lock"))) {
    try {
      await stopDemo(runHome);
    } catch (error) {
      if (error instanceof Error && /ENOENT|ECONNREFUSED/.test(String(error))) {
        await NodeFSP.rm(NodePath.join(runHome, "run.lock"), { force: false });
      } else throw error;
    }
  }
  await finishDisposableRun(sourceHome, runHome);
};
