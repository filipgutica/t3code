import { test, expect, snapshot } from "./fixtures.ts";

test("E1 T3: Epic creation, child membership and completion progress persist", async ({
  page,
  demo,
}) => {
  await page.goto("/workbench?workbenchProjectId=beacon");
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "New Epic" }).click();
  const epicDialog = page.getByRole("dialog", { name: "Create Epic", exact: true });
  const dialog = page.getByRole("dialog", { name: "Create Ticket", exact: true });
  await epicDialog.getByPlaceholder("What outcome does this Epic deliver?").fill("Regression Epic");
  await epicDialog
    .getByPlaceholder("Context, scope, and intended outcome…")
    .fill("**Reliable releases** for Beacon.");
  await epicDialog.getByRole("button", { name: "Create Epic", exact: true }).click();
  await expect(epicDialog).not.toBeVisible();
  const epic = (await snapshot(demo.home)).epics.find((e) => e.title === "Regression Epic");
  if (!epic) throw new Error("Created Epic was not persisted");
  await page.goto(`/workbench?workbenchProjectId=beacon&epicId=${epic.id}`);
  await expect(page.getByRole("heading", { name: "Regression Epic", exact: true })).toBeVisible();
  await expect(page.getByText("0 of 0 done", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Ticket", exact: true }).click();
  await dialog.getByPlaceholder("What needs doing?").fill("Regression Epic child");
  await dialog.getByRole("combobox", { name: "Ticket type" }).click();
  await page.getByRole("option", { name: "Bug", exact: true }).click();
  await dialog.getByRole("button", { name: "Create Ticket", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const child = (await snapshot(demo.home)).tickets.find(
    (t) => t.title === "Regression Epic child",
  );
  if (!child) throw new Error("Created child was not persisted");
  expect(child.epicId).toBe(epic.id);
  expect(child.kind).toBe("bug");
  await page.goto(`/workbench?workbenchProjectId=beacon&ticketId=${child.id}`);
  await page
    .getByRole("button", { name: "Change status of Regression Epic child", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Change status of Regression Epic child", exact: true }),
  ).toContainText("Done");
  await page.goto(`/workbench?workbenchProjectId=beacon&epicId=${epic.id}`);
  await expect(page.getByText("1 of 1 done", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Updated Epic scope.");
  await page.getByRole("button", { name: "Save Epic" }).click();
  await page.reload();
  await expect(page.getByText("Updated Epic scope.", { exact: true })).toBeVisible();
});
