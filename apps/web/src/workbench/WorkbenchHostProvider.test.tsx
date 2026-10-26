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
import { act, useEffect, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
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

let host: typeof import("../hostIntegrations");
let provider: typeof import("./WorkbenchHostProvider");
let composer: typeof import("../components/composerContextPresentation");
let notes: typeof import("../components/sidebar/SidebarUpdateReleaseNotes");
let renderer: ReactTestRenderer | undefined;
async function render(view: ReactElement) {
  await act(() => {
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}
function visibleText() {
  return JSON.stringify(renderer!.toJSON());
}
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

beforeAll(async () => {
  vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", "true");
  vi.resetModules();
  [host, provider, composer, notes] = await Promise.all([
    import("../hostIntegrations"),
    import("./WorkbenchHostProvider"),
    import("../components/composerContextPresentation"),
    import("../components/sidebar/SidebarUpdateReleaseNotes"),
  ]);
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.preparations = new Map();
  state.failPolicy = false;
  state.failPreview = false;
  state.failSlot = false;
  state.refresh.mockClear();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each(["/settings", "/pull-requests", "/usage"])(
  "returns from %s to the selected Workbench board after visiting other utilities",
  async (utilityPath) => {
    const {
      createMemoryHistory,
      createRootRoute,
      createRoute,
      createRouter,
      RouterContextProvider,
    } = await import("@tanstack/react-router");
    const { startMainAppLocationTracking, useNavigateToMainApp } =
      await import("../components/sidebar/mainAppLocation");
    function Navigation() {
      const back = useNavigateToMainApp();
      return <button onClick={back}>Back</button>;
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
    using _tracking = { [Symbol.dispose]: startMainAppLocationTracking(router) };
    const view = () => (
      <provider.WorkbenchHostProvider>
        <RouterContextProvider router={router}>
          <Navigation />
        </RouterContextProvider>
      </provider.WorkbenchHostProvider>
    );
    await render(view());
    const go = async (href: string) => {
      const fromLocation = router.state.location;
      await router.navigate({ href });
      const toLocation = router.state.location;
      // Node routers run in server mode and never emit onResolved themselves.
      router.emit({
        type: "onResolved",
        fromLocation,
        toLocation,
        pathChanged: fromLocation.pathname !== toLocation.pathname,
        hrefChanged: fromLocation.href !== toLocation.href,
        hashChanged: fromLocation.hash !== toLocation.hash,
      });
      // Node uses the router's server snapshot, so render the new location explicitly.
      await render(view());
    };
    const boardHref =
      "/workbench?environmentId=remote&workbenchProjectId=workspace&ticketId=ticket";
    await go(boardHref);
    await go(utilityPath);
    await go("/settings/providers");
    await act(() => renderer!.root.findByType("button").props.onClick());
    expect(router.state.location.href).toBe(boardHref);
  },
);

it("updates scoped native lists through preparation promotion without repainting static consumers", async () => {
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
  await render(view());
  expect(renderer!.root.findAllByType("li").map((item) => item.children.join(""))).toEqual(["two"]);
  const initialStaticRenders = onStaticRender.mock.calls.length;
  state.preparations = new Map([
    [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "planning" }],
  ]);
  await render(view());
  expect(renderer!.root.findAllByType("li").map((item) => item.children.join(""))).toEqual(["two"]);
  state.preparations = new Map([
    [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "working" }],
  ]);
  await render(view());
  expect(renderer!.root.findAllByType("li").map((item) => item.children.join(""))).toEqual([
    "one",
    "two",
  ]);
  expect(onStaticRender).toHaveBeenCalledTimes(initialStaticRenders);
});

it("hides the injected Ticket reference while retaining ordinary and unresolved native context", async () => {
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
  await render(chips);
  expect(
    renderer!.root.findAllByProps({ "data-composer-context-reference-hidden": "true" }),
  ).toHaveLength(0);
  expect(visibleText()).toContain("Fix onboarding");
  await render(<provider.WorkbenchHostProvider>{chips}</provider.WorkbenchHostProvider>);
  expect(
    renderer!.root.findAllByProps({ "data-composer-context-reference-hidden": "true" }),
  ).toHaveLength(1);
  expect(visibleText()).not.toContain("Fix onboarding");
  expect(visibleText()).toContain("a.ts");
  expect(visibleText()).toContain("Missing reference");
  expect(records.size).toBe(2);
});

it("uses the installed product release identity for exact Nightly links and history", async () => {
  const version = "0.0.24-nightly.20261011.6";
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
  await render(<NativeReleaseNotes />);
  expect(renderer!.root.findAllByType("a").map((anchor) => anchor.props.href)).toEqual([
    `https://github.com/pingdotgg/t3code/releases/tag/v${version}`,
    "https://github.com/pingdotgg/t3code/releases",
  ]);
  await render(
    <provider.WorkbenchHostProvider>
      <NativeReleaseNotes />
    </provider.WorkbenchHostProvider>,
  );
  expect(renderer!.root.findAllByType("a").map((anchor) => anchor.props.href)).toEqual([
    `https://github.com/filipgutica/t3code/releases/tag/workbench-daily-v${version}`,
    "https://github.com/filipgutica/t3code/releases",
  ]);
});

it("preserves the installed desktop identity for the native Codex auth handoff", async () => {
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
  await render(<NativeHandoff />);
  expect(new URL(renderer!.root.findByType("a").props.href).protocol).toBe("t3code-dev:");
  await render(
    <provider.WorkbenchHostProvider>
      <NativeHandoff />
    </provider.WorkbenchHostProvider>,
  );
  expect(new URL(renderer!.root.findByType("a").props.href).protocol).toBe("t3code-workbench-dev:");
});

it.each(["slot", "preview", "policy"])(
  "contains a throwing %s while preserving native surfaces and policy defaults",
  async (failure) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
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
    try {
      await render(view());
      state.failSlot = failure === "slot";
      state.failPreview = failure === "preview";
      state.failPolicy = failure === "policy";
      await render(view());
      expect(visibleText()).toContain("Native conversation");
      expect(visibleText()).toContain("Native sidebar");
      expect(renderer!.root.findAllByType("h1").map((node) => node.children.join(""))).toContain(
        "Native commands (0 Workbench actions)",
      );
      expect(renderer!.root.findAllByType("p").map((node) => node.children.join(""))).toEqual(
        failure === "policy" ? ["one", "two"] : ["two"],
      );
      expect(renderer!.root.findByProps({ "data-can-notify": failure === "policy" })).toBeDefined();
      if (failure === "slot") expect(visibleText()).not.toContain("Workbench breadcrumb");
    } finally {
      errors.mockRestore();
    }
  },
);
