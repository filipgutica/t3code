import { ORCHESTRATION_V2_WS_METHODS } from "../../packages/contracts/src/orchestrationV2.ts";
import { test, expect, snapshot, openWorkbench, waitForWorkbench } from "./fixtures.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import { WS_METHODS } from "../../packages/contracts/src/rpc.ts";

test("ticket PRs exclude shared checkouts until a workspace is prepared", async ({
  page,
  demo,
}) => {
  const initial = await snapshot(demo);
  const ticket = initial.tickets.find(
    (candidate) =>
      candidate.projectId === "orbit" &&
      !initial.assignments.some((assignment) => assignment.ticketId === candidate.id),
  );
  if (!ticket) throw new Error("Expected an unassigned demo Ticket");
  let prepared = false;
  const worktreePath = `${demo.home}/ticket-pr-worktree`;
  const timestamp = "2026-09-16T00:00:00.000Z";
  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const payload: unknown = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      );
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("_tag" in payload) ||
        payload._tag !== "Request" ||
        !("id" in payload) ||
        !("tag" in payload)
      ) {
        server.send(message);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchGetSnapshot) {
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: payload.id,
            exit: {
              _tag: "Success",
              value: {
                ...initial,
                ticketWorkspaces: prepared
                  ? [
                      {
                        ticketId: ticket.id,
                        attemptId: "pr-scope-attempt",
                        status: "ready",
                        branchName: "ticket-work",
                        errorMessage: null,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        repositories: [
                          {
                            projectId: ticket.primaryT3ProjectId,
                            isPrimary: true,
                            sourcePath: `${demo.home}/shared`,
                            worktreePath,
                            branchName: "ticket-work",
                            status: "ready",
                            errorMessage: null,
                            createdAt: timestamp,
                            updatedAt: timestamp,
                          },
                        ],
                      },
                    ]
                  : [],
              },
            },
          }),
        );
        return;
      }
      if (
        payload.tag === WS_METHODS.subscribeVcsStatus ||
        payload.tag === WS_METHODS.vcsRefreshStatus
      ) {
        const input = "payload" in payload ? payload.payload : null;
        const owned =
          typeof input === "object" &&
          input !== null &&
          "cwd" in input &&
          input.cwd === worktreePath;
        const local = {
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: false,
          refName: owned ? "ticket-work" : "unrelated-work",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        };
        const remote = {
          hasUpstream: true,
          aheadCount: 0,
          behindCount: 0,
          pr: {
            number: owned ? 202 : 101,
            title: owned ? "Ticket workspace change" : "Unrelated shared checkout change",
            url: `https://github.com/example/repo/pull/${owned ? 202 : 101}`,
            baseRef: "main",
            headRef: local.refName,
            state: "open",
          },
        };
        socket.send(
          JSON.stringify(
            payload.tag === WS_METHODS.subscribeVcsStatus
              ? {
                  _tag: "Chunk",
                  requestId: payload.id,
                  values: [{ _tag: "snapshot", local, remote }],
                }
              : {
                  _tag: "Exit",
                  requestId: payload.id,
                  exit: { _tag: "Success", value: { ...local, ...remote } },
                },
          ),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await openWorkbench(
    page,
    demo.workbenchUrl(`/workbench?workbenchProjectId=orbit&ticketId=${ticket.id}`),
  );
  await expect(page.getByRole("heading", { name: ticket.title, exact: true })).toBeVisible();
  await expect(page.getByText("unrelated-work", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Pull requests 0", exact: true })).toBeVisible();
  await expect(
    page.getByText("No pull requests found for this ticket.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Unrelated shared checkout change", { exact: true })).toHaveCount(0);

  prepared = true;
  await page.reload();
  await waitForWorkbench(page);
  await expect(page.getByRole("heading", { name: /^Pull requests/ })).toBeVisible();
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Pull requests/ }) })
      .getByText("Work area", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ticket workspace change", { exact: true })).toBeVisible();
  await expect(page.getByText("Unrelated shared checkout change", { exact: true })).toHaveCount(0);
});

test("ticket PR References show without changing Ticket scope", async ({
  page,
  demo,
}, testInfo) => {
  const initial = await snapshot(demo);
  const workspace = initial.projects.find((project) => project.id === "orbit");
  const ticket = initial.tickets.find((candidate) => candidate.projectId === workspace?.id);
  const selectedProjectId = workspace?.linkedProjectIds[0];
  if (!workspace || !ticket || !selectedProjectId)
    throw new Error("Expected a demo Workspace with a repository and a Ticket");
  const shell = await demo.shellSnapshot();
  const threadId = initial.assignments.find(
    (assignment) => assignment.ticketId === ticket.id,
  )?.threadId;
  if (!threadId) throw new Error("Expected a linked demo Thread");
  const threadTitle = "Database setup and connection verification for the development environment";
  const timestamp = "2026-09-17T00:00:00.000Z";
  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request: unknown = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      );
      if (
        typeof request !== "object" ||
        request === null ||
        !("_tag" in request) ||
        request._tag !== "Request" ||
        !("id" in request) ||
        !("tag" in request)
      ) {
        server.send(message);
        return;
      }
      const reply = (value: unknown) =>
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: request.id,
            exit: { _tag: "Success", value },
          }),
        );
      if (request.tag === ORCHESTRATION_V2_WS_METHODS.subscribeShell) {
        socket.send(
          JSON.stringify({
            _tag: "Chunk",
            requestId: request.id,
            values: [
              {
                kind: "snapshot",
                snapshot: {
                  ...shell,
                  threads: shell.threads.map((thread) =>
                    thread.id === threadId
                      ? {
                          ...thread,
                          title: threadTitle,
                          pullRequests: [
                            {
                              host: "github.com",
                              repository: "example/api",
                              number: 1584,
                              url: "https://github.com/example/api/pull/1584",
                              source: "manual",
                              linkedAt: timestamp,
                              stack: null,
                              snapshot: {
                                state: "open",
                                title: "Add remote database setup",
                                headBranch: "remote-setup",
                                baseBranch: "main",
                                isDraft: false,
                                updatedAt: null,
                                syncedAt: timestamp,
                              },
                            },
                          ],
                        }
                      : thread,
                  ),
                },
              },
            ],
          }),
        );
        return;
      }
      if (request.tag === WORKBENCH_WS_METHODS.workbenchGetSnapshot) {
        reply({
          ...initial,
          tickets: initial.tickets.map((candidate) =>
            candidate.id === ticket.id
              ? {
                  ...candidate,
                  primaryT3ProjectId: selectedProjectId,
                  repositoryProjectIds: [selectedProjectId],
                }
              : candidate,
          ),
          references: [
            {
              ticketId: ticket.id,
              url: "https://github.com/example/api/pull/1554",
              title: "Fix request scoping",
              addedByThreadId: null,
              createdAt: timestamp,
            },
          ],
          ticketWorkspaces: [],
        });
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await openWorkbench(
    page,
    demo.workbenchUrl(`/workbench?workbenchProjectId=${workspace.id}&ticketId=${ticket.id}`),
  );
  await expect(page.getByRole("heading", { name: ticket.title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pull requests/ })).toBeVisible();
  await page.getByRole("heading", { name: /^Pull requests/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ticket-pr-discovery.png") });
  await expect(page.getByText("Fix request scoping", { exact: true })).toBeVisible();
  const threadBadge = page.getByRole("button", {
    name: `Open linked Thread: ${threadTitle}`,
    exact: true,
  });
  await expect(threadBadge).toBeVisible();
  await threadBadge.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator('[data-slot="tooltip-popup"]')).toContainText(threadTitle);
  await page.screenshot({ path: testInfo.outputPath("ticket-thread-tooltip.png") });
  await threadBadge.press("Escape");
  const linkedPr = page
    .getByRole("link", {
      name: "Open pull request #1584: Add remote database setup in T3 Code (open)",
      exact: true,
    })
    .filter({ hasText: "Add remote database setup" });
  await expect(linkedPr).toBeVisible();
  await expect(
    linkedPr
      .locator("span")
      .filter({ hasText: /^#1584$/ })
      .first(),
  ).toHaveClass(/text-emerald/);
  await page.screenshot({ path: testInfo.outputPath("ticket-pr-discovery.png") });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(threadBadge).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ticket-metadata-narrow.png") });
  await threadBadge.click();
  await expect(page).toHaveURL(
    (url) => url.pathname.includes(threadId) && url.searchParams.get("workbench") === "true",
  );
  // Showing the PR must not add its repository to the Ticket's saved preparation scope.
  expect((await snapshot(demo)).tickets.find((candidate) => candidate.id === ticket.id)).toEqual(
    ticket,
  );
});
