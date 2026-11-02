// @effect-diagnostics nodeBuiltinImport:off - The test controls the external provider fixture through a private file and checks the command's side effect.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { test, expect, openWorkbench, snapshot, ticketChat } from "./fixtures.ts";
import { providerControlPath, REGRESSION_PROVIDER_MESSAGE } from "./provider-settings.mts";

test("C1: the ticket chat embeds the Thread view, opens its terminal on the Ticket, and continues terminal actions on the full Thread", async ({
  page,
  demo,
}) => {
  const controlPath = providerControlPath(demo.home);
  const original = await NodeFSP.readFile(controlPath, "utf8");
  const marker = NodePath.join(demo.home, "ticket-chat-terminal-ran");
  const cwdMarker = NodePath.join(demo.home, "ticket-terminal-cwd");
  try {
    await NodeFSP.writeFile(
      controlPath,
      JSON.stringify({
        turn: {
          scenario: "success",
          message: `${REGRESSION_PROVIDER_MESSAGE}\n\n\`\`\`sh\ntouch ${marker}\n\`\`\`\n`,
        },
      }),
    );
    await openWorkbench(
      page,
      demo.workbenchUrl("/workbench?workbenchProjectId=orbit&ticketId=orbit-006"),
    );
    await page.getByRole("button", { name: "Create Thread", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create work area and Thread", exact: true })
      .click();
    const chat = ticketChat(page);
    const editor = chat.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();

    // The full Thread view types into its composer from anywhere on the page; the ticket
    // page keeps its own keyboard. A page click collapses the chat and keeps its draft.
    const draft = await editor.textContent();
    await page
      .getByRole("heading", { name: "Expire unused invitation links", exact: true })
      .click();
    await page.keyboard.type("q");
    await expect(editor).toBeHidden();
    await page.getByRole("button", { name: "Expand ticket chat", exact: true }).click();
    await expect(editor).toHaveText(draft ?? "");

    await editor.click();
    await editor.press("End");
    await editor.pressSequentially("Suggest a command.");
    await chat.getByRole("button", { name: "Submit message", exact: true }).click();
    await expect(chat.getByText(REGRESSION_PROVIDER_MESSAGE, { exact: true })).toBeVisible();

    // The Ticket header opens the chat Thread's terminal on the page, in the Thread's checkout.
    await page.getByRole("button", { name: "Toggle terminal drawer", exact: true }).click();
    const terminalInput = page
      .locator('[data-terminal-owner="drawer"]')
      .getByRole("textbox", { name: "Terminal input", exact: true });
    // Keys typed before the new shell starts are dropped, so type until the marker appears.
    await expect(async () => {
      await terminalInput.focus();
      await terminalInput.pressSequentially(`pwd > ${cwdMarker}`);
      await terminalInput.press("Enter");
      await expect.poll(() => NodeFS.existsSync(cwdMarker)).toBe(true);
    }).toPass();
    const assignment = (await snapshot(demo)).assignments.find(
      (entry) => entry.ticketId === "orbit-006",
    );
    const worktreePath = (await demo.shellSnapshot()).threads.find(
      (entry) => entry.id === assignment?.threadId,
    )?.worktreePath;
    expect(worktreePath).toBeTruthy();
    await expect
      .poll(() => (NodeFS.existsSync(cwdMarker) ? NodeFS.readFileSync(cwdMarker, "utf8") : ""))
      .toBe(`${NodeFS.realpathSync(worktreePath!)}\n`);
    expect(new URL(page.url()).pathname).toBe("/workbench");

    await chat.getByRole("button", { name: "Run in terminal", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === null,
    );
    await expect.poll(() => NodeFS.existsSync(marker)).toBe(true);
  } finally {
    await NodeFSP.writeFile(controlPath, original);
  }
});
