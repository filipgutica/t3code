// @effect-diagnostics globalFetch:off - Standalone Vercel SDK adapter uses native HTTP outside the application runtime.
import { Sandbox } from "@vercel/sandbox";
import { provisionScript } from "./provision.js";

const prefix = "/opt/workbench-preview";
const node = `${prefix}/node-bin/node`;
const app = `${prefix}/app`;
const path = `${prefix}/node-bin:/usr/local/bin:/usr/bin:/bin`;

const readArtifact = (environment: NodeJS.ProcessEnv) => {
  const sha = environment.WORKBENCH_PREVIEW_SHA;
  const pr = environment.WORKBENCH_PREVIEW_PR;
  const checksum = environment.WORKBENCH_PREVIEW_BUNDLE_SHA256;
  const url = environment.WORKBENCH_PREVIEW_BUNDLE_URL;
  if (
    !sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !pr ||
    !/^[1-9][0-9]*$/.test(pr) ||
    !checksum ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    url !==
      `https://github.com/filipgutica/t3code/releases/download/workbench-preview-builds/pr-${pr}-${sha}-${checksum}.tar.gz`
  )
    throw new Error("Invalid fixed preview artifact.");
  return { sha, pr, checksum, url };
};

const readinessScript = `
(async()=>{const end=Date.now()+95000;while(Date.now()<end){
 try{const r=await fetch('http://127.0.0.1:8080/.well-known/t3/environment',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}
 catch{}await new Promise(resolve=>setTimeout(resolve,200));
}throw Error('Readiness timeout');})().catch(()=>process.exit(1));
`;
const pairingScript = `
const fs=require('node:fs');const cp=require('node:child_process');
const root='/var/lib/workbench-preview';const homes=fs.readdirSync(root).filter(n=>n.startsWith('session-'));
if(homes.length!==1)process.exit(1);
const output=cp.execFileSync('${node}',['${app}/apps/server/dist/bin.mjs','pair','--base-dir',root+'/'+homes[0]+'/t3','--ttl','1 minute','--label','PR preview reviewer'],{encoding:'utf8',timeout:15000});
const token=output.match(/^Token: ([^\\s]+)$/m)?.[1];if(!token)process.exit(1);process.stdout.write(token);
`;

export type LaunchStage = "checking" | "creating" | "preparing" | "starting" | "pairing";

export const launchPreview = async ({
  environment,
  onProgress,
}: {
  environment: NodeJS.ProcessEnv;
  onProgress?: (stage: LaunchStage) => void;
}) => {
  const artifact = readArtifact(environment);
  onProgress?.("checking");
  const source = await fetch(
    `https://api.github.com/repos/filipgutica/t3code/pulls/${artifact.pr}`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const pull: unknown = await source.json();
  if (
    !source.ok ||
    typeof pull !== "object" ||
    pull === null ||
    !("state" in pull) ||
    typeof pull.state !== "string" ||
    !["open", "closed"].includes(pull.state) ||
    !("head" in pull) ||
    typeof pull.head !== "object" ||
    pull.head === null ||
    !("sha" in pull.head) ||
    typeof pull.head.sha !== "string" ||
    !("repo" in pull.head) ||
    typeof pull.head.repo !== "object" ||
    pull.head.repo === null ||
    !("full_name" in pull.head.repo) ||
    typeof pull.head.repo.full_name !== "string"
  )
    throw new Error("Could not verify the preview pull request.");
  if (
    pull.state !== "open" ||
    pull.head.sha !== artifact.sha ||
    pull.head.repo.full_name !== "filipgutica/t3code"
  )
    return { unavailable: "revision-changed" as const };
  onProgress?.("creating");
  const sandbox = await Sandbox.create({
    image: "vercel/sandbox/node:24",
    persistent: false,
    timeout: 20 * 60_000,
    resources: { vcpus: 1 },
    ports: [8080],
    signal: AbortSignal.timeout(30_000),
  });
  let successful = false;
  try {
    onProgress?.("preparing");
    const user = await sandbox.createUser("node");
    const provision = await sandbox.runCommand({
      cmd: "node",
      args: [
        "-e",
        provisionScript,
        artifact.url,
        artifact.checksum,
        prefix,
        "/var/lib/workbench-preview",
        "node:node",
      ],
      sudo: true,
      timeoutMs: 100_000,
    });
    if (provision.exitCode !== 0) throw new Error("Preview provisioning failed.");
    onProgress?.("starting");
    const startup = await user.runCommand({
      cmd: node,
      args: [`${app}/scripts/workbench-preview/start.mts`],
      cwd: app,
      env: { PORT: "8080", PATH: path },
      detached: true,
    });
    const controller = new AbortController();
    try {
      await Promise.race([
        user
          .runCommand({ cmd: node, args: ["-e", readinessScript], timeoutMs: 100_000 })
          .then((result) => {
            if (result.exitCode !== 0) throw new Error("Preview readiness failed.");
          }),
        startup.wait({ signal: controller.signal }).then(() => {
          throw new Error("Preview runtime stopped.");
        }),
      ]);
    } finally {
      controller.abort();
    }
    onProgress?.("pairing");
    const paired = await user.runCommand({
      cmd: node,
      args: ["-e", pairingScript],
      env: { PATH: path },
      timeoutMs: 20_000,
    });
    if (paired.exitCode !== 0) throw new Error("Preview pairing failed.");
    const token = (await paired.stdout()).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid native pairing token.");
    const pairingUrl = new URL("/pair", sandbox.domain(8080));
    pairingUrl.hash = new URLSearchParams([["token", token]]).toString();
    successful = true;
    return { pairingUrl: pairingUrl.toString() };
  } finally {
    if (!successful) await sandbox.stop({ signal: AbortSignal.timeout(10_000) });
  }
};
