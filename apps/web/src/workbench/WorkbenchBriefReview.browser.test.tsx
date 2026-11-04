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
import { WorkbenchBriefAskButton, WorkbenchBriefBody } from "./WorkbenchBriefReview";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import { WorkbenchReviewBar } from "./WorkbenchReviewBar";
import { useWorkbenchTicketBriefReview } from "./useWorkbenchBriefReview";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  undo: vi.fn(),
  ask: vi.fn(),
  readOnly: false,
  // What a full Ticket read returns, and whether the brief asked for one.
  read: null as WorkbenchTicket | null,
  readRequested: false,
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (query: unknown) => {
    if (query !== null) mocks.readRequested = true;
    return { data: query === null ? null : mocks.read };
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly name: "accept" | "undo" | "ask" }) => mocks[command.name],
}));
vi.mock("./state", async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const denied = Atom.make(false);
  const command = (name: "accept" | "undo" | "ask") => ({
    name,
    permissionAtom: () => (mocks.readOnly ? denied : allowed),
  });
  return {
    workbenchEnvironment: {
      acceptTicketReview: command("accept"),
      undoTicketReview: command("undo"),
      askForTicketChange: command("ask"),
      ticket: (query: unknown) => query,
    },
  };
});

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

function setup({ readOnly = false } = {}) {
  mocks.readOnly = readOnly;
  mocks.read = null;
  mocks.readRequested = false;
  mocks.accept.mockReset();
  mocks.undo.mockReset();
  mocks.ask.mockReset();
}

/** The Ticket page's brief: the badge, the review bar, and the brief or its diff. */
function TicketBrief({
  record,
  askButton = false,
  jira = false,
}: {
  readonly record: WorkbenchTicket;
  readonly jira?: boolean;
  /** The header's whole-brief Ask for change, which shares the pill's name. */
  readonly askButton?: boolean;
}) {
  const briefReview = useWorkbenchTicketBriefReview({
    environmentId,
    ticket: record,
    localEdit: false,
    archived: false,
    jira,
  });
  return (
    <>
      <WorkbenchProvenanceBadge
        source={{ kind: "askForChange" }}
        pressed={briefReview.diffShown}
        onToggle={briefReview.toggleDiff}
      />
      {askButton ? <WorkbenchBriefAskButton briefReview={briefReview} variant="outline" /> : null}
      {briefReview.review ? (
        <WorkbenchReviewBar review={briefReview.review} permitted={briefReview.permitted} />
      ) : null}
      <WorkbenchBriefBody briefReview={briefReview} markdown={record.markdown} jira={jira} />
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
  await expect.element(page.getByText("Edits the selected text", { exact: false })).toBeVisible();
});

it("shows a read-only connection the diff without Ask for change, Undo, or Accept", async () => {
  setup({ readOnly: true });
  await using screen = await render(<TicketBrief record={{ ...ticket, reviewBase }} askButton />);
  const removed = screen.getByText("Someone who comes back has to start over.");
  await expect.element(removed).toBeVisible();
  // The diff offers no selection, so hide it to reach the brief Ask for change would select in.
  await userEvent.click(screen.getByRole("button", { name: /Updated by Ask for change/ }));
  await expect.element(removed).not.toBeInTheDocument();
  await userEvent.tripleClick(screen.getByText(goal), { position: { x: 8, y: 8 } });
  await expect
    .element(page.getByRole("button", { name: "Ask for change" }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Accept" })).not.toBeInTheDocument();
});

it("resolves a reference link in the diff whose definition is in another block", async () => {
  setup();
  const definition = "[spec]: https://acme.example/spec";
  const markdown = `Read the [spec] first.\n\n${why}\n\n${definition}`;
  const record = {
    ...ticket,
    markdown,
    reviewBase: { title: ticket.title, markdown: markdown.replace(why, goal) },
  };
  await using screen = await render(<TicketBrief record={record} />);
  await expect.element(screen.getByRole("region", { name: "Review changes" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "spec" })).toBeVisible();
});

it("shows an accepted change read-only from the badge, reading its base only when asked", async () => {
  setup();
  const accepted = { ...ticket, acceptedChange: true };
  mocks.read = { ...accepted, acceptedBase: reviewBase };
  await using screen = await render(<TicketBrief record={accepted} />);
  const removed = screen.getByText("Someone who comes back has to start over.");
  await expect.element(screen.getByText(why)).toBeVisible();
  expect(mocks.readRequested).toBe(false);

  await userEvent.click(screen.getByRole("button", { name: /Updated by Ask for change/ }));
  const bar = screen.getByRole("region", { name: "Review changes" });
  await expect.element(bar).toMatchTextContent(/Accepted changes · title and 1 paragraph/);
  await expect.element(removed).toBeVisible();
  await expect.element(bar.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  await expect.element(bar.getByRole("button", { name: "Accept" })).not.toBeInTheDocument();

  await userEvent.click(bar.getByRole("button", { name: "Hide" }));
  await expect.element(removed).not.toBeInTheDocument();
  await expect.element(bar).not.toBeInTheDocument();
});

it("shows the next review's diff after a hidden one was undone", async () => {
  setup();
  mocks.undo.mockResolvedValue(succeeded);
  await using screen = await render(<TicketBrief record={{ ...ticket, reviewBase }} />);
  const removed = screen.getByText("Someone who comes back has to start over.");
  await userEvent.click(screen.getByRole("button", { name: /Updated by Ask for change/ }));
  await expect.element(removed).not.toBeInTheDocument();
  const bar = screen.getByRole("region", { name: "Review changes" });
  await userEvent.click(bar.getByRole("button", { name: "Undo" }));
  expect(mocks.undo).toHaveBeenCalledOnce();
  // An agent edits the restored brief again, so the new review has the same base.
  await screen.rerender(<TicketBrief record={{ ...ticket, revision: 9, reviewBase }} />);
  await expect.element(removed).toBeVisible();
});

it("shows the next review's diff after a hidden one ended elsewhere", async () => {
  setup();
  await using screen = await render(<TicketBrief record={{ ...ticket, reviewBase }} />);
  const removed = screen.getByText("Someone who comes back has to start over.");
  await userEvent.click(screen.getByRole("button", { name: /Updated by Ask for change/ }));
  await expect.element(removed).not.toBeInTheDocument();
  // Another client undoes it, then an agent edits the restored brief again.
  await screen.rerender(
    <TicketBrief record={{ ...ticket, ...reviewBase, revision: 8, reviewBase: null }} />,
  );
  await expect.element(removed).toBeVisible();
  await screen.rerender(<TicketBrief record={{ ...ticket, revision: 9, reviewBase }} />);
  await expect.element(removed).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Review changes" }))
    .not.toMatchTextContent(/diff hidden/);
});

it("renders a Jira brief's unchanged diff blocks in the brief's own markup", async () => {
  setup();
  const steps = "# First step\n# Second step";
  const record = { ...ticket, markdown: `h1. Goal\n\nNew paragraph.\n\n${steps}` };
  const base = { title: ticket.title, markdown: `h1. Goal\n\nOld paragraph.\n\n${steps}` };
  await using screen = await render(<TicketBrief record={{ ...record, reviewBase: base }} jira />);
  await expect.element(screen.getByRole("region", { name: "Review changes" })).toBeVisible();
  // The list alone has no wiki marker, so it must take the mode the whole brief uses.
  await expect
    .element(screen.getByRole("listitem").filter({ hasText: "First step" }))
    .toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "First step" })).not.toBeInTheDocument();
});
