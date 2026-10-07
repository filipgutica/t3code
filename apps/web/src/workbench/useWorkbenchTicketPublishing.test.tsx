import { act, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueLink,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useWorkbenchTicketPublishing } from "./useWorkbenchTicketPublishing";

const createTicket = vi.hoisted(() => vi.fn());
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => createTicket }));
vi.mock("./state", () => ({ workbenchEnvironment: { createTicket: {} } }));
const timestamp = "2026-10-07T00:00:00.000Z";
const environmentId = EnvironmentId.make("environment-1");
const projectId = WorkbenchProjectId.make("workspace-1");
const repositoryId = ProjectId.make("repository-1");
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("local-ticket"),
  projectId,
  epicId: null,
  title: "Local title",
  markdown: "Local context",
  kind: "story",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [repositoryId],
  status: "in_progress",
  blocked: true,
  revision: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding-1"),
  projectId,
  connectionId: WorkbenchJiraConnectionId.make("connection-1"),
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Board",
  sprintId: 7,
  sprintName: "Sprint 7",
  selectedSprints: [
    { id: 7, name: "Sprint 7" },
    { id: 8, name: "Sprint 8" },
  ],
  defaultPrimaryT3ProjectId: repositoryId,
  defaultRepositoryProjectIds: [repositoryId],
  statusMappings: [],
  followActiveSprint: true,
  observedActiveSprintIds: [7, 8],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const link: WorkbenchJiraIssueLink = {
  bindingId: binding.id,
  ticketId: ticket.id,
  active: false,
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
  linkedAt: timestamp,
  lastSeenAt: timestamp,
};
type Options = Omit<
  Parameters<typeof useWorkbenchTicketPublishing>[0],
  "pendingAction" | "setPendingAction"
>;
let result: ReturnType<typeof useWorkbenchTicketPublishing>;
let renderer: ReactTestRenderer | undefined;
const setError = vi.fn();
const refreshWorkbenchSnapshot = vi.fn();
const refreshJiraSnapshot = vi.fn();
const options = (): Options => ({
  environmentId,
  selectedProjectId: projectId,
  snapshot: {
    projects: [
      {
        id: projectId,
        title: "Workspace",
        linkedProjectIds: [repositoryId],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    tickets: [ticket],
    epics: [],
    assignments: [],
    reservedThreadIds: [],
    ticketWorkspaces: [],
  },
  jiraSnapshot: { connections: [], bindings: [binding], issueLinks: [] },
  ticketDrafts: new Map(),
  setError,
  refreshWorkbenchSnapshot,
  refreshJiraSnapshot,
});
let pagePendingAction: string | null = null;
let changePagePendingAction: Dispatch<SetStateAction<string | null>>;
function Probe(props: Options) {
  const [pendingAction, setPagePendingAction] = useState<string | null>(null);
  const value = useWorkbenchTicketPublishing({
    ...props,
    pendingAction,
    setPendingAction: setPagePendingAction,
  });
  useLayoutEffect(() => {
    result = value;
    pagePendingAction = pendingAction;
    changePagePendingAction = setPagePendingAction;
  });
  return null;
}
const render = async (props = options()) => {
  await act(() => {
    if (renderer) renderer.update(<Probe {...props} />);
    else renderer = create(<Probe {...props} />);
  });
};
const open = async () => {
  await act(() => result.openPublication(ticket));
};
const publish = async (jiraSprintId = 7) => {
  let succeeded = false;
  await act(async () => {
    succeeded = await result.publishTicket({ jiraSprintId, epicId: null });
  });
  return succeeded;
};
const deferCreation = () => {
  let finish!: (value: unknown) => void;
  createTicket.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  return finish;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  createTicket.mockResolvedValue({ _tag: "Success", value: ticket });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("publishing an existing Workbench Ticket", () => {
  it.each(["success", "rejection"])(
    "clears page-owned pending state for an immediately resolved %s",
    async (outcome) => {
      if (outcome === "rejection")
        createTicket.mockRejectedValue(new Error("Immediate transport failure"));
      await render();
      await open();
      await act(async () => {
        expect(await result.publishTicket({ jiraSprintId: 7, epicId: null })).toBe(
          outcome === "success",
        );
      });
      expect(pagePendingAction).toBeNull();
      expect(refreshWorkbenchSnapshot).toHaveBeenCalledOnce();
      expect(refreshJiraSnapshot).toHaveBeenCalledOnce();
      if (outcome === "rejection")
        expect(result.publicationError).toBe("Immediate transport failure");
    },
  );

  it("publishes the captured revision and identity, leaving remote status to Jira, then refreshes both snapshots", async () => {
    await render();
    await open();
    expect(await publish(8)).toBe(true);
    expect(createTicket).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        id: ticket.id,
        projectId,
        epicId: null,
        title: ticket.title,
        markdown: ticket.markdown,
        kind: ticket.kind,
        primaryT3ProjectId: repositoryId,
        repositoryProjectIds: [repositoryId],
        existingLocalTicketRevision: 3,
        jiraSprintId: 8,
        createdAt: ticket.createdAt,
      },
    });
    expect(refreshWorkbenchSnapshot).toHaveBeenCalledOnce();
    expect(refreshJiraSnapshot).toHaveBeenCalledOnce();
    expect(result.publication).toBeNull();
  });

  it("reconciles a remote failure and retries the same input without creating a new identity", async () => {
    createTicket.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Sprint update failed")),
    });
    await render();
    await open();
    expect(await publish()).toBe(false);
    expect(result.publicationError).toBe("Sprint update failed");
    expect(refreshWorkbenchSnapshot).toHaveBeenCalledOnce();
    expect(refreshJiraSnapshot).toHaveBeenCalledOnce();
    expect(await publish(8)).toBe(false);
    expect(createTicket).toHaveBeenCalledOnce();
    expect(await publish()).toBe(true);
    expect(createTicket.mock.calls[1]?.[0]).toEqual(createTicket.mock.calls[0]?.[0]);
  });

  it("blocks duplicate submissions and cancellation while the first request is unresolved", async () => {
    const finish = deferCreation();
    await render();
    await open();
    let first!: Promise<boolean>;
    await act(() => {
      first = result.publishTicket({ jiraSprintId: 7, epicId: null });
    });
    expect(await publish()).toBe(false);
    await act(() => result.closePublication());
    expect(result.publication?.ticket.id).toBe(ticket.id);
    expect(createTicket).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ _tag: "Success", value: ticket });
      expect(await first).toBe(true);
    });
  });

  it.each([
    ["environment", "success"],
    ["environment", "failure"],
    ["workspace", "failure"],
  ])("suppresses an old %s response (%s) and releases pending state", async (scope, outcome) => {
    const finish = deferCreation();
    await render();
    await open();
    let first!: Promise<boolean>;
    await act(() => {
      first = result.publishTicket({ jiraSprintId: 7, epicId: null });
    });
    expect(pagePendingAction).toBe(`publish-ticket:${ticket.id}`);
    await render({
      ...options(),
      ...(scope === "environment"
        ? { environmentId: EnvironmentId.make("other") }
        : { selectedProjectId: WorkbenchProjectId.make("other") }),
    });
    expect(result.publication).toBeNull();
    expect(pagePendingAction).toBe(`publish-ticket:${ticket.id}`);
    setError.mockClear();
    await act(async () => {
      finish(
        outcome === "success"
          ? { _tag: "Success", value: ticket }
          : { _tag: "Failure", cause: Cause.fail(new Error("Old request failed")) },
      );
      expect(await first).toBe(false);
    });
    expect(setError).not.toHaveBeenCalled();
    expect(pagePendingAction).toBeNull();
    expect(refreshJiraSnapshot).not.toHaveBeenCalled();
    if (scope === "environment") {
      await open();
      expect(result.publication?.ticket.id).toBe(ticket.id);
    }
  });

  it("preserves another action started after navigation while an old publication finishes", async () => {
    const finish = deferCreation();
    await render();
    await open();
    let first!: Promise<boolean>;
    await act(() => {
      first = result.publishTicket({ jiraSprintId: 7, epicId: null });
    });
    await render({ ...options(), selectedProjectId: WorkbenchProjectId.make("other") });
    await act(() => changePagePendingAction("update-project"));
    await act(async () => {
      finish({ _tag: "Success", value: ticket });
      await first;
    });
    expect(pagePendingAction).toBe("update-project");
  });

  it.each(["mapped", "local", "archived"])(
    "only publishes under an available Jira Epic (%s)",
    async (kind) => {
      const epicId = WorkbenchEpicId.make("epic-1");
      const props = options();
      await render({
        ...props,
        snapshot: {
          ...props.snapshot!,
          epics: [
            {
              id: epicId,
              projectId,
              title: "Epic",
              markdown: "",
              archivedAt: kind === "archived" ? timestamp : null,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
        jiraSnapshot: {
          ...props.jiraSnapshot!,
          epicLinks:
            kind === "local"
              ? []
              : [{ bindingId: binding.id, epicId, jiraIssueId: "123", jiraIssueKey: "WB-123" }],
        },
      });
      await open();
      await act(async () => {
        expect(await result.publishTicket({ jiraSprintId: 7, epicId })).toBe(kind === "mapped");
      });
      if (kind === "mapped")
        expect(createTicket).toHaveBeenCalledWith(
          expect.objectContaining({ input: expect.objectContaining({ epicId }) }),
        );
      else expect(createTicket).not.toHaveBeenCalled();
    },
  );

  const initial = options();
  const publicationChanges: ReadonlyArray<{
    change: string;
    updates: Partial<Options>;
    pendingAction?: string;
    hidesPublication?: boolean;
  }> = [
    {
      change: "revision",
      updates: { snapshot: { ...initial.snapshot!, tickets: [{ ...ticket, revision: 4 }] } },
    },
    {
      change: "archive",
      updates: {
        snapshot: { ...initial.snapshot!, tickets: [{ ...ticket, archivedAt: timestamp }] },
      },
    },
    { change: "delete", updates: { snapshot: { ...initial.snapshot!, tickets: [] } } },
    {
      change: "link",
      updates: { jiraSnapshot: { ...initial.jiraSnapshot!, issueLinks: [link] } },
      hidesPublication: true,
    },
    {
      change: "paused",
      updates: {
        jiraSnapshot: { ...initial.jiraSnapshot!, bindings: [{ ...binding, active: false }] },
      },
    },
    {
      change: "draft",
      updates: {
        ticketDrafts: new Map([[ticket.id, { title: "Unsaved", markdown: "", mode: "editing" }]]),
      },
    },
    {
      change: "sprint",
      updates: {
        jiraSnapshot: {
          ...initial.jiraSnapshot!,
          bindings: [{ ...binding, selectedSprints: [{ id: 8, name: "Sprint 8" }] }],
        },
      },
    },
    { change: "pending", updates: {}, pendingAction: "save-ticket" },
    { change: "binding", updates: { jiraSnapshot: { ...initial.jiraSnapshot!, bindings: [] } } },
    {
      change: "binding target",
      updates: {
        jiraSnapshot: {
          ...initial.jiraSnapshot!,
          bindings: [{ ...binding, jiraProjectId: "different-jira-project" }],
        },
      },
    },
    {
      change: "migration",
      updates: {
        jiraSnapshot: {
          ...initial.jiraSnapshot!,
          bindings: [{ ...binding, localMigrationPending: true }],
        },
      },
    },
  ];
  it.each(publicationChanges)(
    "rechecks $change changes before sending a Jira request",
    async ({ updates, pendingAction, hidesPublication }) => {
      await render();
      await open();
      if (pendingAction) await act(() => changePagePendingAction(pendingAction));
      await render({ ...options(), ...updates });
      expect(await publish()).toBe(false);
      expect(createTicket).not.toHaveBeenCalled();
      if (hidesPublication) expect(result.publication).toBeNull();
    },
  );

  it("blocks opening Jira-owned Tickets even when their links are inactive", async () => {
    const props = options();
    await render({ ...props, jiraSnapshot: { ...props.jiraSnapshot!, issueLinks: [link] } });
    await open();
    expect(result.publication).toBeNull();
    expect(setError).toHaveBeenCalledWith("This Ticket is already linked to Jira.");
  });

  it("waits for a saved draft to be projected and accepts it once its revision is visible", async () => {
    const props = options();
    const draft = {
      title: ticket.title,
      markdown: ticket.markdown,
      mode: "saved" as const,
      savedVersion: { revision: 4 },
    };
    await render({ ...props, ticketDrafts: new Map([[ticket.id, draft]]) });
    await open();
    expect(result.publication).toBeNull();
    await render({
      ...props,
      ticketDrafts: new Map([[ticket.id, { ...draft, savedVersion: { revision: 3 } }]]),
    });
    await open();
    expect(await publish()).toBe(true);
  });
});
