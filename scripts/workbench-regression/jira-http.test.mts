import { expect, it } from "vite-plus/test";

import { JiraHttpClient } from "./jira-http.mts";

it("decodes Jira issue documents and sends authenticated updates", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const client = new JiraHttpClient({
    site: "https://example.atlassian.net/",
    email: "demo@example.test",
    token: "test-token",
    fetcher: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/issue/ORBIT-1?")) {
        return new Response(
          JSON.stringify({
            id: "10001",
            key: "ORBIT-1",
            fields: {
              summary: "A baseline issue",
              description: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Line one" }] },
                  { type: "paragraph", content: [{ type: "text", text: "Line two" }] },
                ],
              },
              labels: ["baseline"],
              assignee: { accountId: "account-1" },
              status: { id: "10000", name: "To Do" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    },
  });

  await expect(client.issue("ORBIT-1")).resolves.toMatchObject({
    id: "10001",
    key: "ORBIT-1",
    description: "Line one\nLine two",
    assigneeAccountId: "account-1",
  });
  await client.updateIssue("ORBIT-1", { description: "Updated", labels: ["regression"] });

  expect(requests).toHaveLength(2);
  expect(requests[0]?.init.headers).toMatchObject({
    Authorization: `Basic ${Buffer.from("demo@example.test:test-token").toString("base64")}`,
  });
  expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
    fields: {
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
      },
      labels: ["regression"],
    },
  });
});

it("clears an empty Jira description with null instead of invalid empty ADF text", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const client = new JiraHttpClient({
    site: "https://example.atlassian.net",
    email: "demo@example.test",
    token: "test-token",
    fetcher: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/issue/ORBIT-1?")) {
        return Response.json({
          id: "10001",
          key: "ORBIT-1",
          fields: {
            summary: "An issue without a description",
            description: null,
            labels: [],
            assignee: null,
            status: { id: "10000", name: "To Do" },
          },
        });
      }
      return new Response(null, { status: 204 });
    },
  });

  await expect(client.issue("ORBIT-1")).resolves.toMatchObject({ description: "" });
  await client.updateIssue("ORBIT-1", { description: "" });

  expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
    fields: { description: null },
  });
});

it("decodes transitions, current user, and sprint issue keys", async () => {
  const client = new JiraHttpClient({
    site: "https://example.atlassian.net",
    email: "demo@example.test",
    token: "test-token",
    fetcher: async (input) => {
      const url = String(input);
      if (url.endsWith("/transitions")) {
        return new Response(
          JSON.stringify({ transitions: [{ id: 11, name: "Start", to: { id: 3, name: "Done" } }] }),
          { status: 200 },
        );
      }
      if (url.endsWith("/myself")) {
        return new Response(JSON.stringify({ accountId: "account-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: [{ key: "ORBIT-1" }] }), { status: 200 });
    },
  });

  await expect(client.transitions("ORBIT-1")).resolves.toEqual([
    { id: "11", name: "Start", to: { id: "3", name: "Done" } },
  ]);
  await expect(client.currentUserAccountId()).resolves.toBe("account-1");
  await expect(client.sprintIssueKeys(7)).resolves.toEqual(["ORBIT-1"]);
});

it("recovers only exact test summaries across Jira search pages", async () => {
  const summary = "Regression unique-id";
  const client = new JiraHttpClient({
    site: "https://example.atlassian.net",
    email: "demo@example.test",
    token: "test-token",
    fetcher: async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("jql")).toBe('project = "ORBIT"');
      return new Response(
        JSON.stringify(
          url.searchParams.has("nextPageToken")
            ? { issues: [{ key: "ORBIT-2", fields: { summary } }], isLast: true }
            : {
                issues: [{ key: "ORBIT-1", fields: { summary: "Regression unique-id other" } }],
                nextPageToken: "next",
              },
        ),
      );
    },
  });
  await expect(client.issueKeysWithSummary({ projectKey: "ORBIT", summary })).resolves.toEqual([
    "ORBIT-2",
  ]);
});

it("creates, moves, and deletes only validated sprint IDs", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const client = new JiraHttpClient({
    site: "https://example.atlassian.net",
    email: "demo@example.test",
    token: "test-token",
    fetcher: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/rest/agile/1.0/sprint")) {
        return new Response(
          JSON.stringify({ id: 19, name: "Regression future", state: "future", originBoardId: 7 }),
          {
            status: 201,
          },
        );
      }
      if (String(input).endsWith("/rest/agile/1.0/sprint/19")) {
        return new Response(
          JSON.stringify({ id: 19, name: "Regression future", state: "future", originBoardId: 7 }),
          { status: 200 },
        );
      }
      if (String(input).includes("/rest/agile/1.0/board/7/sprint?state=future")) {
        return new Response(
          JSON.stringify({
            values: [{ id: 19, name: "Regression future", state: "future", originBoardId: 7 }],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    },
  });

  await expect(client.createFutureSprint(7, " Regression future ")).resolves.toEqual({
    id: 19,
    name: "Regression future",
    state: "future",
    originBoardId: 7,
  });
  await expect(client.sprint(19)).resolves.toEqual({
    id: 19,
    name: "Regression future",
    state: "future",
    originBoardId: 7,
  });
  await expect(client.futureSprintsForBoard(7)).resolves.toEqual([
    { id: 19, name: "Regression future", state: "future", originBoardId: 7 },
  ]);
  await client.moveIssuesToSprint(19, ["ORBIT-1"]);
  await client.deleteSprint(19);

  expect(requests.map(({ url, init }) => [url, init.method])).toEqual([
    ["https://example.atlassian.net/rest/agile/1.0/sprint", "POST"],
    ["https://example.atlassian.net/rest/agile/1.0/sprint/19", undefined],
    [
      "https://example.atlassian.net/rest/agile/1.0/board/7/sprint?state=future&maxResults=100",
      undefined,
    ],
    ["https://example.atlassian.net/rest/agile/1.0/sprint/19/issue", "POST"],
    ["https://example.atlassian.net/rest/agile/1.0/sprint/19", "DELETE"],
  ]);
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
    name: "Regression future",
    originBoardId: 7,
  });
  expect(JSON.parse(String(requests[3]?.init.body))).toEqual({ issues: ["ORBIT-1"] });

  await expect(client.createFutureSprint(0, "invalid")).rejects.toThrow(
    "Jira board ID must be a positive integer.",
  );
  await expect(client.createFutureSprint(7, "x".repeat(31))).rejects.toThrow(
    "Jira sprint names must not exceed 30 characters.",
  );
  expect(requests).toHaveLength(5);
  await expect(client.moveIssuesToSprint(19, [])).rejects.toThrow(
    "At least one Jira issue is required.",
  );
  await expect(client.deleteSprint(0)).rejects.toThrow(
    "Jira sprint ID must be a positive integer.",
  );
});
