import { test, expect, snapshot } from "./fixtures.ts";
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
  await page.goto(`/workbench?workbenchProjectId=orbit&ticketId=${ticket.id}`);
  await expect(page.getByRole("heading", { name: ticket.title, exact: true })).toBeVisible();
  await expect(page.getByText("unrelated-work", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pull Requests/ })).toHaveCount(0);

  prepared = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Pull Requests/ })).toBeVisible();
  await expect(page.getByText("Ticket workspace", { exact: true })).toBeVisible();
  await expect(page.getByText("Ticket workspace change", { exact: true })).toBeVisible();
  await expect(page.getByText("Unrelated shared checkout change", { exact: true })).toHaveCount(0);
});
