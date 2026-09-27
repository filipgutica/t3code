import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { WorkbenchAttentionQueries } from "./WorkbenchAttentionQueries";

const state = vi.hoisted(() => ({
  completed: new Set<number>(),
  active: new Set<string>(),
  maxActive: 0,
  refreshed: [] as string[],
  targets: [] as { kind: string; input: { number: number; host?: string; repository: string } }[],
  pending: new Set<number>(),
  errors: new Set<number>(),
  failed: new Set<number>(),
  updatedAt: 1,
  resultIdentity: {},
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: ({
    input,
  }: {
    input: { number: number; host?: string; repository: string };
  }) => {
    state.targets.push({ kind: "summary", input });
    return { kind: "summary", number: input.number };
  },
  pullRequestEnvironment: {
    activity: ({ input }: { input: { number: number; host?: string; repository: string } }) => {
      state.targets.push({ kind: "activity", input });
      return { kind: "activity", number: input.number };
    },
  },
  useSharedPullRequestSummary: (_environment: unknown, _input: unknown, data: unknown) => data,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: ({ kind, number }: { kind: string; number: number }) => {
    const key = `${kind}:${number}`;
    useEffect(() => {
      state.active.add(key);
      state.maxActive = Math.max(state.maxActive, state.active.size);
      return () => {
        state.active.delete(key);
      };
    }, [key]);
    const complete = state.completed.has(number);
    return {
      resultIdentity: state.resultIdentity,
      data: complete
        ? kind === "summary"
          ? {
              state: "open",
              checksState: state.failed.has(number) ? "failing" : "passing",
              reviewDecision: "approved",
            }
          : { reviewThreads: [], commentsTruncated: false }
        : null,
      dataUpdatedAt: complete ? state.updatedAt : null,
      error: state.errors.has(number) ? "Native PR read failed" : null,
      isPending: !complete || state.pending.has(number),
      isSuccess: complete,
      refresh: () => {
        state.refreshed.push(key);
      },
    };
  },
}));

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.completed.clear();
  state.active.clear();
  state.maxActive = 0;
  state.refreshed.length = 0;
  state.targets.length = 0;
  state.errors.clear();
  state.pending.clear();
  state.failed.clear();
  state.updatedAt = 1;
  state.resultIdentity = {};
});
afterEach(() => act(() => renderer?.unmount()));
const references = Array.from({ length: 7 }, (_, index) => ({
  projectId: ProjectId.make("repo"),
  repository: "acme/web",
  number: index + 1,
  url: `https://github.com/acme/web/pull/${index + 1}`,
}));
const environmentId = EnvironmentId.make("attention-local");

it("bounds native reads to three PRs, progresses completed batches, and unsubscribes on leaving attention", () => {
  const onChange = vi.fn();
  act(() => {
    renderer = create(
      <WorkbenchAttentionQueries
        environmentId={environmentId}
        references={references}
        refresh={false}
        onChange={onChange}
      />,
    );
  });
  expect([...state.active].sort()).toEqual([
    "activity:1",
    "activity:2",
    "activity:3",
    "summary:1",
    "summary:2",
    "summary:3",
  ]);
  for (const completed of [
    [1, 2, 3],
    [4, 5, 6],
  ]) {
    completed.forEach((number) => state.completed.add(number));
    act(() =>
      renderer.update(
        <WorkbenchAttentionQueries
          environmentId={environmentId}
          references={references}
          refresh={false}
          onChange={onChange}
        />,
      ),
    );
  }
  expect([...state.active].sort()).toEqual(["activity:7", "summary:7"]);
  expect(state.maxActive).toBe(6);
  expect([...onChange.mock.lastCall![0].values()].filter((value) => value.inspected)).toHaveLength(
    6,
  );
  act(() => renderer.unmount());
  expect(state.active.size).toBe(0);
});

it("routes both native reads by URL host and holds cached batches until fresh refresh results", () => {
  state.completed.add(1);
  const onChange = vi.fn();
  const refs = [
    {
      ...references[0]!,
      repository: "fork/other",
      url: "https://github.enterprise.test/fork/other/pull/1",
    },
  ];
  const render = () => (
    <WorkbenchAttentionQueries
      environmentId={environmentId}
      references={refs}
      refresh
      onChange={onChange}
    />
  );
  act(() => {
    renderer = create(render());
  });
  expect(state.active.size).toBe(2);
  expect(onChange.mock.lastCall![0].values().next().value.reasons).toEqual([
    "PR attention loading",
  ]);
  expect(
    state.targets.every(
      (target) =>
        target.input.host === "github.enterprise.test" && target.input.repository === "fork/other",
    ),
  ).toBe(true);
  state.resultIdentity = {};
  state.pending.add(1);
  act(() => renderer.update(render()));
  expect(state.active.size).toBe(2);
  state.pending.clear();
  state.failed.add(1);
  state.resultIdentity = {};
  state.updatedAt = 2;
  act(() => renderer.update(render()));
  expect(onChange.mock.lastCall![0].values().next().value.reasons).toEqual(["Failed PR checks"]);
  expect(state.active.size).toBe(0);
});

it("keeps a cached failed read subscribed until its retry settles and recovers coverage", () => {
  state.completed.add(1);
  state.errors.add(1);
  const onChange = vi.fn();
  const render = () => (
    <WorkbenchAttentionQueries
      environmentId={environmentId}
      references={[references[0]!]}
      refresh
      onChange={onChange}
    />
  );
  act(() => {
    renderer = create(render());
  });
  expect(state.active.size).toBe(2);
  expect(onChange.mock.lastCall![0].values().next().value.terminal).toBe(false);
  state.resultIdentity = {};
  state.pending.add(1);
  act(() => renderer.update(render()));
  expect(state.active.size).toBe(2);
  state.pending.clear();
  state.errors.clear();
  state.resultIdentity = {};
  state.updatedAt = 2;
  act(() => renderer.update(render()));
  expect(onChange.mock.lastCall![0].values().next().value.inspected).toBe(true);
  expect(state.active.size).toBe(0);
});

it("settles a fast same-error retry even when React never renders pending", () => {
  state.completed.add(1);
  state.errors.add(1);
  const onChange = vi.fn();
  const refs = [references[0]!];
  const render = () => (
    <WorkbenchAttentionQueries
      environmentId={environmentId}
      references={refs}
      refresh
      onChange={onChange}
    />
  );
  act(() => {
    renderer = create(render());
  });
  expect(state.active.size).toBe(2);
  state.resultIdentity = {};
  act(() => renderer.update(render()));
  const result = onChange.mock.lastCall![0].values().next().value;
  expect(result.reasons).toEqual(["PR attention unavailable"]);
  expect(result.terminal).toBe(true);
  expect(state.active.size).toBe(0);
});
