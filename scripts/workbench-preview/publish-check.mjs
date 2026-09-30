import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";

const sha = "a".repeat(40);
for (const scenario of [
  "new-content",
  "team-scoped-token",
  "ci-output",
  "ci-pending",
  "agent-error",
  "identical-content",
  "deploy-failure",
  "unprotected-post",
  "production-target",
  "sso-redirect",
  "untrusted-redirect",
]) {
  NodeTest.test(
    `publisher ${scenario} preserves the verified bytes and private deployment boundary`,
    async () => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "preview-publisher-test-"));
      try {
        const bundle = NodePath.join(root, "runtime.tar.gz");
        const bytes = "verified fresh runtime";
        const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
        const name = `pr-71-${sha}-${digest}.tar.gz`;
        const log = NodePath.join(root, "commands.jsonl");
        await NodeFSP.writeFile(bundle, bytes);
        const bin = NodePath.join(root, "bin");
        await NodeFSP.mkdir(bin);
        const command = `#!${process.execPath}
const NodeFSP=require('node:fs');NodeFSP.appendFileSync(process.env.TEST_LOG,JSON.stringify({command:require('node:path').basename(process.argv[1]),args:process.argv.slice(2)})+'\\n');if(process.argv[1].endsWith('pnpm')){if(process.env.TEST_SCENARIO==='team-scoped-token'&&process.argv.includes('--scope')){process.stderr.write('scope-not-accessible: account lookup denied');process.exit(1);}if(process.env.TEST_SCENARIO==='deploy-failure'){process.stderr.write(process.env.VERCEL_TOKEN);process.exit(1);}const deployment={url:'https://private-launcher.vercel.app',readyState:process.env.TEST_SCENARIO==='ci-pending'?'BUILDING':'READY',target:process.env.TEST_SCENARIO==='production-target'?'production':null};process.stdout.write(JSON.stringify(process.env.TEST_SCENARIO.startsWith('ci-')?deployment:{status:process.env.TEST_SCENARIO==='agent-error'?'error':'ok',deployment}));}`;
        for (const tool of ["gh", "pnpm"])
          await NodeFSP.writeFile(NodePath.join(bin, tool), command, { mode: 0o700 });
        const preload = NodePath.join(root, "fetch.mjs");
        await NodeFSP.writeFile(
          preload,
          `import NodeFSP from 'node:fs';
globalThis.fetch=async(url,options={})=>{const u=String(url);NodeFSP.appendFileSync(process.env.TEST_LOG,JSON.stringify({url:u,method:options.method??'GET',body:options.body})+'\\n');let data={};let status=200;if(u.includes('/pulls/'))data={state:'open',head:{sha:'${sha}',repo:{full_name:'filipgutica/t3code'}},user:{login:'filipgutica'}};else if(u.includes('api.vercel.com'))data={ssoProtection:{deploymentType:'all'}};else if(u.includes('/releases/tags/'))data={assets:[{id:10,name:process.env.TEST_SCENARIO==='identical-content'?'${name}':'pr-71-${sha}-'+'b'.repeat(64)+'.tar.gz',digest:'sha256:'+(process.env.TEST_SCENARIO==='identical-content'?'${digest}':'b'.repeat(64))}]};else if(u.includes('private-launcher.vercel.app'))status=process.env.TEST_SCENARIO==='unprotected-post'&&options.method==='POST'?200:401;else if(u.includes('/comments'))data=[];else if(options.method==='DELETE')status=204;let headers={};if(u.includes('private-launcher.vercel.app')&&['sso-redirect','untrusted-redirect'].includes(process.env.TEST_SCENARIO)){status=302;headers.Location=(process.env.TEST_SCENARIO==='sso-redirect'?'https://vercel.com':'https://attacker.invalid')+'/sso-api?url='+encodeURIComponent(u)+'&nonce=fixture';}return new Response(status===204?null:JSON.stringify(data),{status,headers});};`,
        );
        const environment = {
          PATH:
            bin +
            NodePath.delimiter +
            NodePath.dirname(process.execPath) +
            NodePath.delimiter +
            "/usr/bin:/bin",
          GH_TOKEN: "fake-gh",
          VERCEL_TOKEN: "private-test-token",
          VERCEL_ORG_ID: "fake-team",
          VERCEL_PROJECT_ID: "fake-project",
          PREVIEW_REPO: "filipgutica/t3code",
          PREVIEW_PR: "71",
          PREVIEW_SHA: sha,
          PREVIEW_CONTROLLER_SHA: "c".repeat(40),
          TEST_LOG: log,
          TEST_SCENARIO: scenario,
        };
        const run = () =>
          NodeChildProcess.execFileSync(
            process.execPath,
            ["--import", preload, "scripts/workbench-preview/publish.mjs", bundle],
            { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        if (scenario === "deploy-failure") {
          NodeAssert.throws(run, (error) => {
            NodeAssert.match(error.stderr, /Vercel launcher deployment failed/);
            NodeAssert.doesNotMatch(error.stderr, /private-test-token/);
            return true;
          });
        } else if (["production-target", "ci-pending", "agent-error"].includes(scenario)) {
          NodeAssert.throws(run, (error) => {
            NodeAssert.match(error.stderr, /ready preview deployment/);
            return true;
          });
        } else if (["unprotected-post", "untrusted-redirect"].includes(scenario)) {
          NodeAssert.throws(run, (error) => {
            NodeAssert.match(error.stderr, /anonymous access check/);
            return true;
          });
        } else run();
        const events = (await NodeFSP.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
        const uploads = events.filter(
          (event) => event.command === "gh" && event.args[1] === "upload",
        );
        NodeAssert.equal(uploads.length, scenario === "identical-content" ? 0 : 1);
        if (uploads.length) NodeAssert.equal(NodePath.basename(uploads[0].args[3]), name);
        const deploy = events.find((event) => event.command === "pnpm");
        NodeAssert.equal(deploy.args[deploy.args.indexOf("--target") + 1], "preview");
        NodeAssert.equal(deploy.args[deploy.args.indexOf("--format") + 1], "json");
        NodeAssert.ok(deploy.args.includes(`WORKBENCH_PREVIEW_BUNDLE_SHA256=${digest}`));
        NodeAssert.ok(
          deploy.args.some(
            (arg) => arg.startsWith("WORKBENCH_PREVIEW_BUNDLE_URL=") && arg.endsWith(name),
          ),
        );
        const comments = events.filter(
          (event) => event.url?.includes("/comments") && event.method === "POST",
        );
        NodeAssert.equal(
          comments.length,
          [
            "deploy-failure",
            "unprotected-post",
            "production-target",
            "ci-pending",
            "agent-error",
            "untrusted-redirect",
          ].includes(scenario)
            ? 0
            : 1,
        );
        if (comments.length) {
          NodeAssert.ok(
            events.some(
              (event) =>
                event.url === "https://private-launcher.vercel.app/api/launch" &&
                event.method === "POST",
            ),
          );
          NodeAssert.doesNotMatch(comments[0].body, /private-test-token|token=/);
          const posted = JSON.parse(comments[0].body).body;
          NodeAssert.match(posted, new RegExp("PR `" + sha + "`"));
          NodeAssert.match(posted, /main `c{40}`/);
        }
      } finally {
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    },
  );
}
