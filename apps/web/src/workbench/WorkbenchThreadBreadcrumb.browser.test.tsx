import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { type ReactNode } from "react";
import { act, render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { WorkbenchThreadBreadcrumb } from "./WorkbenchThreadBreadcrumb";

vi.mock("./state", () => ({
  workbenchEnvironment: {
    snapshot: () => snapshotQuery,
    jiraSnapshot: () => jiraSnapshotQuery,
    ticket: (target: {
      environmentId: EnvironmentId;
      input: { ticketId: WorkbenchTicketId; revision: number };
    }) => ticketQuery(JSON.stringify(target)),
  },
}));
vi.mock("../state/entities", () => ({
  useProjects: () => [project],
  useThreadShell: () => thread,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import { toastManager } from "../components/ui/toast";

const environmentId = EnvironmentId.make("archive-host");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("linked-thread"));
const project = {
  id: ProjectId.make("repository"),
  environmentId,
  title: "Repository",
  workspaceRoot: "/remote/repository",
};
const thread = { id: threadRef.threadId, projectId: project.id, worktreePath: null };
const timestamp = "2026-10-17T10:00:00.000Z";
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("archived-ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  epicId: null,
  title: "Archived requirements",
  kind: "story",
  markdown: "Preserve this archived description in the composer.",
  primaryT3ProjectId: project.id,
  repositoryProjectIds: [project.id],
  status: "done",
  blocked: false,
  revision: 2,
  archivedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const snapshot: WorkbenchSnapshot = {
  projects: [
    {
      id: ticket.projectId,
      title: "Workspace",
      linkedProjectIds: [project.id],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  reservedThreadIds: [],
  epics: [],
  tickets: [],
  ticketWorkspaces: [],
  assignments: [
    {
      id: WorkbenchAssignmentId.make("assignment"),
      ticketId: ticket.id,
      threadId: thread.id,
      createdAt: timestamp,
      supersededAt: null,
    },
  ],
};
const snapshotQuery = Atom.make(AsyncResult.success(snapshot));
// Never loads: attaching Ticket context must not wait for Jira.
const jiraSnapshotQuery = Atom.make(AsyncResult.initial());
const ticketQuery = Atom.family((_key: string) =>
  Atom.make<AsyncResult.AsyncResult<WorkbenchTicket | null, Error>>(AsyncResult.initial()),
);
const fullTicketQuery = ticketQuery(
  JSON.stringify({
    environmentId,
    input: { ticketId: ticket.id, revision: ticket.revision },
  }),
);
function setup() {
  vi.clearAllMocks();
  const registry = AtomRegistry.make();
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  useComposerDraftStore.getState().setPrompt(threadRef, "Keep my unsent request");
  return Object.assign(registry, { [Symbol.dispose]: () => registry.dispose() });
}
const mount = async (
  registry: AtomRegistry.AtomRegistry,
  record: WorkbenchTicket = { ...ticket, markdown: "", markdownOmitted: true },
) => {
  registry.set(snapshotQuery, AsyncResult.success({ ...snapshot, tickets: [record] }));
  return render(
    <RegistryContext.Provider value={registry}>
      <WorkbenchThreadBreadcrumb environmentId={environmentId} threadId={thread.id} />
    </RegistryContext.Provider>,
  );
};
const draft = () => useComposerDraftStore.getState().getComposerDraft(threadRef);

it("waits for omitted markdown before adding the archived Ticket to the native composer", async () => {
  using registry = setup();
  await using screen = await mount(registry);
  await act(async () => {
    (
      screen.getByRole("button", { name: "Add ticket context" }).element() as HTMLButtonElement
    ).click();
  });
  expect(draft()?.reviewComments).toHaveLength(0);
  expect(toastManager.add).not.toHaveBeenCalled();
  await act(async () => {
    registry.set(fullTicketQuery, AsyncResult.success(ticket));
  });
  expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
  expect(draft()?.prompt).toContain("Keep my unsent request");
  expect(toastManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it.each(["failure", "missing"])(
  "reports a %s read without adding empty context, then allows retry",
  async (outcome) => {
    using registry = setup();
    await using screen = await mount(registry);
    await act(async () => {
      (
        screen.getByRole("button", { name: "Add ticket context" }).element() as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      registry.set(
        fullTicketQuery,
        outcome === "failure"
          ? AsyncResult.failure(Cause.fail(new Error("Ticket read denied")))
          : AsyncResult.success(null),
      );
    });
    expect(draft()?.reviewComments).toHaveLength(0);
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        description: expect.stringContaining(
          outcome === "failure" ? "Ticket read denied" : "no longer exists",
        ),
      }),
    );
    await act(async () => {
      (
        screen.getByRole("button", { name: "Add ticket context" }).element() as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      registry.set(fullTicketQuery, AsyncResult.success(ticket));
    });
    expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
  },
);

it("attaches full legacy or active snapshot content without a Ticket read", async () => {
  using registry = setup();
  await using screen = await mount(registry, ticket);
  await act(async () => {
    (
      screen.getByRole("button", { name: "Add ticket context" }).element() as HTMLButtonElement
    ).click();
  });
  expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
});
