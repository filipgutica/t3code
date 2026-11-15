import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";
import { resolvePublishedVersion } from "./remote.mts";

const commit = "4cb6945dc60ed03f567dc5daafd083e52308e82b";

test("resolves only a release tag at the integrated commit, including peeled annotated tags", () => {
  NodeAssert.equal(
    resolvePublishedVersion(
      commit,
      [
        `${"a".repeat(40)}\trefs/tags/v0.1.8-nightly.20261107.4301`,
        `${commit}\trefs/tags/v0.1.8-nightly.20261107.4301^{}`,
        `${"b".repeat(40)}\trefs/tags/v9.0.0`,
        `${commit}\trefs/tags/unpublished`,
      ].join("\n"),
    ),
    "0.1.8-nightly.20261107.4301",
  );
  NodeAssert.equal(resolvePublishedVersion(commit, `${commit}\trefs/tags/v1.2.3`), "1.2.3");
  NodeAssert.throws(
    () => resolvePublishedVersion(commit, `${"a".repeat(40)}\trefs/tags/v1.2.3`),
    /found 0/,
  );
  NodeAssert.throws(
    () =>
      resolvePublishedVersion(commit, `${commit}\trefs/tags/v1.2.3\n${commit}\trefs/tags/v1.2.4`),
    /found 2/,
  );
});
