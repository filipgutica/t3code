import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
  type WorkbenchProject,
  type WorkbenchTicket,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Cause from "effect/Cause";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useComposerDraftStore } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { WorkbenchBoardFloatingChat } from "./WorkbenchBoardFloatingChat";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

const mocks = vi.hoisted(() => ({ begin: vi.fn(), otherCommand: vi.fn() }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly name: string }) =>
    command.name === "begin" ? mocks.begin : mocks.otherCommand,
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => name });
  return {
    workbenchEnvironment: {
      beginTicketDraft: command("begin"),
      updateTicketDraft: command("update"),
      promoteTicketDraft: command("promote"),
      startTicketDraftWork: command("start"),
      discardTicketDraft: command("discard"),
      readSnapshot: command("read"),
    },
  };
});
vi.mock("./useWorkbenchThreadRecaps", () => ({
  useWorkbenchThreadRecaps: () => new Map([["first", "Refunded the duplicate charge."]]),
}));
vi.mock("./usePlanningModelSelection", () => ({
  usePlanningModelSelection: () => ({
    entries: [],
    modelSelection: { instanceId: "codex", model: "gpt-5" },
  }),
}));
// The real ChatView needs a connected environment; a read-only planning composer stays read-only.
vi.mock("../components/ChatView", () => ({
  default: (props: { threadId: string; readOnlyPlanning?: boolean }) => (
    <textarea
      aria-label={`Composer for ${props.threadId}`}
      readOnly={props.readOnlyPlanning === true}
    />
  ),
}));
vi.mock("./WorkbenchTicketProposal", () => ({
  WorkbenchTicketProposalHistory: (props: { children: ReactNode }) => props.children,
  // Stands in for a proposal card: Apply hands the proposal to the chat's draft editor.
  WorkbenchTicketProposalRenderer: (props: {
    children: ReactNode;
    canApply: boolean;
    onApply: (suggestion: {
      title: string;
      markdown: string;
      repositoryProjectIds: ReadonlyArray<string>;
      primaryT3ProjectId: string | null;
    }) => void;
  }) => (
    <>
      {props.children}
      <button
        type="button"
        disabled={!props.canApply}
        onClick={() =>
          props.onApply({
            title: "Export refunds",
            markdown: "",
            repositoryProjectIds: [],
            primaryT3ProjectId: null,
          })
        }
      >
        Apply to draft
      </button>
    </>
  ),
}));

const environmentId = EnvironmentId.make("local");
const projectId = WorkbenchProjectId.make("workspace");
const repositoryId = ProjectId.make("repository");
const createdAt = "2026-10-25T00:00:00.000Z";
const workspace: WorkbenchProject = {
  id: projectId,
  title: "Payments",
  linkedProjectIds: [repositoryId],
  archivedAt: null,
  revision: 0,
  createdAt,
  updatedAt: createdAt,
};
const ticket = (id: string, title: string): WorkbenchTicket => ({
  id: WorkbenchTicketId.make(id),
  projectId,
  epicId: null,
  title,
  markdown: "",
  kind: "story",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [repositoryId],
  status: "todo",
  blocked: false,
  archivedAt: null,
  revision: 0,
  createdAt,
  updatedAt: createdAt,
});
const assignment = (threadId: string, ticketId: string): WorkbenchAssignment => ({
  id: WorkbenchAssignmentId.make(`assignment-${threadId}`),
  ticketId: WorkbenchTicketId.make(ticketId),
  threadId: ThreadId.make(threadId),
  supersededAt: null,
  createdAt,
});
const draft = (id: string, threadId: string, title: string): WorkbenchTicketDraft => ({
  id: WorkbenchTicketId.make(id),
  projectId,
  threadId: ThreadId.make(threadId),
  anchorProjectId: repositoryId,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  revision: 0,
  phase: "draft",
  fields: {
    title,
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
  },
  createdAt,
  updatedAt: createdAt,
});
const liveThread = (id: string) =>
  makeThreadFixture({
    id: ThreadId.make(id),
    projectId: repositoryId,
    environmentId,
    title: `Thread ${id}`,
  });

type BeginInput = { readonly id: WorkbenchTicketId; readonly threadId: ThreadId };

/** Plays the host: a successful begin adds the draft and its Thread to the next snapshot. */
function Harness(props: {
  readonly initialDrafts?: ReadonlyArray<WorkbenchTicketDraft>;
  readonly onSnapshot: (add: (input: BeginInput) => void) => void;
  readonly onOpenDraft?: (draftId: WorkbenchTicketId) => void;
  readonly onOpenThread?: (threadId: ThreadId) => void;
  readonly onNewTicketThread?: (ticket: WorkbenchTicket) => void;
}) {
  const [drafts, setDrafts] = useState(props.initialDrafts ?? []);
  props.onSnapshot((input) =>
    setDrafts((current) => [...current, draft(input.id, input.threadId, "")]),
  );
  const threadIds = ["first", "second", ...drafts.map((candidate) => candidate.threadId as string)];
  return (
    <WorkbenchBoardFloatingChat
      environmentId={environmentId}
      workspace={workspace}
      providers={[]}
      linkedProjects={[]}
      tickets={[
        {
          ...ticket("ticket-a", "Refunds"),
          jiraIssue: { key: "PAY-1", url: "https://example.atlassian.net/browse/PAY-1" },
        },
        ticket("ticket-b", "Payouts"),
      ]}
      assignments={[assignment("first", "ticket-a"), assignment("second", "ticket-b")]}
      drafts={drafts}
      threadsById={new Map(threadIds.map((id) => [ThreadId.make(id), liveThread(id)]))}
      archivedThreadsById={new Map()}
      createContext={{
        linkedProjects: [],
        epics: [],
      }}
      canStartDrafts
      refreshSnapshot={() => {}}
      onOpenDraft={props.onOpenDraft ?? (() => {})}
      onOpenThread={props.onOpenThread ?? (() => {})}
      onNewTicketThread={props.onNewTicketThread ?? (() => {})}
      newTicketThreadDisabled={false}
    />
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

/** `group` names a collapsed ticket group to open before picking its Thread. */
const pickThread = async (screen: Screen, name: RegExp, group?: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: /^Board Threads/ }));
  if (group) await userEvent.click(screen.getByRole("menuitem", { name: group }));
  await userEvent.click(screen.getByRole("menuitem", { name }));
};

const threadMenu = (screen: Screen) => screen.getByRole("button", { name: /^Board Threads/ });

const beginDraft = async (screen: Screen) => {
  await userEvent.click(threadMenu(screen));
  await userEvent.click(screen.getByRole("menuitem", { name: "New ticket draft" }));
};

// The chat stays hidden on narrow screens, which includes the default test viewport.
const setup = async () => {
  await page.viewport(1280, 900);
  mocks.begin.mockReset();
  mocks.otherCommand.mockReset();
  useWorkbenchFloatingChatStore.setState({
    mode: "collapsed",
    restoreMode: "collapsed",
    focusRequest: { id: 0, threadId: null },
    pageChat: null,
  });
  let addToSnapshot: (input: BeginInput) => void = () => {};
  const succeed = async ({ input }: { readonly input: BeginInput }) => {
    addToSnapshot(input);
    return { _tag: "Success", value: draft(input.id, input.threadId, "") };
  };
  return {
    succeed,
    onSnapshot: (add: (input: BeginInput) => void) => {
      addToSnapshot = add;
    },
  };
};

it("groups drafts and each ticket under collapsible headings, even a ticket with one Thread", async () => {
  const { onSnapshot } = await setup();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Board Threads: Plan exports" }));

  const items = screen.getByRole("menuitem");
  const drafts = items.nth(0);
  await expect.element(drafts).toHaveAccessibleName("Drafts 1 Thread");
  await expect.element(drafts).toHaveAttribute("aria-expanded", "true");
  await expect.element(items.nth(1)).toHaveAccessibleName(/Plan exports/);
  const refunds = items.nth(2);
  await expect.element(refunds).toHaveAccessibleName("PAY-1 Refunds 1 Thread");
  await expect.element(refunds).toHaveAttribute("aria-expanded", "false");
  await expect.element(items.nth(3)).toHaveAccessibleName("Payouts 1 Thread");

  // A ticket heading opens to its Thread instead of opening the Thread itself.
  await userEvent.click(refunds);
  const first = screen.getByRole("menuitem", { name: "Thread first" });
  await expect.element(first).toHaveAccessibleDescription("Refunded the duplicate charge.");
  await expect.element(first.getByText("Refunded the duplicate charge.")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Board Threads: Plan exports" }))
    .toBeInTheDocument();

  // Collapsing keeps the menu open and hides only the group's Threads.
  await userEvent.click(drafts);
  await expect.element(drafts).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("menuitem", { name: /Plan exports/ }))
    .not.toBeInTheDocument();
  await expect.element(first).toBeVisible();
  await userEvent.click(drafts);
  await expect.element(screen.getByRole("menuitem", { name: /Plan exports/ })).toBeVisible();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it("starts another Thread on the showing Thread's ticket, but not on a draft's", async () => {
  const { onSnapshot } = await setup();
  const onNewTicketThread = vi.fn();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
      onNewTicketThread={onNewTicketThread}
    />,
  );
  await pickThread(screen, /Thread first/, /^PAY-1 Refunds/);
  await userEvent.click(threadMenu(screen));
  await userEvent.click(screen.getByRole("menuitem", { name: "New Thread on PAY-1" }));
  expect(onNewTicketThread).toHaveBeenCalledWith(
    expect.objectContaining({ id: WorkbenchTicketId.make("ticket-a") }),
  );

  await pickThread(screen, /Plan exports/);
  await userEvent.click(threadMenu(screen));
  await expect.element(screen.getByRole("menuitem", { name: "New ticket draft" })).toBeVisible();
  await expect
    .element(screen.getByRole("menuitem", { name: /^New Thread on/ }))
    .not.toBeInTheDocument();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it("cancels an untouched draft and returns to the Thread it was started from", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin.mockImplementation(succeed);
  mocks.otherCommand.mockResolvedValue({ _tag: "Success", value: undefined });
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await pickThread(screen, /Thread second/, /^Payouts/);

  await beginDraft(screen);
  const begun = mocks.begin.mock.calls[0]?.[0].input as BeginInput;
  const strip = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(strip.getByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  await userEvent.click(strip.getByRole("button", { name: "Cancel" }));

  expect(mocks.otherCommand).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ id: begun.id }) }),
  );
  await expect.element(screen.getByRole("textbox", { name: "Composer for second" })).toBeVisible();
});

it("returns each cancelled draft to the Thread it was started from", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin.mockImplementation(succeed);
  mocks.otherCommand.mockResolvedValue({ _tag: "Success", value: undefined });
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await pickThread(screen, /Thread second/, /^Payouts/);
  const cancel = screen.getByRole("group", { name: "Ticket draft" }).getByRole("button", {
    name: "Cancel",
  });

  await beginDraft(screen);
  const first = mocks.begin.mock.calls[0]?.[0].input as BeginInput;
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${first.threadId}` }))
    .toBeVisible();
  await beginDraft(screen);
  await expect.element(cancel).toBeEnabled();
  await userEvent.click(cancel);
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${first.threadId}` }))
    .toBeVisible();
  await userEvent.click(cancel);

  await expect.element(screen.getByRole("textbox", { name: "Composer for second" })).toBeVisible();
});

it("asks before discarding a draft whose composer holds an unsent message", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin.mockImplementation(succeed);
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await beginDraft(screen);
  const begun = mocks.begin.mock.calls[0]?.[0].input as BeginInput;
  const strip = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(strip.getByRole("button", { name: "Cancel" })).toBeVisible();

  useComposerDraftStore
    .getState()
    .setPrompt(scopeThreadRef(environmentId, begun.threadId), "Check refund exports");

  await expect.element(strip.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect.element(strip.getByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

it("begins a new draft for each click and shows its Thread in the chat", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin.mockImplementation(succeed);
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);

  await beginDraft(screen);
  const first = mocks.begin.mock.calls[0]?.[0].input as BeginInput;
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${first.threadId}` }))
    .toBeVisible();

  await beginDraft(screen);
  const second = mocks.begin.mock.calls[1]?.[0].input as BeginInput;
  expect(second.id).not.toBe(first.id);
  expect(second.threadId).not.toBe(first.threadId);
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${second.threadId}` }))
    .toBeVisible();
});

it("repeats a failed begin with the same ids instead of starting a second draft", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin
    .mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("Lost reply")) })
    .mockImplementationOnce(succeed);
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);

  await beginDraft(screen);
  await userEvent.click(threadMenu(screen));
  const retry = screen.getByRole("menuitem", { name: "New ticket draft" });
  await expect.element(retry).not.toHaveAttribute("aria-disabled");
  await userEvent.click(retry);

  const [failed, retried] = mocks.begin.mock.calls.map(([call]) => call.input as BeginInput);
  expect(retried).toEqual(failed);
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${retried?.threadId}` }))
    .toBeVisible();
});

it("keeps a draft's conversation read-only with the draft's actions, and ticket Threads open", async () => {
  const { onSnapshot } = await setup();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
    />,
  );
  await pickThread(screen, /Plan exports/);
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for draft-thread" }))
    .toHaveAttribute("readonly");
  const strip = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(strip.getByRole("button", { name: "Create ticket" })).toBeDisabled();
  await expect
    .element(strip.getByRole("status"))
    .toHaveTextContent("Select a repository to create the ticket.");

  await pickThread(screen, /Thread first/, /^PAY-1 Refunds/);
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for first" }))
    .not.toHaveAttribute("readonly");
  await expect.element(screen.getByRole("group", { name: "Ticket draft" })).not.toBeInTheDocument();
});

it.each([
  ["planning", "Start work"],
  ["starting", "Retry start work"],
] as const)("offers %s drafts the %s action", async (phase, action) => {
  const { onSnapshot } = await setup();
  const saved = { ...draft("ticket-a", "draft-thread", "Refunds"), phase };
  await using screen = await render(<Harness initialDrafts={[saved]} onSnapshot={onSnapshot} />);
  await pickThread(screen, /Thread draft-thread/);
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  await expect.element(screen.getByRole("button", { name: action })).toBeEnabled();
});

it("Open full Thread opens a draft only after its applied proposal saves", async () => {
  const { onSnapshot } = await setup();
  mocks.otherCommand.mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new Error("Saving the draft failed")),
  });
  const onOpenDraft = vi.fn();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
      onOpenDraft={onOpenDraft}
    />,
  );
  await pickThread(screen, /Plan exports/);
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Saving the draft failed");

  await userEvent.click(screen.getByRole("button", { name: "Open full Thread" }));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(onOpenDraft).not.toHaveBeenCalled();
});

it("opens ticket Threads, including settled ones, as Threads and drafts as drafts", async () => {
  const { onSnapshot } = await setup();
  const onOpenDraft = vi.fn();
  const onOpenThread = vi.fn();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
      onOpenDraft={onOpenDraft}
      onOpenThread={onOpenThread}
    />,
  );
  await pickThread(screen, /Thread first/, /^PAY-1 Refunds/);
  await userEvent.click(screen.getByRole("button", { name: "Open full Thread" }));
  expect(onOpenThread).toHaveBeenCalledWith("first");
  await pickThread(screen, /Plan exports/);
  await userEvent.click(screen.getByRole("button", { name: "Open full Thread" }));
  expect(onOpenDraft).toHaveBeenCalledWith("draft");
});
