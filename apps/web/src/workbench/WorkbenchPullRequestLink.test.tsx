import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type PullRequestSummary } from "@t3tools/contracts";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";

const observed = vi.hoisted(() => ({
  queried: null as PullRequestSummary | null,
  cached: null as PullRequestSummary | null,
}));

vi.mock("../lib/openPullRequestLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/openPullRequestLink")>()),
  useOpenChangeRequestLink: () => () => false,
}));
vi.mock("../components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Passthrough, TooltipPopup: Passthrough, TooltipTrigger: Passthrough };
});
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: (target: unknown) => target,
  useSharedPullRequestSummary: (_environmentId: unknown, _reference: unknown, current: unknown) =>
    observed.cached ?? current,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (atom: { input: { host?: string } } | null) => {
    const summary = observed.queried;
    return {
      data: summary && atom?.input.host === new URL(summary.url).hostname ? summary : null,
      dataUpdatedAt: null,
    };
  },
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("repo");
const pullRequest = {
  projectId,
  repository: "acme/repo",
  number: 42,
  url: "https://github.com/acme/repo/pull/42",
};

describe("Workbench ticket pull request link", () => {
  it.each([
    ["single PR badge", true, pullRequest],
    [
      "multi-PR popover",
      false,
      { ...pullRequest, url: "https://github.enterprise.test/acme/repo/pull/42" },
    ],
  ] as const)(
    "updates a state-less %s to the merged glyph and color",
    async (_label, compact, reference) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      let renderer: ReactTestRenderer | undefined;
      observed.queried = null;
      observed.cached = null;
      try {
        await act(() => {
          renderer = create(
            <WorkbenchPullRequestLink
              compact={compact}
              environmentId={environmentId}
              pullRequest={reference}
            />,
          );
        });
        expect(renderer?.root.findAllByType(PullRequestGlyph.merged)).toHaveLength(0);

        observed.queried = {
          provider: "github",
          ...reference,
          title: "Finished work",
          state: "merged",
          headBranch: "feature",
          baseBranch: "main",
          updatedAt: "2026-09-25T00:00:00.000Z",
        };
        await act(() =>
          renderer?.update(
            <WorkbenchPullRequestLink
              compact={compact}
              environmentId={environmentId}
              pullRequest={reference}
            />,
          ),
        );

        expect(renderer?.root.findAllByType(PullRequestGlyph.merged)).toHaveLength(1);
        expect(
          renderer?.root
            .findAllByType("span")
            .some((span) => String(span.props.className).includes("text-violet-600")),
        ).toBe(true);
      } finally {
        await act(() => renderer?.unmount());
        observed.queried = null;
        observed.cached = null;
        vi.unstubAllGlobals();
      }
    },
  );

  it("keeps an explicit closed state when a shared summary is stale and open", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observed.cached = {
      provider: "github",
      ...pullRequest,
      title: "Old draft",
      state: "open",
      isDraft: true,
      headBranch: "feature",
      baseBranch: "main",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestLink
            compact
            environmentId={environmentId}
            pullRequest={{ ...pullRequest, state: "closed", isDraft: false }}
          />,
        );
      });
      expect(renderer?.root.findAllByType(PullRequestGlyph.closed)).toHaveLength(1);
      expect(renderer?.root.findAllByType(PullRequestGlyph.draft)).toHaveLength(0);
    } finally {
      await act(() => renderer?.unmount());
      observed.queried = null;
      observed.cached = null;
      vi.unstubAllGlobals();
    }
  });

  it("keeps a known merged summary when the supplied state is stale and open", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observed.queried = null;
    observed.cached = {
      provider: "github",
      ...pullRequest,
      title: "Merged work",
      state: "merged",
      headBranch: "feature",
      baseBranch: "main",
      updatedAt: "2026-09-25T00:00:00.000Z",
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestLink
            compact
            environmentId={environmentId}
            pullRequest={{ ...pullRequest, state: "open", isDraft: false }}
          />,
        );
      });
      expect(renderer?.root.findAllByType(PullRequestGlyph.merged)).toHaveLength(1);
    } finally {
      await act(() => renderer?.unmount());
      observed.queried = null;
      observed.cached = null;
      vi.unstubAllGlobals();
    }
  });
});
