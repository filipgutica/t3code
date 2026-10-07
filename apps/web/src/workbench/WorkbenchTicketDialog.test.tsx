// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchEpic,
  type WorkbenchJiraBinding,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import type { Project } from "../types";
import { WorkbenchTicketDialog, type WorkbenchCreateTicketDraft } from "./WorkbenchForms";
import { WorkbenchPublishTicketDialog } from "./WorkbenchPublishTicketDialog";

const timestamp = "2026-10-07T00:00:00.000Z";
const project: Project = {
  id: ProjectId.make("repository-1"),
  environmentId: EnvironmentId.make("environment-1"),
  title: "Repository",
  workspaceRoot: "/tmp/repository",
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding-1"),
  projectId: WorkbenchProjectId.make("workspace-1"),
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
  defaultPrimaryT3ProjectId: project.id,
  defaultRepositoryProjectIds: [project.id],
  statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
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
const localEpic: WorkbenchEpic = {
  id: WorkbenchEpicId.make("local-epic"),
  projectId: binding.projectId,
  title: "Local Epic",
  markdown: "",
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const jiraEpic: WorkbenchEpic = {
  ...localEpic,
  id: WorkbenchEpicId.make("jira-epic"),
  title: "Jira Epic title",
};
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("local-ticket"),
  projectId: binding.projectId,
  epicId: localEpic.id,
  title: "Publish this Ticket",
  kind: "story",
  markdown: "",
  primaryT3ProjectId: project.id,
  repositoryProjectIds: [project.id],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const onCreate = vi.fn<(draft: WorkbenchCreateTicketDraft) => Promise<boolean>>(async () => false);
const onOpenChange = vi.fn();
const props: ComponentProps<typeof WorkbenchTicketDialog> = {
  open: true,
  linkedProjects: [project],
  epics: [localEpic],
  jiraEpics: [],
  initialEpicId: localEpic.id,
  jiraBinding: binding,
  localOnlySupported: true,
  jiraOwnershipKnown: true,
  pending: false,
  error: null,
  onCreateEpic: vi.fn(),
  onOpenChange,
  onCreate,
};
const onPublish =
  vi.fn<
    (selection: { jiraSprintId: number; epicId: WorkbenchEpicId | null }) => Promise<boolean>
  >();
const onClose = vi.fn();
const publishProps: ComponentProps<typeof WorkbenchPublishTicketDialog> = {
  ticket,
  binding,
  epics: [jiraEpic],
  pending: false,
  error: null,
  onClose,
  onPublish,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  onCreate.mockResolvedValue(false);
  onPublish.mockResolvedValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const element = <T extends HTMLElement>(selector: string) => {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
};
const renderDialog = async (overrides: Partial<typeof props> = {}) => {
  await act(async () => root.render(<WorkbenchTicketDialog {...props} {...overrides} />));
};
const setTitle = async () => {
  const input = element<HTMLInputElement>("#workbench-ticket-title");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "Fix this",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const select = async (label: string, text: string) => {
  await act(async () => element<HTMLButtonElement>(`[aria-label="${label}"]`).click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (candidate) => candidate.textContent === text,
  );
  if (!option) throw new Error(`Missing option ${text}`);
  await act(async () => option.click());
};
const submit = async (formId = "create-workbench-ticket") => {
  await act(async () => {
    element<HTMLFormElement>(`#${formId}`).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
};

const renderPublication = async (overrides: Partial<typeof publishProps> = {}) => {
  await act(async () =>
    root.render(<WorkbenchPublishTicketDialog {...publishProps} {...overrides} />),
  );
};
const button = (text: string) => {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};

describe("Workbench Ticket creation destination", () => {
  it("keeps the Jira destination on servers without local-only support", async () => {
    await renderDialog({ localOnlySupported: false });
    await setTitle();
    expect(document.querySelector('[aria-label="Create in"]')).toBeNull();
    await select("Jira sprint", "Sprint 8");
    await submit();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0]?.[0].localOnly).toBeUndefined();
  });

  it("blocks a selected local destination when server support disappears", async () => {
    await renderDialog();
    await setTitle();
    await select("Create in", "Local only");
    await renderDialog({ localOnlySupported: false });
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Update this environment");
  });

  it("waits for Jira details before allowing creation, then exposes the local destination", async () => {
    await renderDialog({ jiraBinding: null, jiraOwnershipKnown: false });
    await setTitle();
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    await renderDialog();
    await select("Create in", "Local only");
    await submit();
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ localOnly: true }));
  });

  it.each([true, false])(
    "creates a local Ticket without a sprint when Jira active is %s",
    async (active) => {
      await renderDialog({ jiraBinding: { ...binding, active } });
      await setTitle();
      await submit();
      expect(onCreate).not.toHaveBeenCalled();

      await select("Create in", "Local only");
      expect(document.querySelector('[aria-label="Jira sprint"]')).toBeNull();
      expect(document.body.textContent).not.toContain("Resume the Jira connection");
      await submit();
      expect(onCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          title: "Fix this",
          localOnly: true,
          epicId: localEpic.id,
          primaryT3ProjectId: project.id,
          repositoryProjectIds: [project.id],
        }),
      );
      expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty("jiraSprintId");
    },
  );

  it("keeps Jira creation as the default and requires a selected sprint", async () => {
    await renderDialog();
    await setTitle();
    expect(element('[aria-label="Create in"]').textContent).toBe("Jira");
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    await select("Create in", "Local only");
    await select("Create in", "Jira");
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    await select("Jira sprint", "Sprint 8");
    await submit();
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: "Fix this",
        jiraSprintId: 8,
        epicId: null,
      }),
    );
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty("localOnly");
  });

  it("resets the destination when the dialog is cancelled", async () => {
    await renderDialog();
    await select("Create in", "Local only");
    await act(async () => button("Cancel").click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await renderDialog({ open: false });
    await renderDialog();
    expect(element('[aria-label="Create in"]').textContent).toBe("Jira");
    expect(element<HTMLInputElement>("#workbench-ticket-title").value).toBe("");
  });
});

describe("publishing a local Ticket to Jira", () => {
  it("requires an explicit sprint, drops the local Epic with a warning, and keeps the dialog for a safe retry", async () => {
    await renderPublication();
    expect(document.body.textContent).toContain("The local Epic will not be published");
    expect(document.body.textContent).toContain(ticket.title);
    await submit("publish-workbench-ticket");
    expect(onPublish).not.toHaveBeenCalled();
    await select("Jira sprint", "Sprint 8");
    await submit("publish-workbench-ticket");
    expect(onPublish).toHaveBeenCalledExactlyOnceWith({ jiraSprintId: 8, epicId: null });
    expect(onClose).not.toHaveBeenCalled();
    expect(element<HTMLButtonElement>('[aria-label="Jira sprint"]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[aria-label="Jira Epic"]').disabled).toBe(true);
    onPublish.mockResolvedValueOnce(true);
    await submit("publish-workbench-ticket");
    expect(onPublish.mock.calls[1]?.[0]).toEqual(onPublish.mock.calls[0]?.[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retains a Jira Epic by default, auto-selects the sole sprint, and allows removing the Epic", async () => {
    await renderPublication({
      ticket: { ...ticket, epicId: jiraEpic.id },
      binding: { ...binding, selectedSprints: [] },
    });
    expect(document.body.textContent).not.toContain("The local Epic will not be published");
    expect(document.body.textContent).toContain("Jira Epic title");
    await select("Jira Epic", "No Epic");
    await submit("publish-workbench-ticket");
    expect(onPublish).toHaveBeenCalledExactlyOnceWith({ jiraSprintId: 7, epicId: null });
  });

  it("allows choosing an available Jira Epic", async () => {
    await renderPublication({ binding: { ...binding, selectedSprints: [] } });
    await select("Jira Epic", "Jira Epic title");
    await submit("publish-workbench-ticket");
    expect(onPublish).toHaveBeenCalledExactlyOnceWith({ jiraSprintId: 7, epicId: jiraEpic.id });
  });

  it("blocks publishing a paused connection and displays the recovery action", async () => {
    await renderPublication({ binding: { ...binding, active: false, selectedSprints: [] } });
    expect(document.body.textContent).toContain("Resume the Jira connection before publishing");
    expect(button("Publish to Jira").disabled).toBe(true);
    await submit("publish-workbench-ticket");
    expect(onPublish).not.toHaveBeenCalled();
    await act(async () => button("Cancel").click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks publication and cancellation while busy and shows failures", async () => {
    await renderPublication({ pending: true, binding: { ...binding, selectedSprints: [] } });
    expect(document.body.textContent).toContain("Publishing to Jira…");
    expect(button("Cancel").disabled).toBe(true);
    await submit("publish-workbench-ticket");
    expect(onPublish).not.toHaveBeenCalled();
    await act(async () => button("Cancel").click());
    expect(onClose).not.toHaveBeenCalled();
    await renderPublication({
      error: "Jira is unavailable",
      binding: { ...binding, selectedSprints: [] },
    });
    expect(element('[role="alert"]').textContent).toBe("Jira is unavailable");
  });
});
