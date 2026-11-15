// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off - Opt-in demo orchestration owns an isolated published upstream server.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import * as Schema from "effect/Schema";

import { CommandId, ProjectId } from "../../packages/contracts/src/baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "../../packages/contracts/src/environment.ts";
import { WS_METHODS } from "../../packages/contracts/src/rpc.ts";
import { WorkbenchProjectId, WorkbenchTicketId } from "../../packages/contracts/src/workbench.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import { withDemoAccess } from "./access.mts";
import { setupHome } from "./environment.mts";
import { launchDemo } from "./launch.mts";
import { ensureLocalOrigin, ensureRepository, LOCAL_DEMO_REPOSITORIES, runRpc } from "./local.mts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const upstreamUrl = "https://github.com/pingdotgg/t3code.git";
const releaseTag = /^v\d+\.\d+\.\d+(?:-nightly\.\d{8}\.\d+)?$/;
const decodeEnvironment = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

export const resolvePublishedVersion = (commit: string, tags: string): string => {
  const versions = new Set(
    tags.split("\n").flatMap((line) => {
      const [sha, ref] = line.trim().split(/\s+/);
      const tag = ref?.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
      return sha === commit && tag && releaseTag.test(tag) ? [tag.slice(1)] : [];
    }),
  );
  if (versions.size !== 1)
    throw new Error(
      `Cannot resolve one published upstream release for ${commit}; found ${versions.size}.`,
    );
  return [...versions][0]!;
};

export const launchRemoteDemo = async (runHome: string) => {
  const home = setupHome(NodePath.join(runHome, "remote"));
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true, mode: 0o700 });
  const policy: unknown = JSON.parse(
    await NodeFSP.readFile(NodePath.join(root, "scripts/workbench-ci-scope.json"), "utf8"),
  );
  if (
    typeof policy !== "object" ||
    policy === null ||
    !("upstreamBase" in policy) ||
    typeof policy.upstreamBase !== "string" ||
    !/^[a-f0-9]{40}$/.test(policy.upstreamBase)
  )
    throw new Error(
      "Cannot resolve the integrated upstream pin in scripts/workbench-ci-scope.json.",
    );
  let version: string;
  try {
    await exec("git", ["merge-base", "--is-ancestor", policy.upstreamBase, "HEAD"], { cwd: root });
    const tags = await exec("git", ["ls-remote", "--tags", upstreamUrl], {
      cwd: root,
      timeout: 60_000,
    });
    version = resolvePublishedVersion(policy.upstreamBase, tags.stdout);
  } catch (cause) {
    throw new Error(
      `Cannot resolve the published release at integrated upstream ${policy.upstreamBase}. No fallback will be used.`,
      { cause },
    );
  }
  const install = NodePath.join(home, "package");
  try {
    await exec(
      "npm",
      [
        "install",
        "--prefix",
        install,
        "--no-save",
        "--package-lock=false",
        "--ignore-scripts",
        `t3@${version}`,
      ],
      {
        cwd: home,
        timeout: 120_000,
      },
    );
  } catch (cause) {
    throw new Error(`Cannot fetch pinned upstream t3@${version}. No fallback will be used.`, {
      cause,
    });
  }
  const upstreamLauncher = NodePath.join(install, "node_modules/t3/bin/t3.mjs");
  const server = await launchDemo({ home, upstreamLauncher });
  try {
    const descriptorResponse = await fetch(`${server.origin}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!descriptorResponse.ok) throw new Error("The remote upstream server is not ready.");
    const descriptor = decodeEnvironment(await descriptorResponse.json());
    const repository = NodePath.join(home, "projects/orbit-api");
    await ensureRepository(repository, LOCAL_DEMO_REPOSITORIES[1], undefined);
    await ensureLocalOrigin({
      root: repository,
      repositoryId: "orbit-api",
      originDirectory: NodePath.join(home, "git-remotes"),
    });
    const projectId = ProjectId.make("remote-orbit-api");
    const title = "Orbit API (remote)";
    await withDemoAccess(
      home,
      (access) =>
        runRpc(access.wsUrl, access.token, (client) =>
          client[WS_METHODS.projectsMutate]({
            type: "project.create",
            commandId: CommandId.make("workbench-demo-remote-project"),
            projectId,
            title,
            workspaceRoot: repository,
            createWorkspaceRootIfMissing: false,
          }),
        ),
      { upstreamLauncher },
    );
    const timestamp = new Date().toISOString();
    await withDemoAccess(runHome, async (access) => {
      await runRpc(access.wsUrl, access.token, (client) =>
        client[WORKBENCH_WS_METHODS.workbenchCreateProject]({
          id: WorkbenchProjectId.make("remote-machine"),
          title: "Remote machine",
          linkedProjectIds: [projectId],
          remoteProjects: [{ projectId, environmentId: descriptor.environmentId, title }],
          createdAt: timestamp,
        }),
      );
      await runRpc(access.wsUrl, access.token, (client) =>
        client[WORKBENCH_WS_METHODS.workbenchCreateTicket]({
          id: WorkbenchTicketId.make("remote-machine-001"),
          projectId: WorkbenchProjectId.make("remote-machine"),
          title: "[Synthetic] Add an invitation status endpoint on the remote machine",
          markdown:
            "Synthetic remote-repository demo. Add a sample invitation status endpoint to Orbit API. Pair the remote environment in Settings → Connections → Add environment, then start this Ticket there. No provider ran during seeding.",
          repositoryProjectIds: [projectId],
          createdAt: timestamp,
        }),
      );
    });
    const paired = await exec(process.execPath, [upstreamLauncher, "pair", "--base-dir", home], {
      cwd: home,
      env: { ...process.env, T3CODE_HOME: home },
      timeout: 30_000,
    });
    const pairingUrl = paired.stdout.match(/https?:\/\/[^\s]+\/pair#[^\s]+/)?.[0];
    if (!pairingUrl)
      throw new Error("The pinned upstream pair command did not print a pairing URL.");
    return { ...server, pairingUrl, version };
  } catch (error) {
    await server.stop();
    throw error;
  }
};
