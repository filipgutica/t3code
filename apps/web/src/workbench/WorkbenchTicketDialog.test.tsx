// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  type WorkbenchEpic,
} from "@t3tools/contracts";
import type { Project } from "../types";
import { WorkbenchTicketDialog, type WorkbenchCreateTicketDraft } from "./WorkbenchForms";

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
const localEpic: WorkbenchEpic = {
  id: WorkbenchEpicId.make("local-epic"),
  projectId: WorkbenchProjectId.make("workspace-1"),
  title: "Local Epic",
  markdown: "",
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const onCreate = vi.fn<(draft: WorkbenchCreateTicketDraft) => Promise<boolean>>(async () => false);
const onOpenChange = vi.fn();
const props: ComponentProps<typeof WorkbenchTicketDialog> = {
  open: true,
  linkedProjects: [project],
  epics: [localEpic],
  initialEpicId: localEpic.id,
  pending: false,
  error: null,
  onCreateEpic: vi.fn(),
  onOpenChange,
  onCreate,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  onCreate.mockResolvedValue(false);
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
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const setTitle = () => type(element<HTMLInputElement>("#workbench-ticket-title"), "Fix this");
const pasteReference = async (url: string) => {
  const input = element<HTMLInputElement>('input[aria-label="Add a reference URL"]');
  await type(input, url);
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
};
const submit = async () => {
  await act(async () => {
    element<HTMLFormElement>("#create-workbench-ticket").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
};

const button = (text: string) => {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};

describe("Workbench Ticket creation", () => {
  it("creates a local Ticket in the selected Epic and Repository scope", async () => {
    await renderDialog();
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    await setTitle();
    await submit();
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: "Fix this",
        epicId: localEpic.id,
        primaryT3ProjectId: project.id,
        repositoryProjectIds: [project.id],
      }),
    );
  });

  it("stages pasted References and sends them with the new Ticket", async () => {
    await renderDialog();
    await setTitle();
    await pasteReference("ORBIT-375");
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/absolute file path/);
    await pasteReference("https://github.com/acme/app/pull/902/files");
    await pasteReference("https://github.com/acme/app/pull/902");
    await pasteReference("/home/user/notes/plan.md");
    await pasteReference("https://acme.atlassian.net/browse/ORBIT-1");
    await act(async () =>
      element<HTMLButtonElement>('button[aria-label="Remove reference ORBIT-1"]').click(),
    );
    await submit();
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        references: [
          { url: "https://github.com/acme/app/pull/902" },
          { url: "/home/user/notes/plan.md" },
        ],
      }),
    );
  });

  it("resets the draft when the dialog is cancelled", async () => {
    await renderDialog();
    await setTitle();
    await act(async () => button("Cancel").click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await renderDialog({ open: false });
    await renderDialog();
    expect(element<HTMLInputElement>("#workbench-ticket-title").value).toBe("");
  });
});
