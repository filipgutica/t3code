import {
  EnvironmentId,
  ThreadId,
  WORKBENCH_REFERENCE_URL_ERROR,
  WorkbenchTicketId,
  type WorkbenchReference,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { WorkbenchDraftReferences } from "./WorkbenchReferences";
import { WorkbenchThreadReferencesMenu } from "./WorkbenchThreadReferencesMenu";
import { workbenchDescriptionLinks } from "./workbenchReferences.logic";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly kind: string }) =>
    command.kind === "add" ? mocks.add : mocks.remove,
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    addReference: { kind: "add", permissionAtom: () => "add-reference" },
    removeReference: { kind: "remove" },
  },
}));
vi.mock("../state/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/projects")>()),
  projectEnvironment: { readFile: (request: unknown) => request },
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (request: unknown) => mocks.readFile(request),
}));

const environmentId = EnvironmentId.make("environment");
const draftId = WorkbenchTicketId.make("draft-1");
const planner = ThreadId.make("thread-planner");
const time = "2026-10-27T00:00:00.000Z";
const references: ReadonlyArray<WorkbenchReference> = [
  {
    ticketId: draftId,
    url: "/home/user/.t3/userdata/workbench-artifacts/draft-1/outline.md",
    title: null,
    addedByThreadId: planner,
    createdAt: time,
  },
];

function setup() {
  useWorkbenchFloatingChatStore.setState({ shownThread: null });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  mocks.add.mockReset();
  mocks.add.mockResolvedValue({ _tag: "Success", value: undefined });
  mocks.remove.mockReset();
  mocks.readFile.mockReset();
  mocks.readFile.mockReturnValue({
    data: {
      relativePath: "outline.md",
      contents: "",
      byteLength: 0,
      truncated: false,
      exists: false,
    },
    error: null,
    isPending: false,
  });
}

const renderDraftReferences = (owned: ReadonlyArray<WorkbenchReference> = references) =>
  render(
    <WorkbenchDraftReferences
      environmentId={environmentId}
      draftId={draftId}
      references={owned}
      threadsById={new Map([[planner, { title: "Planning" }]])}
      archivedThreadsById={new Map()}
      readOnly={false}
      fileCwd="/repos/app"
      fileThreadId={planner}
    />,
  );

it("lists a legacy Reference whose URL no longer parses", async () => {
  setup();
  await using screen = await renderDraftReferences([
    { ...references[0]!, url: "legacy reference", title: "Old link" },
  ]);
  await userEvent.hover(screen.getByRole("link", { name: "Old link" }));
  await expect.element(page.getByText("Link · added by Planning")).toBeVisible();
});

it("adds a pasted URL to the draft and rejects text that is not a Reference", async () => {
  setup();
  await using screen = await renderDraftReferences();
  const input = screen.getByRole("textbox", { name: "Add a reference URL" });

  await userEvent.fill(input, "ORBIT-375");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("alert")).toHaveTextContent(WORKBENCH_REFERENCE_URL_ERROR);
  expect(mocks.add).not.toHaveBeenCalled();

  await userEvent.fill(input, "https://acme.atlassian.net/browse/ORBIT-375");
  await userEvent.keyboard("{Enter}");
  await expect.element(input).toHaveValue("");
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { ticketId: draftId, url: "https://acme.atlassian.net/browse/ORBIT-375" },
  });
});

it("shows who added a Reference and its full path on hover", async () => {
  setup();
  await using screen = await renderDraftReferences();
  await userEvent.hover(screen.getByRole("button", { name: "outline.md" }));
  await expect.element(page.getByText("File · added by Planning")).toBeVisible();
  await expect.element(page.getByText(references[0]!.url)).toBeVisible();
});

it.each(["outline.md", "mockup.html", "spec.pdf", "image.png", "mockups"])(
  "opens %s in the side panel of the Thread the floating chat shows",
  async (name) => {
    setup();
    const shownThread = {
      environmentId: EnvironmentId.make("remote-environment"),
      threadId: planner,
    };
    const reference = { ...references[0]!, url: `/work/artifacts/${name}` };
    useWorkbenchFloatingChatStore.setState({ shownThread });
    await using screen = await renderDraftReferences([reference]);
    await userEvent.click(screen.getByRole("button", { name, exact: true }));
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, shownThread),
    ).toMatchObject({ kind: "file", relativePath: reference.url });
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, {
        environmentId,
        threadId: planner,
      }),
    ).toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
  },
);

it("lists saved and description files once and opens the chosen path in the breadcrumb's Thread", async () => {
  setup();
  const remoteEnvironmentId = EnvironmentId.make("remote-environment");
  const first = { ...references[0]!, url: "/work/first/plan.md", title: "Saved plan" };
  const secondPath = "/work/second/plan.md";
  const descriptionLinks = workbenchDescriptionLinks(
    `[Duplicate](${first.url}) [Saved plan](${secondPath}) [Mockup](/work/mockup.html) [Spec](https://example.com/spec) [PR](https://github.com/acme/app/pull/3)`,
  );
  await using screen = await render(
    <WorkbenchThreadReferencesMenu
      environmentId={remoteEnvironmentId}
      threadId={planner}
      references={[first, { ...first, url: "https://github.com/acme/app/pull/4" }]}
      descriptionLinks={descriptionLinks}
    />,
  );
  await userEvent.hover(screen.getByRole("button", { name: "References, 3" }));
  await expect.element(page.getByText("References", { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "References, 3" }));
  await expect.element(page.getByRole("menuitem")).toHaveLength(3);
  const plans = page.getByRole("menuitem", { name: "Saved plan", exact: true });
  await expect.element(plans).toHaveLength(2);
  await userEvent.keyboard("{Home}");
  await expect.element(plans.nth(0)).toHaveFocus();
  await expect.element(page.getByText(first.url, { exact: true })).toBeVisible();
  await expect.element(plans.nth(0)).toHaveAccessibleDescription(first.url);
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(plans.nth(1)).toHaveFocus();
  await expect.element(plans.nth(1)).toHaveAccessibleDescription(secondPath);
  await userEvent.hover(plans.nth(1));
  await expect.element(page.getByText(secondPath, { exact: true })).toBeVisible();
  await userEvent.click(plans.nth(1));
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, {
      environmentId: remoteEnvironmentId,
      threadId: planner,
    }),
  ).toMatchObject({ kind: "file", relativePath: secondPath });
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, {
      environmentId,
      threadId: planner,
    }),
  ).toBeNull();
});

it("omits the Thread References menu when only links are present", async () => {
  setup();
  await using screen = await render(
    <WorkbenchThreadReferencesMenu
      environmentId={environmentId}
      threadId={planner}
      references={[]}
      descriptionLinks={workbenchDescriptionLinks("[Spec](https://example.com/spec)")}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: /^References,/ }))
    .not.toBeInTheDocument();
});

it("reads a file Reference through the environment and reports a missing file", async () => {
  setup();
  await using screen = await renderDraftReferences();
  await userEvent.click(screen.getByRole("button", { name: "outline.md" }));
  await expect.element(page.getByText("This file is no longer available.")).toBeVisible();
  expect(mocks.readFile).toHaveBeenCalledWith({
    environmentId,
    input: { cwd: "/repos/app", relativePath: references[0]!.url, allowMissing: true },
  });
});
