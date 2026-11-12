import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { makeThreadFixture } from "../test-fixtures";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Select } from "../components/ui/select";
import { WorkbenchLinkPullRequest } from "./WorkbenchLinkPullRequest";

// Environments by what they allow; each test starts with the Ticket's environment allowing all.
const observed = vi.hoisted(() => ({
  connected: [] as string[],
  supported: [] as string[],
  withGitRemote: [] as string[],
}));
vi.mock("./WorkbenchPullRequestPicker", () => ({
  WorkbenchPullRequestPicker: ({ thread }: { thread: EnvironmentThreadShell }) => (
    <div data-picker-thread={thread.id} />
  ),
}));
vi.mock("../state/environments", () => ({
  useConnectedEnvironmentIds: () => observed.connected,
}));
vi.mock("../state/entities", () => ({
  useProjects: () =>
    observed.withGitRemote.map((environmentId) => ({
      environmentId,
      repositoryIdentity: { provider: "github" },
    })),
}));
vi.mock("../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentServerConfigsAtom: Atom.make(
      () => new Map(observed.supported.map((id) => [id, { environment: { capabilities: {} } }])),
    ),
  };
});
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogPopup: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    DialogDescription: Container,
    DialogPanel: Container,
    DialogFooter: Container,
  };
});
vi.mock("../components/ui/tooltip", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Tooltip: Container,
    TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
    TooltipPopup: ({ children }: { children?: ReactNode }) => <div role="tooltip">{children}</div>,
  };
});
vi.mock("../components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  SelectPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
const environmentId = EnvironmentId.make("local-link-test");
const ticketId = WorkbenchTicketId.make("link-ticket");
const thread = (id: string): EnvironmentThreadShell =>
  makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    projectId: ProjectId.make("repo"),
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    latestRun: null,
    runtime: null,
    pullRequests: [],
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });
const assignment = (id: string): WorkbenchAssignment => ({
  id: WorkbenchAssignmentId.make(id),
  ticketId,
  threadId: ThreadId.make(id),
  supersededAt: null,
  createdAt: "2026-09-27T00:00:00.000Z",
});
const one = thread("first");
const two = thread("second");
const props = {
  environmentId,
  ticketId,
  assignments: [assignment("first")],
  threadsById: new Map([[one.id, one]]),
};
// A fresh registry reads this test's environments rather than an earlier test's.
const createWithRegistry = (element: ReactNode) =>
  create(
    <RegistryContext.Provider value={AtomRegistry.make()}>{element}</RegistryContext.Provider>,
  );
const button = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType("button").find((node) => node.children.includes(text))!;
const pickerThreads = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => node.props["data-picker-thread"] !== undefined)
    .map((node) => node.props["data-picker-thread"]);

describe("Ticket PR linking", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observed.connected = [environmentId];
    observed.supported = [environmentId];
    observed.withGitRemote = [environmentId];
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });
  it("opens the PR picker for the sole eligible Thread in the Ticket's environment", () => {
    act(() => {
      renderer = createWithRegistry(
        <WorkbenchLinkPullRequest
          {...props}
          assignments={[
            ...props.assignments,
            assignment("missing"),
            { ...assignment("second"), supersededAt: "2026-09-27T00:00:01.000Z" },
          ]}
          threadsById={
            new Map([
              [one.id, one],
              [two.id, two],
            ])
          }
        />,
      );
    });
    expect(button(renderer, "Link PR").props.disabled).toBe(false);
    act(() => button(renderer, "Link PR").props.onClick());
    expect(pickerThreads(renderer)).toEqual([one.id]);
  });
  it("requires an explicit Thread choice when multiple live Threads are eligible", () => {
    act(() => {
      renderer = createWithRegistry(
        <WorkbenchLinkPullRequest
          {...props}
          assignments={[assignment("first"), assignment("second")]}
          threadsById={
            new Map([
              [one.id, { ...one, title: "Same title" }],
              [two.id, { ...two, title: "Same title" }],
            ])
          }
        />,
      );
    });
    act(() => button(renderer, "Link PR").props.onClick());
    expect(pickerThreads(renderer)).toEqual([]);
    const labels = renderer.root.findAllByType("span").map((span) => span.children.join(""));
    expect(labels).toContain("Same title · source checkout · first");
    expect(labels).toContain("Same title · source checkout · second");
    expect(button(renderer, "Continue").props.disabled).toBe(true);
    act(() => renderer.root.findByType(Select).props.onValueChange(two.id));
    act(() => button(renderer, "Continue").props.onClick());
    expect(pickerThreads(renderer)).toEqual([two.id]);
  });
  it("links on a Thread's own machine when the Ticket's environment cannot", () => {
    const remote = EnvironmentId.make("remote");
    observed.connected = [environmentId, remote];
    observed.supported = [remote];
    observed.withGitRemote = [remote];
    const remoteThread = { ...thread("remote-thread"), environmentId: remote };
    act(() => {
      renderer = createWithRegistry(
        <WorkbenchLinkPullRequest
          {...props}
          assignments={[
            assignment("first"),
            { ...assignment("remote-thread"), environmentId: remote },
          ]}
          threadsById={
            new Map([
              [one.id, one],
              [remoteThread.id, remoteThread],
            ])
          }
        />,
      );
    });
    expect(button(renderer, "Link PR").props.disabled).toBe(false);
    act(() => button(renderer, "Link PR").props.onClick());
    expect(pickerThreads(renderer)).toEqual([remoteThread.id]);
  });
  it.each(["missing", "archived", "settled", "foreign", "unsupported", "offline", "no-host"])(
    "explains why linking is unavailable for %s",
    (reason) => {
      if (reason === "unsupported") observed.supported = [];
      if (reason === "offline") observed.connected = [];
      if (reason === "no-host") observed.withGitRemote = [];
      const target =
        reason === "archived"
          ? { ...one, archivedAt: "2026-09-27T00:00:00.000Z" }
          : reason === "settled"
            ? { ...one, settledOverride: "settled" as const }
            : reason === "foreign"
              ? { ...one, environmentId: EnvironmentId.make("remote") }
              : one;
      act(() => {
        renderer = createWithRegistry(
          <WorkbenchLinkPullRequest
            {...props}
            threadsById={reason === "missing" ? new Map() : new Map([[one.id, target]])}
          />,
        );
      });
      expect(button(renderer, "Link PR").props.disabled).toBe(true);
      expect(renderer.root.findAllByProps({ role: "tooltip" }).length).toBeGreaterThan(0);
      expect(
        renderer.root
          .findAllByType("button")
          .filter((node) => node.props["aria-label"] === "Why Link PR is unavailable"),
      ).toHaveLength(1);
      if (reason === "no-host")
        expect(renderer.root.findByProps({ role: "tooltip" }).children.join("")).toContain(
          "supported Git remote",
        );
      act(() => button(renderer, "Link PR").props.onClick());
      expect(pickerThreads(renderer)).toEqual([]);
    },
  );
});
