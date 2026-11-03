import {
  EnvironmentId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { WorkbenchBriefBody } from "./WorkbenchBriefReview";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import { WorkbenchReviewBar } from "./WorkbenchReviewBar";
import { useWorkbenchTicketBriefReview } from "./useWorkbenchBriefReview";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), undo: vi.fn(), ask: vi.fn() }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly name: "accept" | "undo" | "ask" }) => mocks[command.name],
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    acceptTicketReview: { name: "accept" },
    undoTicketReview: { name: "undo" },
    askForTicketChange: { name: "ask" },
  },
}));

const environmentId = EnvironmentId.make("environment");
const goal = "Help a new team finish setup.";
const why = "A person who returns sees the same progress.";
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket-1"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Build the welcome checklist",
  markdown: `## Goal\n\n${goal}\n\n${why}`,
  repositoryProjectIds: [],
  status: "in_progress",
  blocked: false,
  revision: 7,
  archivedAt: null,
  createdAt: "2026-11-03T10:00:00.000Z",
  updatedAt: "2026-11-03T10:00:00.000Z",
};
const reviewBase = {
  title: "Create the welcome checklist",
  markdown: `## Goal\n\n${goal}\n\nSomeone who comes back has to start over.`,
};
const succeeded = AsyncResult.success(ticket);

function setup() {
  mocks.accept.mockReset();
  mocks.undo.mockReset();
  mocks.ask.mockReset();
}

/** The Ticket page's brief: the badge, the review bar, and the brief or its diff. */
function TicketBrief({ record }: { readonly record: WorkbenchTicket }) {
  const briefReview = useWorkbenchTicketBriefReview({
    environmentId,
    ticket: record,
    localEdit: false,
    archived: false,
    jira: false,
  });
  return (
    <>
      <WorkbenchProvenanceBadge
        source={{ kind: "askForChange" }}
        pressed={briefReview.diffShown}
        onToggle={briefReview.review?.toggleDiff}
      />
      {briefReview.review ? <WorkbenchReviewBar review={briefReview.review} /> : null}
      <WorkbenchBriefBody briefReview={briefReview} markdown={record.markdown} jira={false} />
    </>
  );
}

it("undoes and accepts with the reviewed revision, and explains an Undo that met a newer edit", async () => {
  setup();
  mocks.undo.mockResolvedValue(
    AsyncResult.failure(
      Cause.fail(
        new WorkbenchOperationError({ code: "ticket_changed", message: "The Ticket changed." }),
      ),
    ),
  );
  mocks.accept.mockResolvedValue(succeeded);
  await using screen = await render(<TicketBrief record={{ ...ticket, reviewBase }} />);
  const bar = screen.getByRole("region", { name: "Review changes" });
  await expect.element(bar).toMatchTextContent(/Unreviewed changes · title and 1 paragraph/);

  await userEvent.click(bar.getByRole("button", { name: "Undo" }));
  expect(mocks.undo).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { id: ticket.id, expectedRevision: 7 },
  });
  await expect.element(bar).toMatchTextContent(/Nothing was undone\./);
  await expect.element(bar).toMatchTextContent(/Undo again to restore the text from before both\./);

  await userEvent.click(bar.getByRole("button", { name: "Accept" }));
  expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { id: ticket.id, expectedRevision: 7 },
  });
  await expect.element(bar).not.toMatchTextContent(/Nothing was undone/);
});

it("hides and shows the diff from the badge, which does nothing without a review", async () => {
  setup();
  await using screen = await render(<TicketBrief record={{ ...ticket, reviewBase }} />);
  const removed = screen.getByText("Someone who comes back has to start over.");
  await expect.element(removed).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /Updated by Ask for change/ }));
  await expect.element(removed).not.toBeInTheDocument();
  await expect.element(screen.getByText(why)).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Review changes" }))
    .toMatchTextContent(/diff hidden/);

  await userEvent.click(screen.getByRole("button", { name: "Show diff" }));
  await expect.element(screen.getByText("Someone who comes back has to start over.")).toBeVisible();

  await screen.rerender(<TicketBrief record={{ ...ticket, reviewBase: null }} />);
  await expect.element(screen.getByText("Updated by Ask for change")).toBeVisible();
  expect(screen.getByRole("button", { name: /Updated by Ask for change/ }).query()).toBeNull();
});

it("asks for a change to the whole blocks a selection touches, and Cancel stops the request", async () => {
  setup();
  mocks.ask.mockImplementation(
    ({ input }: { readonly input: { readonly signal: AbortSignal } }) =>
      new Promise((resolve) => {
        input.signal.addEventListener("abort", () =>
          resolve(AsyncResult.failure(Cause.interrupt())),
        );
      }),
  );
  await using screen = await render(<TicketBrief record={ticket} />);
  await userEvent.tripleClick(screen.getByText(goal));
  await userEvent.click(page.getByRole("button", { name: "Ask for change" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Describe the edit" }), "Say it shorter");
  await userEvent.keyboard("{Enter}");

  const start = ticket.markdown.indexOf(goal);
  expect(mocks.ask).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: expect.objectContaining({
      id: ticket.id,
      expectedRevision: 7,
      start,
      end: start + goal.length,
      blockSource: goal,
      instruction: "Say it shorter",
    }),
  });
  const { signal } = mocks.ask.mock.calls[0]![0].input;
  await expect.element(page.getByText("Rewriting…")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  // The prompt stays open with the instruction, so the person can adjust and send again.
  await expect
    .element(page.getByRole("textbox", { name: "Describe the edit" }))
    .toHaveValue("Say it shorter");
});

it("keeps the pill through the rest of the triple-click that opened it", async () => {
  setup();
  await using screen = await render(<TicketBrief record={ticket} />);
  // On the words, so the second click selects one and opens the pill mid-gesture; the third
  // click then selects the paragraph and must not count as a press outside the pill.
  await userEvent.tripleClick(screen.getByText(goal), { position: { x: 8, y: 8 } });
  await userEvent.click(page.getByRole("button", { name: "Ask for change" }));
  await expect
    .element(page.getByText("Rewrites the outlined paragraph", { exact: false }))
    .toBeVisible();
});
