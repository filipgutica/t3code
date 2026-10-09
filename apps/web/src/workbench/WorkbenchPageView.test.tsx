// @vitest-environment jsdom

import { act, useRef, type ComponentProps } from "react";
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
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueLink,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import { WorkbenchPageView } from "./WorkbenchPageView";
import { useWorkbenchBoardData } from "./useWorkbenchBoardData";

vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn(async () => {}) }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
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
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding"),
  projectId: workspace.id,
  connectionId: WorkbenchJiraConnectionId.make("connection"),
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Delivery Board",
  sprintId: 7,
  sprintName: "Sprint 7",
  selectedSprints: [{ id: 7, name: "Sprint 7" }],
  defaultPrimaryT3ProjectId: repository.id,
  defaultRepositoryProjectIds: [repository.id],
  statusMappings: [],
  followActiveSprint: false,
  observedActiveSprintIds: [],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const issueLink: WorkbenchJiraIssueLink = {
  bindingId: binding.id,
  ticketId: ticket.id,
  active: true,
  linkedAt: timestamp,
  lastSeenAt: timestamp,
  issue: {
    issueId: "10001",
    key: "WB-1",
    url: "https://example.atlassian.net/browse/WB-1",
    summary: ticket.title,
    issueType: { id: "story", name: "Story" },
    status: { id: "todo", name: "To Do" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: timestamp,
  },
};
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
const snapshot: WorkbenchSnapshot = {
  projects: [workspace],
  tickets: [ticket],
  epics: [],
  assignments: [assignment],
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
const success = vi.fn(async () => true);
const idle = vi.fn(async () => {});
const syncJiraBinding = vi.fn<PageProps["jiraBindings"]["syncJiraBinding"]>(async () => null);
const openAssignedThread = vi.fn();
const requestTicketThread = vi.fn();
const defaultGrants = { archive: true, remove: true };

function Harness({
  workspaceState = "active",
  detail = false,
  mirrored = false,
  includeLocalTicket = false,
  syncState = "error",
  grants = defaultGrants,
  error = null,
  dialog,
}: {
  workspaceState?: "active" | "archived" | "deleted";
  detail?: boolean;
  mirrored?: boolean;
  includeLocalTicket?: boolean;
  syncState?: "error" | "success";
  grants?: { archive: boolean; remove: boolean };
  error?: string | null;
  dialog?: "create" | "publish";
}) {
  const statusEnvironmentRef = useRef(environmentId);
  const pendingJiraMigrationBindingsRef = useRef<
    PageProps["jiraBindings"]["pendingJiraMigrationBindingsRef"]["current"]
  >(new Map());
  const archivedAt = workspaceState === "archived" ? timestamp : null;
  const currentWorkspace = { ...workspace, archivedAt };
  const selectedProject = workspaceState === "deleted" ? null : currentWorkspace;
  const selectedTicket = detail ? ticket : null;
  const selectedTicketId = selectedTicket?.id ?? null;
  const publication = dialog === "publish" ? { ticket, binding } : null;
  const jiraSyncMessage =
    syncState === "success" ? "Jira sync completed" : "Jira sync needs a retry";
  const issueLinks = mirrored ? [issueLink] : [];
  const tickets = includeLocalTicket
    ? [
        ...snapshot.tickets,
        { ...ticket, id: WorkbenchTicketId.make("local-ticket"), title: "Local follow-up" },
      ]
    : snapshot.tickets;
  const currentSnapshot = { ...snapshot, projects: [currentWorkspace], tickets };
  const jiraSnapshot: NonNullable<PageProps["pageData"]["jiraSnapshot"]> = {
    connections: [],
    bindings: [binding],
    issueLinks,
    epicLinks: [],
    supportsLocalOnlyTickets: true,
  };
  const pageData: PageProps["pageData"] = {
    projects: [repository],
    repositoriesById: new Map([[repository.id, repository]]),
    providers: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    availableEditors: [],
    query: { ...query, data: currentSnapshot },
    jiraQuery: { ...query, data: jiraSnapshot },
    refreshWorkbenchSnapshot: noop,
    refreshJiraSnapshot: noop,
    ticketDrafts: new Map(),
    clearTicketDraft: noop,
    snapshot: currentSnapshot,
    snapshotProjects: currentSnapshot.projects,
    jiraSnapshot,
    optimisticStatus: {
      tickets,
      issueLinks: jiraSnapshot.issueLinks,
      pendingTicketIds: new Set(),
      begin: vi.fn(),
      succeed: noop,
      fail: noop,
    },
    threadsById: new Map([[thread.id, thread]]),
    archivedThreadsById: new Map(),
    existingThreadIds: new Set([thread.id]),
    reservedThreadIds: new Set(),
    assignmentsByTicket: new Map([[ticket.id, assignment]]),
    threadLookupReady: true,
    archivedThreadsError: null,
    refreshArchivedThreads: noop,
  };
  const selection: PageProps["selection"] = {
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
    selectedEpic: null,
    selectedTicket,
    updateRouteSelection: idle,
    updateEpicRouteSelection: idle,
    closeWorkItem: noop,
    openWorkspaceDialog: noop,
    handleWorkspaceDialogOpenChange: noop,
  };
  const jiraBindings: PageProps["jiraBindings"] = {
    jiraError: null,
    setJiraError: noop,
    jiraPendingAction: null,
    setJiraPendingAction: noop,
    jiraSyncNotice: null,
    setJiraSyncNotice: noop,
    statusEnvironmentRef,
    pendingJiraMigrationBindingsRef,
    jiraSyncBinding: vi.fn<PageProps["jiraBindings"]["jiraSyncBinding"]>(),
    listJiraProjectsForConnection: vi.fn(async () => []),
    listJiraBoardsForProject: vi.fn(async () => []),
    listJiraSprintsForBoard: vi.fn(async () => []),
    getJiraBoardConfiguration: vi.fn(async () => null),
    createJiraBindingForWorkspace: success,
    updateJiraBindingForWorkspace: success,
    setJiraBindingActive: success,
    syncJiraBinding,
  };
  const boardData = useWorkbenchBoardData({
    environmentId,
    pageData,
    selection,
    jiraSyncNotice: {
      environmentId,
      projectId: workspace.id,
      bindingId: binding.id,
      state: syncState,
      message: jiraSyncMessage,
    },
  });
  const props: PageProps = {
    environmentId,
    createWorkspace: false,
    jiraDialogOpen: false,
    error,
    pendingAction: null,
    setError: noop,
    beginJiraAuthFlow: idle,
    openJiraDialog: noop,
    handleJiraDialogOpenChange: noop,
    pageData,
    selection,
    jiraBindings,
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
      editWorkspaceOpen: false,
      setEditWorkspaceOpen: noop,
      ticketDialogOpen: dialog === "create",
      ticketDialogEpicId: null,
      epicDialogOpen: false,
      submitProject: success,
      saveWorkspace: success,
      submitTicket: success,
      saveEpicContent: success,
      submitEpic: success,
      openTicketDialog: noop,
      openEpicDialog: noop,
      handleTicketDialogOpenChange: noop,
      handleEpicDialogOpenChange: noop,
    },
    ticketActions: {
      publication,
      publicationError: null,
      openPublication: noop,
      closePublication: noop,
      publishTicket: success,
      repositoryScopeDraft: null,
      editRepositories: noop,
      changeRepositoryScope: noop,
      cancelRepositoryScope: noop,
      clearRepositoryScope: noop,
      acceptSavedRepositoryScope: noop,
      saveRepositories: success,
      workspacePreparationFailure: null,
      changeTicket: noop,
      changeJiraTransition: idle,
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
      editStartThreadRepositories: noop,
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
const button = (label: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};

it("suspends planning and Jira retry on archive and restores their availability", async () => {
  await render();
  expect(button("New Ticket").disabled).toBe(false);
  expect(button("Retry").disabled).toBe(false);
  await render({ workspaceState: "archived" });
  expect(button("New Ticket").disabled).toBe(true);
  expect(document.body.textContent).toContain("Planning is read-only and Jira sync is paused");
  expect(document.body.textContent).toContain("Jira sync needs a retry");
  expect(document.body.textContent).not.toContain("Retry");
  expect(button("Restore Workspace").disabled).toBe(false);
  await render();
  expect(button("New Ticket").disabled).toBe(false);
  await act(async () => button("Retry").click());
  expect(syncJiraBinding).toHaveBeenCalledOnce();
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

it("blocks Jira refresh for a mirrored Ticket in an archived Workspace", async () => {
  await render({ detail: true, mirrored: true });
  expect(button("Refresh from Jira").disabled).toBe(false);
  expect(document.body.textContent).not.toContain("Publish to Jira…");
  await render({ detail: true, mirrored: true, workspaceState: "archived" });
  expect(button("Refresh from Jira").disabled).toBe(true);
  await act(async () => button("Refresh from Jira").click());
  expect(syncJiraBinding).not.toHaveBeenCalled();
  await render({ detail: true, mirrored: true });
  await act(async () => button("Refresh from Jira").click());
  expect(syncJiraBinding).toHaveBeenCalledOnce();
});

it("shows imported Tickets after a successful sync and can return to all planning", async () => {
  await render({ mirrored: true, includeLocalTicket: true, syncState: "success" });
  const titles = () =>
    [...document.querySelectorAll("article h3")].map((heading) => heading.textContent);
  expect(titles()).toEqual([ticket.title, "Local follow-up"]);
  await act(async () => button("View imported tickets").click());
  expect(titles()).toEqual([ticket.title]);
  expect(document.body.textContent).toContain("1 imported tickets");
  await act(async () => button("Show all Workbench tickets").click());
  expect(titles()).toEqual([ticket.title, "Local follow-up"]);
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

it.each(["create", "publish"] as const)(
  "closes an already open %s dialog when its Workspace is archived",
  async (dialog) => {
    await render({ dialog });
    const formId = dialog === "create" ? "create-workbench-ticket" : "publish-workbench-ticket";
    expect(document.getElementById(formId)).not.toBeNull();
    await render({ workspaceState: "archived", dialog });
    expect(document.getElementById(formId)).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("keeps linked native Threads openable while archived Ticket publication is disabled", async () => {
  await render({ detail: true });
  expect(button("Publish to Jira…").disabled).toBe(false);
  await render({ detail: true, workspaceState: "archived" });
  expect(button("Publish to Jira…").disabled).toBe(true);
  const openThread = button("Open Thread for Ship the release");
  expect(openThread.disabled).toBe(false);
  await act(async () => openThread.click());
  expect(requestTicketThread).toHaveBeenCalledWith(
    expect.objectContaining({ id: ticket.id }),
    thread.id,
  );
});
