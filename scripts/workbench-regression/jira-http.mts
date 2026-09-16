// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Live regression helpers own remote Jira assertions.

import { WORKBENCH_DEMO_CLEANUP_LABEL } from "../workbench-demo/remotes.mts";

/** Shared with the baseline reset: interrupted live tests may leave this issue behind. */
export const JIRA_REGRESSION_CLEANUP_LABEL = WORKBENCH_DEMO_CLEANUP_LABEL;

export type JiraHttpConfig = {
  readonly site: string;
  readonly email: string;
  readonly token: string;
  readonly fetcher?: typeof fetch;
};

export type JiraIssue = {
  readonly id: string;
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly assigneeAccountId: string | null;
  readonly status: { readonly id: string; readonly name: string };
};

export type JiraTransition = {
  readonly id: string;
  readonly name: string;
  readonly to: { readonly id: string; readonly name: string };
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const descriptionText = (value: unknown): string => {
  if (typeof value === "string") return value;
  const root = record(value);
  const content = root?.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((paragraph) => {
      const paragraphRecord = record(paragraph);
      const paragraphContent = paragraphRecord?.content;
      if (!Array.isArray(paragraphContent)) return [];
      return paragraphContent.flatMap((part) => {
        const text = stringValue(record(part)?.text);
        return text === undefined ? [] : [text];
      });
    })
    .join("\n");
};

const documentDescription = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const siteUrl = (site: string): string => {
  const url = new URL(site.trim());
  if (url.protocol !== "https:") throw new Error("Jira site must use HTTPS.");
  return url.origin;
};

const parseIssue = (value: unknown): JiraIssue => {
  const root = record(value);
  const fields = record(root?.fields);
  const status = record(fields?.status);
  if (
    root === null ||
    fields === null ||
    status === null ||
    typeof root.id !== "string" ||
    typeof root.key !== "string" ||
    typeof fields.summary !== "string" ||
    typeof status.id !== "string" ||
    typeof status.name !== "string"
  ) {
    throw new Error("Jira returned an unexpected issue response.");
  }
  const assignee = record(fields.assignee);
  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((label): label is string => typeof label === "string")
    : [];
  return {
    id: root.id,
    key: root.key,
    summary: fields.summary,
    description: descriptionText(fields.description),
    labels,
    assigneeAccountId: stringValue(assignee?.accountId) ?? null,
    status: { id: status.id, name: status.name },
  };
};

const parseTransitions = (value: unknown): readonly JiraTransition[] => {
  const transitions = record(value)?.transitions;
  if (!Array.isArray(transitions))
    throw new Error("Jira returned an unexpected transition response.");
  return transitions.flatMap((item) => {
    const transition = record(item);
    const destination = record(transition?.to);
    if (
      transition === null ||
      destination === null ||
      (typeof transition.id !== "string" && typeof transition.id !== "number") ||
      typeof transition.name !== "string" ||
      (typeof destination.id !== "string" && typeof destination.id !== "number") ||
      typeof destination.name !== "string"
    )
      return [];
    return [
      {
        id: String(transition.id),
        name: transition.name,
        to: { id: String(destination.id), name: destination.name },
      },
    ];
  });
};

const parseSprintKeys = (value: unknown): readonly string[] => {
  const issues = record(value)?.issues;
  if (!Array.isArray(issues)) throw new Error("Jira returned an unexpected sprint response.");
  return issues.flatMap((item) => {
    const key = stringValue(record(item)?.key);
    return key === undefined ? [] : [key];
  });
};

const parseAccountId = (value: unknown): string => {
  const accountId = stringValue(record(value)?.accountId);
  if (accountId === undefined)
    throw new Error("Jira returned an unexpected current-user response.");
  return accountId;
};

export class JiraHttpClient {
  readonly #site: string;
  readonly #authorization: string;
  readonly #fetcher: typeof fetch;

  constructor({ site, email, token, fetcher = fetch }: JiraHttpConfig) {
    if (!email.trim() || !token.trim()) throw new Error("Jira email and API token are required.");
    this.#site = siteUrl(site);
    this.#authorization = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
    this.#fetcher = fetcher;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetcher(`${this.#site}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: this.#authorization,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
    const bodyText = await response.text();
    let body: unknown = undefined;
    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        body = bodyText;
      }
    }
    if (!response.ok) {
      throw new Error(`Jira ${init.method ?? "GET"} ${path} failed (HTTP ${response.status}).`);
    }
    return body as T;
  }

  async issue(key: string): Promise<JiraIssue> {
    const fields = "summary,description,status,labels,assignee";
    return parseIssue(
      await this.#request<unknown>(
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}`,
      ),
    );
  }

  async currentUserAccountId(): Promise<string> {
    return parseAccountId(await this.#request<unknown>("/rest/api/3/myself"));
  }

  async transitions(key: string): Promise<readonly JiraTransition[]> {
    return parseTransitions(
      await this.#request<unknown>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`),
    );
  }

  async updateIssue(
    key: string,
    fields: { readonly description?: string; readonly labels?: readonly string[] },
  ): Promise<void> {
    await this.#request(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          ...(fields.description === undefined
            ? {}
            : { description: documentDescription(fields.description) }),
          ...(fields.labels === undefined ? {} : { labels: [...fields.labels] }),
        },
      }),
    });
  }

  async transitionIssue(key: string, transitionId: string): Promise<void> {
    await this.#request(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  async sprintIssueKeys(sprintId: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(sprintId) || sprintId <= 0) {
      throw new Error("Jira sprint ID must be a positive integer.");
    }
    return parseSprintKeys(
      await this.#request<unknown>(
        `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}/issue?maxResults=100&fields=key`,
      ),
    );
  }

  /** Recover only the unique issue created by a failed UI test. */
  async issueKeysWithSummary({
    projectKey,
    summary,
  }: {
    projectKey: string;
    summary: string;
  }): Promise<readonly string[]> {
    const keys: string[] = [];
    let nextPageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({
        jql: `project = ${JSON.stringify(projectKey)}`,
        fields: "summary",
        maxResults: "100",
      });
      if (nextPageToken) query.set("nextPageToken", nextPageToken);
      const result = record(await this.#request<unknown>(`/rest/api/3/search/jql?${query}`));
      if (!Array.isArray(result?.issues))
        throw new Error("Jira returned an unexpected issue search response.");
      for (const value of result.issues) {
        const issue = record(value);
        if (record(issue?.fields)?.summary === summary && typeof issue?.key === "string")
          keys.push(issue.key);
      }
      nextPageToken = stringValue(result.nextPageToken);
      if (nextPageToken && seen.has(nextPageToken))
        throw new Error("Jira repeated an issue search page.");
      if (nextPageToken) seen.add(nextPageToken);
    } while (nextPageToken);
    return keys;
  }

  async deleteIssue(key: string): Promise<void> {
    await this.#request(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "DELETE" });
  }
}
