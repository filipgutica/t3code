import { test, expect, snapshot } from "./fixtures.ts";

test("W1 W2: create and rename a Workspace without preparing worktrees", async ({ page, demo }) => {
  const before = await snapshot(demo);
  await page.goto("/workbench?workbenchProjectId=orbit");
  await expect(page.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Workspace/ });
  await expect(
    dialog.getByRole("button", { name: "Create Workspace", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Workspace title").fill("Regression Workspace");
  await dialog.getByRole("checkbox", { name: /Orbit API/ }).check();
  await dialog.getByRole("checkbox", { name: /Orbit Web/ }).check();
  await dialog.getByRole("button", { name: "Create Workspace", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Regression Workspace", exact: true }),
  ).toBeVisible();
  const created = await snapshot(demo);
  expect(created.assignments).toEqual(before.assignments);
  expect(
    created.projects.find((p) => p.title === "Regression Workspace")?.linkedProjectIds,
  ).toHaveLength(2);
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "Edit Workspace" }).click();
  await dialog.getByLabel("Workspace title").fill("Renamed Regression Workspace");
  await expect(dialog.getByRole("checkbox", { name: /Orbit API/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Renamed Regression Workspace", exact: true }),
  ).toBeVisible();
});

test("T1 T2 T5 T6: create, edit, move, archive, restore and delete a Ticket", async ({
  page,
  demo,
}) => {
  await page.goto("/workbench?workbenchProjectId=orbit");
  await page.getByRole("button", { name: "New Ticket", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create Ticket", exact: true });
  await dialog.getByPlaceholder("What needs doing?").fill("Regression disposable ticket");
  await dialog
    .getByPlaceholder("Goal, constraints, and acceptance criteria…")
    .fill("Full regression description with acceptance criteria.");
  await dialog.getByRole("button", { name: "Create Ticket", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByText("Regression disposable ticket", { exact: true }).last().click();
  await expect(
    page.getByRole("heading", { name: "Regression disposable ticket", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Edited regression ticket");
  await page.getByLabel("Description", { exact: true }).fill("Updated full description.");
  await page.getByRole("button", { name: "Save Ticket", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Edited regression ticket", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Updated full description.", { exact: true })).toBeVisible();
  for (const to of ["In Progress", "Done", "Todo"]) {
    await page
      .getByRole("button", { name: "Change status of Edited regression ticket", exact: true })
      .click();
    await page.getByRole("menuitem", { name: to, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Change status of Edited regression ticket", exact: true }),
    ).toContainText(to);
  }
  const ticket = (await snapshot(demo)).tickets.find((t) => t.title === "Edited regression ticket");
  if (!ticket) throw new Error("Created Ticket was not persisted");
  expect(ticket.status).toBe("todo");
  await page.getByRole("button", { name: "Ticket actions" }).click();
  await page.getByRole("menuitem", { name: "Archive Ticket", exact: true }).click();
  await page.goto(`/workbench?workbenchProjectId=orbit&ticketId=${ticket.id}`);
  await page.getByRole("button", { name: "Ticket actions" }).click();
  await page.getByRole("menuitem", { name: "Restore Ticket", exact: true }).click();
  await page.getByRole("button", { name: "Ticket actions" }).click();
  await page.getByRole("menuitem", { name: "Delete Ticket", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edited regression ticket", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ticket actions" }).click();
  await page.getByRole("menuitem", { name: "Delete Ticket", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete Ticket", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edited regression ticket", exact: true }),
  ).not.toBeVisible();
  expect((await snapshot(demo)).tickets.some((t) => t.id === ticket.id)).toBe(false);
});

test("W3 W4 X2: direct routes, history and narrow layout retain Ticket ownership", async ({
  page,
}) => {
  await page.goto("/workbench?workbenchProjectId=orbit&ticketId=orbit-001");
  await expect(
    page.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await page.goto("/workbench?workbenchProjectId=beacon&ticketId=beacon-010");
  await expect(
    page.getByRole("heading", { name: "Write the five-minute quickstart", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Create the welcome checklist", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Back to Board" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
