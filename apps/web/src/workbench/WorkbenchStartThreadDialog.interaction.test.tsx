// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type ServerProvider,
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";

vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } =
    await import("@t3tools/contracts/settings");
  return {
    useEnvironmentSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, ...DEFAULT_SERVER_SETTINGS }),
  };
});
vi.mock("../components/chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../components/chat/TraitsPicker", () => ({ TraitsPicker: () => null }));
vi.mock("../composerDraftStore", async () => {
  const Schema = await import("effect/Schema");
  const store = {
    stickyActiveProvider: null,
    stickyModelSelectionByProvider: {},
    setStickyModelSelection: vi.fn(),
  };
  return {
    DraftId: Schema.String.pipe(Schema.brand("DraftId")),
    useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store),
  };
});

const environmentId = EnvironmentId.make("remote");
const timestamp = "2026-10-13T00:00:00.000Z";
const projects: Project[] = ["Primary", "Additional"].map((title) => ({
  id: ProjectId.make(title),
  environmentId,
  title,
  workspaceRoot: `/repos/${title}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}));
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  epicId: null,
  title: "Ship a change",
  markdown: "",
  kind: "story",
  primaryT3ProjectId: projects[0]!.id,
  repositoryProjectIds: [projects[0]!.id],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workspace: WorkbenchTicketWorkspace = {
  ticketId: ticket.id,
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: "workbench/ticket",
  errorMessage: null,
  repositories: [
    {
      projectId: ticket.primaryT3ProjectId,
      isPrimary: true,
      sourcePath: "/repos/Primary",
      worktreePath: "/worktrees/Primary",
      branchName: "workbench/ticket",
      status: "ready",
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: timestamp,
  models: [
    {
      slug: "gpt-default",
      name: "GPT Default",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
};
const onStart = vi.fn();
const onOpenChange = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (pending = false) => {
  await act(async () =>
    root.render(
      <WorkbenchStartThreadDialog
        open
        onOpenChange={onOpenChange}
        providers={[provider]}
        request={{
          environmentId,
          defaultModelSelection: null,
          ticket,
          projects,
          workspace,
          initialRepositoryScope: undefined,
          additional: true,
        }}
        pending={pending}
        onStart={onStart}
        error={null}
      />,
    ),
  );
};
const button = (label: string) => {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};
const additionalRepository = () => {
  const result = document.querySelector<HTMLButtonElement>('[role="checkbox"]');
  if (!result) throw new Error("Missing additional repository checkbox");
  return result;
};

it("edits prepared repositories in the dialog and submits the reviewed choices", async () => {
  await render();
  await act(async () => button("Edit repositories").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Primary repository"]')).not.toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => additionalRepository().click());
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: projects.map((project) => project.id),
    },
  });
});

it("cancels repository edits without abandoning thread creation and blocks edits while pending", async () => {
  await render();
  await act(async () => button("Edit repositories").click());
  await act(async () => additionalRepository().click());
  await act(async () => button("Cancel repository edits").click());
  expect(document.querySelector('[aria-label="Primary repository"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
  await render(true);
  expect(button("Edit repositories").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
});
