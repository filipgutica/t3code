// @effect-diagnostics nodeBuiltinImport:off - Inspect only this test's disposable worktrees.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { test, expect, openWorkbench, snapshot } from "./fixtures.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";

test("prepare without a thread, extend context, and reuse retained worktrees", async ({
  page,
  demo,
}, testInfo) => {
  test.setTimeout(120_000);
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-007"),
  );
  await expect(
    page.getByRole("heading", { name: "Add a team settings page", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not prepared", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose editor", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("unprepared.png"), fullPage: true });
  const before = await snapshot(demo);
  await page.getByRole("button", { name: "Prepare workspace", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  const prepared = await snapshot(demo);
  expect(prepared.assignments).toEqual(before.assignments);
  const workspace = prepared.ticketWorkspaces.find(
    (candidate) => candidate.ticketId === "orbit-007",
  )!;
  expect(workspace.status).toBe("ready");
  expect(workspace.repositories).toHaveLength(1);
  const original = workspace.repositories[0]!;
  const marker = NodePath.join(original.worktreePath, "retained-work.txt");
  await NodeFSP.writeFile(marker, "Keep this local work.\n");
  await page.getByRole("button", { name: "Expand Edit repository scope", exact: true }).click();
  await page.getByRole("checkbox", { name: "Orbit API", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Orbit API", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Choose editor", exact: true })).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "Orbit Web", exact: true })).toBeEnabled();
  const extended = (await snapshot(demo)).ticketWorkspaces.find(
    (candidate) => candidate.ticketId === "orbit-007",
  )!;
  expect(extended.repositories).toHaveLength(2);
  expect(
    extended.repositories.find((repository) => repository.projectId === original.projectId)
      ?.worktreePath,
  ).toBe(original.worktreePath);
  await page.getByRole("checkbox", { name: "Orbit Web", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Orbit Web", exact: true })).not.toBeChecked();
  await expect(page.getByText(/Retained.*outside ticket context/)).toBeVisible();
  expect(await NodeFSP.readFile(marker, "utf8")).toBe("Keep this local work.\n");
  await page.getByRole("checkbox", { name: "Orbit Web", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Orbit Web", exact: true })).toBeChecked();
  await expect(page.getByText(/Retained.*outside ticket context/)).not.toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Orbit Web", exact: true })).toBeEnabled();
  const restored = (await snapshot(demo)).ticketWorkspaces.find(
    (candidate) => candidate.ticketId === "orbit-007",
  )!;
  expect(
    restored.repositories.find((repository) => repository.projectId === original.projectId)
      ?.worktreePath,
  ).toBe(original.worktreePath);
  expect(await NodeFSP.readFile(marker, "utf8")).toBe("Keep this local work.\n");
  expect((await snapshot(demo)).assignments).toEqual(before.assignments);
  await page.getByRole("button", { name: "Choose editor", exact: true }).first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").locator("kbd")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("prepared.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "Expand Advanced workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove prepared worktrees", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove prepared worktrees", exact: true })
    .click();
  await expect(page.getByText(/has local changes/).last()).toBeVisible();
  expect(await NodeFSP.readFile(marker, "utf8")).toBe("Keep this local work.\n");
  await NodeFSP.unlink(marker);
});

test("unlink preserves a native thread and its workspace, and permits relinking", async ({
  page,
  demo,
}) => {
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-008"),
  );
  await page
    .getByRole("button", { name: "Create Thread for Validate invitation addresses", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create Thread", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === "true",
  );
  const initial = await snapshot(demo);
  const assignment = initial.assignments.find((candidate) => candidate.ticketId === "orbit-008")!;
  const thread = (await demo.shellSnapshot()).threads.find(
    (candidate) => candidate.id === assignment.threadId,
  )!;
  expect(
    initial.ticketWorkspaces
      .find((candidate) => candidate.ticketId === "orbit-008")
      ?.repositories.some((repository) => repository.worktreePath === thread.worktreePath),
  ).toBe(true);
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-008"),
  );
  await page.getByRole("button", { name: `Unlink Thread ${thread.title}`, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Unlink Thread ${thread.title}`, exact: true }),
  ).not.toBeVisible();
  expect(
    (await snapshot(demo)).assignments.some((candidate) => candidate.threadId === thread.id),
  ).toBe(false);
  const retainedThread = (await demo.shellSnapshot()).threads.find(
    (candidate) => candidate.id === thread.id,
  );
  expect(retainedThread?.worktreePath).toBe(thread.worktreePath);
  await page
    .getByRole("button", { name: "Expand Advanced workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove prepared worktrees", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove prepared worktrees", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "The Ticket Workspace cannot be reset while a native Thread still uses one of its worktrees.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /Link existing Thread/i, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: thread.title, exact: true }).click();
  await dialog.getByRole("button", { name: /Link Thread/i, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: `Unlink Thread ${thread.title}`, exact: true }),
  ).toBeVisible();
  expect(
    (await snapshot(demo)).assignments.find((candidate) => candidate.threadId === thread.id)
      ?.ticketId,
  ).toBe("orbit-008");
});

test("standalone preparation shows progress immediately and retries a failed request", async ({
  page,
  demo,
}) => {
  let failNext = true;
  const failure = Promise.withResolvers<void>();
  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage(async (message) => {
      const payload: unknown = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      );
      if (
        failNext &&
        typeof payload === "object" &&
        payload !== null &&
        "tag" in payload &&
        "id" in payload &&
        payload.tag === WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace
      ) {
        failNext = false;
        await failure.promise;
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: payload.id,
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: {
                    _tag: "WorkbenchOperationError",
                    code: "ticket_workspace_preparation_failed",
                    message: "Preparation failed for regression.",
                  },
                },
              ],
            },
          }),
        );
        return;
      }
      server.send(message);
    });
  });
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-003"),
  );
  await page.getByRole("button", { name: "Prepare workspace", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preparing workspace…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Preparing", { exact: true })).toBeVisible();
  failure.resolve();
  await expect(page.getByText("Preparation failed for regression.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry preparation", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry preparation", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  expect(
    (await snapshot(demo)).assignments.some((candidate) => candidate.ticketId === "orbit-003"),
  ).toBe(false);
});
