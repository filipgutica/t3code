import { describe, expect, it, vi } from "vite-plus/test";

import {
  inspectGitHub,
  inspectJira,
  provisionGitHub,
  provisionJira,
  resetJira,
  snapshotJiraBaseline,
  type CommandRunner,
} from "./remotes.mts";

const commandOutput = (stdout: string) => ({ stdout, stderr: "" });

describe("provisionGitHub", () => {
  it("returns a write-free plan by default", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue(commandOutput(""));

    const result = await provisionGitHub({
      owner: "Example-Owner",
      prefix: "guide",
      commandRunner: runner,
    });

    expect(result).toMatchObject({
      owner: "example-owner",
      prefix: "guide",
      apply: false,
      marker: "t3-workbench-demo:guide",
      repositories: ["guide-orbit-api", "guide-orbit-web"],
    });
    if (result.apply) throw new Error("Expected a preview result.");
    expect(result.operations).toHaveLength(9);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.slice(0, 2)).toEqual(["gh", ["auth", "status"]]);
  });

  it("reuses only marked repositories and pull requests", async () => {
    const runner = vi.fn<CommandRunner>().mockImplementation(async (_command, args) => {
      if (args[0] === "auth") return commandOutput("");
      if (args[0] === "repo") {
        const name = String(args[2]);
        return commandOutput(
          JSON.stringify({
            nameWithOwner: name,
            description: "t3-workbench-demo:guide",
            url: `https://github.com/${name}`,
            defaultBranchRef: { name: "main" },
          }),
        );
      }
      if (args[0] === "api") {
        const fullName = String(args.at(-1)).split("/").slice(1, 3).join("/");
        return commandOutput(
          JSON.stringify([
            [
              {
                number: 1,
                title: "Draft",
                head: { ref: "guide/demo-draft" },
                state: "open",
                draft: true,
                html_url: `https://github.com/${fullName}/pull/1`,
              },
              {
                number: 2,
                title: "Open",
                head: { ref: "guide/demo-open" },
                state: "open",
                draft: false,
                html_url: `https://github.com/${fullName}/pull/2`,
              },
              {
                number: 3,
                title: "Closed",
                head: { ref: "guide/demo-closed" },
                state: "open",
                draft: false,
                html_url: `https://github.com/${fullName}/pull/3`,
              },
              {
                number: 4,
                title: "Merged",
                head: { ref: "guide/demo-merged" },
                state: "open",
                draft: false,
                html_url: `https://github.com/${fullName}/pull/4`,
              },
            ],
          ]),
        );
      }
      if (args[0] === "pr") return commandOutput("");
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const result = await provisionGitHub({
      owner: "example-owner",
      prefix: "guide",
      apply: true,
      commandRunner: runner,
    });

    expect(result.apply).toBe(true);
    if (!result.apply) throw new Error("Expected an applied result.");
    expect(result.repositories).toHaveLength(2);
    expect(result.repositories[0]?.pullRequests.map((pullRequest) => pullRequest.scenario)).toEqual(
      ["draft", "open", "closed", "merged"],
    );
    expect(
      runner.mock.calls.some(([, args]) => args.includes("repo") && args.includes("create")),
    ).toBe(false);
    expect(runner.mock.calls.some(([, args]) => args[0] === "pr" && args[1] === "close")).toBe(
      true,
    );
    expect(runner.mock.calls.some(([, args]) => args[0] === "pr" && args[1] === "merge")).toBe(
      true,
    );
  });

  it("paginates pull requests during read-only inspection", async () => {
    const runner = vi.fn<CommandRunner>().mockImplementation(async (_command, args) => {
      if (args[0] === "auth") return commandOutput("");
      if (args[0] === "repo") {
        return commandOutput(
          JSON.stringify({ nameWithOwner: "example-owner/existing", description: "guide" }),
        );
      }
      if (args[0] === "api") {
        return commandOutput(
          JSON.stringify([
            [
              {
                number: 1,
                title: "first",
                state: "open",
                draft: false,
                html_url: "https://github.com/example-owner/existing/pull/1",
                head: { ref: "main" },
              },
            ],
            [
              {
                number: 2,
                title: "second",
                state: "closed",
                draft: false,
                html_url: "https://github.com/example-owner/existing/pull/2",
                head: { ref: "feature" },
              },
            ],
          ]),
        );
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const result = await inspectGitHub({
      repositories: ["example-owner/existing"],
      commandRunner: runner,
    });

    expect(result.missing).toEqual([]);
    expect(result.repositories[0]?.pullRequests).toHaveLength(2);
    expect(runner.mock.calls.some(([, args]) => args.includes("--paginate"))).toBe(true);
  });

  it("fails closed when a marked draft scenario has drifted", async () => {
    const runner = vi.fn<CommandRunner>().mockImplementation(async (_command, args) => {
      if (args[0] === "auth") return commandOutput("");
      if (args[0] === "repo") {
        const name = String(args[2]);
        return commandOutput(
          JSON.stringify({
            nameWithOwner: name,
            description: "t3-workbench-demo:guide",
            defaultBranchRef: { name: "main" },
          }),
        );
      }
      if (args[0] === "api") {
        return commandOutput(
          JSON.stringify([
            [
              {
                number: 1,
                title: "Draft",
                head: { ref: "guide/demo-draft" },
                state: "open",
                draft: false,
                html_url: "https://github.com/example-owner/guide-orbit-api/pull/1",
              },
            ],
          ]),
        );
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    await expect(
      provisionGitHub({
        owner: "example-owner",
        prefix: "guide",
        apply: true,
        commandRunner: runner,
      }),
    ).rejects.toThrow("draft scenario drifted");
    expect(runner.mock.calls.some(([, args]) => args[0] === "repo" && args[1] === "create")).toBe(
      false,
    );
  });

  it("refuses an unmarked repository before making changes", async () => {
    const runner = vi.fn<CommandRunner>().mockImplementation(async (_command, args) => {
      if (args[0] === "auth") return commandOutput("");
      if (args[0] === "repo") {
        const name = String(args[2]);
        return commandOutput(
          JSON.stringify({ nameWithOwner: name, description: "someone else's repository" }),
        );
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    await expect(
      provisionGitHub({
        owner: "example-owner",
        prefix: "guide",
        apply: true,
        commandRunner: runner,
      }),
    ).rejects.toThrow("Refusing to modify example-owner/guide-orbit-api");
    expect(runner.mock.calls.some(([, args]) => args.includes("create"))).toBe(false);
  });

  it("repairs a marked repository with already-pushed branches without reinitializing it", async () => {
    const runner = vi.fn<CommandRunner>().mockImplementation(async (command, args) => {
      if (command === "gh" && args[0] === "auth") return commandOutput("");
      if (command === "gh" && args[0] === "repo" && args[1] === "view") {
        const name = String(args[2]);
        return commandOutput(
          JSON.stringify({
            nameWithOwner: name,
            description: "t3-workbench-demo:guide",
            url: `https://github.com/${name}`,
            defaultBranchRef: { name: "main" },
          }),
        );
      }
      if (command === "gh" && args[0] === "api") return commandOutput("[[]]");
      if (command === "gh" && args[0] === "repo" && args[1] === "clone") return commandOutput("");
      if (command === "git" && args[0] === "ls-remote")
        return commandOutput("deadbeef\trefs/heads/guide/demo");
      if (command === "gh" && args[0] === "pr" && args[1] === "create") {
        const branch = String(args[args.indexOf("--head") + 1]);
        const number =
          ["draft", "open", "closed", "merged"].findIndex((scenario) => branch.endsWith(scenario)) +
          1;
        return commandOutput(`https://github.com/example-owner/demo/pull/${number}`);
      }
      if (command === "gh" && args[0] === "pr") return commandOutput("");
      if (command === "git" && args[0] === "config") return commandOutput("");
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    await provisionGitHub({
      owner: "example-owner",
      prefix: "guide",
      apply: true,
      commandRunner: runner,
    });

    expect(
      runner.mock.calls.some(
        ([command, args]) => command === "gh" && args[0] === "repo" && args[1] === "create",
      ),
    ).toBe(false);
    expect(
      runner.mock.calls.some(([command, args]) => command === "git" && args[0] === "init"),
    ).toBe(false);
    expect(
      runner.mock.calls.filter(
        ([command, args]) => command === "gh" && args[0] === "repo" && args[1] === "clone",
      ),
    ).toHaveLength(2);
  });
});

describe("provisionJira", () => {
  it("returns a write-free plan without contacting Jira", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await provisionJira({
      site: "https://example.atlassian.net/",
      projectKey: "demo",
      email: "user@example.test",
      token: "secret",
      prefix: "guide",
      fetcher,
    });

    expect(result).toMatchObject({
      site: "https://example.atlassian.net",
      projectKey: "DEMO",
      marker: "t3-workbench-demo-guide",
      apply: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates marked issues, transitions them, and adds them to an existing sprint", async () => {
    let issueNumber = 0;
    const calls: string[] = [];
    const issueBodies: Array<{
      readonly fields?: {
        readonly issuetype?: { readonly name?: string };
        readonly parent?: { readonly key?: string };
      };
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const path = new URL(url).pathname + new URL(url).search;
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/project/DEMO")) return Response.json({ id: "10000", key: "DEMO" });
      if (path.endsWith("/myself")) return Response.json({ accountId: "account-1" });
      if (path.startsWith("/rest/api/3/search")) return Response.json({ issues: [] });
      if (path.endsWith("/field")) {
        return Response.json([
          {
            id: "customfield_10014",
            schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" },
          },
        ]);
      }
      if (path.endsWith("/issue") && init?.method === "POST") {
        issueBodies.push(
          JSON.parse(String(init.body)) as {
            readonly fields?: {
              readonly issuetype?: { readonly name?: string };
              readonly parent?: { readonly key?: string };
            };
          },
        );
        issueNumber += 1;
        const type = issueNumber <= 2 ? "Epic" : "Task";
        return Response.json({
          id: String(issueNumber),
          key: `DEMO-${issueNumber}`,
          fields: { summary: type },
        });
      }
      if (path.includes("/transitions") && init?.method !== "POST") {
        return Response.json({
          transitions: [
            { id: "11", to: { name: "To Do" } },
            { id: "12", to: { name: "In Progress" } },
            { id: "13", to: { name: "In Review" } },
            { id: "14", to: { name: "Done" } },
            { id: "15", to: { name: "Closed" } },
          ],
        });
      }
      if (path.includes("/transitions") && init?.method === "POST") return Response.json({});
      if (path.includes("/board/7/sprint"))
        return Response.json({
          values: [{ id: 9, name: "t3-workbench-demo-guide sprint", state: "ACTIVE" }],
        });
      if (path.includes("/sprint/9/issue")) return Response.json({});
      throw new Error(`Unexpected Jira request: ${init?.method ?? "GET"} ${path}`);
    };

    const result = await provisionJira({
      site: "https://example.atlassian.net",
      projectKey: "DEMO",
      email: "user@example.test",
      token: "secret",
      prefix: "guide",
      boardId: 7,
      apply: true,
      fetcher,
    });

    expect(result).toMatchObject({ projectKey: "DEMO", accountId: "account-1", sprintId: 9 });
    if (!("issues" in result)) throw new Error("Expected an applied Jira result.");
    expect(result.epics).toEqual(["DEMO-1", "DEMO-2"]);
    expect(result.issues.map((issue) => issue.state)).toEqual([
      "todo",
      "in-progress",
      "in-review",
      "done",
      "closed",
    ]);
    expect(
      issueBodies.some(
        (body) => body.fields?.issuetype?.name === "Task" && body.fields.parent?.key === "DEMO-1",
      ),
    ).toBe(true);
    expect(calls.some((call) => call === "POST /rest/agile/1.0/sprint/9/issue")).toBe(true);
  });

  it("reports the actual state when Jira cannot transition a requested fixture state", async () => {
    let issueNumber = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/project/DEMO")) return Response.json({ id: "1", key: "DEMO" });
      if (url.pathname.endsWith("/myself")) return Response.json({ accountId: "account-1" });
      if (url.pathname.endsWith("/search/jql")) return Response.json({ issues: [] });
      if (url.pathname.endsWith("/issue") && init?.method === "POST") {
        issueNumber += 1;
        return Response.json({ id: String(issueNumber), key: `DEMO-${issueNumber}` });
      }
      if (url.pathname.includes("/transitions")) return Response.json({ transitions: [] });
      throw new Error(`Unexpected Jira request: ${init?.method ?? "GET"} ${url.pathname}`);
    };

    const result = await provisionJira({
      site: "https://example.atlassian.net",
      projectKey: "DEMO",
      email: "user@example.test",
      token: "secret",
      prefix: "guide",
      apply: true,
      fetcher,
    });

    if (!("issues" in result)) throw new Error("Expected an applied Jira result.");
    expect(result.issues.map((issue) => issue.requestedState)).toEqual([
      "todo",
      "in-progress",
      "in-review",
      "done",
      "closed",
    ]);
    expect(result.issues.every((issue) => issue.state === "unknown")).toBe(true);
    expect(result.warnings).toHaveLength(5);
    expect(result.warnings?.[0]).toContain("not the requested todo state");
  });
});

describe("inspectJira", () => {
  it("reports missing credentials without contacting Jira", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await inspectJira({
      site: "https://example.atlassian.net/",
      projectKey: "demo",
      fetcher,
    });

    expect(result.authenticated).toBe(false);
    expect(result.sprints).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads the project, account, board, and sprint without writes", async () => {
    const methods: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      methods.push(init?.method ?? "GET");
      if (url.pathname.endsWith("/project/DEMO"))
        return Response.json({ id: "1", key: "DEMO", name: "Demo" });
      if (url.pathname.endsWith("/myself")) return Response.json({ accountId: "account-1" });
      if (url.pathname.endsWith("/board/7"))
        return Response.json({ id: 7, name: "Demo board", type: "scrum" });
      if (url.pathname.endsWith("/board/7/sprint"))
        return Response.json({ values: [{ id: 9, name: "Demo sprint", state: "ACTIVE" }] });
      throw new Error(`Unexpected Jira request: ${url.pathname}`);
    };

    const result = await inspectJira({
      site: "https://example.atlassian.net",
      projectKey: "DEMO",
      email: "user@example.test",
      token: "secret",
      boardId: 7,
      fetcher,
    });

    expect(result).toMatchObject({
      authenticated: true,
      project: { key: "DEMO" },
      accountId: "account-1",
      board: { id: 7 },
    });
    expect(result.sprints).toEqual([{ id: 9, name: "Demo sprint", state: "ACTIVE" }]);
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
});

describe("resetJira", () => {
  it("returns a write-free plan and validates issue ownership", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await resetJira({
      baseline: {
        site: "https://example.atlassian.net/",
        projectKey: "orbit",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "Baseline description",
            labels: ["baseline"],
            assigneeAccountId: null,
            epicKey: null,
            state: "todo",
          },
        ],
      },
      email: "user@example.test",
      token: "secret",
      fetcher,
    });

    expect(result).toMatchObject({
      site: "https://example.atlassian.net",
      projectKey: "ORBIT",
      apply: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      resetJira({
        baseline: {
          site: "https://example.atlassian.net",
          projectKey: "ORBIT",
          boardId: 42,
          boardName: "Orbit board",
          sprintId: 7,
          sprintName: "Orbit sprint",
          issues: [
            {
              key: "BEACON-1",
              summary: "Baseline issue",
              description: "Baseline description",
              labels: ["baseline"],
              assigneeAccountId: null,
              epicKey: null,
              state: "todo",
            },
          ],
        },
        email: "user@example.test",
        token: "secret",
      }),
    ).rejects.toThrow("must belong to ORBIT");
  });

  it("clears an empty baseline description with null instead of invalid empty ADF text", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url: url.pathname, init: init ?? {} });
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "simple" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue"))
        return Response.json({ issues: [{ id: "10001", key: "ORBIT-1", fields: { labels: [] } }] });
      if (url.pathname.endsWith("/search/jql")) return Response.json({ issues: [], isLast: true });
      if (url.pathname.endsWith("/issue/ORBIT-1") && init?.method !== "PUT")
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: null,
            labels: [],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      if (url.pathname.endsWith("/issue/ORBIT-1") && init?.method === "PUT")
        return Response.json({});
      throw new Error(`Unexpected Jira request: ${init?.method ?? "GET"} ${url.pathname}`);
    };

    await resetJira({
      baseline: {
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "",
            labels: [],
            assigneeAccountId: null,
            epicKey: null,
            state: "todo",
          },
        ],
      },
      email: "user@example.test",
      token: "secret",
      apply: true,
      fetcher,
    });

    const update = requests.find(({ init }) => init.method === "PUT");
    expect(JSON.parse(String(update?.init.body))).toEqual({
      fields: {
        summary: "Baseline issue",
        description: null,
        labels: [],
        assignee: null,
        parent: null,
      },
    });
  });

  it("verifies the selected project, board, sprint, and issue before re-adding it", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "simple" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/issue/ORBIT-1"))
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Baseline description" }],
                },
              ],
            },
            labels: ["baseline"],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      if (url.pathname.endsWith("/issue/ORBIT-1") && init?.method === "PUT")
        return Response.json({});
      if (url.pathname.endsWith("/sprint/7/issue"))
        return Response.json({
          issues: [{ id: "10001", key: "ORBIT-1", fields: { labels: ["baseline"] } }],
          isLast: true,
        });
      if (url.pathname.endsWith("/search/jql")) return Response.json({ issues: [], isLast: true });
      throw new Error(`Unexpected Jira request: ${init?.method ?? "GET"} ${url.pathname}`);
    };

    const result = await resetJira({
      baseline: {
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "Baseline description",
            labels: ["baseline"],
            assigneeAccountId: null,
            epicKey: null,
            state: "todo",
          },
        ],
      },
      email: "user@example.test",
      token: "secret",
      apply: true,
      fetcher,
    });

    expect(result).toEqual({
      site: "https://example.atlassian.net",
      projectKey: "ORBIT",
      boardId: 42,
      sprintId: 7,
      issueKeys: ["ORBIT-1"],
      removedExtras: [],
      updated: ["ORBIT-1"],
      transitioned: [],
      verifiedIssueKeys: ["ORBIT-1"],
    });
    expect(calls).toEqual([
      "GET /rest/api/3/project/ORBIT",
      "GET /rest/agile/1.0/board/42",
      "GET /rest/agile/1.0/sprint/7",
      "GET /rest/agile/1.0/sprint/7/issue",
      "GET /rest/api/3/search/jql",
      "GET /rest/api/3/issue/ORBIT-1",
      "PUT /rest/api/3/issue/ORBIT-1",
      "POST /rest/agile/1.0/sprint/7/issue",
      "GET /rest/agile/1.0/sprint/7/issue",
    ]);
  });

  it("fails during preflight when a recorded status cannot be reached", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "scrum" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue"))
        return Response.json({
          issues: [{ id: "10001", key: "ORBIT-1", fields: { labels: [] } }],
          isLast: true,
        });
      if (url.pathname.endsWith("/search/jql")) return Response.json({ issues: [], isLast: true });
      if (url.pathname.endsWith("/issue/ORBIT-1"))
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: {},
            labels: [],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      if (url.pathname.endsWith("/transitions")) return Response.json({ transitions: [] });
      throw new Error(`Unexpected Jira request: ${init?.method ?? "GET"} ${url.pathname}`);
    };

    await expect(
      resetJira({
        baseline: {
          site: "https://example.atlassian.net",
          projectKey: "ORBIT",
          boardId: 42,
          boardName: "Orbit board",
          sprintId: 7,
          sprintName: "Orbit sprint",
          issues: [
            {
              key: "ORBIT-1",
              summary: "Baseline issue",
              description: "Baseline description",
              labels: [],
              assigneeAccountId: null,
              epicKey: null,
              state: "done",
            },
          ],
        },
        email: "user@example.test",
        token: "secret",
        apply: true,
        fetcher,
      }),
    ).rejects.toThrow("refusing partial baseline reset");
    expect(calls.some((call) => call.startsWith("PUT "))).toBe(false);
    expect(calls.some((call) => call.startsWith("POST "))).toBe(false);
  });

  it("deletes marked extras and moves unlabelled project extras to the backlog", async () => {
    const calls: string[] = [];
    let markedExtraPresent = true;
    let unlabelledExtraPresent = true;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "scrum" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue")) {
        if (method === "POST") return Response.json({});
        return Response.json({
          issues: [
            { id: "10001", key: "ORBIT-1", fields: { labels: ["baseline"] } },
            ...(markedExtraPresent
              ? [{ id: "10099", key: "ORBIT-99", fields: { labels: ["workbench-regression"] } }]
              : []),
            ...(unlabelledExtraPresent
              ? [{ id: "10097", key: "ORBIT-97", fields: { labels: [] } }]
              : []),
          ],
          isLast: true,
        });
      }
      if (url.pathname.endsWith("/search/jql"))
        return Response.json({
          issues: [
            { id: "10099", key: "ORBIT-99", fields: { labels: ["workbench-regression"] } },
            { id: "10098", key: "ORBIT-98", fields: { labels: ["workbench-regression"] } },
          ],
          isLast: true,
        });
      if (url.pathname.endsWith("/issue/ORBIT-99") || url.pathname.endsWith("/issue/ORBIT-98")) {
        if (method === "DELETE") {
          if (url.pathname.endsWith("/issue/ORBIT-99")) markedExtraPresent = false;
          return Response.json({});
        }
        throw new Error("The cleanup candidate should only be deleted.");
      }
      if (url.pathname.endsWith("/backlog/issue")) {
        expect(method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ issues: ["ORBIT-97"] });
        unlabelledExtraPresent = false;
        return Response.json({});
      }
      if (url.pathname.endsWith("/issue/ORBIT-1")) {
        if (method === "PUT") return Response.json({});
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: {},
            labels: ["baseline"],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      }
      throw new Error(`Unexpected Jira request: ${method} ${url.pathname}`);
    };

    const result = await resetJira({
      baseline: {
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "Baseline description",
            labels: ["baseline"],
            assigneeAccountId: null,
            epicKey: null,
            state: "todo",
          },
        ],
      },
      email: "user@example.test",
      token: "secret",
      apply: true,
      fetcher,
    });

    expect(result).toMatchObject({
      issueKeys: ["ORBIT-1"],
      removedExtras: ["ORBIT-99", "ORBIT-98"],
      verifiedIssueKeys: ["ORBIT-1"],
    });
    expect(calls.filter((call) => call.startsWith("DELETE "))).toEqual([
      "DELETE /rest/api/3/issue/ORBIT-99",
      "DELETE /rest/api/3/issue/ORBIT-98",
    ]);
    expect(calls.some((call) => call.includes("ORBIT-97") && call.startsWith("DELETE "))).toBe(
      false,
    );
    expect(calls.filter((call) => call === "POST /rest/agile/1.0/backlog/issue")).toHaveLength(1);
  });

  it("recovers on retry when reset is interrupted after cleanup", async () => {
    const calls: string[] = [];
    let markedExtraPresent = true;
    let failSprintAdd = true;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "scrum" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue")) {
        if (method === "DELETE") return Response.json({});
        if (method === "POST") {
          if (failSprintAdd) {
            failSprintAdd = false;
            return new Response("interrupted", { status: 503 });
          }
          return Response.json({});
        }
        return Response.json({
          issues: [
            { id: "10001", key: "ORBIT-1", fields: { labels: ["baseline"] } },
            ...(markedExtraPresent
              ? [{ id: "10099", key: "ORBIT-99", fields: { labels: ["workbench-regression"] } }]
              : []),
          ],
          isLast: true,
        });
      }
      if (url.pathname.endsWith("/search/jql"))
        return Response.json({
          issues: markedExtraPresent
            ? [{ id: "10099", key: "ORBIT-99", fields: { labels: ["workbench-regression"] } }]
            : [],
          isLast: true,
        });
      if (url.pathname.endsWith("/issue/ORBIT-99")) {
        if (method === "DELETE") {
          markedExtraPresent = false;
          return Response.json({});
        }
        throw new Error("The cleanup candidate should only be deleted.");
      }
      if (url.pathname.endsWith("/issue/ORBIT-1")) {
        if (method === "PUT") return Response.json({});
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: {},
            labels: ["baseline"],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      }
      throw new Error(`Unexpected Jira request: ${method} ${url.pathname}`);
    };
    const baseline = {
      site: "https://example.atlassian.net",
      projectKey: "ORBIT",
      boardId: 42,
      boardName: "Orbit board",
      sprintId: 7,
      sprintName: "Orbit sprint",
      issues: [
        {
          key: "ORBIT-1",
          summary: "Baseline issue",
          description: "Baseline description",
          labels: ["baseline"],
          assigneeAccountId: null,
          epicKey: null,
          state: "todo" as const,
        },
      ],
    };
    await expect(
      resetJira({ baseline, email: "user@example.test", token: "secret", apply: true, fetcher }),
    ).rejects.toThrow("POST /rest/agile/1.0/sprint/7/issue failed");
    const retry = await resetJira({
      baseline,
      email: "user@example.test",
      token: "secret",
      apply: true,
      fetcher,
    });
    expect(retry).toMatchObject({
      removedExtras: [],
      verifiedIssueKeys: ["ORBIT-1"],
    });
    expect(calls.filter((call) => call.startsWith("DELETE "))).toHaveLength(1);
  });

  it("preserves unrelated-project Jira issues while resetting the selected project", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "scrum" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue")) {
        if (method === "POST") return Response.json({});
        return Response.json({
          issues: [
            { id: "10001", key: "ORBIT-1", fields: { labels: ["baseline"] } },
            { id: "10077", key: "BEACON-77", fields: { labels: ["user-owned"] } },
          ],
          isLast: true,
        });
      }
      if (url.pathname.endsWith("/search/jql")) return Response.json({ issues: [], isLast: true });
      if (url.pathname.endsWith("/issue/ORBIT-1")) {
        if (method === "PUT") return Response.json({});
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "Baseline issue",
            description: {},
            labels: ["baseline"],
            assignee: null,
            parent: null,
            status: { name: "To Do" },
          },
        });
      }
      throw new Error(`Unexpected Jira request: ${method} ${url.pathname}`);
    };
    const result = await resetJira({
      baseline: {
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "Baseline description",
            labels: ["baseline"],
            assigneeAccountId: null,
            epicKey: null,
            state: "todo",
          },
        ],
      },
      email: "user@example.test",
      token: "secret",
      apply: true,
      fetcher,
    });
    expect(result).toMatchObject({
      verifiedIssueKeys: ["ORBIT-1", "BEACON-77"],
      removedExtras: [],
    });
    expect(calls.some((call) => call.includes("BEACON-77") && call.startsWith("DELETE "))).toBe(
      false,
    );
    expect(calls.some((call) => call === "POST /rest/agile/1.0/backlog/issue")).toBe(false);
  });
});

describe("snapshotJiraBaseline", () => {
  it.each([true, false])(
    "captures full issue fields, including Jira's omitted parent when ungrouped (%s)",
    async (hasParent) => {
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/project/ORBIT"))
          return Response.json({ id: "1", key: "ORBIT" });
        if (url.pathname.endsWith("/board/42"))
          return Response.json({ id: 42, name: "Orbit board", type: "simple" });
        if (url.pathname.endsWith("/sprint/7"))
          return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
        if (url.pathname.endsWith("/sprint/7/issue"))
          return Response.json({
            issues: [
              {
                id: "10001",
                key: "ORBIT-1",
                fields: {
                  summary: "Baseline issue",
                  description: hasParent
                    ? {
                        type: "doc",
                        version: 1,
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "Baseline description" }],
                          },
                        ],
                      }
                    : "Baseline description",
                  labels: ["baseline"],
                  assignee: { accountId: "account-1" },
                  ...(hasParent ? { parent: { key: "ORBIT-10" } } : {}),
                  status: { name: "To Do" },
                },
              },
            ],
            isLast: true,
          });
        throw new Error(`Unexpected Jira request: ${url.pathname}`);
      };

      await expect(
        snapshotJiraBaseline({
          site: "https://example.atlassian.net",
          projectKey: "ORBIT",
          boardId: 42,
          sprintId: 7,
          email: "user@example.test",
          token: "secret",
          fetcher,
        }),
      ).resolves.toEqual({
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        boardName: "Orbit board",
        sprintId: 7,
        sprintName: "Orbit sprint",
        issues: [
          {
            key: "ORBIT-1",
            summary: "Baseline issue",
            description: "Baseline description",
            labels: ["baseline"],
            assigneeAccountId: "account-1",
            epicKey: hasParent ? "ORBIT-10" : null,
            state: "todo",
          },
        ],
      });
    },
  );

  it("captures Jira's null description as an empty string", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/project/ORBIT")) return Response.json({ id: "1", key: "ORBIT" });
      if (url.pathname.endsWith("/board/42"))
        return Response.json({ id: 42, name: "Orbit board", type: "simple" });
      if (url.pathname.endsWith("/sprint/7"))
        return Response.json({ id: 7, name: "Orbit sprint", state: "ACTIVE" });
      if (url.pathname.endsWith("/sprint/7/issue"))
        return Response.json({
          issues: [
            {
              id: "10001",
              key: "ORBIT-1",
              fields: {
                summary: "Empty description",
                description: null,
                labels: [],
                assignee: null,
                status: { name: "To Do" },
              },
            },
          ],
          isLast: true,
        });
      throw new Error(`Unexpected Jira request: ${url.pathname}`);
    };

    await expect(
      snapshotJiraBaseline({
        site: "https://example.atlassian.net",
        projectKey: "ORBIT",
        boardId: 42,
        sprintId: 7,
        email: "user@example.test",
        token: "secret",
        fetcher,
      }),
    ).resolves.toMatchObject({
      issues: [expect.objectContaining({ key: "ORBIT-1", description: "" })],
    });
  });
});
