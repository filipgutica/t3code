import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type PullRequestReviewThread } from "@t3tools/contracts";
import { createWorkbenchAttentionQueries } from "./WorkbenchAttentionQueries";
import { createAttentionNativeFixture } from "./workbenchAttention.testkit";
import type { getWorkbenchPullRequestAttention } from "./workbenchAttention.logic";

let native: ReturnType<typeof createAttentionNativeFixture>;
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: (target: Parameters<typeof native.summaryQuery>[0]) =>
    native.summaryQuery(target),
  pullRequestEnvironment: {
    activity: (target: Parameters<typeof native.activityQuery>[0]) => native.activityQuery(target),
  },
  sharedPullRequestSummaryAtom: (...args: Parameters<typeof native.sharedSummary>) =>
    native.sharedSummary(...args),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    pullRequestViewer: (target: Parameters<typeof native.viewerQuery>[0]) =>
      native.viewerQuery(target),
  },
}));

const references = Array.from({ length: 7 }, (_, index) => ({
  projectId: ProjectId.make("repo"),
  repository: "acme/web",
  number: index + 1,
  url: `https://github.com/acme/web/pull/${index + 1}`,
}));
const environmentId = EnvironmentId.make("attention-local");
type Reference = (typeof references)[number];
type Input = Parameters<typeof getWorkbenchPullRequestAttention>[0];
const target = (reference: Reference) => ({
  environmentId,
  input: {
    projectId: reference.projectId,
    repository: reference.repository,
    number: reference.number,
    host: new URL(reference.url).host,
  },
});
const answer = (reference: Reference, overrides: Partial<Input> = {}): Input => ({
  reference,
  summary: {
    title: "Invite reviewers",
    state: "open",
    checksState: "passing",
    reviewDecision: "approved",
  },
  activity: { reviewThreads: [], commentsTruncated: false },
  loading: false,
  error: false,
  ...overrides,
});
let owner: ReturnType<typeof createWorkbenchAttentionQueries>;
let stop: (() => void) | undefined;
const mount = (refs: ReadonlyArray<Reference>, generation = 0, onChange = vi.fn()) => {
  const atom = owner({
    environmentId,
    entityScope: "local",
    scope: JSON.stringify([refs, generation]),
    references: refs,
    refreshGeneration: generation,
  });
  stop = native.registry.subscribe(atom, onChange, { immediate: true });
  return onChange;
};
const latest = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.lastCall![0].values().next().value;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native = createAttentionNativeFixture();
  owner = createWorkbenchAttentionQueries();
});
afterEach(async () => {
  await act(async () => stop?.());
  native.registry.dispose();
  vi.unstubAllGlobals();
});

it("bounds native reads to three PRs, progresses completed batches, and unsubscribes on leaving attention", async () => {
  const onChange = vi.fn();
  await act(async () => {
    mount(references, 0, onChange);
  });
  expect(native.activeKeys().sort()).toEqual([
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
    await act(async () => {
      for (const number of completed) {
        const reference = references[number - 1]!;
        native.publish(target(reference), answer(reference));
      }
    });
  }
  expect(native.activeKeys().sort()).toEqual(["activity:7", "summary:7"]);
  expect(native.maxActive).toBe(6);
  expect(
    [...onChange.mock.lastCall![0].values()].filter(
      (value: { inspected: boolean }) => value.inspected,
    ),
  ).toHaveLength(6);
  await act(async () => stop?.());
  expect(native.active.size).toBe(0);
});

it("initiates native refreshes for a new generation while another reader retains the cached answers", async () => {
  const reference = references[0]!;
  const request = target(reference);
  native.stage(
    request,
    answer(reference, {
      summary: {
        title: "Cached failing title",
        state: "open",
        checksState: "failing",
        reviewDecision: "approved",
      },
    }),
  );
  const keepSummary = native.registry.mount(native.summaryQuery(request));
  const keepActivity = native.registry.mount(native.activityQuery(request));
  try {
    const onChange = vi.fn();
    await act(async () => {
      mount([reference], 0, onChange);
    });
    expect(latest(onChange)).toMatchObject({
      pullRequestTitle: "Cached failing title",
      signalKinds: ["failed-checks"],
      inspected: true,
      terminal: true,
    });
    await act(async () => stop?.());
    native.stage(
      request,
      answer(reference, {
        summary: {
          title: "Fresh passing title",
          state: "open",
          checksState: "passing",
          reviewDecision: "approved",
        },
      }),
    );
    await act(async () => {
      mount([reference], 1, onChange);
    });
    expect(latest(onChange)).toMatchObject({
      pullRequestTitle: "Fresh passing title",
      signalKinds: [],
      inspected: true,
      terminal: true,
    });
  } finally {
    keepSummary();
    keepActivity();
  }
});

it("keeps observing until the viewer lookup settles, then counts discussions you answered", async () => {
  const reference = references[0]!;
  native.setViewer(environmentId, "github.com", "pending");
  const thread = (login: string): PullRequestReviewThread => ({
    id: "answered",
    path: "src/settings.ts",
    line: 12,
    side: "right",
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        id: "finding",
        author: { login: "kong-ksai", name: null, avatarUrl: null },
        body: "",
        createdAt: "2026-10-20T00:00:00.000Z",
        url: null,
      },
      {
        id: "reply",
        author: { login, name: null, avatarUrl: null },
        body: "",
        createdAt: "2026-10-20T00:00:00.000Z",
        url: null,
      },
    ],
  });
  native.stage(
    target(reference),
    answer(reference, {
      activity: { reviewThreads: [thread("filipgutica")], commentsTruncated: false },
    }),
  );
  const onChange = vi.fn();
  await act(async () => {
    mount([reference], 0, onChange);
  });
  expect(latest(onChange)).toMatchObject({ terminal: false, inspectionStatus: "loading" });
  await act(async () => native.setViewer(environmentId, "github.com", "settled"));
  expect(latest(onChange)).toMatchObject({ terminal: true, signalKinds: [] });
  await act(async () => stop?.());
  native.setViewer(environmentId, "github.com", "failed");
  await act(async () => {
    mount([reference], 0, onChange);
  });
  expect(latest(onChange)).toMatchObject({ terminal: true, signalKinds: ["unresolved-feedback"] });
});

it.each(["open", "closed"] as const)(
  "routes native reads by URL host and holds a cached %s PR until fresh refresh results",
  async (cachedState) => {
    const reference = {
      ...references[0]!,
      state: "open" as const,
      repository: "fork/other",
      url: "https://github.enterprise.test/fork/other/pull/1",
    };
    native.stage(
      target(reference),
      answer(reference, {
        summary: { state: cachedState, checksState: "passing", reviewDecision: "approved" },
      }),
    );
    const onChange = vi.fn();
    await act(async () => {
      mount([reference], 1, onChange);
    });
    expect(native.active.size).toBe(2);
    expect(latest(onChange).reasons).toEqual(["PR attention loading"]);
    expect(
      native.targets.every(
        ({ target }) =>
          target.input.host === "github.enterprise.test" &&
          target.input.repository === "fork/other",
      ),
    ).toBe(true);
    await act(async () => native.publish(target(reference), answer(reference, { loading: true })));
    expect(native.active.size).toBe(2);
    await act(async () =>
      native.publish(
        target(reference),
        answer(reference, {
          summary: { state: "open", checksState: "failing", reviewDecision: "approved" },
        }),
      ),
    );
    expect(latest(onChange).reasons).toEqual(["Failed PR checks"]);
    expect(native.active.size).toBe(0);
  },
);

it("keeps a cached failed read subscribed until its retry settles and recovers coverage", async () => {
  const reference = references[0]!;
  native.stage(target(reference), answer(reference, { error: true }));
  const onChange = vi.fn();
  await act(async () => {
    mount([reference], 1, onChange);
  });
  expect(native.active.size).toBe(2);
  expect(latest(onChange).terminal).toBe(false);
  await act(async () =>
    native.publish(target(reference), answer(reference, { loading: true, error: true })),
  );
  expect(native.active.size).toBe(2);
  await act(async () => native.publish(target(reference), answer(reference)));
  expect(latest(onChange).inspected).toBe(true);
  expect(native.active.size).toBe(0);
});

it("settles a fast same-error retry even when React never renders pending", async () => {
  const reference = references[0]!;
  native.stage(target(reference), answer(reference, { error: true }));
  const onChange = vi.fn();
  await act(async () => {
    mount([reference], 1, onChange);
  });
  expect(native.active.size).toBe(2);
  await act(async () => native.publish(target(reference), answer(reference, { error: true })));
  expect(latest(onChange).reasons).toEqual(["PR attention unavailable"]);
  expect(latest(onChange).terminal).toBe(true);
  expect(native.active.size).toBe(0);
});

it("publishes title changes, discussion details and resolved targets while inspection is still loading", async () => {
  const reference = references[0]!;
  const first: PullRequestReviewThread = {
    id: "feedback-one",
    path: "src/invitations.ts",
    line: 12,
    side: "right",
    isResolved: false,
    isOutdated: false,
    comments: [],
  };
  native.stage(
    target(reference),
    answer(reference, {
      activity: { reviewThreads: [first], commentsTruncated: false },
      loading: true,
    }),
  );
  const onChange = vi.fn();
  await act(async () => {
    mount([reference], 0, onChange);
  });
  await act(async () =>
    native.publish(
      target(reference),
      answer(reference, {
        summary: {
          title: "Keep invitation claims",
          state: "open",
          checksState: "passing",
          reviewDecision: "approved",
        },
        activity: { reviewThreads: [first], commentsTruncated: false },
        loading: true,
      }),
    ),
  );
  expect(latest(onChange).pullRequestTitle).toBe("Keep invitation claims");
  const second = { ...first, id: "feedback-two", path: "src/settings.ts", line: 23 };
  await act(async () =>
    native.publish(
      target(reference),
      answer(reference, {
        activity: { reviewThreads: [first, second], commentsTruncated: false },
        loading: true,
      }),
    ),
  );
  expect(latest(onChange).signalKinds).toEqual(["unresolved-feedback"]);
  expect(latest(onChange).unresolvedReviewThreads).toEqual([first, second]);
  expect(latest(onChange).inspectionStatus).toBe("loading");
  await act(async () =>
    native.publish(
      target(reference),
      answer(reference, {
        activity: {
          reviewThreads: [
            { ...first, isResolved: true },
            { ...second, isResolved: true },
          ],
          commentsTruncated: false,
        },
        loading: true,
      }),
    ),
  );
  expect(latest(onChange).resolvedReviewThreadIds).toEqual([first.id, second.id]);
  await act(async () =>
    native.publish(
      target(reference),
      answer(reference, {
        activity: { reviewThreads: [{ ...first, isResolved: true }], commentsTruncated: false },
        loading: true,
      }),
    ),
  );
  expect(latest(onChange).resolvedReviewThreadIds).toEqual([first.id]);
});
