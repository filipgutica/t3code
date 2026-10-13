import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { UpdateEverythingMachine } from "../components/sidebar/updateEverything.logic";
import type { ServerUpdateTarget } from "../components/ServerUpdateAction";

const state = vi.hoisted(() => ({
  machines: new Array<UpdateEverythingMachine>(),
  npmPublished: true,
  checkNpm: vi.fn(),
  updateServer: vi.fn(async (_target: ServerUpdateTarget) => {}),
  updateProviders: vi.fn(async () => {}),
  installLocal: vi.fn(async () => {}),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.machines }));
vi.mock("~/branding", () => ({ APP_VERSION: "0.0.24" }));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("~/state/session", () => ({ environmentSession: { sessionStateAtom: vi.fn() } }));
vi.mock("~/state/server", () => ({ serverEnvironment: { updateStateAtom: vi.fn() } }));
vi.mock("~/state/npmRelease", () => ({
  useNpmReleasePublished: (version: string | null) => {
    state.checkNpm(version);
    return state.npmPublished;
  },
}));
vi.mock("../components/ServerUpdateAction", () => ({
  canUpdateServer: () => true,
  useServerUpdate: () => state.updateServer,
}));
vi.mock("../components/ProviderUpdatesAction", () => ({
  useProviderUpdates: () => ({
    machines: [{ environmentId: "npm", label: "npm", candidates: [{ driver: "codex" }] }],
    updateAll: state.updateProviders,
  }),
}));
vi.mock("./useWorkbenchTicketPreparations", () => ({
  useWorkbenchTicketPreparations: () => new Map(),
  useWorkbenchTicketPreparationRefresh: () => {},
  createWorkbenchThreadPresentationPolicy: () => ({ isVisible: () => true, canNotify: () => true }),
}));
vi.mock("./WorkbenchPullRequestPreview", () => ({
  WorkbenchPullRequestPreviewProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./WorkbenchSidebarSlot", () => ({ WorkbenchSidebarSlot: () => null }));
vi.mock("./WorkbenchSidebarUtilityItem", () => ({ WorkbenchSidebarUtilityItem: () => null }));
vi.mock("./WorkbenchThreadBreadcrumb", () => ({ WorkbenchThreadBreadcrumb: () => null }));
vi.mock("./WorkbenchThreadPreparationGate", () => ({ WorkbenchThreadPreparationGate: () => null }));
vi.mock("./WorkbenchComposerPendingReviewComments", () => ({
  WorkbenchComposerPendingReviewComments: () => null,
}));
vi.mock("./useWorkbenchCommandPaletteActions", () => ({
  useWorkbenchCommandPaletteActions: () => [],
}));

let provider: typeof import("./WorkbenchHostProvider");
let useUpdateEverything: typeof import("../components/sidebar/useUpdateEverything").useUpdateEverything;
let renderer: ReactTestRenderer | undefined;

beforeAll(async () => {
  vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", "true");
  provider = await import("./WorkbenchHostProvider");
  ({ useUpdateEverything } = await import("../components/sidebar/useUpdateEverything"));
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.npmPublished = true;
  state.machines = ["npm", "other-desktop", "this-app"].map((id) => ({
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.23",
        capabilities: {
          repositoryIdentity: true,
          serverSelfUpdate: id === "npm" ? "boot-service" : "desktop-managed",
          desktopAppUpdate: id !== "npm",
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: id === "this-app",
    canMaintain: true,
    updateState: { status: "idle" },
  }));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function UpdateAction() {
  const updates = useUpdateEverything("0.0.25");
  return (
    <button onClick={() => updates.run({ installLocal: state.installLocal })}>
      {updates.summary}
    </button>
  );
}

it("retains the native npm server target and remote desktop updates", async () => {
  await act(() => {
    renderer = create(<UpdateAction />);
  });
  expect(renderer!.root.findByType("button").children).toEqual([
    "Update this app, 2 servers, and 1 provider",
  ]);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.checkNpm).toHaveBeenCalledWith("0.0.25");
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "npm",
    "other-desktop",
  ]);
});

it.each([false, true])(
  "excludes npm targets under Workbench even when its version is published: %s",
  async (published) => {
    state.npmPublished = published;
    await act(() => {
      renderer = create(
        <provider.WorkbenchHostProvider>
          <UpdateAction />
        </provider.WorkbenchHostProvider>,
      );
    });
    expect(renderer!.root.findByType("button").children).toEqual([
      "Update this app, 1 server, and 1 provider",
    ]);
    expect(state.checkNpm).toHaveBeenCalledWith(null);
    await act(() => renderer!.root.findByType("button").props.onClick());
    expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
      "other-desktop",
    ]);
    expect(state.updateProviders).toHaveBeenCalledOnce();
    expect(state.installLocal).toHaveBeenCalledOnce();
  },
);
