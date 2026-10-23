import { type ReactNode } from "react";
import { render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, WorkbenchProjectId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PullRequestThreadLinks } from "../components/pullRequest/PullRequestThreadLinks";
import { ThreadPresentationPolicyContext } from "../hostIntegrations";
import { makeThreadFixture } from "../test-fixtures";
import { createWorkbenchThreadPresentationPolicy } from "./useWorkbenchTicketPreparations";

const state = vi.hoisted(() => ({
  threads: [] as ReturnType<typeof makeThreadFixture>[],
  link: vi.fn(),
}));
vi.mock("../state/entities", () => ({
  useThreadShells: () => state.threads,
  useThreadShell: () => null,
  useProjects: () => [],
  useServerConfigs: () =>
    new Map([
      [
        EnvironmentId.make("picker"),
        { environment: { capabilities: { threadPullRequests: true } } },
      ],
    ]),
  readProjects: () => [],
  readEnvironmentSupportsServerBrowser: () => false,
  useEnvironmentSupportsServerBrowser: () => false,
}));
vi.mock("../hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({
    mode: "multiple",
    isLinked: () => false,
    canLink: () => true,
    changeLink: state.link,
  }),
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: null, error: null }) }));
vi.mock("../state/pullRequests", () => ({ pullRequestEnvironment: { linkedThreads: () => null } }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: vi.fn() } }));
vi.mock("./state", () => ({ workbenchEnvironment: { ticketPreparations: vi.fn() } }));
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: Container, DialogPopup: Container, DialogTitle: Container };
});
vi.mock("../components/ui/command", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Command: Container,
    CommandList: Container,
    CommandInput: () => null,
    CommandItem: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
  };
});
const environmentId = EnvironmentId.make("picker");
const projectId = ProjectId.make("repo");
function setup() {
  state.link.mockReset();
  state.threads = ["planning", "working"].map((id) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, projectId, title: id }),
  );
}
it("excludes hidden planning Threads from PR candidates while retaining native linking", async () => {
  setup();
  const planningId = ThreadId.make("planning");
  const policy = createWorkbenchThreadPresentationPolicy(
    new Map([
      [
        scopedThreadKey(scopeThreadRef(environmentId, planningId)),
        {
          threadId: planningId,
          projectId: WorkbenchProjectId.make("workspace"),
          ticketId: null,
          phase: "draft",
        },
      ],
    ]),
  );
  const view = (withPolicy: boolean) => (
    <ThreadPresentationPolicyContext value={withPolicy ? policy : null}>
      <PullRequestThreadLinks
        environmentId={environmentId}
        reference={{ projectId, host: "github.com", repository: "owner/repo", number: 1 }}
        url="https://github.com/owner/repo/pull/1"
        threadRef={null}
        display="picker"
      />
    </ThreadPresentationPolicyContext>
  );
  await using screen = await render(view(true));
  expect(screen.container.querySelectorAll("button")).toHaveLength(1);
  await expect.element(screen.getByText("planning", { exact: true })).not.toBeInTheDocument();
  await screen.getByRole("button").click();
  expect(state.link).toHaveBeenCalledWith(
    scopeThreadRef(environmentId, ThreadId.make("working")),
    "https://github.com/owner/repo/pull/1",
    true,
  );
  await screen.rerender(view(false));
  expect(screen.container.querySelectorAll("button")).toHaveLength(2);
});
