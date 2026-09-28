import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

// Exercise the built image and real native CLI; never print pairing credentials or logs.
const name = `workbench-preview-smoke-${NodeCrypto.randomUUID()}`;
const image = process.argv[2] ?? "workbench-preview:local";
const bundle = process.argv[3];
const application = bundle ? "/opt/workbench-preview/app" : "/app";
const docker = (...args) => {
  try {
    if (args[0] === "exec") args.splice(1, 0, "--workdir", "/");
    return NodeChildProcess.execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch {
    throw new Error(
      `Docker ${args[0]} failed. Inspect the container privately; logs can contain pairing credentials.`,
    );
  }
};
let created = false;
try {
  const launch = [
    "create",
    "--name",
    name,
    "--publish",
    "127.0.0.1::8080",
    "--env",
    "GH_TOKEN=preview-smoke-ambient-credential",
  ];
  if (bundle) launch.push("--user", "root", "--entrypoint", "sh");
  launch.push(image);
  if (bundle)
    launch.push(
      "-c",
      "if [ -d /app ]; then mv /app /original-app; fi; mkdir -p /opt/workbench-preview && tar -xzf /tmp/preview-bundle.tar.gz -C /opt/workbench-preview && exec su -s /bin/sh node -c 'PATH=/opt/workbench-preview/node-bin:/usr/local/bin:/usr/bin:/bin /opt/workbench-preview/node-bin/node /opt/workbench-preview/app/scripts/workbench-preview/start.mts'",
    );
  docker(...launch);
  created = true;
  if (bundle) docker("cp", NodePath.resolve(bundle), `${name}:/tmp/preview-bundle.tar.gz`);
  docker("start", name);
  let origin = `http://${docker("port", name, "8080/tcp")}`;
  const ready = async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      NodeAssert.equal(
        docker("inspect", name, "--format", "{{.State.Running}}"),
        "true",
        "Preview exited before serving seeded state",
      );
      try {
        const response = await fetch(`${origin}/.well-known/t3/environment`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return await response.json();
      } catch {
        /* Wait for the real service listener, not a fixed startup delay. */
      }
      await NodeTimersPromises.setTimeout(200);
    }
    throw new Error("Seeded preview did not become ready within 120 seconds");
  };
  const before = await ready();
  NodeAssert.equal(
    (await fetch(origin, { signal: AbortSignal.timeout(5000) })).status,
    200,
    "Built web client is served",
  );
  NodeAssert.equal(
    (await fetch(`${origin}/api/orchestration/snapshot`, { signal: AbortSignal.timeout(5000) }))
      .status,
    401,
  );
  const rejectedUpgrade = await new Promise((resolve, reject) => {
    const request = NodeHttp.request(`${origin}/ws`, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    request.once("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    request.once("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("WebSocket denial timed out")));
    request.end();
  });
  NodeAssert.equal(rejectedUpgrade, 401, "Unauthenticated WebSocket upgrade is refused");
  const home = docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    "import fs from 'node:fs';import NodePath from 'node:path';const homes=fs.readdirSync('/var/lib/workbench-preview').filter(x=>x.startsWith('session-'));if(homes.length!==1)throw Error('Expected one fresh home');console.log(NodePath.join('/var/lib/workbench-preview',homes[0],'t3'));",
  );
  const counts = JSON.parse(
    docker(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]+'/userdata/state.sqlite',{readOnly:true});console.log(JSON.stringify({tickets:db.prepare('SELECT COUNT(*) AS count FROM workbench_tickets').get().count,selections:db.prepare('SELECT model_selection_json FROM projection_threads').all().map(x=>JSON.parse(x.model_selection_json)),jira:db.prepare('SELECT COUNT(*) AS count FROM workbench_jira_connections').get().count}));db.close();",
      home,
    ),
  );
  NodeAssert.ok(
    counts.tickets > 0 && counts.selections.length > 0,
    "Native fixture receipts finish before public readiness",
  );
  for (const selection of counts.selections)
    NodeAssert.deepEqual(
      selection,
      { instanceId: "opencode", model: "opencode/big-pickle" },
      "Seeded native Threads use the free preview provider",
    );
  NodeAssert.equal(counts.jira, 0, "Preview starts without a connected Jira account");
  NodeAssert.equal(
    docker("exec", name, "git", "-C", `${home}/projects/orbit-web`, "remote", "get-url", "origin"),
    "https://github.com/filipgutica/workbench-demo-orbit-web.git",
    "The assigned Orbit Ticket has a real GitHub repository for Link PR review",
  );
  const runtimeUid = docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    "import fs from 'node:fs';const target=process.argv[1];for(const pid of fs.readdirSync('/proc').filter(x=>/^[0-9]+$/.test(x))){try{const argv=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split(String.fromCharCode(0));if(argv.includes(target)&&argv.includes('serve')){const line=fs.readFileSync('/proc/'+pid+'/status','utf8').split(String.fromCharCode(10)).find(x=>x.startsWith('Uid:'));console.log(line.slice(4).trim().split(String.fromCharCode(9))[0]);}}catch{}}",
    `${application}/apps/server/dist/bin.mjs`,
  );
  NodeAssert.ok(Number(runtimeUid) > 0, "Native server runs as an unprivileged user");
  const github = JSON.parse(
    docker(
      "exec",
      "--user",
      "node",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import fs from 'node:fs';import cp from 'node:child_process';const target=process.argv[1];let environment;for(const pid of fs.readdirSync('/proc').filter(x=>/^[0-9]+$/.test(x))){try{const argv=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split(String.fromCharCode(0));if(argv.includes(target)&&argv.includes('serve'))environment=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split(String.fromCharCode(0)).filter(Boolean).map(entry=>{const index=entry.indexOf('=');return [entry.slice(0,index),entry.slice(index+1)];}));}catch{}}if(!environment)throw Error('Native runtime environment unavailable');const version=cp.spawnSync('gh',['--version'],{env:environment,encoding:'utf8',timeout:5000});const auth=cp.spawnSync('gh',['auth','status','--hostname','github.com'],{env:environment,encoding:'utf8',timeout:5000});const location=cp.spawnSync('sh',['-c','command -v gh'],{env:environment,encoding:'utf8',timeout:5000});const openCode=cp.spawnSync('opencode',['--version'],{env:environment,encoding:'utf8',timeout:4000});console.log(JSON.stringify({location:location.stdout?.trim(),version:version.stdout?.split(String.fromCharCode(10))[0],versionStatus:version.status,authStatus:auth.status,openCodeVersion:openCode.stdout?.trim(),openCodeStatus:openCode.status,hasCredentials:['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'].some(key=>Boolean(environment[key]))}));",
      `${application}/apps/server/dist/bin.mjs`,
    ),
  );
  NodeAssert.equal(github.versionStatus, 0, "GitHub CLI is executable on the native runtime PATH");
  NodeAssert.equal(
    github.location,
    bundle ? "/opt/workbench-preview/node-bin/gh" : "/usr/local/bin/gh",
    "Runtime resolves the intended installed GitHub CLI",
  );
  NodeAssert.match(github.version, /^gh version 2\.101\.0 /, "GitHub CLI is the pinned release");
  NodeAssert.equal(
    github.hasCredentials,
    false,
    "Native runtime does not inherit ambient GitHub credentials",
  );
  NodeAssert.equal(
    github.authStatus,
    1,
    "GitHub CLI starts unauthenticated in the fresh native home",
  );
  NodeAssert.equal(
    github.openCodeStatus,
    0,
    "OpenCode responds within the native four-second probe",
  );
  NodeAssert.equal(github.openCodeVersion, "1.18.33", "Preview uses the pinned OpenCode release");

  const pairing = docker(
    "exec",
    name,
    "node",
    `${application}/apps/server/dist/bin.mjs`,
    "pair",
    "--base-dir",
    home,
    "--ttl",
    "1m",
  );
  const credential = /^Token: (\S+)$/m.exec(pairing)?.[1];
  NodeAssert.ok(credential, "Native pair command issues a reviewer credential");
  const exchange = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: credential,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  NodeAssert.equal(exchange.status, 200, "Reviewer pairing works on the native production service");
  const { access_token: token } = await exchange.json();
  NodeAssert.equal(
    (
      await fetch(`${origin}/api/orchestration/snapshot`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    200,
  );
  // SIGKILL skips finally: replacement startup must erase previous credential files itself.
  docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    "import fs from 'node:fs';fs.writeFileSync(process.argv[1]+'/retired-credential', 'synthetic credential residue');",
    home,
  );
  docker("kill", "--signal", "KILL", name);
  docker("start", name);
  origin = `http://${docker("port", name, "8080/tcp")}`;
  const after = await ready();
  NodeAssert.notEqual(
    after.environmentId,
    before.environmentId,
    "Crash recovery creates a fresh environment identity",
  );
  NodeAssert.equal(
    docker(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import fs from 'node:fs';console.log(fs.existsSync(process.argv[1]));",
      home,
    ),
    "false",
    "Crash recovery removes the prior home and credential residue",
  );
  NodeAssert.equal(
    (
      await fetch(`${origin}/api/orchestration/snapshot`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    401,
    "Old reviewer sessions cannot access replacement state",
  );
  console.log(
    "Preview container smoke passed: seeded native state, disconnected Jira, pinned unauthenticated GitHub CLI, pairing, HTTP/WebSocket denial, and crash recovery without retained credentials.",
  );
} finally {
  if (created) docker("rm", "--force", name);
}
