import { assert, describe, it } from "@effect/vitest";

import {
  validateVerifiedSyncPullRequest,
  type VerifiedSyncMergeInput,
  type VerifiedSyncPullRequest,
} from "./workbench-upstream-sync-merge.ts";

const pullRequest: VerifiedSyncPullRequest = {
  number: 42,
  state: "open",
  draft: false,
  merged: false,
  base: {
    ref: "main",
    sha: "product-sha",
    repository: "filipgutica/t3code",
  },
  head: {
    ref: "automation/workbench-upstream-sync",
    sha: "verified-sha",
    repository: "filipgutica/t3code",
  },
};

interface PullRequestOverrides {
  readonly state?: string;
  readonly draft?: boolean;
  readonly merged?: boolean;
  readonly base?: Partial<VerifiedSyncPullRequest["base"]>;
  readonly head?: Partial<VerifiedSyncPullRequest["head"]>;
}

const input = (overrides: PullRequestOverrides = {}): VerifiedSyncMergeInput => ({
  pullRequest: {
    number: pullRequest.number,
    state: overrides.state ?? pullRequest.state,
    draft: overrides.draft ?? pullRequest.draft,
    merged: overrides.merged ?? pullRequest.merged,
    base: { ...pullRequest.base, ...overrides.base },
    head: { ...pullRequest.head, ...overrides.head },
  },
  repository: "filipgutica/t3code",
  productBranch: "main",
  syncBranch: "automation/workbench-upstream-sync",
  productSha: "product-sha",
  verifiedSha: "verified-sha",
});

const assertError = (error: string | undefined, pattern: RegExp) => {
  if (error === undefined) throw new Error("Expected sync PR validation to fail");
  assert.match(error, pattern);
};

describe("validateVerifiedSyncPullRequest", () => {
  it("accepts the exact open verified sync PR", () => {
    assert.equal(validateVerifiedSyncPullRequest(input()), undefined);
  });

  it("rejects a changed product base", () => {
    assertError(
      validateVerifiedSyncPullRequest(input({ base: { sha: "new-product-sha" } })),
      /product branch changed/,
    );
  });

  it("rejects a changed sync head", () => {
    assertError(
      validateVerifiedSyncPullRequest(input({ head: { sha: "new-verified-sha" } })),
      /sync branch changed/,
    );
  });

  it("rejects a draft, closed, or fork-owned PR", () => {
    assertError(validateVerifiedSyncPullRequest(input({ draft: true })), /draft/);
    assertError(validateVerifiedSyncPullRequest(input({ state: "closed" })), /not open/);
    assertError(
      validateVerifiedSyncPullRequest(input({ head: { repository: "someone/fork" } })),
      /head repository changed/,
    );
  });
});
