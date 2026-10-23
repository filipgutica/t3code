import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  decryptTokens,
  encryptTokens,
  JIRA_SCOPES,
  requestTokens,
  secretField,
  type Tokens,
  type WorkbenchAuthEnv,
} from "../src/protocol.ts";

const sessionId = "Ag".repeat(22).slice(0, 43);
const challenge = "AQ".repeat(22).slice(0, 43);

const environment = (overrides: Partial<WorkbenchAuthEnv> = {}) =>
  ({
    PUBLIC_BASE_URL: "https://workbench-auth.example.workers.dev",
    ATLASSIAN_CLIENT_ID: "client-id",
    ATLASSIAN_CLIENT_SECRET: "client-secret",
    SESSION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    AUTH_SESSION: { getByName: vi.fn() },
    AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    ...overrides,
  }) as WorkbenchAuthEnv;

afterEach(() => vi.unstubAllGlobals());

describe("Workbench auth protocol", () => {
  it("requests Jira scopes needed for issue creation and sprint placement", () => {
    expect(JIRA_SCOPES.split(" ")).toEqual(
      expect.arrayContaining(["read:jira-user", "write:jira-work", "write:sprint:jira-software"]),
    );
  });

  it("distinguishes missing refresh credentials from transport failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "access",
          expires_in: 3600,
          scope: "read:jira-work",
        }),
      ),
    );
    await expect(
      requestTokens({
        env: environment(),
        grant: {
          grant_type: "authorization_code",
          code: "test-code",
          redirect_uri: "https://example.com/callback",
        },
      }),
    ).rejects.toMatchObject({ code: "missing_refresh_token", status: 502 });
  });

  it("accepts only canonical 32-byte base64url secrets", () => {
    expect(secretField({ body: { claimChallenge: challenge }, name: "claimChallenge" })).toBe(
      challenge,
    );
    expect(() =>
      secretField({ body: { claimChallenge: `${challenge}= ` }, name: "claimChallenge" }),
    ).toThrowError();
    expect(() =>
      secretField({
        body: { claimChallenge: `${challenge.slice(0, 42)}!` },
        name: "claimChallenge",
      }),
    ).toThrowError();
    expect(() =>
      secretField({
        body: { claimChallenge: `${challenge.slice(0, 42)}B` },
        name: "claimChallenge",
      }),
    ).toThrowError();
  });

  it("binds encrypted handoffs to their session id", async () => {
    const env = environment();
    const tokens: Tokens = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: "read:jira-work offline_access",
      expiresAt: "2026-09-11T12:00:00.000Z",
    };

    const encrypted = await encryptTokens({ env, sessionId, tokens });
    await expect(decryptTokens({ env, sessionId, encrypted })).resolves.toEqual(tokens);
    await expect(
      decryptTokens({ env, sessionId: "Aw".repeat(22).slice(0, 43), encrypted }),
    ).rejects.toThrow();
  });
});
