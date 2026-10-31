// @effect-diagnostics nodeBuiltinImport:off - Inspect the scripted provider input and disposable worktrees for end-to-end assertions.
import { test, expect, snapshot, openWorkbench, ticketChat, waitForWorkbench } from "./fixtures.ts";
import * as NodeChildProcess from "node:child_process";
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

test("N1 N2 N3 R1: create a Thread, send the Ticket instruction and retain completed work", async ({
  page,
  demo,
}, testInfo) => {
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-004"),
  );
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
    .getByRole("button", { name: "Create work area and Thread", exact: true })
    .click();
  const chat = ticketChat(page);
  const editor = chat.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/workbench");
  const prepared = await snapshot(demo);
  expect(prepared.tickets.find((t) => t.id === "orbit-004")?.status).toBe("todo");
  expect(prepared.assignments.filter((a) => a.ticketId === "orbit-004")).toHaveLength(1);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(
    "Do not edit files or run commands. Reply exactly: Workbench regression passed.",
  );
  await chat.getByRole("button", { name: "Submit message", exact: true }).click();
  await expect(chat.getByText("Workbench regression passed.", { exact: true })).toBeVisible();
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
      (input) =>
        input.includes(`Workbench Ticket ${JSON.stringify(ticket!.title)}`) &&
        input.includes("Prepared worktrees: "),
    ),
  ).toBe(true);
  expect(complete.tickets.find((t) => t.id === "orbit-004")?.status).toBe("in_progress");
  expect(complete.assignments.filter((a) => a.ticketId === "orbit-004")).toHaveLength(1);
  await chat.getByRole("button", { name: "Open full Thread", exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === "true",
  );
  const workspaceBreadcrumb = page.getByRole("link", {
    name: "Back to Workspace Orbit Board",
    exact: true,
  });
  const ticketBreadcrumb = page.getByRole("link", {
    name: "Back to Ticket Fix focus after creating a project in Workspace Orbit",
    exact: true,
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(workspaceBreadcrumb).toBeVisible();
  await expect(ticketBreadcrumb).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspaceBreadcrumb).not.toBeVisible();
  await expect(ticketBreadcrumb).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(workspaceBreadcrumb).toBeVisible();
  await page.reload();
  await waitForWorkbench(page);
  await expect(workspaceBreadcrumb).toBeVisible();
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
  const settledToggle = page
    .getByRole("region", { name: "Settled", exact: true })
    .getByRole("button", { name: "Settled 1", exact: true });
  await page
    .getByRole("button", { name: `Settle Thread ${nativeThread.title}`, exact: true })
    .click();
  await expect(settledToggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: `Un-settle Thread ${nativeThread.title}`, exact: true }),
  ).not.toBeVisible();
  expect(
    (await demo.shellSnapshot()).threads.find((entry) => entry.id === nativeThread.id)
      ?.settledOverride,
  ).toBe("settled");
  await page.reload();
  await waitForWorkbench(page);
  await expect(settledToggle).toHaveAttribute("aria-expanded", "false");
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
    sidebar.getByRole("button", { name: "Fix focus after creating a project", exact: true }),
  ).toHaveCount(1);
  // The sidebar lists Tickets only; Threads are reached from the Ticket and its chat.
  await expect(sidebar.getByRole("button", { name: nativeThread.title, exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: testInfo.outputPath("settlement-collapsed.png"), fullPage: true });
  await settledToggle.click();
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
  for (const repository of workspace!.repositories) {
    expect(
      NodeChildProcess.execFileSync("git", ["status", "--porcelain"], {
        cwd: repository.worktreePath,
        encoding: "utf8",
      }),
    ).toBe("");
  }
  await openWorkbench(
    page,
    demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-001"),
  );
  await expect(
    page.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Advanced work area settings", exact: true })
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
  const refusal = page.getByRole("alertdialog").getByRole("alert");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(
    "The Ticket Workspace cannot be reset while it has linked Agent Threads, including archived or historical Threads.",
  );
  expect((await snapshot(demo)).ticketWorkspaces.find((w) => w.ticketId === "orbit-001")).toEqual(
    workspace,
  );
});
