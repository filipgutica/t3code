#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off - Standalone setup tooling owns its host I/O.
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";
import * as NodeProcess from "node:process";
import type * as NodeStream from "node:stream";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { requireHome, readConfig } from "./environment.mts";

export type JiraProject = { key: string; name: string };
export type JiraBoard = { id: number; name: string; type?: string };
export type JiraSprint = { id: number; name: string; state?: string };
export type JiraSelection = {
  project: JiraProject;
  board: JiraBoard;
  sprint?: JiraSprint;
};
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ReadLine = (prompt: string) => Promise<string | null>;

const PAGE_SIZE = 50;
const TIMEOUT_MS = 10_000;

export const jiraOrigin = (site: string): string => {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new Error("Enter an HTTPS Jira site or page URL without embedded login credentials.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
    throw new Error("Enter an HTTPS Jira site or page URL without embedded login credentials.");
  return url.origin;
};

export const requestJson = async ({
  site,
  email,
  token,
  path,
  fetcher = fetch,
  timeoutMs = TIMEOUT_MS,
}: {
  site: string;
  email: string;
  token: string;
  path: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): Promise<unknown> => {
  const origin = jiraOrigin(site);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(new URL(path, origin), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Jira request failed with HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error("Jira returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Jira ")) throw error;
    throw new Error("Jira request failed or timed out.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
};

const pageValues = (body: unknown): { values: unknown[]; more: boolean; next: number } => {
  if (Array.isArray(body)) return { values: body, more: false, next: 0 };
  if (
    typeof body !== "object" ||
    body === null ||
    !("values" in body) ||
    !Array.isArray(body.values)
  )
    throw new Error("Jira returned an unexpected list response.");
  const startAt = "startAt" in body && typeof body.startAt === "number" ? body.startAt : 0;
  const pageSize =
    "maxResults" in body && typeof body.maxResults === "number" && body.maxResults > 0
      ? body.maxResults
      : PAGE_SIZE;
  const next = startAt + pageSize;
  const more =
    ("isLast" in body && body.isLast === false) ||
    ("total" in body && typeof body.total === "number" && next < body.total);
  return { values: body.values, more: more && body.values.length > 0, next };
};

export const paginatedValues = async ({
  site,
  email,
  token,
  path,
  query = {},
  fetcher,
  timeoutMs,
}: {
  site: string;
  email: string;
  token: string;
  path: string;
  query?: Record<string, string>;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): Promise<unknown[]> => {
  const values: unknown[] = [];
  let startAt = 0;
  let first = true;
  for (;;) {
    const params = new URLSearchParams(query);
    if (!first) {
      params.set("startAt", String(startAt));
      params.set("maxResults", String(PAGE_SIZE));
    }
    const suffix = params.toString();
    const body = await requestJson({
      site,
      email,
      token,
      path: `${path}${suffix ? `?${suffix}` : ""}`,
      ...(fetcher ? { fetcher } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const page = pageValues(body);
    values.push(...page.values);
    if (!page.more) return values;
    if (!Number.isSafeInteger(page.next) || page.next <= startAt)
      throw new Error("Jira pagination did not advance.");
    startAt = page.next;
    first = false;
  }
};

const projectValue = (value: unknown): JiraProject | undefined =>
  typeof value === "object" &&
  value !== null &&
  "key" in value &&
  "name" in value &&
  typeof value.key === "string" &&
  typeof value.name === "string"
    ? { key: value.key, name: value.name }
    : undefined;
const boardValue = (value: unknown): JiraBoard | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("name" in value) ||
    (typeof value.id !== "number" && (typeof value.id !== "string" || !/^\d+$/.test(value.id))) ||
    typeof value.name !== "string"
  )
    return undefined;
  const type = "type" in value && typeof value.type === "string" ? value.type : undefined;
  return { id: Number(value.id), name: value.name, ...(type ? { type } : {}) };
};
const sprintValue = (value: unknown): JiraSprint | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("name" in value) ||
    (typeof value.id !== "number" && (typeof value.id !== "string" || !/^\d+$/.test(value.id))) ||
    typeof value.name !== "string"
  )
    return undefined;
  const state = "state" in value && typeof value.state === "string" ? value.state : undefined;
  return { id: Number(value.id), name: value.name, ...(state ? { state } : {}) };
};

export const listProjects = async (
  args: Omit<Parameters<typeof paginatedValues>[0], "path" | "query">,
) =>
  (
    await paginatedValues({
      ...args,
      path: "/rest/api/3/project/search",
      query: { startAt: "0", maxResults: String(PAGE_SIZE) },
    })
  )
    .map(projectValue)
    .filter((value): value is JiraProject => value !== undefined);
export const listBoards = async (
  args: Omit<Parameters<typeof paginatedValues>[0], "path" | "query"> & { projectKey: string },
) =>
  (
    await paginatedValues({
      ...args,
      path: "/rest/agile/1.0/board",
      query: { projectKeyOrId: args.projectKey },
    })
  )
    .map(boardValue)
    .filter(
      (value): value is JiraBoard =>
        value !== undefined &&
        (value.type === undefined || value.type === "scrum" || value.type === "simple"),
    );
export const listSprints = async (
  args: Omit<Parameters<typeof paginatedValues>[0], "path" | "query"> & { boardId: number },
) =>
  (
    await paginatedValues({
      ...args,
      path: `/rest/agile/1.0/board/${args.boardId}/sprint`,
      query: { state: "active,future" },
    })
  )
    .map(sprintValue)
    .filter((value): value is JiraSprint => value !== undefined);

export const chooseOption = async <T,>({
  label,
  options,
  name,
  identity,
  saved,
  preferred,
  readLine,
  print = console.log,
}: {
  label: string;
  options: readonly T[];
  name: (value: T) => string;
  identity: (value: T) => string;
  saved?: string;
  preferred?: (value: T) => boolean;
  readLine: ReadLine;
  print?: (line: string) => void;
}): Promise<T> => {
  if (options.length === 0) throw new Error(`No Jira ${label} options are available.`);
  print(`Jira ${label}:`);
  options.forEach((option, index) => print(`${index + 1}. ${name(option)}`));
  const savedIndex = saved ? options.findIndex((option) => identity(option) === saved) : -1;
  const defaultIndex =
    savedIndex >= 0
      ? savedIndex
      : options.length === 1
        ? 0
        : options.findIndex(preferred ?? (() => false));
  const fallback = defaultIndex >= 0 ? defaultIndex : 0;
  for (;;) {
    const answer = await readLine(`Select ${label} [${fallback + 1}]: `);
    if (answer === null) throw new Error("Input ended before Jira selection completed.");
    if (!answer.trim()) return options[fallback]!;
    const index = Number(answer.trim());
    if (Number.isSafeInteger(index) && index >= 1 && index <= options.length)
      return options[index - 1]!;
    print(`Enter a number from 1 to ${options.length}.`);
  }
};

export const saveSelection = ({
  home,
  selection,
  provision,
}: {
  home: string;
  selection: JiraSelection;
  provision: boolean;
}) => {
  const path = NodePath.join(home, "config.env");
  const existing = NodeFS.existsSync(path) ? NodeFS.readFileSync(path, "utf8") : "";
  const updates = new Map([
    ["DEMO_JIRA_PROJECT_KEY", selection.project.key],
    ["DEMO_JIRA_BOARD_ID", String(selection.board.id)],
    ["DEMO_JIRA_SPRINT_ID", provision ? "" : String(selection.sprint!.id)],
  ]);
  const configuredSite = readConfig(home).DEMO_JIRA_SITE_URL;
  if (configuredSite) updates.set("DEMO_JIRA_SITE_URL", jiraOrigin(configuredSite));
  const seen = new Set<string>();
  let content = existing
    .split(/\r?\n/)
    .map((line) => {
      const key = /^(DEMO_JIRA_(?:SITE_URL|PROJECT_KEY|BOARD_ID|SPRINT_ID))=/.exec(line)?.[1];
      if (!key || !updates.has(key)) return line;
      seen.add(key);
      return `${key}=${updates.get(key)}`;
    })
    .join("\n");
  const additions = [...updates]
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  if (additions)
    content =
      content && !content.endsWith("\n") ? `${content}\n${additions}` : `${content}${additions}`;
  const temporary = `${path}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
  NodeFS.writeFileSync(temporary, content.endsWith("\n") ? content : `${content}\n`, {
    mode: 0o600,
  });
  NodeFS.chmodSync(temporary, 0o600);
  NodeFS.renameSync(temporary, path);
  NodeFS.chmodSync(path, 0o600);
};

export const selectJira = async ({
  home,
  readLine,
  print = console.log,
  fetcher,
}: {
  home: string;
  readLine: ReadLine;
  print?: (line: string) => void;
  fetcher?: Fetcher;
}) => {
  const config = readConfig(home);
  const site = config.DEMO_JIRA_SITE_URL?.trim();
  const email = config.DEMO_JIRA_EMAIL?.trim();
  const token = config.DEMO_JIRA_API_TOKEN?.trim();
  const mode = config.DEMO_JIRA_RESOURCE_MODE?.trim() || "reuse";
  if (!site || !email || !token)
    throw new Error(
      "Set DEMO_JIRA_SITE_URL, DEMO_JIRA_EMAIL, and DEMO_JIRA_API_TOKEN in config.env.",
    );
  if (mode !== "reuse" && mode !== "provision")
    throw new Error("DEMO_JIRA_RESOURCE_MODE must be reuse or provision.");
  const common = { site, email, token, ...(fetcher ? { fetcher } : {}) };
  const projects = await listProjects(common);
  const projectChoice = {
    label: "projects",
    options: projects,
    name: (value: JiraProject) => `${value.name} (${value.key})`,
    identity: (value: JiraProject) => value.key,
    readLine,
    print,
    ...(config.DEMO_JIRA_PROJECT_KEY ? { saved: config.DEMO_JIRA_PROJECT_KEY } : {}),
  };
  const project = await chooseOption(projectChoice);
  const boards = await listBoards({ ...common, projectKey: project.key });
  const boardChoice = {
    label: "Scrum boards",
    options: boards,
    name: (value: JiraBoard) => value.name,
    identity: (value: JiraBoard) => String(value.id),
    readLine,
    print,
    ...(config.DEMO_JIRA_BOARD_ID ? { saved: config.DEMO_JIRA_BOARD_ID } : {}),
  };
  const board = await chooseOption(boardChoice);
  const sprint =
    mode === "reuse"
      ? await chooseOption({
          label: "sprints",
          options: await listSprints({ ...common, boardId: board.id }),
          name: (value: JiraSprint) => `${value.name} (${value.state ?? "unknown state"})`,
          identity: (value: JiraSprint) => String(value.id),
          readLine,
          print,
          preferred: (value: JiraSprint) => value.state?.toLowerCase() === "active",
          ...(config.DEMO_JIRA_SPRINT_ID ? { saved: config.DEMO_JIRA_SPRINT_ID } : {}),
        })
      : undefined;
  const selection = sprint ? { project, board, sprint } : { project, board };
  saveSelection({ home, selection, provision: mode === "provision" });
  return { project, board, sprint };
};

export const terminalReader = ({
  input,
  output,
}: {
  input: NodeStream.Readable;
  output: NodeStream.Writable;
}) => {
  const rl = NodeReadline.createInterface({ input, output });
  const lines = rl[Symbol.asyncIterator]();
  return {
    readLine: async (prompt: string) => {
      output.write(prompt);
      const line = await lines.next();
      return line.done ? null : line.value;
    },
    close: () => rl.close(),
  };
};

export const main = async () => {
  const { values, positionals } = NodeUtil.parseArgs({
    options: { home: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length) throw new Error("Unexpected positional argument.");
  if (!values.home) throw new Error("Usage: jira-select.mts --home HOME");
  const home = requireHome(values.home);
  const terminal = terminalReader({ input: NodeProcess.stdin, output: NodeProcess.stdout });
  try {
    const result = await selectJira({ home, readLine: terminal.readLine });
    console.log(
      `Saved Jira selections: ${result.project.name} / ${result.board.name}${result.sprint ? ` / ${result.sprint.name}` : ""}`,
    );
  } finally {
    terminal.close();
  }
};

if (NodePath.resolve(process.argv[1] ?? "") === NodeURL.fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Jira selection failed.");
    process.exitCode = 1;
  });
