import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import ChatMarkdown from "./ChatMarkdown";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => null,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    resultIdentity: AsyncResult.initial(),
    data: null,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("./ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("./ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlRefresh: () => vi.fn(),
  useAssetUrlState: (environmentId: EnvironmentId) => ({
    _tag: "Success",
    url: `https://${environmentId}.test/private-image.png`,
  }),
}));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => false,
  readThreadShell: () => null,
  useProjects: () =>
    ["local", "remote"].map((environmentId) => ({
      id: ProjectId.make("repo"),
      environmentId: EnvironmentId.make(environmentId),
      repositoryIdentity: {
        provider: "github",
        canonicalKey: "github.com/acme/repo",
        displayName: "acme/repo",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/repo.git",
        },
      },
    })),
  useServerConfigs: () =>
    new Map(
      ["local", "remote"].map((environmentId) => [
        EnvironmentId.make(environmentId),
        { environment: { capabilities: { pullRequests: true, threadPullRequests: true } } },
      ]),
    ),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("remote"),
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));

describe("Markdown pull request links beside a Thread", () => {
  it.each([
    { label: "foreign PR content", explicitEnvironment: "remote", expectedEnvironment: "remote" },
    {
      label: "ordinary Thread content",
      explicitEnvironment: undefined,
      expectedEnvironment: "local",
    },
  ])(
    "loads private GitHub images from $label environment",
    async ({ explicitEnvironment, expectedEnvironment }) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const localThread = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("reading"));
      let renderer: ReactTestRenderer | undefined;
      try {
        await act(() => {
          renderer = create(
            <ChatMarkdown
              cwd="/workspace/repo"
              threadRef={localThread}
              environmentId={
                explicitEnvironment === undefined
                  ? undefined
                  : EnvironmentId.make(explicitEnvironment)
              }
              text="![private](https://github.com/user-attachments/assets/2f8c1a90-1b2c-4d5e-8f90-abcdef123456)"
              githubMedia
            />,
          );
        });
        expect(renderer!.root.findByType("img").props.src).toBe(
          `https://${expectedEnvironment}.test/private-image.png`,
        );
      } finally {
        await act(() => renderer?.unmount());
        vi.clearAllMocks();
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([
    { label: "foreign PR content", explicitEnvironment: "remote", expectedEnvironment: "remote" },
    {
      label: "same-environment PR content",
      explicitEnvironment: "local",
      expectedEnvironment: "local",
    },
    {
      label: "ordinary Thread content",
      explicitEnvironment: undefined,
      expectedEnvironment: "local",
    },
  ])(
    "opens related links on the owning environment for $label",
    async ({ explicitEnvironment, expectedEnvironment }) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const localThread = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("reading"));
      let renderer: ReactTestRenderer | undefined;
      try {
        await act(() => {
          renderer = create(
            <ChatMarkdown
              cwd="/workspace/repo"
              threadRef={localThread}
              environmentId={
                explicitEnvironment === undefined
                  ? undefined
                  : EnvironmentId.make(explicitEnvironment)
              }
              text="See [related pull request](https://github.com/acme/repo/pull/43)."
            />,
          );
        });
        await act(() => {
          renderer!.root.findByType("a").props.onClick({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
          });
        });
        const surface = selectActiveRightPanelSurface(
          useRightPanelStore.getState().byThreadKey,
          localThread,
        );
        expect(surface).toMatchObject({
          kind: "pull-request",
          projectId: "repo",
          repository: "acme/repo",
          number: 43,
        });
        expect(
          surface?.kind === "pull-request"
            ? (surface.environmentId ?? localThread.environmentId)
            : null,
        ).toBe(expectedEnvironment);
        expect(navigate).not.toHaveBeenCalled();
      } finally {
        await act(() => renderer?.unmount());
        useRightPanelStore.setState({ byThreadKey: {} });
        vi.clearAllMocks();
        vi.unstubAllGlobals();
      }
    },
  );
});
