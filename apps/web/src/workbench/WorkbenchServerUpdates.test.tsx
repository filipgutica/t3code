import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { HostIntegrationsContext } from "../hostIntegrations";
import {
  OutdatedServerUpdateAction,
  ServerUpdateAction,
  ServerUpdatesAction,
  useServerUpdate,
  type ServerUpdateTarget,
} from "../components/ServerUpdateAction";

const state = vi.hoisted(() => ({ update: vi.fn(), clipboard: vi.fn() }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    _tag: "Success",
    value: { authenticated: true, scopes: ["environment:maintain"] },
  }),
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => ({
      _tag: "Success",
      value: { authenticated: true, scopes: ["environment:maintain"] },
    }),
  },
}));
vi.mock("~/state/session", () => ({ environmentSession: { sessionStateAtom: () => null } }));
vi.mock("~/state/server", () => ({
  serverEnvironment: { updateServer: Symbol("updateServer") },
  updateOutdatedServer: Symbol("updateOutdatedServer"),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.update }));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => false }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: state.clipboard }),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

let renderer: ReactTestRenderer | undefined;
const npmTarget: ServerUpdateTarget = {
  environmentId: EnvironmentId.make("npm"),
  serverLabel: "npm server",
  selfUpdate: "boot-service",
  targetVersion: "0.0.25",
};
const desktopTarget: ServerUpdateTarget = {
  ...npmTarget,
  environmentId: EnvironmentId.make("desktop"),
  serverLabel: "desktop server",
  selfUpdate: "desktop-managed",
  desktopAppUpdate: true,
};

async function mount(children: ReactNode, allowNpmServerUpdates = false) {
  await act(() => {
    renderer = create(
      <HostIntegrationsContext value={{ allowNpmServerUpdates }}>
        {children}
      </HostIntegrationsContext>,
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.update.mockResolvedValue(AsyncResult.success({ targetVersion: "0.0.25" }));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each(["boot-service", "respawn", null] as const)(
  "offers no Workbench npm update or manual command for %s",
  async (selfUpdate) => {
    await mount(<ServerUpdateAction {...npmTarget} selfUpdate={selfUpdate} />);
    const buttons = renderer!.root.findAllByType("button");
    for (const button of buttons) await act(() => button.props.onClick());
    expect(state.update).not.toHaveBeenCalled();
    expect(state.clipboard).not.toHaveBeenCalled();
    expect(buttons).toHaveLength(0);
  },
);

it.each([false, true])(
  "uses the host policy for unsupported-server updates: allow npm %s",
  async (allowNpm) => {
    await mount(<OutdatedServerUpdateAction {...npmTarget} fromVersion="0.0.23" />, allowNpm);
    const buttons = renderer!.root.findAllByType("button");
    for (const button of buttons) await act(() => button.props.onClick());
    expect(state.update).toHaveBeenCalledTimes(allowNpm ? 1 : 0);
    if (allowNpm) {
      expect(state.update).toHaveBeenCalledWith({
        environmentId: "npm",
        fromVersion: "0.0.23",
        input: { targetVersion: "0.0.25" },
      });
    }
    expect(buttons).toHaveLength(allowNpm ? 1 : 0);
  },
);

it("updates the desktop feed while excluding npm targets from a batch", async () => {
  await mount(<ServerUpdatesAction targets={[npmTarget, desktopTarget]} />);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.update.mock.calls.map(([input]) => input)).toEqual([
    { environmentId: "desktop", input: { targetVersion: "0.0.25" } },
  ]);
});

function DirectUpdate() {
  const update = useServerUpdate();
  return <button onClick={() => update(npmTarget)}>Update</button>;
}
it("blocks npm targets at the shared execution hook", async () => {
  await mount(<DirectUpdate />);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.update).not.toHaveBeenCalled();
});
