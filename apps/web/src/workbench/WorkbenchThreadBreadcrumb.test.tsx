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
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { WorkbenchThreadBreadcrumb } from "./WorkbenchThreadBreadcrumb";

vi.mock("./state", () => ({
  workbenchEnvironment: {
    snapshot: () => snapshotQuery,
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
vi.mock("@tanstack/react-router", () => ({
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
  threadRecaps: [],
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
const ticketQuery = Atom.family((_key: string) =>
  Atom.make<AsyncResult.AsyncResult<WorkbenchTicket | null, Error>>(AsyncResult.initial()),
);
const fullTicketQuery = ticketQuery(
  JSON.stringify({
    environmentId,
    input: { ticketId: ticket.id, revision: ticket.revision },
  }),
);
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  registry = AtomRegistry.make();
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  useComposerDraftStore.getState().setPrompt(threadRef, "Keep my unsent request");
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});
const render = async (
  record: WorkbenchTicket = { ...ticket, markdown: "", markdownOmitted: true },
) => {
  registry.set(snapshotQuery, AsyncResult.success({ ...snapshot, tickets: [record] }));
  await act(async () => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <WorkbenchThreadBreadcrumb environmentId={environmentId} threadId={thread.id} />
      </RegistryContext.Provider>,
    );
  });
};
const attachButton = () => renderer!.root.findByProps({ "aria-label": "Add ticket context" });
const draft = () => useComposerDraftStore.getState().getComposerDraft(threadRef);

it("waits for omitted markdown before adding the archived Ticket to the native composer", async () => {
  await render();
  let attached: Promise<void> | undefined;
  await act(async () => {
    attached = attachButton().props.onClick();
  });
  expect(draft()?.reviewComments).toHaveLength(0);
  expect(toastManager.add).not.toHaveBeenCalled();
  await act(async () => {
    registry.set(fullTicketQuery, AsyncResult.success(ticket));
    await attached;
  });
  expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
  expect(draft()?.prompt).toContain("Keep my unsent request");
  expect(toastManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it.each(["failure", "missing"])(
  "reports a %s read without adding empty context, then allows retry",
  async (outcome) => {
    await render();
    let attached: Promise<void> | undefined;
    await act(async () => {
      attached = attachButton().props.onClick();
    });
    await act(async () => {
      registry.set(
        fullTicketQuery,
        outcome === "failure"
          ? AsyncResult.failure(Cause.fail(new Error("Ticket read denied")))
          : AsyncResult.success(null),
      );
      await attached;
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
      attached = attachButton().props.onClick();
    });
    await act(async () => {
      registry.set(fullTicketQuery, AsyncResult.success(ticket));
      await attached;
    });
    expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
  },
);

it("attaches full legacy or active snapshot content without a Ticket read", async () => {
  await render(ticket);
  await act(async () => {
    await attachButton().props.onClick();
  });
  expect(draft()?.reviewComments[0]?.diff).toContain(ticket.markdown);
});
