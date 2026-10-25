// @effect-diagnostics nodeBuiltinImport:off - The test controls the external provider fixture through a private file and checks the command's side effect.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { test, expect, openWorkbench, ticketChat } from "./fixtures.ts";
import { providerControlPath, REGRESSION_PROVIDER_MESSAGE } from "./provider-settings.mts";

test("C1: the ticket chat embeds the Thread view and continues terminal actions on the full Thread", async ({
  page,
  demo,
}) => {
  const controlPath = providerControlPath(demo.home);
  const original = await NodeFSP.readFile(controlPath, "utf8");
  const marker = NodePath.join(demo.home, "ticket-chat-terminal-ran");
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
    await page
      .getByRole("button", {
        name: "Create Thread for Expire unused invitation links",
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
    await expect(editor).toBeFocused();

    // The full Thread view types into its composer from anywhere on the page; the ticket
    // page keeps its own keyboard.
    const draft = await editor.textContent();
    await page
      .getByRole("heading", { name: "Expire unused invitation links", exact: true })
      .click();
    await page.keyboard.type("q");
    await expect(editor).toHaveText(draft ?? "");

    await editor.click();
    await editor.press("End");
    await editor.pressSequentially("Suggest a command.");
    await chat.getByRole("button", { name: "Submit message", exact: true }).click();
    await expect(chat.getByText(REGRESSION_PROVIDER_MESSAGE, { exact: true })).toBeVisible();

    await chat.getByRole("button", { name: "Run in terminal", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname !== "/workbench" && url.searchParams.get("workbench") === "true",
    );
    await expect.poll(() => NodeFS.existsSync(marker)).toBe(true);
  } finally {
    await NodeFSP.writeFile(controlPath, original);
  }
});
