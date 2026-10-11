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
}));
vi.mock("./useWorkbenchTicketPreparations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useWorkbenchTicketPreparations")>()),
  useWorkbenchTicketPreparations: () => state.preparations,
  useWorkbenchTicketPreparationRefresh: () => state.refresh(),
}));
vi.mock("./WorkbenchPullRequestPreview", () => ({
  WorkbenchPullRequestPreviewProvider: ({ children }: { readonly children: ReactNode }) => children,
}));
// UI slots have their own interaction suites; this suite exercises installed policy
// through native consumers without mounting a board or a live environment connection.
vi.mock("./WorkbenchSidebarSlot", () => ({
  WorkbenchSidebarSlot: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./WorkbenchSidebarUtilityItem", () => ({ WorkbenchSidebarUtilityItem: () => null }));
vi.mock("./WorkbenchThreadBreadcrumb", () => ({ WorkbenchThreadBreadcrumb: () => null }));
vi.mock("./WorkbenchThreadPreparationGate", () => ({
  WorkbenchThreadPreparationGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./WorkbenchComposerPendingReviewComments", () => ({
  WorkbenchComposerPendingReviewComments: () => null,
}));
vi.mock("./useWorkbenchCommandPaletteActions", () => ({
  useWorkbenchCommandPaletteActions: () => [],
}));
vi.mock("./state", () => ({ workbenchEnvironment: { ticketPreparations: vi.fn() } }));
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
  state.refresh.mockClear();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

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
