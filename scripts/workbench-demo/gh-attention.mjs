#!/usr/bin/env node
// Credential-free demo executable. Every answer is synthetic; no command is forwarded to gh.
import * as NodeFS from "node:fs";
import * as NodeTimersPromises from "node:timers/promises";

const args = process.argv.slice(2);
const repository = "workbench-synthetic/attention-fixtures";
const viewer = "synthetic-demo-viewer";
const at = "2026-09-29T12:00:00.000Z";
const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const refuse = (reason) => {
  process.stderr.write(`[Synthetic demo] ${reason}; no GitHub request was sent.\n`);
  process.exit(1);
};
const flag = (name) => {
  const index = args.indexOf(name);
  return index < 0
    ? args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
    : args[index + 1];
};
const method =
  flag("--method") ?? flag("-X") ?? args.find((value) => /^-X.+/.test(value))?.slice(2);
const restBody =
  args[0] === "api" &&
  args[1] !== "graphql" &&
  args.some((value) => /^(?:--(?:field|raw-field|input)(?:=|$)|-[fF])/.test(value));
if (
  (method !== undefined && method !== "GET") ||
  restBody ||
  (args[0] === "pr" && !["view", "list", "diff"].includes(args[1]))
)
  refuse("Writes and failed-check reruns are disabled for synthetic PRs");
if (flag("--hostname") !== undefined && flag("--hostname") !== "github.com")
  refuse("Host is outside the fixture allowlist");
if (args[0] === "--version") {
  console.log("gh version 2.101.0 (synthetic demo adapter)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "token") {
  console.log("synthetic-demo-token-not-a-credential");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status")
  refuse("No real GitHub login exists; inspections use a synthetic demo adapter");
if (args[0] === "api" && args.includes("user")) {
  output({ id: 900001, login: viewer });
  process.exit(0);
}
if (args[0] === "api" && args.includes("rate_limit")) {
  output({
    data: { rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: "2099-01-01T00:00:00Z" } },
  });
  process.exit(0);
}
let query = args.find((value) => value.startsWith("query="))?.slice(6) ?? "";
let variables = Object.fromEntries(
  args
    .filter((value) => /^(owner|name|number|cursor)=/.test(value))
    .map((value) => {
      const i = value.indexOf("=");
      return [value.slice(0, i), value.slice(i + 1)];
    }),
);
if (args.includes("--input")) {
  const request = JSON.parse(NodeFS.readFileSync(0, "utf8"));
  query = request.query ?? "";
  variables = { ...variables, ...request.variables };
}
if (/\bmutation\b/.test(query))
  refuse("Writes and failed-check reruns are disabled for synthetic PRs");
const title = (number) =>
  `[Synthetic attention] ${{ 901: "Failed PR checks", 902: "Unresolved PR feedback", 903: "Inspection unavailable", 904: "Inspection incomplete", 905: "Slow inspection" }[number]}`;
const check = (number) => ({
  name: "[Synthetic attention] demo-check",
  status: "COMPLETED",
  conclusion: number === 901 ? "FAILURE" : "SUCCESS",
  detailsUrl: `https://github.com/${repository}/pull/${number}`,
  completedAt: at,
});
const pr = (number) => ({
  number,
  title: title(number),
  url: `https://github.com/${repository}/pull/${number}`,
  state: "OPEN",
  isDraft: false,
  headRefName: `synthetic/${number}`,
  baseRefName: "main",
  headRefOid: "a".repeat(40),
  isCrossRepository: false,
  author: { login: viewer },
  reviewDecision: number === 902 ? "CHANGES_REQUESTED" : null,
  mergeable: "MERGEABLE",
  createdAt: at,
  updatedAt: at,
  mergedAt: null,
  closedAt: null,
  body: "Synthetic inspection data. No GitHub request is sent; reruns and all other writes are refused.",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  statusCheckRollup: [check(number)],
  reviewRequests: [],
  latestReviews: [],
  labels: [],
  viewerCanUpdate: true,
  viewerDidAuthor: true,
  viewerCanUpdateBranch: true,
  baseRef: { compare: { behindBy: 0 } },
});
const validate = async (number) => {
  if (![901, 902, 903, 904, 905].includes(number)) refuse("PR is outside the fixture allowlist");
  if (number === 903) refuse("PR inspection is deliberately unavailable");
  if (number === 905) await NodeTimersPromises.setTimeout(2200);
};
if (args[0] === "pr") {
  const selectedRepo = flag("--repo") ?? flag("-R");
  if (
    selectedRepo !== repository &&
    selectedRepo !== `github.com/${repository}` &&
    selectedRepo !== `https://github.com/${repository}`
  )
    refuse("Repository is outside the fixture allowlist");
  if (args[1] === "list") {
    output([]);
    process.exit(0);
  }
  const number = Number(args[2]);
  await validate(number);
  if (args[1] === "diff") {
    console.log(
      "diff --git a/synthetic.txt b/synthetic.txt\nnew file mode 100644\n--- /dev/null\n+++ b/synthetic.txt\n@@ -0,0 +1 @@\n+Synthetic demo inspection only",
    );
    process.exit(0);
  }
  output({ ...pr(number), comments: [], reviews: [], commits: [] });
  process.exit(0);
}
if (args[0] !== "api" || !args.includes("graphql"))
  refuse("Command is outside the fixture allowlist");
const budget = { cost: 1, limit: 5000, remaining: 4999, resetAt: "2099-01-01T00:00:00Z" };
if (query.includes("PullRequestSummaries")) {
  const entries = [
    ...query.matchAll(
      /(s\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{ pullRequest\(number: (\d+)\)/g,
    ),
  ];
  if (!entries.length || entries.some((entry) => `${entry[2]}/${entry[3]}` !== repository))
    refuse("Repository is outside the fixture allowlist");
  const data = { rateLimit: budget };
  for (const entry of entries) {
    const number = Number(entry[4]);
    if (number === 903) {
      data[entry[1]] = { pullRequest: null };
      continue;
    }
    await validate(number);
    data[entry[1]] = {
      pullRequest: {
        ...pr(number),
        latestReviews: { nodes: [] },
        labels: { nodes: [] },
        reviewRequests: { nodes: [] },
        commits: {
          nodes: [
            { commit: { statusCheckRollup: { state: number === 901 ? "FAILURE" : "SUCCESS" } } },
          ],
        },
      },
    };
  }
  output({ data });
  process.exit(0);
}
if (`${variables.owner}/${variables.name}` !== repository)
  refuse("Repository is outside the fixture allowlist");
const number = Number(variables.number);
await validate(number);
let pullRequest = pr(number);
if (query.includes("reviewThreads(first:")) {
  const comment = {
    id: "synthetic-feedback",
    author: { login: "synthetic-reviewer" },
    body: "[Synthetic unresolved feedback] Handle the empty response before rendering.",
    createdAt: at,
    url: `https://github.com/${repository}/pull/${number}#discussion_r1`,
    reactionGroups: [],
  };
  pullRequest = {
    ...pullRequest,
    reactionGroups: [],
    reviewThreads: {
      nodes:
        number === 902 || number === 904
          ? [
              {
                id: `synthetic-thread-${number}`,
                isResolved: number === 904,
                isOutdated: false,
                path: "synthetic.txt",
                line: 1,
                diffSide: "RIGHT",
                comments: {
                  nodes: [comment],
                  totalCount: number === 904 ? 2 : 1,
                  pageInfo: {
                    hasNextPage: number === 904,
                    endCursor: number === 904 ? "synthetic-truncated" : null,
                  },
                },
              },
            ]
          : [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    commits: { nodes: [] },
  };
} else if (query.includes("statusCheckRollup { contexts")) {
  pullRequest = {
    ...pullRequest,
    reviewRequests: { nodes: [] },
    labels: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: { nodes: [check(number)], pageInfo: { hasNextPage: false } },
            },
          },
        },
      ],
    },
  };
}
output({
  data: {
    viewer: { login: viewer },
    rateLimit: budget,
    repository: {
      viewerPermission: "WRITE",
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      pullRequest,
    },
  },
});
