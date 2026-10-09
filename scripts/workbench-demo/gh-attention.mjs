#!/usr/bin/env node
// Credential-free demo executable. Every answer is synthetic; no command is forwarded to gh.
import * as NodeFS from "node:fs";
import * as NodeTimersPromises from "node:timers/promises";

const args = process.argv.slice(2);
const repository = "workbench-synthetic/attention-fixtures";
const apiRepository = "workbench-synthetic/attention-api";
const repositoryForPullRequest = (number) => (number === 906 ? apiRepository : repository);
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
  `[Synthetic attention] ${{ 901: "Failed PR checks", 902: "Unresolved PR feedback", 903: "Inspection unavailable", 904: "Inspection incomplete", 905: "Slow inspection", 906: "Verify invitation expiry and empty-response recovery across the API contract" }[number]}`;
const checks = (number) =>
  (number === 901 ? ["API tests", "Web tests"] : ["demo-check"]).map((name) => ({
    name: `[Synthetic attention] ${name}`,
    workflowName: "[Synthetic attention] Attention CI",
    checkSuite: { workflowRun: { workflow: { name: "[Synthetic attention] Attention CI" } } },
    status: "COMPLETED",
    conclusion: number === 901 ? "FAILURE" : "SUCCESS",
    detailsUrl: `https://github.com/${repositoryForPullRequest(number)}/pull/${number}`,
    completedAt: at,
  }));
const reviews = (number) =>
  number === 902
    ? [
        {
          id: "synthetic-requested-changes-902",
          author: { login: "synthetic-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "[Synthetic requested changes] Add an empty-response regression test before requesting another review.",
          submittedAt: at,
          url: `https://github.com/${repository}/pull/902#pullrequestreview-synthetic`,
          reactionGroups: [],
        },
      ]
    : [];
const pr = (number) => ({
  number,
  title: title(number),
  url: `https://github.com/${repositoryForPullRequest(number)}/pull/${number}`,
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
  additions: number === 902 ? 2 : 1,
  deletions: 0,
  changedFiles: number === 902 ? 2 : 1,
  statusCheckRollup: checks(number),
  reviewRequests: [],
  latestReviews: reviews(number),
  labels: [],
  viewerCanUpdate: true,
  viewerDidAuthor: true,
  viewerCanUpdateBranch: true,
  baseRef: { compare: { behindBy: 0 } },
});
const validateRepository = (number, selectedRepository) => {
  if (![901, 902, 903, 904, 905, 906].includes(number))
    refuse("PR is outside the fixture allowlist");
  if (selectedRepository !== repositoryForPullRequest(number))
    refuse("Repository is outside the fixture allowlist");
};
const validate = async (number) => {
  if (number === 903) refuse("PR inspection is deliberately unavailable");
  if (number === 905) await NodeTimersPromises.setTimeout(2200);
};
if (args[0] === "pr") {
  const selectedRepo = (flag("--repo") ?? flag("-R"))?.replace(/^(?:https:\/\/)?github\.com\//, "");
  if (![repository, apiRepository].includes(selectedRepo))
    refuse("Repository is outside the fixture allowlist");
  if (args[1] === "list") {
    output([]);
    process.exit(0);
  }
  const number = Number(args[2]);
  validateRepository(number, selectedRepo);
  await validate(number);
  if (args[1] === "diff") {
    console.log(
      "diff --git a/synthetic.txt b/synthetic.txt\nnew file mode 100644\n--- /dev/null\n+++ b/synthetic.txt\n@@ -0,0 +1 @@\n+Synthetic demo inspection only" +
        (number === 902
          ? "\ndiff --git a/src/invitations.ts b/src/invitations.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/invitations.ts\n@@ -0,0 +1 @@\n+// Synthetic example: invitation expiry requires a decision."
          : ""),
    );
    process.exit(0);
  }
  output({ ...pr(number), comments: [], reviews: reviews(number), commits: [] });
  process.exit(0);
}
if (args[0] !== "api" || !args.includes("graphql"))
  refuse("Command is outside the fixture allowlist");
const budget = { cost: 1, limit: 5000, remaining: 4999, resetAt: "2099-01-01T00:00:00Z" };
if (
  query.includes("PullRequestSummaries") ||
  query.includes("s0: repository(owner: $owner, name: $name)")
) {
  const literalEntries = [
    ...query.matchAll(
      /(s\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{ pullRequest\(number: (\d+)\)/g,
    ),
  ];
  const variableEntries = [
    ...query.matchAll(
      /(s\d+): repository\(owner: \$(\w+), name: \$(\w+)\) \{ pullRequest\(number: \$(\w+)\)/g,
    ),
  ].map((entry) => [
    entry[0],
    entry[1],
    variables[entry[2]],
    variables[entry[3]],
    variables[entry[4]],
  ]);
  const entries = [...literalEntries, ...variableEntries];
  if (!entries.length) refuse("Repository is outside the fixture allowlist");
  const data = { rateLimit: budget };
  for (const entry of entries) {
    const number = Number(entry[4]);
    validateRepository(number, `${entry[2]}/${entry[3]}`);
    if (number === 903) {
      data[entry[1]] = { pullRequest: null };
      continue;
    }
    await validate(number);
    data[entry[1]] = {
      pullRequest: {
        ...pr(number),
        latestReviews: { nodes: reviews(number) },
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
const number = Number(variables.number);
validateRepository(number, `${variables.owner}/${variables.name}`);
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
              ...(number === 902
                ? [
                    {
                      id: "synthetic-thread-902-expiry",
                      isResolved: false,
                      isOutdated: false,
                      path: "src/invitations.ts",
                      line: 1,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          {
                            ...comment,
                            id: "synthetic-feedback-expiry",
                            body: "[Synthetic unresolved feedback] Verify invitation expiry after 24 hours and show a recovery action for an expired link.",
                            url: `https://github.com/${repository}/pull/902#discussion_r2`,
                          },
                        ],
                        totalCount: 1,
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  ]
                : []),
            ]
          : [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: reviews(number) },
    reviews: { nodes: reviews(number) },
    comments: { nodes: [] },
    commits: { nodes: [] },
  };
} else if (query.includes("comments(first: 100, after: $commentsAfter)")) {
  const pageInfo = { hasNextPage: false, endCursor: null };
  pullRequest = {
    ...pullRequest,
    comments: { nodes: [], pageInfo },
    reviews: { nodes: reviews(number), pageInfo },
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
              contexts: { nodes: checks(number), pageInfo: { hasNextPage: false } },
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
