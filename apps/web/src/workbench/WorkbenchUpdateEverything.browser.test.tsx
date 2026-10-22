import { EnvironmentId } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { act, render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import type { UpdateEverythingMachine } from "../components/sidebar/updateEverything.logic";
import { useUpdateEverything } from "../components/sidebar/useUpdateEverything";
import type { ServerUpdateOutcome, ServerUpdateTarget } from "../components/ServerUpdateAction";

const state = vi.hoisted(() => ({
  machines: new Array<UpdateEverythingMachine>(),
  npmPublished: true,
  checkNpm: vi.fn(),
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
vi.mock("~/state/npmRelease", () => ({
  useNpmReleasePublished: (version: string | null) => {
    state.checkNpm(version);
    return state.npmPublished;
  },
}));
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

async function setup() {
  const previous = import.meta.env.VITE_T3CODE_WORKBENCH_BUILD;
  vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", "true");
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
  try {
    const provider = await import("./WorkbenchHostProvider");
    return {
      provider,
      [Symbol.dispose]() {
        vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", previous);
      },
    };
  } catch (error) {
    vi.stubEnv("VITE_T3CODE_WORKBENCH_BUILD", previous);
    throw error;
  }
}

function UpdateAction() {
  const updates = useUpdateEverything("0.0.25");
  return (
    <button
      data-skipped={updates.skipped
        .map((machine) => `${machine.label}: ${machine.reason}`)
        .join("; ")}
      onClick={() => updates.run({ installLocal: state.installLocal })}
    >
      {updates.summary}
    </button>
  );
}

it("retains the native npm server target and remote desktop updates", async () => {
  using _scope = await setup();
  await using screen = await render(<UpdateAction />);
  await expect
    .element(screen.getByRole("button"))
    .toHaveTextContent("Update this app, 2 servers, and 1 provider");
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.checkNpm).toHaveBeenCalledWith("0.0.25");
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "npm",
    "other-desktop",
  ]);
});

it.each([false, true])(
  "excludes npm targets under Workbench even when its version is published: %s",
  async (published) => {
    using scope = await setup();
    const { provider } = scope;
    state.npmPublished = published;
    await using screen = await render(
      <provider.WorkbenchHostProvider>
        <UpdateAction />
      </provider.WorkbenchHostProvider>,
    );
    await expect
      .element(screen.getByRole("button"))
      .toHaveTextContent("Update this app, 1 server, and 1 provider");
    expect(state.checkNpm).toHaveBeenCalledWith(null);
    expect(
      screen.container.querySelector<HTMLButtonElement>("button")!.getAttribute("data-skipped"),
    ).toContain("npm: npm server updates are disabled for this app");
    await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
    expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
      "other-desktop",
    ]);
    expect(state.updateProviders).toHaveBeenCalledOnce();
    expect(state.installLocal).toHaveBeenCalledOnce();
  },
);

it("preserves unreachable machine reporting when Workbench disables npm updates", async () => {
  using scope = await setup();
  const { provider } = scope;
  state.machines.push({
    ...state.machines[0]!,
    environmentId: EnvironmentId.make("offline"),
    label: "offline",
    connected: false,
  });
  await using screen = await render(
    <provider.WorkbenchHostProvider>
      <UpdateAction />
    </provider.WorkbenchHostProvider>,
  );
  const button = screen.container.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("data-skipped")).toContain("offline: not connected");
  expect(button.getAttribute("data-skipped")).toContain(
    "npm: npm server updates are disabled for this app",
  );
  await act(() => button.click());
  expect(state.updateServer.mock.calls.map(([target]) => target.serverLabel)).toEqual([
    "other-desktop",
  ]);
});
