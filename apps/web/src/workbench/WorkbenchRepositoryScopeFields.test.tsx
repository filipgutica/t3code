// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  WorkbenchTicketWorkspaceAttemptId,
  WorkbenchTicketId,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
import { WorkbenchRepositoryScopeFields } from "./WorkbenchRepositoryScopeFields";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";

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
const workspace: WorkbenchTicketWorkspace = {
  ticketId: WorkbenchTicketId.make("ticket"),
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: "workbench/ticket",
  errorMessage: null,
  repositories: [
    {
      projectId: projects[0]!.id,
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
const onChange = vi.fn();
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

function Harness({
  savedScope,
  availableProjects,
  disabled,
}: {
  savedScope: WorkbenchRepositoryScope;
  availableProjects: ReadonlyArray<Project>;
  disabled: boolean;
}) {
  const [value, setValue] = useState(savedScope);
  return (
    <>
      <button type="button">Outside</button>
      <WorkbenchRepositoryScopeFields
        projects={availableProjects}
        value={value}
        savedScope={savedScope}
        workspace={workspace}
        disabled={disabled}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    </>
  );
}
const render = async ({
  savedScope = { repositoryProjectIds: [projects[0]!.id] },
  availableProjects = projects,
  disabled = false,
}: {
  savedScope?: WorkbenchRepositoryScope;
  availableProjects?: ReadonlyArray<Project>;
  disabled?: boolean;
} = {}) => {
  await act(async () =>
    root.render(
      <Harness savedScope={savedScope} availableProjects={availableProjects} disabled={disabled} />,
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
const labelledButton = (label: string) => {
  const result = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};
const repositoryList = () =>
  document.querySelector('[aria-label="Ticket repositories"]')?.textContent ?? "";
const addRepository = async (label: string) => {
  await act(async () => button("Add repository").click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!option) throw new Error(`Missing repository option: ${label}`);
  await act(async () => option.click());
};
const menuAction = (label: string) => {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  if (!item) throw new Error(`Missing menu action: ${label}`);
  return item;
};
const bothSaved = { repositoryProjectIds: projects.map((project) => project.id) };

it("adds a repository, then removes the addition", async () => {
  await render();
  await addRepository("Additional");
  expect(repositoryList()).toContain("Adding");
  expect(onChange).toHaveBeenLastCalledWith(bothSaved);
  await act(async () => labelledButton("Actions for Additional").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(repositoryList()).not.toContain("Additional");
  expect(onChange).toHaveBeenLastCalledWith({ repositoryProjectIds: [projects[0]!.id] });
});

it("lists every repository by name and removes one of many", async () => {
  const extraProjects = Array.from({ length: 12 }, (_, index) => ({
    ...projects[1]!,
    id: ProjectId.make(`extra-${index}`),
    title: `Extra repository ${index}`,
  }));
  const availableProjects = [...projects, ...extraProjects];
  const savedScope = { repositoryProjectIds: availableProjects.map((project) => project.id) };
  await render({ availableProjects, savedScope });
  for (const project of availableProjects) expect(repositoryList()).toContain(project.title);
  await act(async () => labelledButton("Actions for Extra repository 4").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(onChange).toHaveBeenLastCalledWith({
    repositoryProjectIds: savedScope.repositoryProjectIds.filter(
      (id) => id !== ProjectId.make("extra-4"),
    ),
  });
});

it("lets an unavailable repository be removed", async () => {
  const unavailableId = ProjectId.make("unlinked-repository");
  await render({ savedScope: { repositoryProjectIds: [projects[0]!.id, unavailableId] } });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Remove it, or link it again",
  );
  await act(async () => labelledButton("Actions for Repository unavailable").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(onChange).toHaveBeenLastCalledWith({ repositoryProjectIds: [projects[0]!.id] });
});

it("stages a removal with undo that restores the saved order", async () => {
  await render({ savedScope: bothSaved });
  await act(async () => labelledButton("Actions for Primary").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(repositoryList()).toContain("Removing");
  await act(async () => button("Undo").click());
  expect(repositoryList()).not.toContain("Removing");
  expect(onChange).toHaveBeenLastCalledWith(bothSaved);
});

it("ignores an open row menu once edits become disabled", async () => {
  await render({ savedScope: bothSaved });
  await act(async () => labelledButton("Actions for Additional").click());
  await render({ savedScope: bothSaved, disabled: true });
  await act(async () => menuAction("Remove from ticket").click());
  expect(repositoryList()).not.toContain("Removing");
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps keyboard focus on the row when staging and undoing a removal", async () => {
  await render({ savedScope: bothSaved });
  await act(async () => labelledButton("Actions for Additional").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(document.activeElement).toBe(button("Undo"));
  await act(async () => button("Undo").click());
  expect(document.activeElement).toBe(labelledButton("Actions for Additional"));
});

it("leaves focus on the control that dismissed a row menu", async () => {
  await render({ savedScope: bothSaved });
  await act(async () => labelledButton("Actions for Additional").click());
  const outside = button("Outside");
  await act(async () => {
    // A real click focuses the target on mousedown, before the menu dismisses on click.
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    outside.focus();
    outside.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    outside.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(outside);
});
