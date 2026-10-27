// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import { WorkbenchPageView } from "./WorkbenchPageView";
import { useWorkbenchBoardData } from "./useWorkbenchBoardData";

vi.mock("../state/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/server")>();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make({ environment: { capabilities: { threadSettlement: true } } });
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: () => config },
  };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn(async () => {}) }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
// The conversation embeds the native ChatView; this suite only proves when the Workspace shows it.
vi.mock("./WorkbenchTicketConversation", async () => {
  const { createElement } = await import("react");
  return {
    WorkbenchTicketConversation: (props: {
      draft: { phase: string } | null;
      draftsSupported: boolean;
      onShowTicketDetails: () => void;
    }) =>
      createElement(
        "div",
        {
          "data-conversation": props.draft?.phase ?? "none",
          "data-drafts-supported": String(props.draftsSupported),
        },
        createElement("button", { onClick: props.onShowTicketDetails }, "Ticket details"),
      ),
  };
});
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: () => null,
  pullRequestEnvironment: { activity: () => null },
  useSharedPullRequestSummary: () => null,
  usePullRequestList: () => ({ data: null, isPending: false, error: null, refresh: vi.fn() }),
}));

type PageProps = ComponentProps<typeof WorkbenchPageView>;
const timestamp = "2026-10-09T00:00:00.000Z";
const environmentId = EnvironmentId.make("page-lifecycle");
const repository: Project = {
  id: ProjectId.make("repository"),
  environmentId,
  title: "Repository",
  workspaceRoot: "/tmp/repository",
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workspace = {
  id: WorkbenchProjectId.make("workspace"),
  title: "Delivery",
  linkedProjectIds: [repository.id],
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: workspace.id,
  epicId: null,
  title: "Ship the release",
  markdown: "Release checklist",
  kind: "story",
  primaryT3ProjectId: repository.id,
  repositoryProjectIds: [repository.id],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const jiraIssue = { key: "WB-1", url: "https://example.atlassian.net/browse/WB-1" };
const thread = makeThreadFixture({
  id: ThreadId.make("native-thread"),
  environmentId,
  projectId: repository.id,
  title: "Release agent",
});
const assignment = {
  id: WorkbenchAssignmentId.make("assignment"),
  ticketId: ticket.id,
  threadId: thread.id,
  supersededAt: null,
  createdAt: timestamp,
};
const conversationDraft = (
  phase: WorkbenchTicketDraft["phase"],
  id: WorkbenchTicketId = WorkbenchTicketId.make("draft-ticket"),
): WorkbenchTicketDraft => ({
  id,
  projectId: workspace.id,
  threadId: ThreadId.make("planning-thread"),
  anchorProjectId: repository.id,
  modelSelection: { instanceId: "codex", model: "gpt" } as WorkbenchTicketDraft["modelSelection"],
  revision: 1,
  phase,
  fields: {
    title: "",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
});
type ConversationMode = "create" | "resume" | "planning" | "working" | "legacy";
/** What the snapshot and route hold for each way the page can reach the conversation. */
const conversationFixture = ({
  conversation,
  detail,
}: {
  conversation: ConversationMode | undefined;
  detail: boolean;
}) => {
  const ticketPhase =
    conversation === "planning" || conversation === "working" ? conversation : null;
  const unsavedDraft = conversation === "resume" ? [conversationDraft("draft")] : [];
  return {
    selectedTicket: detail || ticketPhase !== null ? ticket : null,
    // A host that predates conversation drafts omits the snapshot key entirely.
    ticketDrafts:
      conversation === "legacy"
        ? undefined
        : ticketPhase !== null
          ? [conversationDraft(ticketPhase, ticket.id)]
          : unsavedDraft,
    createTicket: conversation === "create" || conversation === "legacy",
  };
};
const workspaceFixture = (workspaceState: "active" | "archived" | "deleted") => {
  const currentWorkspace = {
    ...workspace,
    archivedAt: workspaceState === "archived" ? timestamp : null,
  };
  return {
    currentWorkspace,
    selectedProject: workspaceState === "deleted" ? null : currentWorkspace,
  };
};
const snapshot: WorkbenchSnapshot = {
  projects: [workspace],
  tickets: [ticket],
  epics: [],
  assignments: [assignment],
  threadRecaps: [],
  ticketWorkspaces: [],
  reservedThreadIds: [],
};
const query = {
  resultIdentity: {},
  dataUpdatedAt: 0,
  error: null,
  failure: null,
  isPending: false,
  isSuccess: true,
  refresh: vi.fn(),
};
const noop = vi.fn();
const refreshQuery = vi.fn();
const refreshThreadLookup = vi.fn();
const retries = { queryError: refreshQuery, threadLookupError: refreshThreadLookup };
const success = vi.fn(async () => true);
const idle = vi.fn(async () => {});
const openAssignedThread = vi.fn();
const requestTicketThread = vi.fn();
const defaultGrants = { archive: true, remove: true };

function Harness({
  canOperate = true,
  workspaceState = "active",
  detail = false,
  linked = false,
  grants = defaultGrants,
  error = null,
  queryError = null,
  threadLookupError = null,
  setError = noop,
  dialog,
  conversation,
  deletedThread = false,
  archivedAssignedThread = false,
  epicState,
  epicLifecycleSupported,
}: {
  canOperate?: boolean;
  workspaceState?: "active" | "archived" | "deleted";
  detail?: boolean;
  /** The Ticket links a Jira issue. */
  linked?: boolean;
  grants?: { archive: boolean; remove: boolean };
  error?: string | null;
  queryError?: string | null;
  threadLookupError?: string | null;
  setError?: PageProps["setError"];
  dialog?: "create" | "workspace";
  /** create=ticket in the URL, an unsaved draft to resume, or a saved ticket's draft phase. */
  conversation?: ConversationMode;
  deletedThread?: boolean;
  archivedAssignedThread?: boolean;
  epicState?: "active" | "archived";
  epicLifecycleSupported?: boolean;
}) {
  const { currentWorkspace, selectedProject } = workspaceFixture(workspaceState);
  const {
    selectedTicket: fixtureTicket,
    ticketDrafts,
    createTicket,
  } = conversationFixture({
    conversation,
    detail,
  });
  const linkedTicket = linked ? { ...ticket, jiraIssue } : ticket;
  const selectedTicket = fixtureTicket && linkedTicket;
  const selectedTicketId = selectedTicket?.id ?? null;
  const tickets = [linkedTicket];
  const currentSnapshot = {
    ...snapshot,
    ...(epicLifecycleSupported === undefined
      ? {}
      : { supportsEpicLifecycle: epicLifecycleSupported }),
    projects: [currentWorkspace],
    tickets,
    ...(ticketDrafts === undefined ? {} : { ticketDrafts }),
  };
  const pageData: PageProps["pageData"] = {
    canOperate,
    projects: [repository],
    repositoriesById: new Map([[repository.id, repository]]),
    providers: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    availableEditors: [],
    query: { ...query, data: currentSnapshot, error: queryError, refresh: refreshQuery },
    refreshWorkbenchSnapshot: noop,
    ticketDrafts: new Map(),
    clearTicketDraft: noop,
    snapshot: currentSnapshot,
    snapshotProjects: currentSnapshot.projects,
    optimisticStatus: {
      tickets,
      pendingTicketIds: new Set(),
      begin: vi.fn(),
      succeed: noop,
      fail: noop,
    },
    threadsById: new Map(deletedThread || archivedAssignedThread ? [] : [[thread.id, thread]]),
    archivedThreadsById: new Map(
      archivedAssignedThread ? [[thread.id, { ...thread, archivedAt: timestamp }]] : [],
    ),
    existingThreadIds: new Set(deletedThread ? [] : [thread.id]),
    reservedThreadIds: new Set(),
    assignmentsByTicket: new Map([[ticket.id, assignment]]),
    threadLookupReady: true,
    threadLookupError,
    refreshArchivedThreads: noop,
    refreshThreadLookup,
  };
  const selection: PageProps["selection"] = {
    awaitingTicketId: null,
    selectedProjectId: workspace.id,
    setSelectedProjectId: noop,
    selectedTicketId,
    setSelectedTicketId: noop,
    selectedEpicId: null,
    setSelectedEpicId: noop,
    setAwaitingProjectId: noop,
    setAwaitingTicketId: noop,
    setAwaitingEpicId: noop,
    awaitingSelectedProject: false,
    selectedProject,
    selectedEpic: epicState
      ? {
          id: WorkbenchEpicId.make("epic"),
          projectId: workspace.id,
          title: "Local Epic",
          markdown: "",
          archivedAt: epicState === "archived" ? timestamp : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : null,
    selectedTicket,
    updateRouteSelection: idle,
    updateEpicRouteSelection: idle,
    closeWorkItem: noop,
    openWorkspaceDialog: noop,
    handleWorkspaceDialogOpenChange: noop,
  };
  const boardData = useWorkbenchBoardData({ environmentId, pageData, selection });
  const props: PageProps = {
    environmentId,
    createWorkspace: false,
    createTicket,
    error,
    pendingAction: null,
    setError,
    pageData,
    selection,
    boardData,
    workspaceActions: {
      canArchive: grants.archive,
      canDelete: grants.remove,
      deletion: null,
      deletedProjectIds: new Set(),
      setArchived: idle,
      requestDeletion: noop,
      removeWorkspace: idle,
      closeDeletion: noop,
    },
    dialogs: {
      editWorkspaceOpen: dialog === "workspace",
      setEditWorkspaceOpen: noop,
      ticketDialogOpen: dialog === "create",
      ticketDialogEpicId: null,
      epicDialogOpen: false,
      submitProject: success,
      saveWorkspace: success,
      submitTicket: success,
      saveEpicContent: success,
      canArchiveEpic: true,
      setEpicArchived: success,
      submitEpic: success,
      openTicketDialog: noop,
      conversationEpicId: null,
      openTicketConversation: noop,
      closeTicketConversation: noop,
      openCreatedTicket: noop,
      openDraftThread: noop,
      openEpicDialog: noop,
      handleTicketDialogOpenChange: noop,
      handleEpicDialogOpenChange: noop,
    },
    ticketActions: {
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
      saveTicketContent: vi.fn(async () => false as const),
      regenerateSummary: idle,
    },
    threadActions: {
      startThreadRequest: null,
      setStartThreadRequest: noop,
      attachThreadTicket: null,
      setAttachThreadTicket: noop,
      openAssignedThread,
      requestTicketThread,
      requestNewThread: noop,
      requestReplacementThread: noop,
      deleteAssignedThread: idle,
      attachExistingThread: idle,
      startSelectedThread: idle,
      unlinkThread: idle,
    },
  };
  return <WorkbenchPageView {...props} />;
}

let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createRouter>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener: noop,
    removeEventListener: noop,
  }));
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path: "/workbench" });
  router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/workbench"] }),
  });
  await router.load();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (props: ComponentProps<typeof Harness> = {}) => {
  await act(async () =>
    root.render(
      <RouterContextProvider router={router}>
        <Harness {...props} />
      </RouterContextProvider>,
    ),
  );
};
function button(label: string): HTMLButtonElement;
function button(label: string, options: { optional: true }): HTMLButtonElement | null;
function button(label: string, options?: { optional: true }) {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  if (!found && options?.optional) return null;
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it("suspends planning on archive and restores its availability", async () => {
  await render();
  expect(button("New Ticket").disabled).toBe(false);
  await render({ workspaceState: "archived" });
  expect(button("New Ticket").disabled).toBe(true);
  expect(document.body.textContent).toContain("Planning is read-only");
  expect(button("Restore Workspace").disabled).toBe(false);
  await render();
  expect(button("New Ticket").disabled).toBe(false);
});

it("shows navigation failure after deletion removes the last selected Workspace", async () => {
  const error =
    "Workspace deleted, but Workbench could not open another Workspace. Navigation failed.";
  await render({ workspaceState: "deleted", error });
  expect(document.body.textContent).toContain("No active Workbench Workspaces");
  expect(document.body.textContent).toContain(error);
  expect(document.body.textContent).not.toContain("Retry");
  expect(button("Create Workspace").disabled).toBe(false);
});

it.each([
  {
    workspaceState: "active",
    grants: { archive: true, remove: true },
    action: "Archive Workspace",
  },
  {
    workspaceState: "archived",
    grants: { archive: true, remove: true },
    action: "Restore Workspace",
  },
  {
    workspaceState: "archived",
    grants: { archive: false, remove: false },
    action: "Restore Workspace",
  },
] as const)(
  "keeps lifecycle actions discoverable with appropriate grants ($action, $grants)",
  async ({ action, ...props }) => {
    await render(props);
    await act(async () => button("Workspace actions").click());
    const item = (label: string) => {
      const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      if (!found) throw new Error(`Missing menu action: ${label}`);
      return found;
    };
    expect(item(action).getAttribute("aria-disabled") === "true").toBe(!props.grants.archive);
    expect(item("Delete Workspace…").getAttribute("aria-disabled") === "true").toBe(
      !props.grants.remove,
    );
    expect(item("Edit Workspace").getAttribute("aria-disabled") === "true").toBe(
      props.workspaceState === "archived",
    );
  },
);

it("closes an already open create dialog when its Workspace is archived", async () => {
  await render({ dialog: "create" });
  expect(document.getElementById("create-workbench-ticket")).not.toBeNull();
  await render({ workspaceState: "archived", dialog: "create" });
  expect(document.getElementById("create-workbench-ticket")).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps linked native Threads openable in an archived Workspace", async () => {
  await render({ detail: true, workspaceState: "archived" });
  const openThread = button("Open Thread for Ship the release");
  expect(openThread.disabled).toBe(false);
  await act(async () => openThread.click());
  expect(requestTicketThread).toHaveBeenCalledWith(
    expect.objectContaining({ id: ticket.id }),
    thread.id,
  );
});

it.each(["active", "archived"] as const)(
  "hides %s Epic lifecycle actions until the host advertises support",
  async (epicState) => {
    await render({ epicState });
    expect(button("Actions for Local Epic", { optional: true })).toBeNull();
    await render({ epicState, epicLifecycleSupported: false });
    expect(button("Actions for Local Epic", { optional: true })).toBeNull();
    await render({ epicState, epicLifecycleSupported: true });
    await act(async () => button("Actions for Local Epic").click());
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      epicState === "archived" ? "Restore Epic" : "Archive Epic",
    );
  },
);

it("shows the deleted assignment and a visible replacement action in Ticket detail", async () => {
  await render({ detail: true, deletedThread: true });
  expect(container.textContent).toContain("Thread deleted");
  const replacement = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === "Create replacement Thread for Ship the release" &&
      candidate.textContent?.includes("Thread deleted"),
  );
  if (!replacement) throw new Error("Missing deleted Thread row action");
  const label = [...replacement.querySelectorAll("span")].find(
    (span) => span.children.length === 0 && span.textContent === "Create replacement Thread",
  );
  expect(label).toBeDefined();
  expect(label?.classList.contains("sr-only")).toBe(false);
  await act(async () => replacement.click());
  expect(requestTicketThread).toHaveBeenCalledWith(
    expect.objectContaining({ id: ticket.id }),
    thread.id,
  );
});

it.each(["queryError", "threadLookupError"] as const)(
  "retries the Ticket's %s only when that error is displayed",
  async (errorSource) => {
    const props = { detail: true, [errorSource]: "Could not load Ticket data" };
    await render({ ...props, error: "Could not move Ticket" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not move Ticket",
    );
    expect(container.querySelector('[role="alert"] button')).toBeNull();

    await render(props);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load Ticket data",
    );
    await act(async () => button("Retry").click());
    expect(retries[errorSource]).toHaveBeenCalledOnce();
    expect(Object.values(retries).filter((retry) => retry.mock.calls.length > 0)).toHaveLength(1);
  },
);

it.each(["queryError", "threadLookupError"] as const)(
  "retries the board's %s only when that error is displayed",
  async (errorSource) => {
    const props = { [errorSource]: "Could not load board data" };
    await render({ ...props, error: "Could not move Ticket" });
    expect(container.textContent).toContain("Could not move Ticket");
    expect(button("Retry", { optional: true })).toBeNull();

    await render(props);
    expect(container.textContent).toContain("Could not load board data");
    await act(async () => button("Retry").click());
    expect(retries[errorSource]).toHaveBeenCalledOnce();
    expect(Object.values(retries).filter((retry) => retry.mock.calls.length > 0)).toHaveLength(1);
  },
);

it("opens the planning conversation for create=ticket instead of the board", async () => {
  await render({ conversation: "create" });
  expect(document.querySelector('[data-conversation="none"]')).not.toBeNull();
  expect(document.querySelector("article")).toBeNull();
  await render({ conversation: "create", workspaceState: "archived" });
  expect(document.querySelector("[data-conversation]")).toBeNull();
  expect(document.querySelector("article")).not.toBeNull();
});

it("shows a draft on the board while New Ticket remains available", async () => {
  await render({ conversation: "resume" });
  expect(document.querySelector("[data-conversation]")).toBeNull();
  expect(button("New Ticket").disabled).toBe(false);
  expect(button("Open draft Untitled draft").disabled).toBe(false);
  expect(document.body.textContent).toContain("Draft");
});

it("keeps a planning ticket in the conversation and shows the ordinary ticket once work starts", async () => {
  await render({ conversation: "planning" });
  expect(document.querySelector('[data-conversation="planning"]')).not.toBeNull();
  await render({ conversation: "working" });
  expect(document.querySelector("[data-conversation]")).toBeNull();
  expect(button("Open Thread for Ship the release").disabled).toBe(false);
});

it("opens the ticket details from a planning conversation and returns to the same conversation", async () => {
  await render({ conversation: "planning" });
  await act(async () => button("Ticket details").click());
  expect(document.querySelector("[data-conversation]")).toBeNull();
  // The ordinary ticket view brings back editing and repositories that planning hides.
  expect(document.body.textContent).toContain(ticket.title);
  await act(async () => button("Continue planning").click());
  expect(document.querySelector('[data-conversation="planning"]')).not.toBeNull();
});

it("returns to planning instead of opening a second Thread from the planning ticket's details", async () => {
  await render({ conversation: "planning" });
  await act(async () => button("Ticket details").click());
  await act(async () => button("Open Thread for Ship the release").click());
  expect(requestTicketThread).not.toHaveBeenCalled();
  expect(document.querySelector('[data-conversation="planning"]')).not.toBeNull();
});

it("shows the ticket's Threads in the floating chat except in planning ticket details", async () => {
  await render({ detail: true });
  expect(
    document.querySelector('[data-workbench-floating-chat] [aria-label^="Ticket Threads"]'),
  ).not.toBeNull();
  await render({ conversation: "planning" });
  await act(async () => button("Ticket details").click());
  expect(document.querySelector("article")).not.toBeNull();
  expect(document.querySelector("[data-workbench-floating-chat]")).toBeNull();
});

it("tells the conversation when the host predates conversation drafts", async () => {
  await render({ conversation: "legacy" });
  expect(document.querySelector('[data-drafts-supported="false"]')).not.toBeNull();
  await render({ conversation: "create" });
  expect(document.querySelector('[data-drafts-supported="true"]')).not.toBeNull();
});

it("disables board mutations without operate permission and restores them when granted", async () => {
  await render({ canOperate: false });
  expect(button("New Ticket").disabled).toBe(true);
  await render({ canOperate: true });
  expect(button("New Ticket").disabled).toBe(false);
});

it("links a Ticket's Jira issue from read-only Ticket detail and hides it once unlinked", async () => {
  const issueLink = () =>
    document.querySelector<HTMLAnchorElement>('a[aria-label="Open Jira issue WB-1"]');
  await render({ detail: true, linked: true, canOperate: false });
  expect(document.body.textContent).toContain(ticket.title);
  expect(issueLink()?.href).toBe(jiraIssue.url);
  await render({ detail: true, canOperate: false });
  expect(issueLink()).toBeNull();
});

it("blocks saving an already open Workspace dialog after permission is revoked", async () => {
  await render({ dialog: "workspace" });
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await render({ dialog: "workspace", canOperate: false });
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(submit).not.toBeNull();
  expect(submit!.disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(false);
  expect(submit!.getAttribute("aria-busy")).not.toBe("true");
  await act(async () => submit!.click());
  expect(success).not.toHaveBeenCalled();
});

it("disables Workspace creation for a read-only session with no selected Workspace", async () => {
  await render({ workspaceState: "deleted", canOperate: false });
  expect(button("Create Workspace").disabled).toBe(true);
});

it.each([false, true])(
  "keeps assigned Thread navigation available without operate permission (detail=%s)",
  async (detail) => {
    await render({ detail, canOperate: false });
    const open = button("Open Thread for Ship the release");
    expect(open.disabled).toBe(false);
    await act(async () => open.click());
    expect(requestTicketThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticket.id }),
      thread.id,
    );
  },
);

it.each([false, true])(
  "requires operate permission to restore an archived Thread (detail=%s)",
  async (detail) => {
    await render({ detail, archivedAssignedThread: true, canOperate: false });
    expect(button("Restore and open for Ship the release").disabled).toBe(true);
    await render({
      detail,
      archivedAssignedThread: true,
      workspaceState: "archived",
      canOperate: true,
    });
    const restore = button("Restore and open for Ship the release");
    expect(restore.disabled).toBe(false);
    await act(async () => restore.click());
    expect(requestTicketThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticket.id }),
      thread.id,
    );
  },
);

it("does not start a fresh planning conversation through the URL without operate permission", async () => {
  await render({ conversation: "create", canOperate: false });
  expect(document.querySelector("[data-conversation]")).toBeNull();
  expect(button("New Ticket").disabled).toBe(true);
});

it("disables Ticket Thread mutations when permission is revoked and restores them when granted", async () => {
  for (const canOperate of [true, false, true]) {
    await render({ detail: true, canOperate });
    for (const label of [
      "Create Thread",
      "Link existing Thread",
      "Unlink Thread Release agent",
      "Delete Thread Release agent",
      "Settle Thread Release agent",
    ]) {
      expect(button(label).disabled, label).toBe(!canOperate);
    }
    expect(button("Open Thread for Ship the release").disabled).toBe(false);
  }
});

it("requires operate permission to replace a deleted Ticket Thread", async () => {
  await render({ detail: true, deletedThread: true, canOperate: false });
  expect(button("Create replacement Thread for Ship the release", { optional: true })).toBeNull();
  await render({ detail: true, deletedThread: true, canOperate: true });
  expect(button("Create replacement Thread for Ship the release").disabled).toBe(false);
});

it("dismisses action errors", async () => {
  const setError = vi.fn();
  await render({ error: "Could not move Ticket", setError });
  await act(async () => button("Dismiss action error").click());
  expect(setError).toHaveBeenCalledExactlyOnceWith(null);
  await render({ error: null, setError });
  expect(document.body.textContent).not.toContain("Could not move Ticket");
  expect(button("Dismiss action error", { optional: true })).toBeNull();
});
