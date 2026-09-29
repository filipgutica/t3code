import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";

const env = process.env;
const required = [
  "GH_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "PREVIEW_REPO",
  "PREVIEW_PR",
  "PREVIEW_SHA",
];
if (required.some((key) => !env[key]))
  throw new Error("Configure the dedicated Workbench preview project and GitHub secrets first.");
if (
  env.PREVIEW_REPO !== "filipgutica/t3code" ||
  !/^[1-9][0-9]*$/.test(env.PREVIEW_PR) ||
  !/^[a-f0-9]{40}$/.test(env.PREVIEW_SHA)
)
  throw new Error("Invalid preview identity.");
const request = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Preview publication request failed (${response.status}).`);
  return response.status === 204 ? undefined : response.json();
};
const pr = await request(
  `https://api.github.com/repos/${env.PREVIEW_REPO}/pulls/${env.PREVIEW_PR}`,
  env.GH_TOKEN,
);
if (
  pr.state !== "open" ||
  pr.head.sha !== env.PREVIEW_SHA ||
  pr.head.repo?.full_name !== env.PREVIEW_REPO ||
  pr.user.login !== "filipgutica"
)
  throw new Error("PR is no longer an eligible current revision.");
const project = await request(
  `https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`,
  env.VERCEL_TOKEN,
);
if (project.ssoProtection?.deploymentType !== "all")
  throw new Error(
    "Enable Vercel Authentication for All Deployments on the dedicated preview project.",
  );
if (project.protectionBypass && Object.keys(project.protectionBypass).length)
  throw new Error("Remove deployment protection bypasses from the dedicated preview project.");
if (project.rootDirectory)
  throw new Error("The dedicated preview project must deploy the standalone launcher root.");
const bundle = process.argv[2];
if (!bundle) throw new Error("Pass the verified runtime bundle NodePath.");
const hash = NodeCrypto.createHash("sha256");
for await (const bytes of NodeFS.createReadStream(bundle)) hash.update(bytes);
const digest = hash.digest("hex");
const assetName = `pr-${env.PREVIEW_PR}-${env.PREVIEW_SHA}-${digest}.tar.gz`;
const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "workbench-preview-publish-"));
const gh = (...args) =>
  NodeChildProcess.execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const taggedBundle = NodePath.join(scratch, assetName);
  await NodeFSP.copyFile(bundle, taggedBundle);
  const releaseUrl = `https://api.github.com/repos/${env.PREVIEW_REPO}/releases/tags/workbench-preview-builds`;
  const releaseResponse = await fetch(releaseUrl, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (releaseResponse.status === 404) {
    gh(
      "release",
      "create",
      "workbench-preview-builds",
      "--repo",
      env.PREVIEW_REPO,
      "--target",
      "main",
      "--prerelease",
      "--title",
      "Workbench preview builds",
      "--notes",
      "Compiled code for disposable PR demos. No runtime state or integration credentials.",
    );
  } else if (!releaseResponse.ok) throw new Error("Cannot inspect the preview bundle release.");
  const releases = await request(releaseUrl, env.GH_TOKEN);
  // Reuse only identical content; tooling changes can rebuild an unchanged PR revision.
  const existing = releases.assets.find((asset) => asset.name === assetName);
  if (existing) {
    if (existing.digest !== `sha256:${digest}`)
      throw new Error("Existing preview artifact does not match its content digest.");
  } else
    gh("release", "upload", "workbench-preview-builds", taggedBundle, "--repo", env.PREVIEW_REPO);
  const launcher = NodePath.join(scratch, "launcher");
  await NodeFSP.cp(NodePath.resolve("infra/workbench-preview/launcher"), launcher, {
    recursive: true,
    filter: (entry) =>
      !entry.split(NodePath.sep).includes("node_modules") && !entry.endsWith(".test.ts"),
  });
  // Stage reviewed source only, never unpack or execute PR artifacts in this privileged job.
  const packageJson = JSON.parse(
    await NodeFSP.readFile(NodePath.join(launcher, "package.json"), "utf8"),
  );
  packageJson.packageManager = "pnpm@11.10.0";
  await NodeFSP.writeFile(
    NodePath.join(launcher, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );
  const bundleUrl = `https://github.com/${env.PREVIEW_REPO}/releases/download/workbench-preview-builds/${assetName}`;
  let output;
  try {
    output = NodeChildProcess.execFileSync(
      "pnpm",
      [
        "dlx",
        "vercel@53.1.1",
        "deploy",
        "--yes",
        "--target",
        "preview",
        "--format",
        "json",
        "--archive=tgz",
        // Explicit team/project environment IDs avoid account discovery with team-only tokens.
        "--token",
        env.VERCEL_TOKEN,
        "--env",
        `WORKBENCH_PREVIEW_PR=${env.PREVIEW_PR}`,
        "--env",
        `WORKBENCH_PREVIEW_SHA=${env.PREVIEW_SHA}`,
        "--env",
        `WORKBENCH_PREVIEW_BUNDLE_URL=${bundleUrl}`,
        "--env",
        `WORKBENCH_PREVIEW_BUNDLE_SHA256=${digest}`,
        "--meta",
        `workbenchPreviewPr=${env.PREVIEW_PR}`,
        "--meta",
        `workbenchPreviewSha=${env.PREVIEW_SHA}`,
      ],
      { cwd: launcher, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    // Child-process errors include command arguments, including the deployment token.
    throw new Error("Vercel launcher deployment failed; inspect the deployment in your dashboard.");
  }
  const result = JSON.parse(output);
  // CLI 53 emits a flat deployment in CI and an envelope in agent mode.
  const hasEnvelope = Object.hasOwn(result, "status");
  const deployment = hasEnvelope ? result.deployment : result;
  // The CLI serializes Vercel's default preview target as null.
  if (
    (hasEnvelope && result.status !== "ok") ||
    deployment?.readyState !== "READY" ||
    !["preview", null].includes(deployment?.target) ||
    typeof deployment?.url !== "string"
  )
    throw new Error("Vercel did not return a ready preview deployment; no link published.");
  const url = new URL(deployment.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.pathname !== "/")
    throw new Error("Unexpected launcher deployment URL.");
  const anonymous = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const anonymousLaunch = await fetch(new URL("/api/launch", url), {
    method: "POST",
    headers: { Origin: url.origin },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const deniesAnonymous = (response, destination) => {
    if ([401, 403].includes(response.status)) return true;
    if (response.status !== 302) return false;
    try {
      const login = new URL(response.headers.get("location"));
      return (
        login.origin === "https://vercel.com" &&
        login.pathname === "/sso-api" &&
        login.searchParams.get("url") === destination.toString()
      );
    } catch {
      return false;
    }
  };
  if (
    !deniesAnonymous(anonymous, url) ||
    !deniesAnonymous(anonymousLaunch, new URL("/api/launch", url))
  )
    throw new Error("Launcher failed its anonymous access check; no link published.");
  const marker = "<!-- workbench-sandbox-preview -->";
  const body = `${marker}\n### Workbench demo\n\n[Open the private 20-minute demo](${url}) for ${env.PREVIEW_SHA.slice(0, 7)}. Sign in to Vercel, then choose **Open demo**. Reopening this link in the same browser resumes its running demo; **Start new demo** creates a fresh one. Jira starts disconnected.\n\nExpired? Return to this link and launch again. Use synthetic content with the free OpenCode model.`;
  const comments = await request(
    `https://api.github.com/repos/${env.PREVIEW_REPO}/issues/${env.PREVIEW_PR}/comments?per_page=100`,
    env.GH_TOKEN,
  );
  const prior = comments.find(
    (comment) => comment.user.type === "Bot" && comment.body?.includes(marker),
  );
  await request(
    prior
      ? `https://api.github.com/repos/${env.PREVIEW_REPO}/issues/comments/${prior.id}`
      : `https://api.github.com/repos/${env.PREVIEW_REPO}/issues/${env.PREVIEW_PR}/comments`,
    env.GH_TOKEN,
    { method: prior ? "PATCH" : "POST", body: JSON.stringify({ body }) },
  );
  // Keep only the latest revision per PR. Closing a PR removes its remaining bundles.
  for (const asset of releases.assets)
    if (asset.name.startsWith(`pr-${env.PREVIEW_PR}-`) && asset.name !== assetName) {
      await request(
        `https://api.github.com/repos/${env.PREVIEW_REPO}/releases/assets/${asset.id}`,
        env.GH_TOKEN,
        { method: "DELETE" },
      );
    }
  console.log(
    `Published protected launcher for PR ${env.PREVIEW_PR} at ${env.PREVIEW_SHA.slice(0, 7)}.`,
  );
} finally {
  await NodeFSP.rm(scratch, { recursive: true, force: true });
}
