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
}) => {
  await page.goto("/workbench?workbenchProjectId=orbit&ticketId=orbit-004");
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
});

test("R1 R3: multi-repository worktrees persist and reset refuses retained Threads", async ({
  page,
  demo,
}) => {
  const before = await snapshot(demo);
  const workspace = before.ticketWorkspaces.find((w) => w.ticketId === "orbit-001");
  expect(workspace).toBeDefined();
  await page.goto("/workbench?workbenchProjectId=orbit&ticketId=orbit-001");
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
