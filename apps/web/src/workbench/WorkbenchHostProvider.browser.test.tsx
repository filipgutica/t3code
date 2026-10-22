import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicketPreparation,
} from "@t3tools/contracts";
import { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";
import { useEffect, type ReactNode } from "react";
import { render as renderUI } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { reviewCommentContextId } from "../lib/composerContextRecords";

const state = vi.hoisted(() => ({
  preparations: new Map<string, WorkbenchTicketPreparation>(),
  refresh: vi.fn(),
  failPolicy: false,
  failPreview: false,
  failSlot: false,
}));
vi.mock("./useWorkbenchTicketPreparations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useWorkbenchTicketPreparations")>()),
  useWorkbenchTicketPreparations: () => {
    if (state.failPolicy) throw new Error("Policy failed");
    return state.preparations;
  },
  useWorkbenchTicketPreparationRefresh: () => state.refresh(),
}));
vi.mock("./WorkbenchPullRequestPreview", () => ({
  WorkbenchPullRequestPreviewProvider: ({ children }: { readonly children: ReactNode }) => {
    if (state.failPreview) throw new Error("Preview failed");
    return children;
  },
}));
// UI slots have their own interaction suites; this suite exercises installed policy
// through native consumers without mounting a board or a live environment connection.
vi.mock("./WorkbenchSidebarSlot", () => ({
  WorkbenchSidebarSlot: ({ children }: { children: ReactNode }) => {
    if (state.failSlot) throw new Error("Sidebar failed");
    return children;
  },
}));
vi.mock("./WorkbenchSidebarUtilityItem", () => ({ WorkbenchSidebarUtilityItem: () => null }));
vi.mock("./WorkbenchThreadBreadcrumb", () => ({
  WorkbenchThreadBreadcrumb: () => {
    if (state.failSlot) throw new Error("Slot failed");
    return <span>Workbench breadcrumb</span>;
  },
}));
vi.mock("./WorkbenchThreadPreparationGate", () => ({
  WorkbenchThreadPreparationGate: ({ children }: { children: ReactNode }) => {
    if (state.failSlot) throw new Error("Route failed");
    return children;
  },
}));
vi.mock("./WorkbenchComposerPendingReviewComments", () => ({
  WorkbenchComposerPendingReviewComments: () => null,
}));
vi.mock("./useWorkbenchCommandPaletteActions", () => ({
  useWorkbenchCommandPaletteActions: () => {
    if (state.failSlot) throw new Error("Command palette failed");
    return [];
  },
}));
vi.mock("./state", () => ({ workbenchEnvironment: { ticketPreparations: vi.fn() } }));
vi.mock("./workbenchOutdatedServerDescriptor", () => ({
  workbenchOutdatedServerDescriptor: vi.fn(),
}));
vi.mock("../components/ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("../components/ui/tooltip", () => {
  const Passthrough = ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>
      {render}
      {children}
    </>
  );
  return { Tooltip: Passthrough, TooltipTrigger: Passthrough, TooltipPopup: Passthrough };
});
vi.mock("../components/ui/popover", () => {
  const Passthrough = ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>
      {render}
      {children}
    </>
  );
  return {
    Popover: Passthrough,
    PopoverTrigger: Passthrough,
    PopoverPopup: Passthrough,
    PopoverTitle: Passthrough,
  };
});

const one = EnvironmentId.make("one");
const two = EnvironmentId.make("two");
const threadId = ThreadId.make("same-id");
const threads = [
  { environmentId: one, id: threadId },
  { environmentId: two, id: threadId },
];
const key = scopedThreadKey(scopeThreadRef(one, threadId));
const preparation: WorkbenchTicketPreparation = {
  threadId,
  projectId: WorkbenchProjectId.make("workspace"),
  ticketId: null,
  phase: "draft",
};
const ticketComment = {
  id: "workbench-ticket:ticket-1",
  sectionId: "workbench-ticket:ticket-1",
  sectionTitle: "Agent Workbench ticket",
  filePath: "Fix onboarding",
  startIndex: 0,
  endIndex: 1,
  rangeLabel: "Ticket context",
  text: "Fix onboarding",
  diff: "# Fix onboarding",
  fenceLanguage: "markdown",
};

async function setup() {
  const previous = import.meta.env.VITE_T3CODE_WORKBENCH_BUILD;
  vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", "true");
  state.preparations = new Map();
  state.failPolicy = false;
  state.failPreview = false;
  state.failSlot = false;
  state.refresh.mockClear();
  try {
    const [host, provider, composer, notes] = await Promise.all([
      import("../hostIntegrations"),
      import("./WorkbenchHostProvider"),
      import("../components/composerContextPresentation"),
      import("../components/sidebar/SidebarUpdateReleaseNotes"),
    ]);
    return {
      host,
      provider,
      composer,
      notes,
      [Symbol.dispose]() {
        vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", previous);
      },
    };
  } catch (error) {
    vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", previous);
    throw error;
  }
}

it.each(["/settings", "/pull-requests", "/usage"])(
  "returns from %s to the selected Workbench board after visiting other utilities",
  async (utilityPath) => {
    using scope = await setup();
    const { provider } = scope;
    const {
      createMemoryHistory,
      createRootRoute,
      createRoute,
      createRouter,
      RouterContextProvider,
    } = await import("@tanstack/react-router");
    const { MainAppLocationTracker, useNavigateToMainApp } =
      await import("../components/sidebar/mainAppLocation");
    function Navigation() {
      const back = useNavigateToMainApp();
      return (
        <>
          <MainAppLocationTracker />
          <button onClick={back}>Back</button>
        </>
      );
    }
    const root = createRootRoute();
    const routes = [
      "/",
      "/workbench",
      "/settings",
      "/settings/providers",
      "/pull-requests",
      "/usage",
    ].map((path) =>
      createRoute({
        getParentRoute: () => root,
        path,
        validateSearch: (search: Record<string, unknown>) => search,
      }),
    );
    const router = createRouter({
      routeTree: root.addChildren(routes),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const view = () => (
      <provider.WorkbenchHostProvider>
        <RouterContextProvider router={router}>
          <Navigation />
        </RouterContextProvider>
      </provider.WorkbenchHostProvider>
    );
    // This case drives a dedicated router and checks its remembered navigation.
    await using screen = await renderUI(view(), { router: false });
    const go = async (href: string) => {
      await router.navigate({ href });
      await screen.rerender(view());
    };
    const boardHref =
      "/workbench?environmentId=remote&workbenchProjectId=workspace&ticketId=ticket";
    await go(boardHref);
    await go(utilityPath);
    await go("/settings/providers");
    await screen.getByRole("button", { name: "Back" }).click();
    expect(router.state.location.href).toBe(boardHref);
  },
);

it("updates scoped native lists through preparation promotion without repainting static consumers", async () => {
  using scope = await setup();
  const { host, provider } = scope;
  const onStaticRender = vi.fn();
  function NativeList() {
    const visible = host.useVisibleThreads(threads);
    return (
      <ul>
        {visible.map((thread) => (
          <li key={thread.environmentId}>{thread.environmentId}</li>
        ))}
      </ul>
    );
  }
  function NativeStaticConsumer() {
    host.useHostIntegrations();
    useEffect(() => {
      onStaticRender();
    });
    return <h1>Native conversation</h1>;
  }
  const children = (
    <>
      <NativeList />
      <NativeStaticConsumer />
    </>
  );
  const view = () => <provider.WorkbenchHostProvider>{children}</provider.WorkbenchHostProvider>;
  state.preparations = new Map([[key, preparation]]);
  await using screen = await renderUI(view());
  expect(Array.from(screen.container.querySelectorAll("li"), (item) => item.textContent)).toEqual([
    "two",
  ]);
  const initialStaticRenders = onStaticRender.mock.calls.length;
  state.preparations = new Map([
    [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "planning" }],
  ]);
  await screen.rerender(view());
  expect(Array.from(screen.container.querySelectorAll("li"), (item) => item.textContent)).toEqual([
    "two",
  ]);
  state.preparations = new Map([
    [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "working" }],
  ]);
  await screen.rerender(view());
  expect(Array.from(screen.container.querySelectorAll("li"), (item) => item.textContent)).toEqual([
    "one",
    "two",
  ]);
  expect(onStaticRender).toHaveBeenCalledTimes(initialStaticRenders);
});

it("hides the injected Ticket reference while retaining ordinary and unresolved native context", async () => {
  using scope = await setup();
  const { provider, composer } = scope;
  const ordinary = {
    ...ticketComment,
    id: "review",
    sectionId: "file:a.ts",
    sectionTitle: "File review",
    filePath: "a.ts",
    rangeLabel: "L1",
    text: "Native file review",
    diff: "const answer = 42;",
    fenceLanguage: "typescript",
  };
  const records = composer.composerContextRecordsFromDraft({
    terminalContexts: [],
    reviewComments: [ticketComment, ordinary],
  });
  const chips = (
    <composer.ComposerContextRecordsContext value={records}>
      <composer.ComposerContextReferenceChip
        kind="review-comment"
        contextId={reviewCommentContextId(ticketComment.id)}
        label="Ticket reference"
      />
      <composer.ComposerContextReferenceChip
        kind="review-comment"
        contextId={reviewCommentContextId(ordinary.id)}
        label="Ordinary review"
      />
      <composer.ComposerContextReferenceChip
        kind="review-comment"
        contextId="missing"
        label="Missing reference"
      />
    </composer.ComposerContextRecordsContext>
  );
  await using screen = await renderUI(chips);
  expect(
    screen.container.querySelectorAll('[data-composer-context-reference-hidden="true"]'),
  ).toHaveLength(0);
  expect(screen.container.textContent).toContain("Fix onboarding");
  await screen.rerender(<provider.WorkbenchHostProvider>{chips}</provider.WorkbenchHostProvider>);
  expect(
    screen.container.querySelectorAll('[data-composer-context-reference-hidden="true"]'),
  ).toHaveLength(1);
  expect(screen.container.textContent).not.toContain("Fix onboarding");
  expect(screen.container.textContent).toContain("a.ts");
  expect(screen.container.textContent).toContain("Missing reference");
  expect(records.size).toBe(2);
});

it.each([
  ["0.0.30", "workbench-v0.0.30"],
  ["0.0.24-nightly.20261011.6", "workbench-daily-v0.0.24-nightly.20261011.6"],
])(
  "uses the installed product release identity for exact %s links and history",
  async (version, tag) => {
    using scope = await setup();
    const { host, provider, notes } = scope;
    const updateState = {
      enabled: true,
      status: "available" as const,
      channel: "nightly" as const,
      currentVersion: "0.0.23",
      hostArch: "arm64" as const,
      appArch: "arm64" as const,
      runningUnderArm64Translation: false,
      availableVersion: version,
      downloadedVersion: null,
      releaseNotes: [{ version, items: ["Ticket context"], totalItems: 1 }],
      omittedReleaseCount: 1,
      downloadPercent: null,
      checkedAt: null,
      message: null,
      errorContext: null,
      canRetry: false,
    };
    function NativeReleaseNotes() {
      const { desktopReleaseLinks } = host.useHostIntegrations();
      return (
        <notes.SidebarUpdateReleaseNotes
          releaseLinks={desktopReleaseLinks}
          shell={undefined}
          state={updateState}
          tooltip="Update available"
        />
      );
    }
    await using screen = await renderUI(<NativeReleaseNotes />);
    expect(Array.from(screen.container.querySelectorAll("a"), (anchor) => anchor.href)).toEqual([
      `https://github.com/pingdotgg/t3code/releases/tag/v${version}`,
      "https://github.com/pingdotgg/t3code/releases",
    ]);
    await screen.rerender(
      <provider.WorkbenchHostProvider>
        <NativeReleaseNotes />
      </provider.WorkbenchHostProvider>,
    );
    expect(Array.from(screen.container.querySelectorAll("a"), (anchor) => anchor.href)).toEqual([
      `https://github.com/filipgutica/t3code/releases/tag/${tag}`,
      "https://github.com/filipgutica/t3code/releases",
    ]);
  },
);

it("preserves the installed desktop identity for the native Codex auth handoff", async () => {
  using scope = await setup();
  const { host, provider } = scope;
  function NativeHandoff() {
    const handoff = host.useHostIntegrations().codexAuthHandoffUrl ?? codexAuthHandoffUrl;
    const url = handoff(
      {
        authorizationUrl: "https://auth.openai.com/api/accounts/authorize",
        returnUrl: "https://host.example/settings/providers",
        environmentId: one,
        instanceId: ProviderInstanceId.make("codex"),
        flowId: "fixture-flow",
      },
      true,
    );
    return <a href={url}>Continue sign-in</a>;
  }
  await using screen = await renderUI(<NativeHandoff />);
  expect(new URL(screen.container.querySelector<HTMLAnchorElement>("a")!.href).protocol).toBe(
    "t3code-dev:",
  );
  await screen.rerender(
    <provider.WorkbenchHostProvider>
      <NativeHandoff />
    </provider.WorkbenchHostProvider>,
  );
  expect(new URL(screen.container.querySelector<HTMLAnchorElement>("a")!.href).protocol).toBe(
    "t3code-workbench-dev:",
  );
});

it.each(["slot", "preview", "policy"])(
  "contains a throwing %s while preserving native surfaces and policy defaults",
  async (failure) => {
    using scope = await setup();
    const { host, provider } = scope;
    using _errors = vi.spyOn(console, "error").mockImplementation(() => {});
    state.preparations = new Map([[key, preparation]]);
    function NativeUI() {
      const visible = host.useVisibleThreads(threads);
      const policy = host.useThreadPresentationPolicy();
      return (
        <>
          <host.HostSidebarContent pathname="/" isElectron={false}>
            <h1>Native sidebar</h1>
          </host.HostSidebarContent>
          <host.HostThreadRouteContent threadRef={scopeThreadRef(one, threadId)}>
            <h1>Native conversation</h1>
          </host.HostThreadRouteContent>
          <host.HostCommandPaletteContributions thread={null} draftEnvironmentId={undefined}>
            {(actions) => <h1>Native commands ({actions.length} Workbench actions)</h1>}
          </host.HostCommandPaletteContributions>
          <host.HostThreadBreadcrumb environmentId={one} threadId={threadId} />
          {visible.map((thread) => (
            <p key={thread.environmentId}>{thread.environmentId}</p>
          ))}
          <span data-can-notify={policy?.canNotify(scopeThreadRef(one, threadId)) ?? true} />
        </>
      );
    }
    const view = () => (
      <provider.WorkbenchHostProvider>
        <NativeUI />
      </provider.WorkbenchHostProvider>
    );
    await using screen = await renderUI(view());
    state.failSlot = failure === "slot";
    state.failPreview = failure === "preview";
    state.failPolicy = failure === "policy";
    await screen.rerender(view());
    expect(screen.container.textContent).toContain("Native conversation");
    expect(screen.container.textContent).toContain("Native sidebar");
    expect(
      Array.from(screen.container.querySelectorAll("h1"), (node) => node.textContent),
    ).toContain("Native commands (0 Workbench actions)");
    expect(Array.from(screen.container.querySelectorAll("p"), (node) => node.textContent)).toEqual(
      failure === "policy" ? ["one", "two"] : ["two"],
    );
    expect(
      screen.container.querySelector(`[data-can-notify="${failure === "policy"}"]`),
    ).not.toBeNull();
    if (failure === "slot")
      expect(screen.container.textContent).not.toContain("Workbench breadcrumb");
  },
);
