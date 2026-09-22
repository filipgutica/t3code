// @effect-diagnostics nodeBuiltinImport:off - Read the scripted provider's received input for the end-to-end assertion.
import { test, expect, snapshot } from "./fixtures.ts";
import * as NodeFSP from "node:fs/promises";
import { providerStatePath } from "./provider-settings.mts";
import * as Schema from "effect/Schema";

const decodeProviderState = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      threads: Schema.Record(
        Schema.String,
        Schema.Struct({
          turns: Schema.Array(Schema.Struct({ input: Schema.String })),
        }),
      ),
    }),
  ),
);

test("N1 N2 N3 R1: create a Thread, send full Ticket context and retain completed work", async ({
  page,
  demo,
}, testInfo) => {
  await page.goto(demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-004"));
  await expect(
    page.getByRole("heading", { name: "Fix focus after creating a project", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Create Thread for Fix focus after creating a project",
      exact: true,
    })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create Thread", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === "true",
  );
  const prepared = await snapshot(demo);
  expect(prepared.tickets.find((t) => t.id === "orbit-004")?.status).toBe("todo");
  expect(prepared.assignments.filter((a) => a.ticketId === "orbit-004")).toHaveLength(1);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(
    "Do not edit files or run commands. Reply exactly: Workbench regression passed.",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Workbench regression passed.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).not.toBeVisible();
  const complete = await snapshot(demo);
  const ticket = prepared.tickets.find((candidate) => candidate.id === "orbit-004");
  expect(ticket?.markdown).toBeTruthy();
  const providerState = decodeProviderState(
    await NodeFSP.readFile(providerStatePath(demo.home), "utf8"),
  );
  const inputs = Object.values(providerState.threads).flatMap((thread) =>
    thread.turns.map((turn) => turn.input.replace(/^  /gm, "")),
  );
  expect(inputs.some((input) => input.includes(ticket!.markdown))).toBe(true);
  expect(
    inputs.some(
      (input) => input.includes("## Repository scope") && input.includes("Orbit Web (primary)"),
    ),
  ).toBe(true);
  expect(complete.tickets.find((t) => t.id === "orbit-004")?.status).toBe("in_progress");
  expect(complete.assignments.filter((a) => a.ticketId === "orbit-004")).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("Workbench regression passed.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Fix focus after creating a project", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Back to Ticket Fix focus after creating a project in Workspace Orbit",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fix focus after creating a project",
      exact: true,
    }),
  ).toBeVisible();
  const assignment = complete.assignments.find((entry) => entry.ticketId === "orbit-004")!;
  const nativeThread = (await demo.shellSnapshot()).threads.find(
    (entry) => entry.id === assignment.threadId,
  )!;
  await page.screenshot({ path: testInfo.outputPath("settlement-active.png"), fullPage: true });
  await page
    .getByRole("button", { name: `Settle Thread ${nativeThread.title}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand Settled Threads", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Un-settle Thread ${nativeThread.title}`, exact: true }),
  ).not.toBeVisible();
  expect(
    (await demo.shellSnapshot()).threads.find((entry) => entry.id === nativeThread.id)
      ?.settledOverride,
  ).toBe("settled");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand Settled Threads", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No active Threads", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Create Thread for Fix focus after creating a project",
      exact: true,
    })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  const sidebar = page.locator('[data-slot="sidebar-content"]');
  await expect(
    sidebar.getByRole("button", { name: /^Fix focus after creating a project \d+$/ }),
  ).toHaveCount(1);
  await sidebar
    .getByRole("button", {
      name: "Expand Settled Threads in Fix focus after creating a project",
      exact: true,
    })
    .click();
  const settledSidebar = sidebar.getByRole("region", {
    name: "Settled Threads in Fix focus after creating a project",
    exact: true,
  });
  await settledSidebar.getByRole("button", { name: nativeThread.title, exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname.endsWith(`/${nativeThread.id}`) && url.searchParams.get("workbench") === "true",
  );
  await expect(
    sidebar.getByRole("button", { name: nativeThread.title, exact: true }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: `Actions for Thread ${nativeThread.title}`, exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^New thread on / })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Pin thread", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Snooze", exact: true })).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Project settings", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Archive thread", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Un-settle thread", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workbench-thread-menu.png") });
  await page.getByRole("button", { name: "Rename thread", exact: true }).click();
  await sidebar
    .getByRole("textbox", { name: `Rename Thread ${nativeThread.title}`, exact: true })
    .fill("Sidebar renamed thread");
  await sidebar
    .getByRole("textbox", { name: `Rename Thread ${nativeThread.title}`, exact: true })
    .press("Enter");
  await expect(
    sidebar.getByRole("button", { name: "Sidebar renamed thread", exact: true }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Actions for Thread Sidebar renamed thread", exact: true })
    .click();
  await page.getByRole("button", { name: "Rename thread", exact: true }).click();
  await sidebar
    .getByRole("textbox", { name: "Rename Thread Sidebar renamed thread", exact: true })
    .fill(nativeThread.title);
  await sidebar
    .getByRole("textbox", { name: "Rename Thread Sidebar renamed thread", exact: true })
    .press("Enter");
  await expect(
    sidebar.getByRole("button", { name: nativeThread.title, exact: true }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: `Actions for Thread ${nativeThread.title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Un-settle thread", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: nativeThread.title, exact: true }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: `Actions for Thread ${nativeThread.title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Settle thread", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: nativeThread.title, exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", {
      name: "Collapse Settled Threads in Fix focus after creating a project",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("sidebar-settled-thread.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", {
      name: "Back to Ticket Fix focus after creating a project in Workspace Orbit",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand Settled Threads", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settlement-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "Expand Settled Threads", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Un-settle Thread ${nativeThread.title}`, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settlement-expanded.png"), fullPage: true });
  await page
    .getByRole("button", { name: `Un-settle Thread ${nativeThread.title}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Settle Thread ${nativeThread.title}`, exact: true }),
  ).toBeVisible();
  const restoredThread = (await demo.shellSnapshot()).threads.find(
    (entry) => entry.id === nativeThread.id,
  );
  expect(restoredThread?.settledOverride).toBe("active");
  expect(restoredThread?.worktreePath).toBe(nativeThread.worktreePath);
  const restored = await snapshot(demo);
  expect(restored.assignments).toEqual(complete.assignments);
  expect(restored.ticketWorkspaces).toEqual(complete.ticketWorkspaces);
});

test("R1 R3: multi-repository worktrees persist and reset refuses retained Threads", async ({
  page,
  demo,
}) => {
  const before = await snapshot(demo);
  const workspace = before.ticketWorkspaces.find((w) => w.ticketId === "orbit-001");
  expect(workspace).toBeDefined();
  await page.goto(demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-001"));
  await expect(
    page.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Advanced workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove prepared worktrees", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  expect((await snapshot(demo)).ticketWorkspaces.find((w) => w.ticketId === "orbit-001")).toEqual(
    workspace,
  );
  await page.getByRole("button", { name: "Remove prepared worktrees", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove prepared worktrees", exact: true })
    .click();
  await expect(
    page.getByText(/Threads.*(exist|linked)|linked.*Threads|Thread.*before.*reset/i).last(),
  ).toBeVisible();
  expect((await snapshot(demo)).ticketWorkspaces.find((w) => w.ticketId === "orbit-001")).toEqual(
    workspace,
  );
});
