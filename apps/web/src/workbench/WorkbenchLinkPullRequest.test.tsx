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

const observed = vi.hoisted(() => ({ open: vi.fn(), mode: "multiple", phase: "connected" }));
vi.mock("../components/pullRequest/LinkPullRequestDialog", () => ({
  openLinkPullRequestDialog: observed.open,
}));
vi.mock("../hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({ mode: observed.mode }),
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: observed.phase } }),
}));
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
vi.mock("../components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  SelectPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
const environmentId = EnvironmentId.make("local-link-test");
const ticketId = WorkbenchTicketId.make("link-ticket");
const thread = (id: string): EnvironmentThreadShell => ({
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
  latestTurn: null,
  session: null,
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
const button = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType("button").find((node) => node.children.includes(text))!;

describe("Ticket PR linking", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observed.open.mockClear();
    observed.mode = "multiple";
    observed.phase = "connected";
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });
  it("opens the native dialog for the sole eligible Thread in the Ticket's environment", () => {
    act(() => {
      renderer = create(
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
    expect(observed.open).toHaveBeenCalledExactlyOnceWith({ environmentId, threadId: one.id });
  });
  it("requires an explicit Thread choice when multiple live Threads are eligible", () => {
    act(() => {
      renderer = create(
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
    expect(observed.open).not.toHaveBeenCalled();
    const labels = renderer.root.findAllByType("span").map((span) => span.children.join(""));
    expect(labels).toContain("Same title · source checkout · first");
    expect(labels).toContain("Same title · source checkout · second");
    expect(button(renderer, "Continue").props.disabled).toBe(true);
    act(() => renderer.root.findByType(Select).props.onValueChange(two.id));
    act(() => button(renderer, "Continue").props.onClick());
    expect(observed.open).toHaveBeenCalledExactlyOnceWith({ environmentId, threadId: two.id });
  });
  it.each(["missing", "archived", "settled", "foreign", "unsupported", "offline"])(
    "explains why linking is unavailable for %s",
    (reason) => {
      if (reason === "unsupported") observed.mode = "unsupported";
      if (reason === "offline") observed.phase = "offline";
      const target =
        reason === "archived"
          ? { ...one, archivedAt: "2026-09-27T00:00:00.000Z" }
          : reason === "settled"
            ? { ...one, settledOverride: "settled" as const }
            : reason === "foreign"
              ? { ...one, environmentId: EnvironmentId.make("remote") }
              : one;
      act(() => {
        renderer = create(
          <WorkbenchLinkPullRequest
            {...props}
            threadsById={reason === "missing" ? new Map() : new Map([[one.id, target]])}
          />,
        );
      });
      expect(button(renderer, "Link PR").props.disabled).toBe(true);
      expect(renderer.root.findAllByProps({ role: "status" }).length).toBeGreaterThan(0);
      expect(observed.open).not.toHaveBeenCalled();
    },
  );
});
