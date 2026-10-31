import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { UpdateEverythingMachine } from "../components/sidebar/updateEverything.logic";
import type { ServerUpdateOutcome, ServerUpdateTarget } from "../components/ServerUpdateAction";

const state = vi.hoisted(() => ({
  machines: new Array<UpdateEverythingMachine>(),
  updateServer: vi.fn(async (_target: ServerUpdateTarget): Promise<ServerUpdateOutcome> => ({
    status: "updated",
  })),
  updateProviders: vi.fn(async () => []),
  installLocal: vi.fn(async () => true),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (kind: string) =>
    state.machines.map((machine) =>
      kind === "updates" ? machine.updateState : machine.canMaintain,
    ),
}));
vi.mock("../components/sidebar/updateEverythingRun", () => ({
  setUpdateEverythingRun: vi.fn(),
  settleUpdateRunMachine: vi.fn(),
  waitForServerUpdateHandoff: async (
    _environmentId: EnvironmentId,
    outcome: Promise<ServerUpdateOutcome>,
  ) => {
    await outcome;
  },
  waitForUpdateRestart: async () => true,
  saveUpdateEverythingResult: vi.fn(),
  clearSavedUpdateEverythingResult: vi.fn(),
  showUpdateEverythingResult: vi.fn(),
}));
vi.mock("~/branding", () => ({ APP_VERSION: "0.0.24" }));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({
    environments: state.machines.map((machine) => ({
      environmentId: machine.environmentId,
      label: machine.label,
      serverConfig: machine.serverConfig,
      connection: { phase: machine.connected ? "connected" : "disconnected" },
      entry: {
        target: {
          _tag: machine.hostedByThisApp ? "PrimaryConnectionTarget" : "RemoteConnectionTarget",
        },
      },
    })),
  }),
}));
vi.mock("~/state/session", () => ({ environmentSessionStatesAtom: () => "sessions" }));
vi.mock("~/state/server", () => ({ environmentUpdateStatesAtom: () => "updates" }));
vi.mock("../components/ServerUpdateAction", () => ({
  canUpdateServer: (allowed: boolean) => allowed,
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
vi.mock("./workbenchOutdatedServerDescriptor", () => ({
  workbenchOutdatedServerDescriptor: vi.fn(),
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
    <button
      data-skipped={updates.rows
        .filter((machine) => machine.skipped !== null)
        .map((machine) => `${machine.label}: ${machine.skipped}`)
        .join("; ")}
      onClick={() => updates.run({ installLocal: state.installLocal })}
    >
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
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "npm",
    "other-desktop",
  ]);
});

it("excludes npm targets under Workbench", async () => {
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
  expect(renderer!.root.findByType("button").props["data-skipped"]).toContain(
    "npm: npm server updates are disabled for this app",
  );
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "other-desktop",
  ]);
  expect(state.updateProviders).toHaveBeenCalledOnce();
  expect(state.installLocal).toHaveBeenCalledOnce();
});

it("preserves unreachable machine reporting when Workbench disables npm updates", async () => {
  state.machines.push({
    ...state.machines[0]!,
    environmentId: EnvironmentId.make("offline"),
    label: "offline",
    connected: false,
  });
  await act(() => {
    renderer = create(
      <provider.WorkbenchHostProvider>
        <UpdateAction />
      </provider.WorkbenchHostProvider>,
    );
  });
  const button = renderer!.root.findByType("button");
  expect(button.props["data-skipped"]).toContain("offline: not connected");
  expect(button.props["data-skipped"]).toContain(
    "npm: npm server updates are disabled for this app",
  );
  await act(() => button.props.onClick());
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "other-desktop",
  ]);
});
