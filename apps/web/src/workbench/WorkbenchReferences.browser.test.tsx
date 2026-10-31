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
import { WorkbenchDraftReferences } from "./WorkbenchReferences";

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

const renderDraftReferences = () =>
  render(
    <WorkbenchDraftReferences
      environmentId={environmentId}
      draftId={draftId}
      references={references}
      threadsById={new Map([[planner, { title: "Planning" }]])}
      archivedThreadsById={new Map()}
      readOnly={false}
      fileCwd="/repos/app"
      fileThreadId={planner}
    />,
  );

it("adds a pasted URL to the draft and rejects text that is not a Reference", async () => {
  setup();
  await using screen = await renderDraftReferences();
  await expect.element(screen.getByText("Added by Planning")).toBeVisible();
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

it("reads a file Reference through the environment and reports a missing file", async () => {
  setup();
  await using screen = await renderDraftReferences();
  await userEvent.click(screen.getByRole("button", { name: /^outline\.md/ }));
  await expect.element(page.getByText("This file is no longer available.")).toBeVisible();
  expect(mocks.readFile).toHaveBeenCalledWith({
    environmentId,
    input: { cwd: "/repos/app", relativePath: references[0]!.url, allowMissing: true },
  });
});
