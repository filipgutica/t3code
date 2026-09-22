import { test, expect, snapshot } from "./fixtures.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import { ORCHESTRATION_WS_METHODS } from "../../packages/contracts/src/orchestration.ts";

test("board shortcut opens the working Thread rather than the newer idle Thread", async ({
  page,
  demo,
}) => {
  const initial = await snapshot(demo);
  const shell = await demo.shellSnapshot();
  const ticket = initial.tickets.find((item) => item.id === "orbit-001");
  const working = shell.threads.find((item) => item.id === "orbit-001-thread");
  const idle = shell.threads.find((item) => item.id === "orbit-005-thread");
  if (!ticket || !working || !idle) throw new Error("Expected seeded demo Threads");
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
                assignments: [
                  ...initial.assignments.filter((item) => item.ticketId !== ticket.id),
                  {
                    id: "shortcut-working",
                    ticketId: ticket.id,
                    threadId: working.id,
                    createdAt: "2026-09-01T00:00:00.000Z",
                    supersededAt: null,
                  },
                  {
                    id: "shortcut-idle",
                    ticketId: ticket.id,
                    threadId: idle.id,
                    createdAt: "2026-09-02T00:00:00.000Z",
                    supersededAt: null,
                  },
                ],
              },
            },
          }),
        );
        return;
      }
      if (payload.tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
        socket.send(
          JSON.stringify({
            _tag: "Chunk",
            requestId: payload.id,
            values: [
              {
                kind: "snapshot",
                snapshot: {
                  ...shell,
                  threads: shell.threads.map((thread) =>
                    thread.id === working.id || thread.id === idle.id
                      ? {
                          ...thread,
                          session: null,
                          hasPendingApprovals: false,
                          hasPendingUserInput: false,
                          hasActionableProposedPlan: false,
                          backgroundLiveness: thread.id === working.id ? "working" : null,
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
      server.send(message);
    });
  });
  await page.goto(demo.workbenchUrl("/workbench?workbenchProjectId=orbit"));
  const card = page.getByRole("article").filter({ hasText: ticket.title });
  await expect(card.getByText("Working", { exact: true })).toBeVisible();
  await expect(card.getByText("· 2 Threads", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: `Open Thread for ${ticket.title}`, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith(`/${working.id}`));
});
