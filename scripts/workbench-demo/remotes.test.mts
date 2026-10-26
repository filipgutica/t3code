import { describe, expect, it, vi } from "vite-plus/test";

import { inspectGitHub, provisionGitHub, type CommandRunner } from "./remotes.mts";

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
