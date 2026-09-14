// @effect-diagnostics nodeBuiltinImport:off - Standalone setup tests exercise host file I/O.
import { it, expect, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setupHome } from "./environment.mts";
import {
  chooseOption,
  terminalReader,
  jiraOrigin,
  listProjects,
  saveSelection,
  selectJira,
} from "./jira-select.mts";

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

it("validates an HTTPS origin and paginates project search", async () => {
  expect(jiraOrigin("https://example.atlassian.net")).toBe("https://example.atlassian.net");
  expect(() => jiraOrigin("http://example.atlassian.net")).toThrow(/HTTPS/);
  expect(
    jiraOrigin(
      "https://example.atlassian.net/jira/software/projects/ORBIT/boards/42?view=planning#sprint",
    ),
  ).toBe("https://example.atlassian.net");
  expect(() => jiraOrigin("https://user:secret@example.atlassian.net/jira")).toThrow(/HTTPS/);
  const urls: string[] = [];
  const auth: string[] = [];
  const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
    urls.push(String(url));
    auth.push(String(new Headers(init?.headers).get("authorization")));
    return urls.length === 1
      ? response({
          values: [{ key: "ONE", name: "One" }],
          isLast: false,
          startAt: 0,
          maxResults: 1,
          total: 2,
        })
      : response({
          values: [{ key: "TWO", name: "Two" }],
          isLast: true,
          startAt: 1,
          maxResults: 1,
          total: 2,
        });
  });
  await expect(
    listProjects({
      site: "https://example.atlassian.net",
      email: "a@example.com",
      token: "secret",
      fetcher,
    }),
  ).resolves.toEqual([
    { key: "ONE", name: "One" },
    { key: "TWO", name: "Two" },
  ]);
  expect(urls[0]).toContain("/rest/api/3/project/search?startAt=0&maxResults=50");
  expect(urls[1]).toContain("startAt=1");
  expect(auth[0]).toMatch(/^Basic /);
  expect(auth[0]).not.toContain("secret");
});

it("does not leak credentials when a request fails", async () => {
  const fetcher = vi.fn(async () => response({ error: "secret" }, 403));
  await expect(
    listProjects({
      site: "https://example.atlassian.net",
      email: "person@example.com",
      token: "secret",
      fetcher,
    }),
  ).rejects.toThrow("HTTP 403");
  await expect(
    listProjects({
      site: "https://example.atlassian.net",
      email: "person@example.com",
      token: "secret",
      fetcher,
    }),
  ).rejects.not.toThrow("secret");
});

it("uses valid saved/default choices and reprompts invalid indexes", async () => {
  const answers = ["9", ""];
  const printed: string[] = [];
  const result = await chooseOption({
    label: "projects",
    options: [
      { key: "A", name: "Alpha" },
      { key: "B", name: "Beta" },
    ],
    name: (value) => value.name,
    identity: (value) => value.key,
    saved: "B",
    readLine: async () => answers.shift() ?? null,
    print: (line) => printed.push(line),
  });
  expect(result.key).toBe("B");
  expect(printed).toContain("Enter a number from 1 to 2.");
  await expect(
    chooseOption({
      label: "sprints",
      options: [
        { id: 1, name: "Future", state: "future" },
        { id: 2, name: "Active", state: "active" },
      ],
      name: (value) => value.name,
      identity: (value) => String(value.id),
      preferred: (value) => value.state === "active",
      readLine: async () => "",
    }),
  ).resolves.toMatchObject({ id: 2 });
  await expect(
    chooseOption({
      label: "projects",
      options: [{ key: "A", name: "Alpha" }],
      name: (value) => value.name,
      identity: (value) => value.key,
      readLine: async () => null,
    }),
  ).rejects.toThrow(/Input ended/);
});

it("selects names, skips sprint reads for provision, and writes only after success", async () => {
  const root = mkdtempSync(join(tmpdir(), "jira-select-test-"));
  try {
    const home = setupHome(join(root, "demo"));
    writeFileSync(
      join(home, "config.env"),
      "DEMO_JIRA_SITE_URL=https://example.atlassian.net\nDEMO_JIRA_EMAIL=person@example.com\nDEMO_JIRA_API_TOKEN=secret\nDEMO_JIRA_RESOURCE_MODE=provision\nUNRELATED=keep\n",
    );
    const paths: string[] = [];
    const fetcher = vi.fn(async (url: string | URL) => {
      paths.push(new URL(String(url)).pathname);
      return paths.at(-1)?.endsWith("/project/search")
        ? response({ values: [{ key: "DEMO", name: "Demo Project" }], isLast: true })
        : response({ values: [{ id: 42, name: "Demo Board", type: "scrum" }], isLast: true });
    });
    const result = await selectJira({ home, fetcher, readLine: async () => "" });
    expect(result.sprint).toBeUndefined();
    expect(paths).toEqual(["/rest/api/3/project/search", "/rest/agile/1.0/board"]);
    const config = readFileSync(join(home, "config.env"), "utf8");
    expect(config).toContain("UNRELATED=keep");
    expect(config).toContain("DEMO_JIRA_PROJECT_KEY=DEMO");
    expect(config).toContain("DEMO_JIRA_BOARD_ID=42");
    expect(config).toContain("DEMO_JIRA_SPRINT_ID=\n");
    expect(statSync(join(home, "config.env")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not write config when input ends during selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "jira-select-test-"));
  try {
    const home = setupHome(join(root, "demo"));
    const before =
      "DEMO_JIRA_SITE_URL=https://example.atlassian.net\nDEMO_JIRA_EMAIL=a@b\nDEMO_JIRA_API_TOKEN=secret\nDEMO_JIRA_RESOURCE_MODE=reuse\n";
    writeFileSync(join(home, "config.env"), before);
    const fetcher = vi.fn(
      async (url: string | URL) =>
        new Response(
          JSON.stringify(
            new URL(String(url)).pathname.endsWith("project/search")
              ? { values: [{ key: "A", name: "A" }], isLast: true }
              : { values: [{ id: 1, name: "Board" }], isLast: true },
          ),
        ),
    );
    await expect(selectJira({ home, fetcher, readLine: async () => null })).rejects.toThrow(
      /Input ended/,
    );
    expect(readFileSync(join(home, "config.env"), "utf8")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("preserves config values while upserting selected IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "jira-select-test-"));
  try {
    const home = setupHome(join(root, "demo"));
    writeFileSync(
      join(home, "config.env"),
      "SECRET=literal$(not-executed)\nDEMO_JIRA_PROJECT_KEY=OLD\nDEMO_JIRA_SITE_URL=https://example.atlassian.net/jira/software/projects/ORBIT\n",
    );
    saveSelection({
      home,
      provision: false,
      selection: {
        project: { key: "NEW", name: "New" },
        board: { id: 2, name: "Board" },
        sprint: { id: 3, name: "Sprint" },
      },
    });
    const config = readFileSync(join(home, "config.env"), "utf8");
    assert.match(config, /SECRET=literal\$\(not-executed\)/);
    assert.match(config, /DEMO_JIRA_PROJECT_KEY=NEW/);
    expect(config).toContain("DEMO_JIRA_SITE_URL=https://example.atlassian.net\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("terminal input retains queued answers and settles when input closes", async () => {
  const input = new PassThrough();
  const terminal = terminalReader({ input, output: new PassThrough() });
  try {
    const pending = terminal.readLine("Choice: ");
    input.end("2\n\n");
    await expect(pending).resolves.toBe("2");
    await expect(terminal.readLine("Choice: ")).resolves.toBe("");
    await expect(terminal.readLine("Choice: ")).resolves.toBeNull();
  } finally {
    terminal.close();
  }
});

it("reuses saved project, board and sprint choices across paginated lists", async () => {
  const root = mkdtempSync(join(tmpdir(), "jira-menu-reuse-"));
  try {
    const home = setupHome(join(root, "demo"));
    writeFileSync(
      join(home, "config.env"),
      "DEMO_JIRA_SITE_URL=https://example.atlassian.net\nDEMO_JIRA_EMAIL=a@b\nDEMO_JIRA_API_TOKEN=secret\nDEMO_JIRA_RESOURCE_MODE=reuse\nDEMO_JIRA_PROJECT_KEY=ORBIT\nDEMO_JIRA_BOARD_ID=42\nDEMO_JIRA_SPRINT_ID=9\n",
    );
    const fetcher = async (url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("project/search"))
        return response({ values: [{ key: "ORBIT", name: "Orbit Demo" }], isLast: true });
      if (parsed.pathname.endsWith("/board")) {
        expect(parsed.searchParams.get("projectKeyOrId")).toBe("ORBIT");
        expect(parsed.searchParams.get("type")).toBe("scrum");
        return parsed.searchParams.get("startAt") === "1"
          ? response({
              values: [{ id: 42, name: "Guide board", type: "scrum" }],
              isLast: true,
              startAt: 1,
            })
          : response({
              values: [{ id: 1, name: "Other board", type: "scrum" }],
              isLast: false,
              startAt: 0,
              maxResults: 1,
            });
      }
      expect(parsed.pathname).toBe("/rest/agile/1.0/board/42/sprint");
      expect(parsed.searchParams.get("state")).toBe("active,future");
      return parsed.searchParams.get("startAt") === "1"
        ? response({
            values: [{ id: 9, name: "Guide sprint", state: "future" }],
            isLast: true,
            startAt: 1,
          })
        : response({
            values: [{ id: 8, name: "Current sprint", state: "active" }],
            isLast: false,
            startAt: 0,
            maxResults: 1,
          });
    };
    const printed: string[] = [];
    const selected = await selectJira({
      home,
      fetcher,
      readLine: async () => "",
      print: (line) => printed.push(line),
    });
    expect(selected.board.id).toBe(42);
    expect(selected.sprint?.id).toBe(9);
    expect(printed).toContain("2. Guide sprint (future)");
    expect(readFileSync(join(home, "config.env"), "utf8")).toContain("DEMO_JIRA_SPRINT_ID=9");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
