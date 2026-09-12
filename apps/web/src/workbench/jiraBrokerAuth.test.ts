import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decodePendingJiraBrokerAuth, serializePendingJiraBrokerAuth } from "./jiraBrokerAuth";

describe("Jira broker auth storage", () => {
  it("restores a valid pending state and preserves its originating environment", () => {
    const serialized = serializePendingJiraBrokerAuth({
      environmentId: EnvironmentId.make("environment-1"),
      state: "opaque-state",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(
      decodePendingJiraBrokerAuth({
        serialized,
        nowEpochMs: Date.parse("2026-09-11T00:00:00.000Z"),
      }),
    ).toEqual({
      environmentId: "environment-1",
      state: "opaque-state",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  });

  it("rejects malformed and expired pending state", () => {
    const nowEpochMs = Date.parse("2026-09-11T00:00:00.000Z");
    expect(decodePendingJiraBrokerAuth({ serialized: "not-json", nowEpochMs })).toBeNull();
    expect(
      decodePendingJiraBrokerAuth({
        serialized: JSON.stringify({
          environmentId: "environment-1",
          state: "opaque-state",
          expiresAt: "2026-09-10T00:00:00.000Z",
        }),
        nowEpochMs,
      }),
    ).toBeNull();
  });
});
