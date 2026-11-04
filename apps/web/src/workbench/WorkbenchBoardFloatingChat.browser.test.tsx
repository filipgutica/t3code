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
import { useState, type ComponentProps } from "react";
import { useLocation } from "@tanstack/react-router";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../test/render";
import { useComposerDraftStore } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { WorkbenchPageView } from "./WorkbenchPageView";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { getWorkbenchBoardData } from "./workbenchBoardData";
import { parseWorkbenchSearch } from "./workbenchSearch";
import { WorkbenchBoardFloatingChat } from "./WorkbenchBoardFloatingChat";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  otherCommand: vi.fn(),
  denied: new Set<string>(),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly name: string }) =>
    command.name === "begin" ? mocks.begin : mocks.otherCommand,
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  // The stubbed commands' permission atoms are their names.
  useAtomValue: (atom: unknown) => !(typeof atom === "string" && mocks.denied.has(atom)),
  useAtomRefresh: () => () => {},
}));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => name });
  return {
    workbenchEnvironment: {
      createProject: command("createProject"),
      updateProject: command("updateProject"),
      createEpic: command("createEpic"),
      updateEpic: command("updateEpic"),
      archiveEpic: command("archiveEpic"),
      createTicket: command("createTicket"),
      beginTicketDraft: command("begin"),
      updateTicketDraft: command("update"),
      promoteTicketDraft: command("promote"),
      startTicketDraftWork: command("start"),
      discardTicketDraft: command("discard"),
      discardTicketDraftInBatch: command("discardBatch"),
      readSnapshot: command("read"),
      snapshot: () => null,
      ticketPreparations: () => null,
      addReference: command("addReference"),
      removeReference: command("removeReference"),
      acceptTicketDraftReview: command("acceptReview"),
      undoTicketDraftReview: command("undoReview"),
      askForTicketDraftChange: command("askForChange"),
    },
  };
});
// The stubbed useAtomValue cannot feed the chat bar's PR and provider lookup.
vi.mock("./WorkbenchSidebarThreadRow.logic", () => ({
  useWorkbenchSidebarThreadRowData: () => ({
    providerEntry: null,
    pullRequestBadge: null,
    currentPullRequest: null,
    pullRequestIndicator: null,
  }),
}));
// The provider icon reads real atoms, which this file stubs to `true`.
vi.mock("./WorkbenchThreadProviderIcon", () => ({ WorkbenchThreadProviderIcon: () => null }));
// The stubbed useAtomValue cannot feed the server's settle capability.
vi.mock("./useWorkbenchThreadSettlement", () => ({
  useWorkbenchThreadSettlement: () => ({
    supportsSettlement: false,
    settlementPendingThreadId: null,
    toggleThreadSettlement: async () => {},
  }),
}));
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
// The description editor's code block view pulls in chat modules that also need a connected environment.
vi.mock("../components/chat/ComposerCodeBlockNodeView", () => ({
  ComposerCodeBlockNodeView: () => null,
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
  title,
  markdown: "",
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
    repositoryProjectIds: [],
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
  readonly requestedDraftId?: WorkbenchTicketId;
  readonly repositories?: boolean;
  readonly archived?: boolean;
  readonly missingThreadIds?: ReadonlyArray<ThreadId>;
  readonly onOpenDraft?: (draftId: WorkbenchTicketId) => void;
  readonly onOpenThread?: (threadId: ThreadId) => void;
  readonly onNewTicketThread?: (ticket: WorkbenchTicket) => void;
}) {
  const [drafts, setDrafts] = useState(props.initialDrafts ?? []);
  const [request, setRequest] = useState<{
    id: WorkbenchTicketId | null;
    draft: WorkbenchTicketDraft | null;
  } | null>(
    props.requestedDraftId
      ? {
          id: props.requestedDraftId,
          draft: props.initialDrafts?.find((draft) => draft.id === props.requestedDraftId) ?? null,
        }
      : null,
  );
  props.onSnapshot((input) =>
    setDrafts((current) => [...current, draft(input.id, input.threadId, "")]),
  );
  const linkedProjects = props.repositories
    ? [
        {
          id: repositoryId,
          environmentId,
          title: "Orbit Web",
          workspaceRoot: "/repos/orbit-web",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      ]
    : [];
  const threadIds = ["first", "second", ...drafts.map((candidate) => candidate.threadId as string)];
  return (
    <WorkbenchBoardFloatingChat
      environmentId={environmentId}
      workspace={props.archived ? { ...workspace, archivedAt: createdAt } : workspace}
      providers={[]}
      linkedProjects={linkedProjects}
      tickets={[ticket("ticket-a", "Refunds"), ticket("ticket-b", "Payouts")]}
      referencesByTicket={
        new Map([
          [
            WorkbenchTicketId.make("ticket-a"),
            [
              {
                ticketId: WorkbenchTicketId.make("ticket-a"),
                url: "https://example.atlassian.net/browse/PAY-1",
                title: null,
                addedByThreadId: null,
                createdAt,
              },
            ],
          ],
        ])
      }
      assignments={[assignment("first", "ticket-a"), assignment("second", "ticket-b")]}
      drafts={drafts}
      threadsById={
        new Map(
          threadIds
            .filter((id) => !props.missingThreadIds?.includes(ThreadId.make(id)))
            .map((id) => [ThreadId.make(id), liveThread(id)]),
        )
      }
      archivedThreadsById={new Map()}
      createContext={{
        linkedProjects,
      }}
      canStartDrafts
      draftRequest={request}
      onNewDraft={() => setRequest({ id: null, draft: null })}
      onDraftPrepared={(value) => setRequest({ id: value.id, draft: value })}
      onDraftClosed={() => setRequest(null)}
      onCreateManually={() => {}}
      refreshSnapshot={() => {}}
      onOpenDraft={(id) => {
        props.onOpenDraft?.(id);
        setRequest({ id, draft: drafts.find((draft) => draft.id === id) ?? null });
      }}
      onOpenThread={props.onOpenThread ?? (() => {})}
      onNewTicketThread={props.onNewTicketThread ?? (() => {})}
      newTicketThreadDisabled={false}
    />
  );
}

const headerDraft = draft("header-draft", "header-planning", "Plan exports");
const headerRepository = {
  id: repositoryId,
  environmentId,
  title: "Orbit Web",
  workspaceRoot: "/repos/orbit-web",
  defaultModelSelection: null,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
};
const headerTicket = ticket("ticket-a", "Refunds");
const headerAssignment = assignment("first", "ticket-a");
const headerSnapshot = {
  projects: [workspace],
  tickets: [headerTicket],
  ticketDrafts: [headerDraft],
  assignments: [headerAssignment],
  references: [],
  reservedThreadIds: [],
  threadRecaps: [],
  ticketWorkspaces: [],
};
const noop = () => {};
const idle = async () => {};
const success = async () => true;

function HeaderDraftPage() {
  const search = parseWorkbenchSearch(useLocation().search);
  const selection = useWorkbenchPageSelection({
    environmentId,
    initialProjectId: search.workbenchProjectId,
    initialTicketId: search.ticketId,
    snapshot: headerSnapshot,
    tickets: headerSnapshot.tickets,
    pendingAction: null,
    setError: noop,
  });
  const pageData: ComponentProps<typeof WorkbenchPageView>["pageData"] = {
    canOperate: true,
    referencesByTicket: new Map(),
    projects: [headerRepository],
    repositoriesById: new Map([[repositoryId, headerRepository]]),
    providers: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    availableEditors: [],
    query: {
      resultIdentity: {},
      dataUpdatedAt: 0,
      data: headerSnapshot,
      error: null,
      failure: null,
      isPending: false,
      isSuccess: true,
      refresh: noop,
    },
    refreshWorkbenchSnapshot: noop,
    ticketDrafts: new Map(),
    clearTicketDraft: noop,
    snapshot: headerSnapshot,
    snapshotProjects: headerSnapshot.projects,
    optimisticStatus: {
      tickets: headerSnapshot.tickets,
      pendingTicketIds: new Set(),
      begin: () => false as const,
      succeed: noop,
      fail: noop,
    },
    threadsById: new Map(
      ["first", headerDraft.threadId].map((id) => [ThreadId.make(id), liveThread(id)]),
    ),
    archivedThreadsById: new Map(),
    existingThreadIds: new Set([ThreadId.make("first"), headerDraft.threadId]),
    reservedThreadIds: new Set(),
    assignmentsByTicket: new Map([[headerTicket.id, headerAssignment]]),
    threadLookupReady: true,
    threadLookupError: null,
    refreshArchivedThreads: noop,
    refreshThreadLookup: noop,
  };
  const dialogs = useWorkbenchPageDialogs({
    environmentId,
    projects: pageData.projects,
    canOperate: true,
    selection,
    setError: noop,
    setPendingAction: noop,
  });
  const boardData = getWorkbenchBoardData({ pageData, selection });
  return (
    <WorkbenchPageView
      environmentId={environmentId}
      createWorkspace={false}
      createTicket={search.create === "ticket"}
      error={null}
      pendingAction={null}
      setError={noop}
      pageData={pageData}
      selection={selection}
      dialogs={dialogs}
      boardData={boardData}
      workspaceActions={{
        canArchive: true,
        canDelete: true,
        deletion: null,
        deletedProjectIds: new Set(),
        setArchived: idle,
        requestDeletion: noop,
        removeWorkspace: idle,
        closeDeletion: noop,
      }}
      ticketActions={{
        repositoryScopeDraft: null,
        editRepositories: noop,
        changeRepositoryScope: noop,
        cancelRepositoryScope: noop,
        clearRepositoryScope: noop,
        acceptSavedRepositoryScope: noop,
        saveRepositories: success,
        workspacePreparationFailure: null,
        changeTicket: noop,
        setTicketArchived: success,
        removeTicket: success,
        resetTicketWorkspace: success,
        ticketForBoardAction: (value) => value,
        saveTicketContent: async () => false as const,
        regenerateSummary: idle,
      }}
      threadActions={{
        startThreadRequest: null,
        setStartThreadRequest: noop,
        attachThreadTicket: null,
        setAttachThreadTicket: noop,
        openAssignedThread: idle,
        requestTicketThread: noop,
        requestNewThread: noop,
        requestReplacementThread: noop,
        deleteAssignedThread: idle,
        attachExistingThread: idle,
        startSelectedThread: idle,
        getActiveThreadRepository: () => undefined,
        unlinkThread: idle,
      }}
    />
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

/** `section` names a collapsed status section to open before picking its Thread. */
const pickThread = async (screen: Screen, name: RegExp, section?: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: /^Board Threads/ }));
  if (section) await userEvent.click(screen.getByRole("menuitem", { name: section }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
};

const threadMenu = (screen: Screen) => screen.getByRole("button", { name: /^Board Threads/ });

const beginDraft = async (screen: Screen) => {
  await userEvent.click(threadMenu(screen));
  await userEvent.click(screen.getByRole("menuitem", { name: "New ticket draft" }));
};

// The chat stays hidden on narrow screens, which includes the default test viewport.
const setup = async ({ readOnly = false } = {}) => {
  await page.viewport(1280, 900);
  mocks.begin.mockReset();
  mocks.otherCommand.mockReset();
  mocks.denied.clear();
  if (readOnly) {
    for (const name of ["promote", "acceptReview", "undoReview", "askForChange"]) {
      mocks.denied.add(name);
    }
  }
  useWorkbenchFloatingChatStore.setState({
    mode: "collapsed",
    focusRequest: { id: 0, threadId: null },
    pageChat: null,
    pickedThreads: {},
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

it("lists drafts first, then the board's Threads by status, each naming its ticket", async () => {
  const { onSnapshot } = await setup();
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Board Threads: Plan exports" }));

  const headings = screen.getByRole("menuitem");
  const drafts = headings.nth(0);
  await expect.element(drafts).toHaveAccessibleName("Drafts, 1 Thread");
  await expect.element(drafts).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByRole("menuitemradio", { name: /Plan exports/ })).toBeVisible();
  const idle = headings.nth(1);
  await expect.element(idle).toHaveAccessibleName("Idle, 2 Threads");
  await expect.element(idle).toHaveAttribute("aria-expanded", "true");
  const first = screen.getByRole("menuitemradio", { name: "PAY-1 Thread first" });
  await expect.element(first).toHaveAccessibleDescription("Refunded the duplicate charge.");
  await expect.element(first.getByText("Refunded the duplicate charge.")).toBeVisible();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "Payouts Thread second" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Board Threads: Plan exports" }))
    .toBeInTheDocument();

  // Collapsing keeps the menu open and hides only the section's Threads.
  await userEvent.click(drafts);
  await expect.element(drafts).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("menuitemradio", { name: /Plan exports/ }))
    .not.toBeInTheDocument();
  await expect.element(first).toBeVisible();
  await userEvent.click(drafts);
  await expect.element(screen.getByRole("menuitemradio", { name: /Plan exports/ })).toBeVisible();
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
  await pickThread(screen, /Thread first/);
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

it("shows the picked Thread again when the user returns to the Board", async () => {
  const { onSnapshot } = await setup();
  const showing = (screen: Screen) =>
    screen.getByRole("button", { name: "Board Threads: Thread second" });
  {
    await using screen = await render(<Harness onSnapshot={onSnapshot} />);
    await pickThread(screen, /Thread second/);
    await expect.element(showing(screen)).toBeVisible();
  }
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await expect.element(showing(screen)).toBeVisible();
});

it("cancels an untouched draft and returns to the Thread it was started from", async () => {
  const { succeed, onSnapshot } = await setup();
  mocks.begin.mockImplementation(succeed);
  mocks.otherCommand.mockResolvedValue({ _tag: "Success", value: undefined });
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await pickThread(screen, /Thread second/);

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
  await pickThread(screen, /Thread second/);
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
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Lost reply");
  await expect.element(screen.getByRole("button", { name: "Create manually" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));

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
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for draft-thread" }))
    .toHaveAttribute("readonly");
  const strip = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(strip.getByRole("button", { name: "Create ticket" })).toBeDisabled();
  await expect
    .element(strip.getByRole("status"))
    .toHaveTextContent("Select a repository to create the ticket.");

  await pickThread(screen, /Thread first/);
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for first" }))
    .not.toHaveAttribute("readonly");
  await expect.element(screen.getByRole("group", { name: "Ticket draft" })).not.toBeInTheDocument();
});

it("edits a draft's title in its card and shows the full brief above the conversation", async () => {
  const { onSnapshot } = await setup();
  const planned = draft("draft", "draft-thread", "Plan exports");
  const brief = "## Work\n- [ ] Export refunds\n- [ ] Export payouts\n- [ ] Email the CSV";
  const initial = { ...planned, fields: { ...planned.fields, markdown: brief } };
  mocks.otherCommand.mockImplementation(async ({ input }) => ({
    _tag: "Success",
    value: { ...initial, revision: 1, fields: input.fields },
  }));
  await using screen = await render(<Harness initialDrafts={[initial]} onSnapshot={onSnapshot} />);
  await pickThread(screen, /Plan exports/);
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(card.getByText("Export refunds")).toBeVisible();
  await expect.element(card.getByText("Email the CSV")).not.toBeInTheDocument();

  {
    using _timers = fakeTimers();
    await userEvent.fill(card.getByRole("textbox", { name: "Title" }), "Plan CSV exports");
    await vi.advanceTimersByTimeAsync(600);
  }
  expect(mocks.otherCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        id: "draft",
        expectedRevision: 0,
        fields: expect.objectContaining({ title: "Plan CSV exports" }),
      }),
    }),
  );

  await userEvent.click(card.getByRole("button", { name: "+1 more · Show full brief" }));
  await expect.element(card.getByLabelText("Title")).toHaveValue("Plan CSV exports");
  // The full brief is rendered; changes go through the agent.
  await expect.element(card.getByText("Email the CSV")).toBeVisible();
  await expect.element(card.getByRole("textbox", { name: "Brief" })).not.toBeInTheDocument();
  // The conversation stays usable while the full brief is open.
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for draft-thread" }))
    .toBeVisible();
  await userEvent.click(card.getByRole("button", { name: "Show less" }));
  await expect.element(card.getByText("Export refunds")).toBeVisible();
});

it("shows a read-only connection a draft's unreviewed edit and lets it toggle the diff, without Undo or Accept", async () => {
  const { onSnapshot } = await setup({ readOnly: true });
  const planned = draft("draft", "draft-thread", "Plan exports");
  const brief = "## Work\n- [ ] Export refunds weekly\n- [ ] Export payouts\n- [ ] Email the CSV";
  const initial = {
    ...planned,
    fields: { ...planned.fields, markdown: brief },
    updatedByAskForChange: true,
    reviewBase: { title: planned.fields.title, markdown: brief.replace("weekly", "daily") },
  };
  await using screen = await render(<Harness initialDrafts={[initial]} onSnapshot={onSnapshot} />);
  await pickThread(screen, /Plan exports/);
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await userEvent.click(card.getByRole("button", { name: /Show full brief/ }));
  await expect.element(card.getByRole("region", { name: "Review changes" })).toBeVisible();
  await expect.element(card.getByText("daily")).toBeVisible();
  await expect.element(card.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  await expect.element(card.getByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  // Hiding and showing the diff changes nothing, so the disabled form must not block it.
  await userEvent.click(card.getByRole("button", { name: /Updated by Ask for change/ }));
  await expect.element(card.getByText("daily")).not.toBeInTheDocument();
  await userEvent.click(card.getByRole("button", { name: "Show diff" }));
  await expect.element(card.getByText("daily")).toBeVisible();
});

it("shows a read-only connection a draft's accepted change from the badge", async () => {
  const { onSnapshot } = await setup({ readOnly: true });
  const planned = draft("draft", "draft-thread", "Plan exports");
  const brief = "## Work\n- [ ] Export refunds weekly\n- [ ] Export payouts\n- [ ] Email the CSV";
  const initial = {
    ...planned,
    fields: { ...planned.fields, markdown: brief },
    updatedByAskForChange: true,
    acceptedBase: { title: planned.fields.title, markdown: brief.replace("weekly", "daily") },
  };
  await using screen = await render(<Harness initialDrafts={[initial]} onSnapshot={onSnapshot} />);
  await pickThread(screen, /Plan exports/);
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await userEvent.click(card.getByRole("button", { name: /Show full brief/ }));
  await expect.element(card.getByText("Email the CSV")).toBeVisible();
  await expect.element(card.getByText("daily")).not.toBeInTheDocument();

  await userEvent.click(card.getByRole("button", { name: /Updated by Ask for change/ }));
  const bar = card.getByRole("region", { name: "Review changes" });
  await expect.element(bar).toMatchTextContent(/Accepted change · 1 list/);
  await expect.element(card.getByText("daily")).toBeVisible();
  await expect.element(bar.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  await userEvent.click(bar.getByRole("button", { name: "Hide" }));
  await expect.element(card.getByText("daily")).not.toBeInTheDocument();
});

it("offers no review or selection Ask for change on an archived Board's draft", async () => {
  const { onSnapshot } = await setup();
  const planned = draft("draft", "draft-thread", "Plan exports");
  const brief = "## Work\n- [ ] Export refunds weekly\n- [ ] Export payouts\n- [ ] Email the CSV";
  const initial = {
    ...planned,
    fields: { ...planned.fields, markdown: brief },
    reviewBase: { title: planned.fields.title, markdown: brief.replace("weekly", "daily") },
  };
  await using screen = await render(
    <Harness initialDrafts={[initial]} onSnapshot={onSnapshot} archived />,
  );
  await pickThread(screen, /Plan exports/);
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await userEvent.click(card.getByRole("button", { name: /Show full brief/ }));
  // The same gate turns off the selection's Ask for change, which would run and then fail.
  await expect.element(card.getByText("Email the CSV")).toBeVisible();
  await expect
    .element(card.getByRole("region", { name: "Review changes" }))
    .not.toBeInTheDocument();
});

it("starts a draft's card collapsed in a short chat, still saying why it can't be created", async () => {
  const { onSnapshot } = await setup();
  const key = "t3code:workbench-floating-chat-size";
  localStorage.setItem(key, JSON.stringify({ width: 576, height: 400 }));
  using _size = { [Symbol.dispose]: () => localStorage.removeItem(key) };
  await using screen = await render(
    <Harness
      initialDrafts={[draft("draft", "draft-thread", "Plan exports")]}
      onSnapshot={onSnapshot}
    />,
  );
  await pickThread(screen, /Plan exports/);
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(card.getByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  await expect.element(card.getByRole("button", { name: "Create ticket" })).toBeDisabled();
  await expect
    .element(card.getByRole("status"))
    .toHaveTextContent("Select a repository to create the ticket.");

  await userEvent.click(card.getByRole("button", { name: "Expand ticket draft" }));
  await expect.element(card.getByRole("textbox", { name: "Title" })).toHaveValue("Plan exports");
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

it("opens the full native Thread only when explicitly requested", async () => {
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
  await pickThread(screen, /Thread first/);
  await userEvent.click(screen.getByRole("button", { name: "Thread actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Open full Thread" }));
  expect(onOpenThread).toHaveBeenCalledWith("first");
  await pickThread(screen, /Plan exports/);
  onOpenDraft.mockClear();
  await userEvent.click(screen.getByRole("button", { name: "Thread actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Open full Thread" }));
  expect(onOpenThread).toHaveBeenCalledWith("draft-thread");
  expect(onOpenDraft).not.toHaveBeenCalled();
});

it("opens an old draft URL in the Board chat despite a previous Thread pick", async () => {
  const { onSnapshot } = await setup();
  useWorkbenchFloatingChatStore.setState({
    pickedThreads: {
      [`${environmentId}:board:${projectId}`]: {
        threadId: ThreadId.make("second"),
        settledAt: null,
      },
    },
  });
  const requested = draft("old-draft", "old-thread", "Plan exports");
  await using screen = await render(
    <Harness initialDrafts={[requested]} requestedDraftId={requested.id} onSnapshot={onSnapshot} />,
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for old-thread" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Composer for second" }))
    .not.toBeInTheDocument();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it("requires a repository choice in the card before creating the Ticket", async () => {
  const { onSnapshot } = await setup();
  const planned = draft("draft", "draft-thread", "Plan exports");
  mocks.otherCommand.mockImplementation(
    async ({ input }: { input: { fields: WorkbenchTicketDraft["fields"] } }) => ({
      _tag: "Success",
      value: { ...planned, fields: input.fields, revision: 1 },
    }),
  );
  await using screen = await render(
    <Harness initialDrafts={[planned]} repositories onSnapshot={onSnapshot} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  const card = screen.getByRole("group", { name: "Ticket draft" });
  await expect.element(card.getByRole("button", { name: "Create ticket" })).toBeDisabled();
  await userEvent.click(card.getByText("Orbit Web", { exact: true }));
  await expect.element(card.getByRole("button", { name: "Create ticket" })).toBeEnabled();
});

it("keeps a pending draft start alive while the chat is collapsed", async () => {
  const { succeed, onSnapshot } = await setup();
  let complete: () => Promise<void> = async () => {};
  mocks.begin.mockImplementation(
    (args) =>
      new Promise((resolve) => {
        complete = async () => resolve(await succeed(args));
      }),
  );
  await using screen = await render(<Harness onSnapshot={onSnapshot} />);
  await beginDraft(screen);
  await userEvent.click(screen.getByRole("button", { name: "Collapse board chat" }));
  await complete();
  const input = mocks.begin.mock.calls[0]?.[0].input as BeginInput;
  await expect
    .element(screen.getByRole("textbox", { name: `Composer for ${input.threadId}` }))
    .toBeVisible();
  expect(mocks.begin).toHaveBeenCalledOnce();
});

it("keeps failed title edits until the user explicitly leaves without saving", async () => {
  const { onSnapshot } = await setup();
  const planned = draft("draft", "draft-thread", "Plan exports");
  mocks.otherCommand.mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new Error("Save unavailable")),
  });
  await using screen = await render(
    <Harness initialDrafts={[planned]} requestedDraftId={planned.id} onSnapshot={onSnapshot} />,
    { router: "/workbench" },
  );
  const title = screen.getByRole("textbox", { name: "Title", exact: true });
  await userEvent.fill(title, "Keep these edits");
  await userEvent.click(screen.getByRole("button", { name: "Collapse board chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  await expect.element(title).toHaveValue("Keep these edits");
  await pickThread(screen, /Thread second/);
  await expect.element(title).toHaveValue("Keep these edits");
  void screen.router!.navigate({ to: "/" });
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  page.getByRole("button", { name: "Stay", exact: true }).element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.router!.state.location.pathname).toBe("/workbench");
  await expect.element(title).toHaveValue("Keep these edits");
  void screen.router!.navigate({ to: "/" });
  await expect.element(page.getByRole("button", { name: "Leave without saving" })).toBeVisible();
  page.getByRole("button", { name: "Leave without saving" }).element().focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(screen.router!.state.location.pathname).toBe("/"));
});

it("retries interrupted discard even when the native planning Thread is gone", async () => {
  const { onSnapshot } = await setup();
  const interrupted = {
    ...draft("discarding-draft", "missing-thread", "Plan exports"),
    phase: "discarding" as const,
  };
  mocks.otherCommand.mockResolvedValue({ _tag: "Success", value: undefined });
  await using screen = await render(
    <Harness
      initialDrafts={[interrupted]}
      requestedDraftId={interrupted.id}
      missingThreadIds={[interrupted.threadId]}
      onSnapshot={onSnapshot}
    />,
  );
  const retry = screen.getByRole("button", { name: "Retry discard" });
  await expect.element(retry).toBeVisible();
  await userEvent.click(retry);
  await expect.element(retry).not.toBeInTheDocument();
  expect(mocks.otherCommand).toHaveBeenCalledWith({
    environmentId,
    input: { id: interrupted.id, expectedRevision: interrupted.revision },
  });
  expect(mocks.begin).not.toHaveBeenCalled();
});

it("keeps a failed draft edit when the real Board header starts New ticket", async () => {
  await setup();
  useWorkbenchFloatingChatStore.setState({
    pickedThreads: {
      [`${environmentId}:board:${projectId}`]: {
        threadId: ThreadId.make("first"),
        settledAt: null,
      },
    },
  });
  mocks.otherCommand.mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new Error("Save unavailable")),
  });
  await using screen = await render(<HeaderDraftPage />, {
    router: `/workbench?workbenchProjectId=${projectId}&ticketId=${headerDraft.id}`,
  });
  const title = screen.getByRole("textbox", { name: "Title", exact: true });
  await userEvent.fill(title, "Preserve the header edit");
  await userEvent.click(screen.getByRole("button", { name: "New ticket", exact: true }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  page.getByRole("button", { name: "Stay", exact: true }).element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  await expect.element(title).toHaveValue("Preserve the header edit");
  expect(screen.router!.state.location.search.ticketId).toBe(headerDraft.id);
  expect(mocks.begin).not.toHaveBeenCalled();
});
