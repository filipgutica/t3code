// @effect-diagnostics globalTimers:off globalDate:off - Playwright owns deterministic browser test timing and timestamps.
import { test, expect, snapshot, type Demo } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";

const ISO_NOW = "2026-01-01T00:00:00.000Z";
const fakeConnection = {
  id: "regression-jira-connection",
  cloudId: "regression-jira-cloud",
  siteName: "Regression Jira",
  siteUrl: "https://jira.example.test",
  avatarUrl: null,
  scopes: ["read:jira-work", "write:jira-work"],
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};
const fakeProject = {
  id: "regression-jira-project",
  key: "ORBIT",
  name: "Orbit",
  projectTypeKey: "software",
  avatarUrl: null,
};
const fakeBoard = {
  id: 42,
  name: "Orbit Regression Board",
  type: "scrum" as const,
  projectKeyOrId: "ORBIT",
};
const fakeSprint = {
  id: 4242,
  name: "Orbit Regression Sprint",
  state: "active" as const,
  goal: "",
  startDate: null,
  endDate: null,
  completeDate: null,
};
const fakeBoardConfiguration = {
  boardId: fakeBoard.id,
  name: fakeBoard.name,
  type: fakeBoard.type,
  columns: [
    { name: "To Do", statusIds: ["1"], done: false },
    { name: "In Progress", statusIds: ["3"], done: false },
    { name: "Done", statusIds: ["6"], done: true },
  ],
  rankFieldId: null,
};

type SyncMode = "normal" | "hold" | "failure" | "empty";
type MigrationMode = "normal" | "hold" | "failure" | "lost-response";
type RpcMessage = string | Buffer;
type RpcRequestId = string | number;
type WebSocketServer = { send: (message: RpcMessage) => void };

const routeMockJira = async (page: Page) => {
  let mode: SyncMode = "normal";
  let migrationMode: MigrationMode = "normal";
  let failRecoveryRead = false;
  let migrationResponseLost = false;
  let failedSnapshotCount = 0;
  let targetProjectId: string | null = null;
  let binding: Record<string, unknown> | null = null;
  let links: Array<Record<string, unknown>> = [];
  let epicLinks: Array<Record<string, unknown>> = [];
  const migrationRequests: Array<Record<string, unknown>> = [];
  const rpcTags: string[] = [];
  let bindingCreateCount = 0;
  let syncRequestCount = 0;
  let backgroundSyncRequestCount = 0;
  let remoteTicketTitle = "Imported Jira regression ticket";
  let importedTicketTitle = remoteTicketTitle;
  let syncServer: WebSocketServer | null = null;
  let heldSyncRequestId: RpcRequestId | null = null;
  let migrationServer: WebSocketServer | null = null;
  let heldMigrationRequestId: RpcRequestId | null = null;
  let resolveSyncRequest: (() => void) | null = null;
  let resolveMigrationRequest: (() => void) | null = null;
  const syncRequestSeen = new Promise<void>((resolve) => {
    resolveSyncRequest = resolve;
  });
  const migrationRequestSeen = new Promise<void>((resolve) => {
    resolveMigrationRequest = resolve;
  });
  const snapshotRequestIds = new Set<RpcRequestId>();

  const decode = (message: RpcMessage): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      );
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const inputOf = (payload: Record<string, unknown>) =>
    payload.payload && typeof payload.payload === "object"
      ? (payload.payload as Record<string, unknown>)
      : {};
  const now = () => new Date().toISOString();
  const makeBinding = (input: Record<string, unknown>) => ({
    ...input,
    id: "regression-jira-binding",
    connectionId: fakeConnection.id,
    jiraProjectId: fakeProject.id,
    jiraProjectKey: fakeProject.key,
    jiraProjectName: fakeProject.name,
    boardId: fakeBoard.id,
    boardName: fakeBoard.name,
    sprintId: fakeSprint.id,
    sprintName: fakeSprint.name,
    selectedSprints: [{ id: fakeSprint.id, name: fakeSprint.name }],
    statusMappings: [
      { jiraStatusId: "1", workbenchStatus: "todo" },
      { jiraStatusId: "3", workbenchStatus: "in_progress" },
      { jiraStatusId: "6", workbenchStatus: "done" },
    ],
    followActiveSprint: true,
    boardMode: "mapped" as const,
    boardColumns: fakeBoardConfiguration.columns,
    active: true,
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
  });
  const makeLink = () => ({
    bindingId: "regression-jira-binding",
    ticketId: "jira-regression-ticket",
    issue: {
      issueId: "regression-jira-issue",
      key: "ORBIT-999",
      url: "https://jira.example.test/browse/ORBIT-999",
      summary: importedTicketTitle,
      description: "Imported from the deterministic Jira contract fixture.",
      issueType: { id: "10001", name: "Story" },
      status: { id: "1", name: "To Do" },
      epic: null,
      flagged: false,
      rank: 0,
      remoteUpdatedAt: ISO_NOW,
    },
    active: true,
    linkedAt: ISO_NOW,
    lastSeenAt: ISO_NOW,
  });
  const makeTicket = () => ({
    id: "jira-regression-ticket",
    projectId: targetProjectId,
    epicId: null,
    title: importedTicketTitle,
    kind: "story" as const,
    markdown: "Imported from the deterministic Jira contract fixture.",
    primaryT3ProjectId: (binding?.defaultPrimaryT3ProjectId as string) ?? "orbit-api",
    repositoryProjectIds: (binding?.defaultRepositoryProjectIds as string[]) ?? ["orbit-api"],
    status: "todo" as const,
    blocked: false,
    revision: 0,
    archivedAt: null,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
  });
  const sendExit = (
    socket: { send: (message: string) => void },
    requestId: RpcRequestId,
    value: unknown,
  ) => socket.send(JSON.stringify({ _tag: "Exit", requestId, exit: { _tag: "Success", value } }));
  const sendFailure = (
    socket: { send: (message: string) => void },
    requestId: RpcRequestId,
    message = "Jira sync failed for deterministic regression.",
  ) =>
    socket.send(
      JSON.stringify({
        _tag: "Exit",
        requestId,
        exit: {
          _tag: "Failure",
          cause: [
            {
              _tag: "Fail",
              error: {
                _tag: "WorkbenchJiraOperationError",
                code: "request_failed",
                message,
              },
            },
          ],
        },
      }),
    );
  const syncValue = (empty = mode === "empty") => {
    importedTicketTitle = remoteTicketTitle;
    const syncedAt = now();
    if (binding) binding = { ...binding, lastSyncedAt: syncedAt, updatedAt: syncedAt };
    links = empty ? [] : [makeLink()];
    return {
      bindingId: "regression-jira-binding",
      syncedAt,
      activated: links.length,
      updated: 0,
      deactivated: 0,
      links,
    };
  };

  const sync = (socket: { send: (message: string) => void }, requestId: RpcRequestId) => {
    if (mode === "failure") {
      mode = "normal";
      sendFailure(socket, requestId);
      return;
    }
    const empty = mode === "empty";
    mode = "normal";
    sendExit(socket, requestId, syncValue(empty));
  };

  const migrate = (
    socket: { send: (message: string) => void },
    requestId: RpcRequestId,
    input: Record<string, unknown>,
  ) => {
    if (migrationMode === "hold") {
      heldMigrationRequestId = requestId;
      resolveMigrationRequest?.();
      return;
    }
    if (migrationMode === "failure") {
      migrationMode = "normal";
      sendFailure(
        socket,
        requestId,
        "Jira local data migration failed for deterministic regression.",
      );
      return;
    }
    const lostResponse = migrationMode === "lost-response";
    migrationMode = "normal";
    const action = input.action === "delete" ? "delete" : "publish";
    const tickets = Array.isArray(input.tickets) ? input.tickets : [];
    const epics = Array.isArray(input.epics) ? input.epics : [];
    const ids = (items: ReadonlyArray<unknown>) =>
      items.flatMap((item) => {
        if (item === null || typeof item !== "object") return [];
        const id = (item as { readonly id?: unknown }).id;
        return typeof id === "string" ? [id] : [];
      });
    if (action === "publish") {
      const mappedEpicIds = new Set(
        epicLinks.flatMap((link) => (typeof link.epicId === "string" ? [link.epicId] : [])),
      );
      epicLinks = [
        ...epicLinks,
        ...epics.flatMap((epic, index) => {
          if (epic === null || typeof epic !== "object") return [];
          const epicId = (epic as { readonly id?: unknown }).id;
          if (typeof epicId !== "string" || mappedEpicIds.has(epicId)) return [];
          mappedEpicIds.add(epicId);
          return [
            {
              bindingId: "regression-jira-binding",
              epicId,
              jiraIssueId: `regression-jira-epic-${index + 1}`,
              jiraIssueKey: `ORBIT-${998 - index}`,
            },
          ];
        }),
      ];
    }
    if (binding) binding = { ...binding, localMigrationPending: false };
    if (lostResponse) {
      migrationResponseLost = true;
      sendFailure(socket, requestId, "Migration response was lost after committing.");
      return;
    }
    sendExit(socket, requestId, {
      action,
      requestedTicketCount: tickets.length,
      publishedTicketCount: action === "publish" ? tickets.length : 0,
      publishedEpicCount: action === "publish" ? epics.length : 0,
      deletedTicketCount: action === "delete" ? tickets.length : 0,
      deletedEpicCount: action === "delete" ? epics.length : 0,
      ticketIds: ids(tickets),
      epicIds: ids(epics),
    });
  };

  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    syncServer = socket;
    migrationServer = socket;
    socket.onMessage((message) => {
      const payload = decode(message);
      if (
        payload?._tag !== "Request" ||
        (typeof payload.id !== "string" && typeof payload.id !== "number")
      ) {
        server.send(message);
        return;
      }
      const input = inputOf(payload);
      if (typeof payload.tag === "string") rpcTags.push(payload.tag);
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchGetSnapshot) {
        snapshotRequestIds.add(payload.id);
        server.send(message);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraGetSnapshot) {
        if (migrationResponseLost && failRecoveryRead) {
          failedSnapshotCount += 1;
          sendFailure(socket, payload.id, "Connection unavailable during recovery.");
          return;
        }
        sendExit(socket, payload.id, {
          connections: [fakeConnection],
          bindings: binding ? [binding] : [],
          issueLinks: links,
          epicLinks,
        });
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraListProjects) {
        sendExit(socket, payload.id, [fakeProject]);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraListBoards) {
        sendExit(socket, payload.id, [fakeBoard]);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraListSprints) {
        sendExit(socket, payload.id, [fakeSprint]);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraGetBoardConfiguration) {
        sendExit(socket, payload.id, fakeBoardConfiguration);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraCreateBinding) {
        bindingCreateCount += 1;
        targetProjectId = typeof input.projectId === "string" ? input.projectId : null;
        binding = makeBinding(input);
        sendExit(socket, payload.id, binding);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraUpdateBinding) {
        if (!binding || input.id !== binding.id) {
          sendFailure(socket, payload.id, "The Jira sprint binding was not found.");
          return;
        }
        binding = { ...binding, ...input };
        sendExit(socket, payload.id, binding);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraMigrateLocalTickets) {
        migrationRequests.push(input);
        migrate(socket, payload.id, input);
        return;
      }
      if (payload.tag === WORKBENCH_WS_METHODS.workbenchJiraSyncBinding) {
        if (input.background === true) {
          backgroundSyncRequestCount += 1;
          sendExit(socket, payload.id, syncValue(links.length === 0));
          return;
        }
        syncRequestCount += 1;
        if (mode === "hold") {
          heldSyncRequestId = payload.id;
          resolveSyncRequest?.();
          return;
        }
        sync(socket, payload.id);
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const payload = decode(message);
      if (
        payload?._tag === "Exit" &&
        (typeof payload.requestId === "string" || typeof payload.requestId === "number") &&
        snapshotRequestIds.delete(payload.requestId) &&
        payload.exit &&
        typeof payload.exit === "object"
      ) {
        const exit = payload.exit as { readonly _tag?: string; readonly value?: unknown };
        if (exit._tag === "Success" && exit.value && typeof exit.value === "object") {
          const value = exit.value as { projects?: unknown; tickets?: unknown };
          const projects = Array.isArray(value.projects) ? value.projects : [];
          const project = projects.find(
            (candidate) =>
              candidate &&
              typeof candidate === "object" &&
              (candidate as { id?: unknown }).id === targetProjectId,
          );
          if (project && links.length > 0) {
            const tickets = Array.isArray(value.tickets) ? value.tickets : [];
            socket.send(
              JSON.stringify({
                ...payload,
                exit: {
                  ...exit,
                  value: { ...value, tickets: [...tickets, makeTicket()] },
                },
              }),
            );
            return;
          }
        }
      }
      socket.send(message);
    });
  });

  return {
    setMode: (next: SyncMode) => {
      mode = next;
      heldSyncRequestId = null;
    },
    setMigrationMode: (next: MigrationMode) => {
      migrationMode = next;
      heldMigrationRequestId = null;
    },
    setRecoveryReadFailure: (fail: boolean) => {
      failRecoveryRead = fail;
    },
    getFailedSnapshotCount: () => failedSnapshotCount,
    getMigrationRequests: () => migrationRequests,
    getRpcTags: () => rpcTags,
    getBindingCreateCount: () => bindingCreateCount,
    getSyncRequestCount: () => syncRequestCount,
    getBackgroundSyncRequestCount: () => backgroundSyncRequestCount,
    setRemoteTicketTitle: (title: string) => {
      remoteTicketTitle = title;
    },
    waitForSync: async () => {
      await Promise.race([
        syncRequestSeen,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for the mocked Jira sync RPC.")),
            15_000,
          );
          syncRequestSeen.finally(() => clearTimeout(timeout)).catch(() => undefined);
        }),
      ]);
    },
    waitForMigration: async () => {
      await Promise.race([
        migrationRequestSeen,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for the mocked Jira migration RPC.")),
            15_000,
          );
          migrationRequestSeen.finally(() => clearTimeout(timeout)).catch(() => undefined);
        }),
      ]);
    },
    releaseMigration: (nextMode: Exclude<MigrationMode, "hold"> = "normal") => {
      if (!heldMigrationRequestId || !migrationServer) {
        throw new Error("Expected mocked Jira migration RPC was not held.");
      }
      migrationMode = nextMode;
      migrate(migrationServer, heldMigrationRequestId, migrationRequests.at(-1) ?? {});
      heldMigrationRequestId = null;
    },
    release: () => {
      if (!heldSyncRequestId || !syncServer) {
        throw new Error("Expected mocked Jira sync RPC was not held.");
      }
      sync(syncServer, heldSyncRequestId);
      heldSyncRequestId = null;
    },
  };
};

const createWorkspace = async (page: Page, demo: Demo, title: string) => {
  await page.goto("/workbench?workbenchProjectId=orbit");
  await expect(page.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Workspace/ });
  await dialog.getByLabel("Workspace title").fill(title);
  await dialog.getByRole("checkbox", { name: /Orbit API/ }).check();
  await dialog.getByRole("checkbox", { name: /Orbit Web/ }).check();
  await dialog.getByRole("button", { name: "Create Workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const current = await snapshot(demo);
  return current.projects.find((project) => project.title === title)?.id;
};

const seedLocalEpicAndTicket = async (page: Page, demo: Demo, workspaceId: string | undefined) => {
  if (!workspaceId) throw new Error("Created Jira migration Workspace was not persisted.");
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "New Epic", exact: true }).click();
  const epicDialog = page.getByRole("dialog", { name: "Create Epic", exact: true });
  await epicDialog
    .getByPlaceholder("What outcome does this Epic deliver?")
    .fill("Jira migration regression Epic");
  await epicDialog
    .getByPlaceholder("Context, scope, and intended outcome…")
    .fill("Local Epic retained for migration contract coverage.");
  await epicDialog.getByRole("button", { name: "Create Epic", exact: true }).click();
  await expect(epicDialog).not.toBeVisible();

  const currentAfterEpic = await snapshot(demo);
  const epic = currentAfterEpic.epics.find(
    (candidate) =>
      candidate.title === "Jira migration regression Epic" && candidate.projectId === workspaceId,
  );
  if (!epic) throw new Error("Created Jira migration Epic was not persisted.");
  await page.goto(`/workbench?workbenchProjectId=${workspaceId}&epicId=${epic.id}`);
  await expect(page.getByRole("heading", { name: epic.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Ticket", exact: true }).click();
  const ticketDialog = page.getByRole("dialog", { name: "Create Ticket", exact: true });
  await ticketDialog.getByPlaceholder("What needs doing?").fill("Jira migration regression Ticket");
  await ticketDialog.getByRole("button", { name: "Create Ticket", exact: true }).click();
  await expect(ticketDialog).not.toBeVisible();

  const currentAfterTicket = await snapshot(demo);
  const ticket = currentAfterTicket.tickets.find(
    (candidate) =>
      candidate.title === "Jira migration regression Ticket" && candidate.projectId === workspaceId,
  );
  if (!ticket) throw new Error("Created Jira migration Ticket was not persisted.");
  expect(ticket.epicId).toBe(epic.id);
  await page.goto(`/workbench?workbenchProjectId=${workspaceId}`);
  await expect(page.getByRole("button", { name: "Workspace actions" })).toBeVisible();
  return { epic, ticket };
};

const connectJira = async (page: Page) => {
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByRole("menuitem", { name: "Connect Jira", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^(Connect Jira|Jira sprint mirror)$/ });
  await expect(dialog.getByText(fakeConnection.siteName, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Jira project" })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Jira project" }).click();
  await page.getByRole("option", { name: /ORBIT/ }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Jira board" })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Jira board" }).click();
  await page.getByRole("option", { name: /Orbit Regression Board/ }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Create mirror", exact: true })).toBeVisible();
  return dialog;
};

test.describe("Jira connection UI contract", () => {
  test("refreshes remote Jira changes when returning to Workbench without a manual sync", async ({
    page,
    demo,
  }) => {
    const route = await routeMockJira(page);
    await createWorkspace(page, demo, "Foreground Jira Refresh");
    const dialog = await connectJira(page);
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "View imported tickets", exact: true }).click();
    await expect(page.getByText("ORBIT-999", { exact: true })).toBeVisible();

    route.setRemoteTicketTitle("Changed in Jira while away");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "Changed in Jira while away", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    expect(route.getSyncRequestCount()).toBe(1);
    expect(route.getBackgroundSyncRequestCount()).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "View imported tickets", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByLabel("Jira sync status")).toContainText("Jira synced");
  });

  test("automatically syncs after connection and persists the visible result", async ({
    page,
    demo,
  }) => {
    const route = await routeMockJira(page);
    await createWorkspace(page, demo, "Deterministic Jira Connection");
    const dialog = await connectJira(page);
    route.setMode("hold");
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    await route.waitForSync();
    await expect(page.getByLabel("Jira sync status")).toContainText("Syncing with Jira…");
    route.release();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
    ).toBeVisible();
    await expect(page.getByText("ORBIT-999", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View imported tickets", exact: true }).click();
    await expect(page.getByRole("region", { name: "All Tickets", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Imported Jira regression ticket", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("ticketId")).toBeNull();
    await page.reload();
    await expect(page.getByLabel("Jira sync status")).toContainText("Jira synced");
    expect(
      (await snapshot(demo)).projects.some(
        (project) => project.title === "Deterministic Jira Connection",
      ),
    ).toBe(true);
  });

  test("shows a failed sync with a retry action", async ({ page, demo }) => {
    const route = await routeMockJira(page);
    await createWorkspace(page, demo, "Deterministic Jira Retry");
    const dialog = await connectJira(page);
    route.setMode("failure");
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    const status = page
      .getByRole("status")
      .filter({ hasText: "Jira sync failed for deterministic regression." });
    await expect(status).toBeVisible();
    // Creating the binding succeeds before its first sync. A failed first sync
    // leaves the configuration dialog open, so close it before exercising the
    // page-level Retry action behind the modal.
    const mirrorDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Jira sync failed for deterministic regression." });
    await expect(mirrorDialog).toBeVisible();
    await mirrorDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(mirrorDialog).not.toBeVisible();
    await status.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
    ).toBeVisible();
  });

  test("explains an empty Jira result", async ({ page, demo }) => {
    const route = await routeMockJira(page);
    await createWorkspace(page, demo, "Deterministic Jira Empty");
    const dialog = await connectJira(page);
    route.setMode("empty");
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("status").filter({
        hasText: "No Jira issues are assigned to you in this sprint.",
      }),
    ).toBeVisible();
  });

  test("requires an explicit local-data decision and leaves data untouched when deletion is canceled", async ({
    page,
    demo,
  }) => {
    const route = await routeMockJira(page);
    const workspaceId = await createWorkspace(page, demo, "Deterministic Jira Delete Choice");
    const { epic, ticket } = await seedLocalEpicAndTicket(page, demo, workspaceId);
    const dialog = await connectJira(page);
    const createButton = dialog.getByRole("button", { name: "Create mirror", exact: true });

    await expect(dialog.getByText("Existing local data", { exact: true })).toBeVisible();
    await expect(createButton).toBeDisabled();
    await dialog.getByRole("radio", { name: /Delete local data/ }).click();
    await expect(createButton).toBeEnabled();
    await createButton.click();

    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("Delete local data before importing?");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(dialog).toBeVisible();
    expect(route.getBindingCreateCount()).toBe(0);
    expect(route.getMigrationRequests()).toHaveLength(0);
    expect(route.getSyncRequestCount()).toBe(0);

    const current = await snapshot(demo);
    expect(current.epics.some((candidate) => candidate.id === epic.id)).toBe(true);
    expect(current.tickets.some((candidate) => candidate.id === ticket.id)).toBe(true);
  });

  test("publishes local Tickets and Epics before syncing, then retries without a duplicate binding", async ({
    page,
    demo,
  }) => {
    const route = await routeMockJira(page);
    const workspaceId = await createWorkspace(page, demo, "Deterministic Jira Publish Retry");
    const { epic, ticket } = await seedLocalEpicAndTicket(page, demo, workspaceId);
    const dialog = await connectJira(page);
    await dialog.getByRole("radio", { name: /Publish local data to Jira/ }).click();

    route.setMigrationMode("hold");
    await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
    await route.waitForMigration();
    expect(route.getBackgroundSyncRequestCount()).toBe(0);
    await expect(dialog.getByRole("status")).toContainText(
      "Saving the mirror and importing Jira tickets…",
    );
    await expect(
      dialog.getByRole("button", { name: "Syncing with Jira…", exact: true }),
    ).toBeDisabled();

    route.releaseMigration("failure");
    await expect(dialog.getByRole("alert")).toContainText(
      "Jira local data migration failed for deterministic regression.",
    );
    expect(route.getSyncRequestCount()).toBe(0);
    expect(route.getBindingCreateCount()).toBe(1);

    const migrationRequests = route.getMigrationRequests();
    expect(migrationRequests).toHaveLength(1);
    expect(migrationRequests[0]).toMatchObject({
      action: "publish",
      bindingId: "regression-jira-binding",
      tickets: [{ id: ticket.id, revision: ticket.revision }],
      epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
    });

    await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
    ).toBeVisible();
    expect(route.getBindingCreateCount()).toBe(1);
    expect(route.getMigrationRequests()).toHaveLength(2);
    expect(route.getSyncRequestCount()).toBe(1);
    const tags = route.getRpcTags();
    const migrateTags = tags
      .map((tag, index) =>
        tag === WORKBENCH_WS_METHODS.workbenchJiraMigrateLocalTickets ? index : -1,
      )
      .filter((index) => index >= 0);
    const syncIndex = tags.lastIndexOf(WORKBENCH_WS_METHODS.workbenchJiraSyncBinding);
    expect(migrateTags).toHaveLength(2);
    expect(syncIndex).toBeGreaterThan(migrateTags[1] ?? -1);
  });

  for (const recoveryReadFails of [false, true]) {
    test(`recovers a committed local deletion after a lost response${recoveryReadFails ? " and reconnect" : ""}`, async ({
      page,
      demo,
    }) => {
      const route = await routeMockJira(page);
      const workspaceId = await createWorkspace(page, demo, "Deterministic Jira Lost Response");
      await seedLocalEpicAndTicket(page, demo, workspaceId);
      const dialog = await connectJira(page);
      await dialog.getByRole("radio", { name: /Delete local data/ }).click();
      route.setMigrationMode("lost-response");
      route.setRecoveryReadFailure(recoveryReadFails);
      await dialog.getByRole("button", { name: "Create mirror", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete and import", exact: true })
        .click();
      if (recoveryReadFails) {
        await expect(dialog.getByRole("alert")).toContainText(
          "Migration response was lost after committing.",
        );
        await expect.poll(route.getFailedSnapshotCount).toBeGreaterThan(0);
        route.setRecoveryReadFailure(false);
        await dialog.getByRole("button", { name: "Save mirror", exact: true }).click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: "Delete and import", exact: true })
          .click();
      }
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: /Synced \d+ Jira tickets?/i }),
      ).toBeVisible();
      expect(route.getBindingCreateCount()).toBe(1);
      expect(route.getMigrationRequests()).toHaveLength(1);
      expect(route.getSyncRequestCount()).toBe(1);
    });
  }
});
