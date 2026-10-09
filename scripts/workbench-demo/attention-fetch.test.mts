// @effect-diagnostics nodeBuiltinImport:off - Disposable child processes exercise the real native HTTP transport.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { installAttentionGitHubAdapter } from "./attention.mts";
import { setupHome } from "./environment.mts";
import { preparePreview } from "../workbench-preview/config.mts";
import {
  buildPullRequestSummariesGraphQlQuery,
  pullRequestCoreGraphQlQuery,
  pullRequestSummaryGraphQlQuery,
} from "../../apps/server/src/pullRequest/gitHubPullRequestJson.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const serverRequire = NodeModule.createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
);
const moduleUrl = (name: string) => NodeURL.pathToFileURL(serverRequire.resolve(name)).href;

it.each(["demo", "preview"] as const)(
  "installs synthetic GitHub transport in an owned %s home while delegating other hosts unchanged",
  async (kind) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "attention-fetch-"));
    try {
      const fixtureEnvironment: NodeJS.ProcessEnv = { PATH: process.env.PATH };
      let home: string;
      if (kind === "demo") home = setupHome(NodePath.join(directory, "home"));
      else {
        await NodeFSP.writeFile(
          NodePath.join(directory, ".workbench-preview-owned"),
          "workbench-preview-v1\n",
        );
        const preview = await preparePreview(fixtureEnvironment, directory);
        home = preview.home;
        Object.assign(fixtureEnvironment, preview.environment);
      }
      const spy = NodePath.join(directory, "network-spy.mjs");
      await NodeFSP.writeFile(
        spy,
        `
globalThis.attentionForwards = [];
globalThis.fetch = async (input, init) => {
  globalThis.attentionForwards.push([input, init]);
  return Response.json({ forwarded: true });
};
`,
      );
      const environment = await installAttentionGitHubAdapter(home, {
        ...fixtureEnvironment,
        NODE_OPTIONS: `--import=${NodeURL.pathToFileURL(spy).href}`,
      });
      const document = {
        query: pullRequestCoreGraphQlQuery("github.com"),
        variables: {
          owner: "workbench-synthetic",
          name: "attention-fixtures",
          number: 901,
          headRef: "refs/pull/901/head",
        },
      };
      const summaryDocuments = [
        { query: pullRequestSummaryGraphQlQuery(true), variables: document.variables },
        buildPullRequestSummariesGraphQlQuery(
          [
            { repository: "workbench-synthetic/attention-fixtures", number: 901 },
            { repository: "workbench-synthetic/attention-api", number: 906 },
          ],
          true,
        ),
      ];
      const execution = await execFile(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
const Effect = await import(${JSON.stringify(moduleUrl("effect/Effect"))});
const { FetchHttpClient, HttpClient, HttpClientRequest } = await import(${JSON.stringify(moduleUrl("effect/http"))});
const document = ${JSON.stringify(document)};
const github = await Effect.runPromise(Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(HttpClientRequest.post("https://api.github.com/graphql").pipe(HttpClientRequest.bodyJsonUnsafe(document)));
  return yield* response.json;
}).pipe(Effect.provide(FetchHttpClient.layer)));
const summaries = [];
for (const summaryDocument of ${JSON.stringify(summaryDocuments)}) {
  const response = await fetch("https://api.github.com/graphql", { method: "POST", body: JSON.stringify(summaryDocument) });
  summaries.push({ status: response.status, body: await response.json() });
}
const refused = [];
for (const [path, method, body] of [
  ["/graphql", "POST", { ...document, query: "mutation { closePullRequest }" }],
  ["/graphql", "POST", { ...document, query: "query { viewer { login } }" }],
  ["/graphql", "POST", { ...document, variables: { ...document.variables, owner: "unrelated" } }],
  ["/repos/workbench-synthetic/attention-fixtures/actions/runs/1/rerun-failed-jobs", "POST", {}],
  ["/unknown", "GET", undefined],
]) {
  const response = await fetch(new URL(path, "https://api.github.com"), {
    method, headers: { Authorization: "Bearer synthetic-test-value", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  refused.push({ status: response.status, body: await response.json() });
}
const user = await (await fetch("https://api.github.com/user")).json();
const delegatedInput = new Request("https://provider.example.invalid/models");
const delegatedInit = { headers: { "X-Synthetic": "unchanged" } };
const delegated = await (await fetch(delegatedInput, delegatedInit)).json();
const forwards = globalThis.attentionForwards;
console.log(JSON.stringify({ github, summaries, refused, user, delegated, forwardedCount: forwards.length,
  delegatedIdentity: forwards.length === 1 && forwards[0][0] === delegatedInput && forwards[0][1] === delegatedInit }));
`,
        ],
        { env: environment, timeout: 15_000 },
      );
      const result = JSON.parse(execution.stdout);
      expect(result.forwardedCount).toBe(1);
      expect(result.delegatedIdentity).toBe(true);
      expect(result.github.data?.repository?.pullRequest?.title).toMatch(
        /^\[Synthetic attention\]/,
      );
      for (const summary of result.summaries) {
        expect(summary.status).toBe(200);
        expect(summary.body.data.s0.pullRequest.number).toBe(901);
      }
      expect(result.summaries[1].body.data.s1.pullRequest.number).toBe(906);
      expect(result.refused).toHaveLength(5);
      for (const refusal of result.refused) {
        expect(refusal.status).toBeGreaterThanOrEqual(400);
        expect(refusal.body.message).toMatch(/\[Synthetic demo\].*no GitHub request was sent/);
      }
      expect(result.user.login).toBe("synthetic-demo-viewer");
      expect(result.delegated).toEqual({ forwarded: true });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);

it("refuses unowned and symlinked installations before writing, and refuses preload startup without its marked home", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "attention-owner-"));
  try {
    const unowned = NodePath.join(directory, "unowned");
    await NodeFSP.mkdir(unowned);
    await expect(installAttentionGitHubAdapter(unowned, {})).rejects.toThrow();
    expect(await NodeFSP.readdir(unowned)).toEqual([]);
    const owned = setupHome(NodePath.join(directory, "owned"));
    const symlink = NodePath.join(directory, "symlink");
    await NodeFSP.symlink(owned, symlink);
    await expect(installAttentionGitHubAdapter(symlink, {})).rejects.toThrow(/symlink/);
    expect(await NodeFSP.readdir(owned)).toEqual([".workbench-demo.json"]);
    const preload = NodeURL.pathToFileURL(
      NodePath.join(import.meta.dirname, "attention-fetch.mjs"),
    ).href;
    for (const environment of [{}, { T3CODE_SYNTHETIC_ATTENTION_HOME: owned }]) {
      await expect(
        execFile(
          process.execPath,
          ["--import", preload, "--eval", "throw new Error('application started')"],
          { env: environment },
        ),
      ).rejects.toThrow(/owned demo home|ENOENT/);
    }
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
