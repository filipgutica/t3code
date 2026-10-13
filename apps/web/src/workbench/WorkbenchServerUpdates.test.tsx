import {
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  type DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import {
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
  SshConnectionProfile,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { RegistryContext } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode, type ButtonHTMLAttributes } from "react";
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
import { workbenchOutdatedServerDescriptor } from "./workbenchOutdatedServerDescriptor";
import { environmentCatalog } from "../connection/catalog";
import { relayEnvironmentDiscovery } from "../state/relay";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  clipboard: vi.fn(),
  fetchDescriptor: vi.fn(),
  entries: new Map<EnvironmentId, ConnectionCatalogEntry>(),
  relay: new Map<
    EnvironmentId,
    { status: Option.Option<{ descriptor: ExecutionEnvironmentDescriptor }> }
  >(),
  descriptor: null as ExecutionEnvironmentDescriptor | null,
  pendingDescriptor: false,
  ensureSsh: vi.fn(),
  fetchSsh: vi.fn(),
  bootstrapSsh: vi.fn(),
}));
vi.mock("../components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@effect/atom-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@effect/atom-react")>();
  return {
    ...actual,
    useAtomValue: (atom: Parameters<typeof actual.useAtomValue>[0]) =>
      atom === null
        ? { _tag: "Success", value: { authenticated: true, scopes: ["environment:maintain"] } }
        : actual.useAtomValue(atom),
  };
});
vi.mock("../connection/runtime", async () => {
  const { Atom } = await import("effect/reactivity");
  return { connectionAtomRuntime: { atom: Atom.make } };
});
vi.mock("../connection/catalog", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentCatalog: { catalogValueAtom: Atom.make(() => ({ entries: state.entries })) },
  };
});
vi.mock("../state/relay", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    relayEnvironmentDiscovery: { stateValueAtom: Atom.make(() => ({ environments: state.relay })) },
  };
});
vi.mock("@t3tools/client-runtime/environment", async () => {
  const Effect = await import("effect/Effect");
  return {
    fetchRemoteEnvironmentDescriptor: ({ httpBaseUrl }: { httpBaseUrl: string }) =>
      Effect.suspend(() => {
        state.fetchDescriptor(httpBaseUrl);
        if (state.pendingDescriptor) return Effect.never;
        return state.descriptor
          ? Effect.succeed(state.descriptor)
          : Effect.fail("offline" as const);
      }),
  };
});
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
let registry: AtomRegistry.AtomRegistry;
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

async function mount(children: ReactNode, allowNpmServerUpdates = false, queryDescriptor = false) {
  await act(async () => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <HostIntegrationsContext
          value={{
            allowNpmServerUpdates,
            ...(queryDescriptor
              ? { outdatedServerDescriptor: workbenchOutdatedServerDescriptor }
              : {}),
          }}
        >
          {children}
        </HostIntegrationsContext>
      </RegistryContext.Provider>,
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  registry = AtomRegistry.make();
  state.entries = new Map();
  state.relay = new Map();
  state.descriptor = null;
  state.pendingDescriptor = false;
  state.ensureSsh.mockReset().mockImplementation(async (target: DesktopSshEnvironmentTarget) => ({
    target,
    httpBaseUrl: "http://127.0.0.1:3201",
    wsBaseUrl: "ws://127.0.0.1:3201/ws",
    pairingToken: null,
  }));
  state.fetchSsh.mockReset().mockImplementation(async () => state.descriptor);
  state.update.mockResolvedValue(AsyncResult.success({ targetVersion: "0.0.25" }));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
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

function sshDesktop() {
  directDesktop();
  const target: DesktopSshEnvironmentTarget = {
    alias: "desktop-ssh",
    hostname: "desktop.example.test",
    username: "developer",
    port: 22,
  };
  state.entries.set(desktopTarget.environmentId, {
    target: new SshConnectionTarget({
      environmentId: desktopTarget.environmentId,
      label: "SSH desktop",
      connectionId: "ssh-desktop",
    }),
    profile: Option.some(
      new SshConnectionProfile({
        environmentId: desktopTarget.environmentId,
        connectionId: "ssh-desktop",
        label: "SSH desktop",
        target,
      }),
    ),
    enabled: false,
  });
  vi.stubGlobal("window", {
    desktopBridge: {
      ensureSshEnvironment: state.ensureSsh,
      fetchSshEnvironmentDescriptor: state.fetchSsh,
      bootstrapSshBearerSession: state.bootstrapSsh,
    },
  });
  return target;
}

it("checks an incompatible SSH-only desktop on request without pairing, then offers its update", async () => {
  const target = sshDesktop();
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  const check = renderer!.root.findByType("button");
  expect(check.children).toEqual(["Check update availability"]);
  expect(state.ensureSsh).not.toHaveBeenCalled();
  await act(() => check.props.onClick());
  expect(state.ensureSsh).toHaveBeenCalledOnce();
  expect(state.ensureSsh).toHaveBeenCalledWith(target, { issuePairingToken: false });
  expect(state.fetchSsh).toHaveBeenCalledWith("http://127.0.0.1:3201");
  expect(state.bootstrapSsh).not.toHaveBeenCalled();
  const update = renderer!.root.findByType("button");
  expect(update.children).toEqual(["Update"]);
  await act(() => update.props.onClick());
  expect(state.update).toHaveBeenCalledWith({
    environmentId: "desktop",
    fromVersion: "0.0.23",
    input: { targetVersion: "0.0.25" },
  });
});

it("suppresses npm updates after checking an SSH-only host", async () => {
  sshDesktop();
  state.descriptor = {
    ...state.descriptor!,
    capabilities: { repositoryIdentity: true, serverSelfUpdate: "boot-service" },
  };
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(state.update).not.toHaveBeenCalled();
});

it("rejects a foreign SSH descriptor and can retry the check without updating it", async () => {
  sshDesktop();
  const matching = state.descriptor!;
  state.descriptor = { ...matching, environmentId: EnvironmentId.make("other") };
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  await act(() => renderer!.root.findByType("button").props.onClick());
  const retry = renderer!.root.findByType("button");
  expect(retry.children).toEqual(["Retry update check"]);
  expect(state.update).not.toHaveBeenCalled();
  state.descriptor = matching;
  await act(() => retry.props.onClick());
  expect(state.ensureSsh).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findByType("button").children).toEqual(["Update"]);
  expect(state.bootstrapSsh).not.toHaveBeenCalled();
});

it("keeps a rejected SSH availability check visible and retryable", async () => {
  sshDesktop();
  state.ensureSsh.mockRejectedValueOnce(new Error("SSH authentication cancelled"));
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(renderer!.root.findByType("button").children).toEqual(["Retry update check"]);
  expect(state.fetchSsh).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("does not retry a cancelled SSH check when unrelated catalog or relay state changes", async () => {
  sshDesktop();
  state.ensureSsh.mockRejectedValueOnce(new Error("SSH authentication cancelled"));
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.ensureSsh).toHaveBeenCalledOnce();
  await act(async () => registry.refresh(relayEnvironmentDiscovery.stateValueAtom));
  expect(state.ensureSsh).toHaveBeenCalledOnce();
  await act(async () => registry.refresh(environmentCatalog.catalogValueAtom));
  expect(state.ensureSsh).toHaveBeenCalledOnce();
  const retry = renderer!.root.findByType("button");
  expect(retry.children).toEqual(["Retry update check"]);
  await act(() => retry.props.onClick());
  expect(state.ensureSsh).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findByType("button").children).toEqual(["Update"]);
});

it.each([false, true])(
  "offers an unsupported desktop update only when its descriptor supports app updates: %s",
  async (desktopAppUpdate) => {
    await mount(
      <OutdatedServerUpdateAction
        {...desktopTarget}
        desktopAppUpdate={desktopAppUpdate}
        fromVersion="0.0.23"
      />,
    );
    const buttons = renderer!.root.findAllByType("button");
    for (const button of buttons) await act(() => button.props.onClick());
    expect(state.update).toHaveBeenCalledTimes(desktopAppUpdate ? 1 : 0);
    if (desktopAppUpdate) {
      expect(state.update).toHaveBeenCalledWith({
        environmentId: "desktop",
        fromVersion: "0.0.23",
        input: { targetVersion: "0.0.25" },
      });
    }
    expect(buttons).toHaveLength(desktopAppUpdate ? 1 : 0);
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

function directDesktop() {
  state.entries.set(desktopTarget.environmentId, {
    target: new PrimaryConnectionTarget({
      environmentId: desktopTarget.environmentId,
      label: "Direct desktop",
      httpBaseUrl: "https://direct.example.test",
      wsBaseUrl: "wss://direct.example.test/ws",
    }),
    profile: Option.none(),
    enabled: false,
  });
  state.descriptor = {
    environmentId: desktopTarget.environmentId,
    label: "Direct desktop",
    platform: { os: "darwin", arch: "arm64" },
    serverVersion: "0.0.23",
    capabilities: {
      repositoryIdentity: true,
      serverSelfUpdate: "desktop-managed",
      desktopAppUpdate: true,
    },
  };
}

it("updates an incompatible direct desktop with no relay discovery record", async () => {
  directDesktop();
  await mount(
    <OutdatedServerUpdateAction
      {...npmTarget}
      environmentId={desktopTarget.environmentId}
      fromVersion="0.0.23"
    />,
    false,
    true,
  );
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(state.fetchDescriptor).toHaveBeenCalledWith("https://direct.example.test");
  expect(state.update).toHaveBeenCalledWith({
    environmentId: "desktop",
    fromVersion: "0.0.23",
    input: { targetVersion: "0.0.25" },
  });
});

it("does not fall back to stale desktop props while the direct descriptor is loading", async () => {
  directDesktop();
  state.pendingDescriptor = true;
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(state.update).not.toHaveBeenCalled();
});

it("stops offering a desktop update while a previously successful descriptor refresh is pending", async () => {
  directDesktop();
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  expect(renderer!.root.findAllByType("button")).toHaveLength(1);
  state.pendingDescriptor = true;
  await act(async () =>
    registry.refresh(workbenchOutdatedServerDescriptor(desktopTarget.environmentId)),
  );
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(state.update).not.toHaveBeenCalled();
});

it("refuses a direct route belonging to another environment and keeps the check retryable", async () => {
  directDesktop();
  state.descriptor = { ...state.descriptor!, environmentId: EnvironmentId.make("other") };
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  const retry = renderer!.root.findByType("button");
  expect(retry.children).toEqual(["Retry update check"]);
  await act(() => retry.props.onClick());
  expect(state.update).not.toHaveBeenCalled();
  expect(state.fetchDescriptor).toHaveBeenCalledTimes(2);
});

it("uses the direct npm descriptor instead of stale desktop capability props", async () => {
  directDesktop();
  state.descriptor = {
    ...state.descriptor!,
    capabilities: { repositoryIdentity: true, serverSelfUpdate: "boot-service" },
  };
  await mount(<OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />, false, true);
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(state.update).not.toHaveBeenCalled();
});

it.each([false, true])(
  "validates relay descriptor identity before offering a desktop update: %s",
  async (matching) => {
    directDesktop();
    state.entries.set(desktopTarget.environmentId, {
      target: new RelayConnectionTarget({
        environmentId: desktopTarget.environmentId,
        label: "Relay desktop",
      }),
      profile: Option.none(),
      enabled: false,
    });
    state.relay.set(desktopTarget.environmentId, {
      status: Option.some({
        descriptor: {
          ...state.descriptor!,
          environmentId: matching ? desktopTarget.environmentId : EnvironmentId.make("other"),
        },
      }),
    });
    await mount(
      <OutdatedServerUpdateAction {...desktopTarget} fromVersion="0.0.23" />,
      false,
      true,
    );
    const buttons = renderer!.root.findAllByType("button");
    for (const button of buttons) await act(() => button.props.onClick());
    expect(state.update).toHaveBeenCalledTimes(matching ? 1 : 0);
    expect(state.fetchDescriptor).not.toHaveBeenCalled();
  },
);
